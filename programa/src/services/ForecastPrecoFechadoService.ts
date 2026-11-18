import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { estadoDoPrecoFechado, type EstadoDoPrecoFechado } from '../utils/forecastPrecoFechado';
import { HttpError } from '../utils/http';
import { dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import type { ForecastPrecoFechadoPutInput } from '../validators/forecast';
import { AuditLogService } from './AuditLogService';
import type { FrozenProduct } from './ForecastSnapshotService';

const ENTITY_TYPE = 'forecast_product';

export interface PrecoFechadoDoItem {
  productId: number;
  estado: EstadoDoPrecoFechado;
  valorPorKg: number | null;
  moeda: string | null;
  incoterm: string | null;
  /** AAAA-MM-DD. */
  validoAte: string | null;
}

export const PRECO_FECHADO_SELECT = {
  id: true,
  fixedPriceFlag: true,
  fixedPrice: true,
  fixedPriceCurrency: true,
  fixedPriceIncoterm: true,
  fixedPriceValidUntil: true,
} satisfies Prisma.ForecastProductSelect;

type Linha = Prisma.ForecastProductGetPayload<{ select: typeof PRECO_FECHADO_SELECT }>;

/** Termos do preco fechado do CADASTRO atual -> forma da API (valor como numero, validade como AAAA-MM-DD). */
export function precoDoCadastro(p: Linha, hoje: string): PrecoFechadoDoItem {
  const termos = {
    valorPorKg: p.fixedPrice === null ? null : Number(p.fixedPrice),
    moeda: p.fixedPriceCurrency,
    incoterm: p.fixedPriceIncoterm,
    validoAte: p.fixedPriceValidUntil === null ? null : dbDateToKey(p.fixedPriceValidUntil),
  };
  return { productId: p.id, estado: estadoDoPrecoFechado(termos, hoje), ...termos };
}

// Preco fechado do Forecast: leitura em lista (para a tela do relatorio) e gravacao por produto. O VALOR so sai por aqui e
// pelo envio da PO direta, sempre atras de admin/comprador; o AuditLog nunca guarda o valor (so se ha preco, moeda, incoterm e
// validade). O selo (`fixedPriceFlag`) vem da planilha (X da coluna AV): aqui so se define o preco de quem ja tem o selo.
export class ForecastPrecoFechadoService {
  /** Precos dos produtos DESTA quinzena que hoje tem o selo no cadastro (so os de preco fechado entram na lista). */
  static async listar(snapshotId: number, agora: Date = new Date()): Promise<{ hoje: string; itens: PrecoFechadoDoItem[] }> {
    const snapshot = await prisma.forecastSnapshot.findFirst({
      where: { id: snapshotId, deletedAt: null },
      select: { products: true },
    });
    if (!snapshot) throw new HttpError(404, 'Quinzena não encontrada.');
    const ids = [
      ...new Set(
        (snapshot.products as unknown as FrozenProduct[]).flatMap((p) => (p.productId != null ? [p.productId] : [])),
      ),
    ];
    const hoje = todayKeyInSaoPaulo(agora);
    if (ids.length === 0) return { hoje, itens: [] };
    const linhas = await prisma.forecastProduct.findMany({
      where: { id: { in: ids }, fixedPriceFlag: true },
      orderBy: { id: 'asc' },
      select: PRECO_FECHADO_SELECT,
    });
    return { hoje, itens: linhas.map((l) => precoDoCadastro(l, hoje)) };
  }

  /** Define (ou remove, com `limpar`) o preco fechado do produto. So produto com o selo da planilha. */
  static async gravar(
    productId: number,
    input: ForecastPrecoFechadoPutInput,
    userId: number | null,
    agora: Date = new Date(),
  ): Promise<PrecoFechadoDoItem> {
    const hoje = todayKeyInSaoPaulo(agora);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`forecast:preco:${productId}`}))`;
      const antes = await tx.forecastProduct.findUnique({ where: { id: productId }, select: PRECO_FECHADO_SELECT });
      if (!antes) throw new HttpError(404, 'Produto não encontrado.');
      if (!antes.fixedPriceFlag) {
        throw new HttpError(409, 'O item não está marcado como preço fechado na planilha (coluna AV).');
      }
      const limpar = input.limpar === true;
      const depois = await tx.forecastProduct.update({
        where: { id: productId },
        data: limpar
          ? { fixedPrice: null, fixedPriceCurrency: null, fixedPriceIncoterm: null, fixedPriceValidUntil: null }
          : {
              fixedPrice: input.valorPorKg,
              fixedPriceCurrency: input.moeda,
              fixedPriceIncoterm: input.incoterm,
              fixedPriceValidUntil: dateKeyToDbDate(input.validoAte as string),
            },
        select: PRECO_FECHADO_SELECT,
      });
      const a = precoDoCadastro(antes, hoje);
      const d = precoDoCadastro(depois, hoje);
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: productId,
          action: 'update',
          performedById: userId,
          // Nunca o valor: so se havia preco antes/depois e os termos que nao sao o valor.
          metadata: {
            via: 'preco-fechado',
            acao: limpar ? 'removido' : a.valorPorKg === null ? 'definido' : 'alterado',
            antes: { comValor: a.valorPorKg !== null, moeda: a.moeda, incoterm: a.incoterm, validoAte: a.validoAte },
            depois: { comValor: d.valorPorKg !== null, moeda: d.moeda, incoterm: d.incoterm, validoAte: d.validoAte },
          },
        },
        tx,
      );
      return d;
    });
  }
}
