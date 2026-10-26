import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ForecastMesesAtipicosPutInput } from '../validators/forecast';
import type { MesMarcado } from '../utils/forecastMesesAtipicos';
import { HttpError } from '../utils/http';
import { AuditLogService } from './AuditLogService';
import {
  CADASTRO_OCUPADO_MESSAGE,
  CADASTRO_TX_OPTIONS,
  isTransactionTimeout,
  lockForecastProduct,
} from './ForecastProductCadastroService';

type Db = Prisma.TransactionClient | typeof prisma;

const ENTITY_TYPE = 'forecast_product';

export interface ForecastMesesAtipicosData {
  productId: number;
  /** Conjunto de meses marcados DEPOIS da gravacao (todos, inclusive os fora da janela informada), em ordem cronologica. */
  meses: MesMarcado[];
}

const porAnoMes = (a: MesMarcado, b: MesMarcado) => (a.anoMes < b.anoMes ? -1 : a.anoMes > b.anoMes ? 1 : 0);

// Meses de venda atipica (PR 6c): ficam FORA das medias trimestral/semestral do produto. A marca mora no cadastro do
// produto (nao na quinzena), vale em toda quinzena cuja janela contem o mes e e lida do cadastro ATUAL.
export class ForecastMesesAtipicosService {
  // Substitui o conjunto. Sem `janela`: o conjunto inteiro do produto vira `meses`. Com `janela` (os meses que a tela
  // mostrou): so os meses da janela sao substituidos; as marcas de outros meses (de outras quinzenas) ficam como estao.
  // Sem alteracao nao grava nem audita. O AuditLog guarda so ano-mes e contagens: nunca o texto do motivo.
  static async substituir(
    productId: number,
    input: ForecastMesesAtipicosPutInput,
    userId: number | null,
  ): Promise<ForecastMesesAtipicosData> {
    try {
      return await this.substituirNaTransacao(productId, input, userId);
    } catch (error) {
      if (isTransactionTimeout(error)) throw new HttpError(503, CADASTRO_OCUPADO_MESSAGE);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Os meses atípicos deste produto foram alterados por outra pessoa. Recarregue e tente de novo.');
      }
      throw error;
    }
  }

  private static async substituirNaTransacao(
    productId: number,
    input: ForecastMesesAtipicosPutInput,
    userId: number | null,
  ): Promise<ForecastMesesAtipicosData> {
    return prisma.$transaction(async (tx) => {
      // Trava a linha do produto ANTES de ler as marcas: dois PUT do mesmo produto se serializam (sem P2002 nem
      // perda de marca). Marca em produto inativo e recusada; a leitura (doProdutos) continua valendo.
      const produto = await lockForecastProduct(tx, productId);
      if (!produto) throw new HttpError(404, 'Produto nao encontrado.');
      if (!produto.isActive) {
        throw new HttpError(
          400,
          'Produto inativo: reative o produto no cadastro do Forecast antes de marcar meses atípicos.',
        );
      }

      const atuais = await tx.forecastAtypicalMonth.findMany({
        where: { productId },
        select: { id: true, yearMonth: true, reason: true },
      });
      const escopo = input.janela ? new Set(input.janela) : null;
      const noEscopo = (anoMes: string) => escopo === null || escopo.has(anoMes);
      const desejados = new Map(input.meses.map((m) => [m.anoMes, m.motivo]));

      const apagar = atuais.filter((a) => noEscopo(a.yearMonth) && !desejados.has(a.yearMonth));
      const atualizar = atuais.filter(
        (a) => noEscopo(a.yearMonth) && desejados.has(a.yearMonth) && desejados.get(a.yearMonth) !== a.reason,
      );
      const existentes = new Set(atuais.map((a) => a.yearMonth));
      const criar = input.meses.filter((m) => !existentes.has(m.anoMes));

      if (apagar.length + atualizar.length + criar.length > 0) {
        if (apagar.length > 0) {
          await tx.forecastAtypicalMonth.deleteMany({ where: { id: { in: apagar.map((a) => a.id) } } });
        }
        for (const a of atualizar) {
          await tx.forecastAtypicalMonth.update({
            where: { id: a.id },
            data: { reason: desejados.get(a.yearMonth) as string },
          });
        }
        if (criar.length > 0) {
          await tx.forecastAtypicalMonth.createMany({
            data: criar.map((m) => ({ productId, yearMonth: m.anoMes, reason: m.motivo, createdById: userId })),
          });
        }
        const antes = atuais.map((a) => a.yearMonth).sort();
        const depois = [...atuais.filter((a) => !apagar.includes(a)).map((a) => a.yearMonth), ...criar.map((m) => m.anoMes)].sort();
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: productId,
            action: 'atypical_months_update',
            performedById: userId,
            // So ano-mes e contagens: o texto do motivo nao vai para o log.
            metadata: { antes, depois, motivosAlterados: atualizar.length },
          },
          tx,
        );
      }

      const rows = await tx.forecastAtypicalMonth.findMany({
        where: { productId },
        select: { yearMonth: true, reason: true },
      });
      return { productId, meses: rows.map((r) => ({ anoMes: r.yearMonth, motivo: r.reason })).sort(porAnoMes) };
    }, CADASTRO_TX_OPTIONS);
  }

  // Marcas dos produtos informados (1 consulta; lista vazia = sem consulta). Marca em produto inativo continua valendo.
  // O gateway so precisa trocar este provedor.
  static async doProdutos(productIds: number[], db: Db = prisma): Promise<Map<number, MesMarcado[]>> {
    const ids = [...new Set(productIds)];
    const mapa = new Map<number, MesMarcado[]>();
    if (ids.length === 0) return mapa;
    const rows = await db.forecastAtypicalMonth.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, yearMonth: true, reason: true },
      orderBy: [{ productId: 'asc' }, { yearMonth: 'asc' }],
    });
    for (const r of rows) {
      const lista = mapa.get(r.productId) ?? [];
      lista.push({ anoMes: r.yearMonth, motivo: r.reason });
      mapa.set(r.productId, lista);
    }
    return mapa;
  }
}
