import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type {
  ForecastDemandaComercialCreateInput,
  ForecastDemandaComercialPatchInput,
  ForecastDemandaComercialQueryInput,
  ForecastDemandaComercialStatus,
} from '../validators/forecast';
import type { DemandaComercialAberta } from '../utils/forecastDemandaComercial';
import { HttpError } from '../utils/http';
import { dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { AuditLogService } from './AuditLogService';

type Db = Prisma.TransactionClient | typeof prisma;

const ENTITY_TYPE = 'forecast_commercial_demand';
const LIMITE_DA_LISTA = 500;

const COM_PRODUTO = {
  product: { select: { name: true, isActive: true, source: { select: { name: true } } } },
} satisfies Prisma.ForecastCommercialDemandInclude;

type LinhaComProduto = Prisma.ForecastCommercialDemandGetPayload<{ include: typeof COM_PRODUTO }>;

export interface ForecastDemandaComercialData {
  id: number;
  productId: number;
  produto: string;
  fonte: string | null;
  produtoAtivo: boolean;
  quantidadeKg: number;
  /** 'AAAA-MM-DD'. */
  necessidade: string;
  motivo: string;
  cliente: string | null;
  solicitacaoId: number | null;
  status: ForecastDemandaComercialStatus;
  notaFechamento: string | null;
  /** 'AAAA-MM-DD' (calendario de Sao Paulo); nulo enquanto aberta. */
  fechadaEm: string | null;
  criadaEm: string;
}

function paraDados(r: LinhaComProduto): ForecastDemandaComercialData {
  return {
    id: r.id,
    productId: r.productId,
    produto: r.product.name,
    fonte: r.product.source?.name ?? null,
    produtoAtivo: r.product.isActive,
    quantidadeKg: Number(r.quantityKg),
    necessidade: dbDateToKey(r.neededBy),
    motivo: r.reason,
    cliente: r.customerName,
    solicitacaoId: r.commercialRequestId,
    status: r.status as ForecastDemandaComercialStatus,
    notaFechamento: r.closeNote,
    fechadaEm: r.closedAt ? todayKeyInSaoPaulo(r.closedAt) : null,
    criadaEm: todayKeyInSaoPaulo(r.createdAt),
  };
}

// A Solicitacao precisa existir (so leitura por id, sem FK nem migration; CommercialRequest nao tem soft-delete). So o
// numero vai na mensagem: nada da Solicitacao vaza para o Forecast.
async function assertSolicitacaoExiste(tx: Prisma.TransactionClient, id: number): Promise<void> {
  const solicitacao = await tx.commercialRequest.findUnique({ where: { id }, select: { id: true } });
  if (!solicitacao) {
    throw new HttpError(
      400,
      `Solicitação nº ${id} não encontrada no módulo Solicitações. Confira o número ou deixe o campo vazio.`,
    );
  }
}

// Demanda do comercial (PR 6d): compra pedida pelo comercial por programacao futura de cliente, lancada a mao pelo COMEX.
// O AuditLog guarda so ids, kg, data, status e contagens: nunca o texto do motivo, da nota nem o nome do cliente.
export class ForecastDemandaComercialService {
  static async list(
    filtro: ForecastDemandaComercialQueryInput = {},
    db: Db = prisma,
  ): Promise<ForecastDemandaComercialData[]> {
    const rows = await db.forecastCommercialDemand.findMany({
      where: {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(filtro.productId ? { productId: filtro.productId } : {}),
      },
      include: COM_PRODUTO,
      orderBy: [{ neededBy: 'asc' }, { id: 'asc' }],
      take: LIMITE_DA_LISTA,
    });
    return rows.map(paraDados);
  }

  // Pedidos abertos para o relatorio de compras (1 consulta). O gateway so precisa trocar este provedor.
  static async abertas(db: Db = prisma): Promise<DemandaComercialAberta[]> {
    const rows = await db.forecastCommercialDemand.findMany({
      where: { status: 'aberta' },
      include: COM_PRODUTO,
      orderBy: [{ neededBy: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      produto: r.product.name,
      fonte: r.product.source?.name ?? null,
      kg: Number(r.quantityKg),
      necessidade: dbDateToKey(r.neededBy),
      motivo: r.reason,
      cliente: r.customerName,
      solicitacaoId: r.commercialRequestId,
    }));
  }

  static async create(
    input: ForecastDemandaComercialCreateInput,
    userId: number | null,
  ): Promise<ForecastDemandaComercialData> {
    return prisma.$transaction(async (tx) => {
      const produto = await tx.forecastProduct.findUnique({
        where: { id: input.productId },
        select: { id: true, isActive: true },
      });
      if (!produto) throw new HttpError(404, 'Produto nao encontrado.');
      if (!produto.isActive) {
        throw new HttpError(400, 'Produto inativo: reative o produto no cadastro do Forecast antes de lancar a demanda.');
      }
      if (typeof input.solicitacaoId === 'number') await assertSolicitacaoExiste(tx, input.solicitacaoId);
      const criada = await tx.forecastCommercialDemand.create({
        data: {
          productId: input.productId,
          quantityKg: input.quantidadeKg,
          neededBy: dateKeyToDbDate(input.necessidade),
          reason: input.motivo,
          customerName: input.cliente ?? null,
          commercialRequestId: input.solicitacaoId ?? null,
          status: 'aberta',
          createdById: userId,
        },
        include: COM_PRODUTO,
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: criada.id,
          action: 'create',
          performedById: userId,
          metadata: {
            productId: input.productId,
            quantidadeKg: input.quantidadeKg,
            necessidade: input.necessidade,
            status: 'aberta',
            solicitacaoId: input.solicitacaoId ?? null,
          },
        },
        tx,
      );
      return paraDados(criada);
    });
  }

  // Edita (so aberta) ou fecha. Fechada nao reabre (409). O `updateMany` com status 'aberta' no WHERE barra a corrida
  // entre duas pessoas: quem chega depois recebe 409 e nao sobrescreve o fechamento.
  static async patch(
    id: number,
    input: ForecastDemandaComercialPatchInput,
    userId: number | null,
  ): Promise<ForecastDemandaComercialData> {
    return prisma.$transaction(async (tx) => {
      const atual = await tx.forecastCommercialDemand.findUnique({ where: { id }, include: COM_PRODUTO });
      if (!atual) throw new HttpError(404, 'Demanda nao encontrada.');
      if (atual.status !== 'aberta') {
        throw new HttpError(409, 'Demanda ja fechada: nao pode ser alterada nem reaberta.');
      }
      const corrida = () => new HttpError(409, 'A demanda foi alterada por outra pessoa. Atualize a tela e confira.');
      const kgAtual = Number(atual.quantityKg);
      const necessidadeAtual = dbDateToKey(atual.neededBy);

      if (input.status !== undefined) {
        const resultado = await tx.forecastCommercialDemand.updateMany({
          where: { id, status: 'aberta' },
          data: { status: input.status, closeNote: input.nota ?? null, closedAt: new Date(), closedById: userId },
        });
        if (resultado.count === 0) throw corrida();
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'close',
            performedById: userId,
            metadata: {
              productId: atual.productId,
              quantidadeKg: kgAtual,
              necessidade: necessidadeAtual,
              status: input.status,
              solicitacaoId: atual.commercialRequestId,
              comNota: input.nota != null,
            },
          },
          tx,
        );
      } else {
        const data: Prisma.ForecastCommercialDemandUncheckedUpdateManyInput = {};
        const alterados: string[] = [];
        if (input.quantidadeKg !== undefined && input.quantidadeKg !== kgAtual) {
          data.quantityKg = input.quantidadeKg;
          alterados.push('quantidadeKg');
        }
        if (input.necessidade !== undefined && input.necessidade !== necessidadeAtual) {
          if (input.necessidade < todayKeyInSaoPaulo(new Date())) {
            throw new HttpError(400, 'A data de necessidade não pode ser anterior a hoje.');
          }
          data.neededBy = dateKeyToDbDate(input.necessidade);
          alterados.push('necessidade');
        }
        if (input.motivo !== undefined && input.motivo !== atual.reason) {
          data.reason = input.motivo;
          alterados.push('motivo');
        }
        if (input.cliente !== undefined && input.cliente !== atual.customerName) {
          data.customerName = input.cliente;
          alterados.push('cliente');
        }
        if (input.solicitacaoId !== undefined && input.solicitacaoId !== atual.commercialRequestId) {
          // So a TROCA para um numero novo valida: demanda antiga com numero legado continua editavel; null limpa.
          if (input.solicitacaoId !== null) await assertSolicitacaoExiste(tx, input.solicitacaoId);
          data.commercialRequestId = input.solicitacaoId;
          alterados.push('solicitacaoId');
        }
        // Sem alteracao nao grava nem audita.
        if (alterados.length === 0) return paraDados(atual);
        const resultado = await tx.forecastCommercialDemand.updateMany({ where: { id, status: 'aberta' }, data });
        if (resultado.count === 0) throw corrida();
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'update',
            performedById: userId,
            metadata: {
              productId: atual.productId,
              quantidadeKg: input.quantidadeKg ?? kgAtual,
              necessidade: input.necessidade ?? necessidadeAtual,
              status: 'aberta',
              solicitacaoId: input.solicitacaoId === undefined ? atual.commercialRequestId : input.solicitacaoId,
              camposAlterados: alterados,
            },
          },
          tx,
        );
      }
      const depois = await tx.forecastCommercialDemand.findUnique({ where: { id }, include: COM_PRODUTO });
      return paraDados(depois as LinhaComProduto);
    });
  }
}
