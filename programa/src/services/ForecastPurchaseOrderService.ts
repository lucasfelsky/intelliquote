import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { avancarStatus } from '../utils/forecastCotacaoVinculo';
import { chaveDeEnvioValida, codigoDeFalha, quantidadeDaPoValida } from '../utils/forecastPoDireta';
import type { StatusCompra } from '../utils/forecastTypes';
import { HttpError } from '../utils/http';
import { AuditLogService } from './AuditLogService';

const ENTITY_PO = 'forecast_purchase_order';
const ENTITY_DECISAO = 'forecast_purchase_decision';

export interface ReservaPoInput {
  snapshotId: number;
  productId: number;
  /** Fornecedor do IQ ligado a fonte do produto (sem FK: o fornecedor tem soft delete). */
  supplierId: number | null;
  /** Nome congelado no envio (a PO continua legivel se o fornecedor for renomeado ou excluido). */
  supplierName: string;
  quantityKg: number;
  /** Copia do preco fechado do cadastro NO MOMENTO do envio. Nunca vai ao AuditLog. */
  unitPrice: number | null;
  currency: string | null;
  incoterm: string | null;
  /** Chave de idempotencia gerada pelo cliente: o mesmo envio repetido (duplo clique, reenvio) nao reserva outra PO. */
  requestKey: string;
  userId: number | null;
}

/** O que a quantidade da PO congela quando o item ainda NAO tem decisao (mesma referencia do PUT da decisao). */
export interface ReferenciaDecisao {
  sugeridaKg: number;
  demandaKg: number;
  manual: boolean;
}

export interface PoReservada {
  id: number;
  status: string;
  /** `true` quando a chave ja tinha uma reserva (nao se envia o e-mail de novo se ela ja esta 'enviada'). */
  jaExistia: boolean;
}

export interface PoDoLote {
  id: number;
  productId: number;
  status: string;
}

export interface PoLoteReservado {
  /** Uma PO por item, na ordem pedida. */
  pos: PoDoLote[];
  /** `true` quando a mesma lista de chaves ja tinha reserva (nao se envia o e-mail de novo se estao 'enviada'). */
  jaExistia: boolean;
}

export interface PoConcluida {
  /** `true` quando a PO ja estava 'enviada' (chamada repetida: nada foi somado de novo). */
  jaConcluida: boolean;
  decisao: 'criada' | 'atualizada' | 'sem_decisao' | 'inalterada';
  /** Qtd. final da decisao depois da soma (kg), quando ha decisao. */
  finalKg: number | null;
  status: string | null;
}

function naoEncontrada(mensagem = 'Quinzena não encontrada.'): HttpError {
  return new HttpError(404, mensagem);
}

const num = (d: Prisma.Decimal | null | undefined): number | null => (d === null || d === undefined ? null : Number(d));

// PO direta do Forecast (item de preco fechado). Tres passos, para o e-mail nunca sair em dobro nem a quantidade somar em dobro:
//  1) `reservar`: grava a PO como 'enviando' ANTES do e-mail (a chave unica barra o envio repetido);
//  2) o chamador envia o e-mail;
//  3) `concluir` (e-mail saiu) ou `falhar` (e-mail nao saiu). So a PO 'enviada' soma na Qtd. final e leva o status a 'po'.
export class ForecastPurchaseOrderService {
  /** Uma PO (um item). Mesmo contrato de sempre: e o lote de 1 item. */
  static async reservar(input: ReservaPoInput): Promise<PoReservada> {
    const lote = await ForecastPurchaseOrderService.reservarLote([input]);
    const po = lote.pos[0] as PoDoLote;
    return { id: po.id, status: po.status, jaExistia: lote.jaExistia };
  }

  /**
   * Reserva as POs de VARIOS itens da mesma quinzena de uma vez (um e-mail, uma PO por item), numa transacao: ou todas ou
   * nenhuma. Cada item tem a propria `requestKey` (unica). A mesma lista repetida devolve as POs que ja existem (`jaExistia`);
   * uma chave ja usada com OUTRA lista de itens e 409 (nunca mistura PO nova com antiga).
   */
  static async reservarLote(inputs: ReservaPoInput[]): Promise<PoLoteReservado> {
    if (inputs.length === 0) throw new HttpError(400, 'Escolha ao menos um item para a PO.');
    for (const input of inputs) {
      if (!quantidadeDaPoValida(input.quantityKg)) {
        throw new HttpError(400, 'Informe a quantidade da PO em kg (maior que zero, até 3 casas decimais).');
      }
      if (!chaveDeEnvioValida(input.requestKey)) {
        throw new HttpError(400, 'Chave do envio inválida.');
      }
      if (input.unitPrice !== null && (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)) {
        throw new HttpError(400, 'Preço inválido.');
      }
      if (input.supplierName.trim() === '') throw new HttpError(400, 'Informe o fornecedor da PO.');
    }
    const snapshotId = inputs[0]!.snapshotId;
    if (inputs.some((i) => i.snapshotId !== snapshotId)) throw new HttpError(400, 'Os itens da PO precisam ser da mesma quinzena.');

    const viva = await prisma.forecastSnapshot.findFirst({ where: { id: snapshotId, deletedAt: null }, select: { id: true } });
    if (!viva) throw naoEncontrada();

    try {
      return await prisma.$transaction(async (tx) => {
        const pos: PoDoLote[] = [];
        for (const input of inputs) {
          const criada = await tx.forecastPurchaseOrder.create({
            data: {
              snapshotId: input.snapshotId,
              productId: input.productId,
              supplierId: input.supplierId,
              supplierName: input.supplierName.trim(),
              quantityKg: input.quantityKg,
              unitPrice: input.unitPrice,
              currency: input.currency,
              incoterm: input.incoterm,
              requestKey: input.requestKey,
              status: 'enviando',
              createdById: input.userId,
            },
          });
          await AuditLogService.log(
            {
              entityType: ENTITY_PO,
              entityId: criada.id,
              action: 'create',
              performedById: input.userId,
              // Sem preco, sem fornecedor em texto: so ids, kg e se havia preco.
              metadata: {
                snapshotId: input.snapshotId,
                productId: input.productId,
                supplierId: input.supplierId,
                quantityKg: input.quantityKg,
                comPreco: input.unitPrice !== null,
                status: 'enviando',
                ...(inputs.length > 1 ? { itensNaPo: inputs.length } : {}),
              },
            },
            tx,
          );
          pos.push({ id: criada.id, productId: input.productId, status: criada.status });
        }
        return { pos, jaExistia: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existentes = await prisma.forecastPurchaseOrder.findMany({
          where: { requestKey: { in: inputs.map((i) => i.requestKey) } },
          select: { id: true, status: true, snapshotId: true, productId: true, requestKey: true },
        });
        const porChave = new Map(existentes.map((e) => [e.requestKey, e] as const));
        const mesmaLista =
          existentes.length === inputs.length &&
          inputs.every((i) => {
            const e = porChave.get(i.requestKey);
            return e !== undefined && e.snapshotId === i.snapshotId && e.productId === i.productId;
          });
        if (mesmaLista) {
          return {
            pos: inputs.map((i) => {
              const e = porChave.get(i.requestKey)!;
              return { id: e.id, productId: e.productId, status: e.status };
            }),
            jaExistia: true,
          };
        }
        throw new HttpError(409, 'Esta chave de envio já foi usada em outra PO ou com outra lista de itens.');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new HttpError(400, 'O produto não faz parte desta quinzena.');
      }
      throw error;
    }
  }

  /**
   * O e-mail saiu: marca a PO como 'enviada' e SOMA a quantidade na Qtd. final da decisao do item (`finalAt` so na 1a vez),
   * levando o status a 'po' sem regredir. Sem decisao e com `referencia`, cria a decisao (quantidade decidida = a da PO).
   * Idempotente e repetivel: se a transacao cair, a PO segue 'enviando' e o chamador tenta de novo; se ja esta 'enviada',
   * nada soma. O CHAMADOR captura o erro: o e-mail ja saiu e nunca deve virar 5xx por causa daqui.
   */
  static async concluir(poId: number, userId: number | null, referencia: ReferenciaDecisao | null): Promise<PoConcluida> {
    return prisma.$transaction(async (tx) => {
      const achada = await tx.forecastPurchaseOrder.findUnique({ where: { id: poId }, select: { snapshotId: true, productId: true } });
      if (!achada) throw new HttpError(404, 'PO não encontrada.');
      const { snapshotId, productId } = achada;

      // Serializa as POs do mesmo item (soma da Qtd. final e criacao da decisao); o PUT da decisao ja se protege por updatedAt.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`forecast:po:${snapshotId}:${productId}`}))`;
      await tx.$queryRaw`SELECT id FROM "ForecastPurchaseOrder" WHERE id = ${poId} FOR NO KEY UPDATE`;
      const po = await tx.forecastPurchaseOrder.findUnique({ where: { id: poId } });
      if (!po) throw new HttpError(404, 'PO não encontrada.');
      if (po.status === 'enviada') return { jaConcluida: true, decisao: 'inalterada' as const, finalKg: null, status: null };
      if (po.status !== 'enviando') throw new HttpError(409, 'Esta PO não está em envio.');

      const agora = new Date();
      await tx.forecastPurchaseOrder.update({ where: { id: poId }, data: { status: 'enviada', sentAt: agora } });
      await AuditLogService.log(
        {
          entityType: ENTITY_PO,
          entityId: poId,
          action: 'update',
          performedById: userId,
          metadata: { snapshotId, productId, status: 'enviada', camposAlterados: ['status', 'sentAt'], antes: { status: 'enviando' } },
        },
        tx,
      );

      const quantidade = new Prisma.Decimal(po.quantityKg);
      const atual = await tx.forecastPurchaseDecision.findUnique({
        where: { snapshotId_productId: { snapshotId, productId } },
        select: { id: true },
      });

      if (!atual) {
        if (!referencia) return { jaConcluida: false, decisao: 'sem_decisao' as const, finalKg: null, status: null };
        const criada = await tx.forecastPurchaseDecision.create({
          data: {
            snapshotId,
            productId,
            quantityKg: quantidade,
            status: 'po',
            note: null,
            suggestedKg: referencia.sugeridaKg,
            demandKg: referencia.demandaKg,
            manuallyIncluded: referencia.manual,
            finalKg: quantidade,
            finalAt: agora,
            decidedById: userId,
          },
        });
        await AuditLogService.log(
          {
            entityType: ENTITY_DECISAO,
            entityId: criada.id,
            action: 'create',
            performedById: userId,
            metadata: {
              snapshotId,
              productId,
              via: 'po-direta',
              purchaseOrderId: poId,
              quantidadeKg: Number(quantidade),
              finalKg: Number(quantidade),
              status: 'po',
              ...(referencia.manual ? { incluidoManualmente: true } : {}),
            },
          },
          tx,
        );
        return { jaConcluida: false, decisao: 'criada' as const, finalKg: Number(quantidade), status: 'po' };
      }

      // Trava a decisao (FOR NO KEY UPDATE) e a le: serializa com os ganchos de cotacao e com o PUT.
      await tx.$queryRaw`SELECT id FROM "ForecastPurchaseDecision" WHERE id = ${atual.id} FOR NO KEY UPDATE`;
      const decisao = await tx.forecastPurchaseDecision.findUniqueOrThrow({ where: { id: atual.id } });
      const novoFinal = new Prisma.Decimal(decisao.finalKg ?? 0).plus(quantidade);
      const novoStatus = avancarStatus(decisao.status as StatusCompra, 'po');
      const primeira = decisao.finalAt === null;
      await tx.forecastPurchaseDecision.update({
        where: { id: decisao.id },
        data: {
          finalKg: novoFinal,
          finalAt: primeira ? agora : decisao.finalAt,
          status: novoStatus,
          updatedAt: agora,
        },
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_DECISAO,
          entityId: decisao.id,
          action: 'update',
          performedById: userId,
          metadata: {
            snapshotId,
            productId,
            via: 'po-direta',
            purchaseOrderId: poId,
            somouKg: Number(quantidade),
            finalKg: Number(novoFinal),
            status: novoStatus,
            camposAlterados: ['finalKg', ...(primeira ? ['finalAt'] : []), ...(novoStatus !== decisao.status ? ['status'] : [])],
            antes: { finalKg: num(decisao.finalKg), status: decisao.status },
          },
        },
        tx,
      );
      return { jaConcluida: false, decisao: 'atualizada' as const, finalKg: Number(novoFinal), status: novoStatus };
    });
  }

  /** O e-mail nao saiu: a PO deixa de valer ('falhou'). So sai de 'enviando'; nunca soma nada. Devolve se mudou. */
  static async falhar(poId: number, userId: number | null, motivo: string): Promise<boolean> {
    const failureCode = codigoDeFalha(motivo);
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.forecastPurchaseOrder.updateMany({
        where: { id: poId, status: 'enviando' },
        data: { status: 'falhou', failureCode },
      });
      if (count === 0) return false;
      await AuditLogService.log(
        {
          entityType: ENTITY_PO,
          entityId: poId,
          action: 'update',
          performedById: userId,
          metadata: { status: 'falhou', failureCode, camposAlterados: ['status', 'failureCode'], antes: { status: 'enviando' } },
        },
        tx,
      );
      return true;
    });
  }
}
