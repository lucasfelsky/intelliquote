import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cleanProposedName } from '../utils/commercialItemName';
import { HttpError } from '../utils/http';
import {
  ACTIONS_BLOCKED_AFTER_ACCEPT,
  QUOTE_ACTION_LABEL,
  QUOTE_STATUS_LABEL,
  QUOTE_TRANSITIONS,
  formatQuoteRef,
  parsePricePerKg,
  type IndentQuoteAction,
  type IndentQuoteStatusName,
} from '../utils/indentQuote';
import { dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import type {
  IndentQuoteFreeItemInput,
  IndentQuoteMarkSentInput,
  IndentQuoteResponseInput,
} from '../validators/indentQuote';
import { AuditLogService } from './AuditLogService';
import {
  WRITE_ROLES,
  acceptedSelect,
  loadQuoteDetail,
  quoteDetailInclude,
  type AcceptedQuote,
  type QuoteDetailRow,
} from './IndentQuoteService';
import { IndentRequestService, type IndentActor } from './IndentRequestService';

// Acoes sobre a cotacao do IQ Indent (PR 3): marcar como enviada, item livre, registrar resposta, aceitar, recusar e pedir revisao.
// Toda acao roda em $transaction: trava a SOLICITACAO e depois a COTACAO (lockIndentQuote, mesma ordem do `generate` do PR 2),
// revalida tudo DEPOIS da trava e grava com AuditLog no mesmo `tx`. Nao ha escrita em massa: o aceite nao mexe nas outras cotacoes.

const ENTITY_TYPE = 'indent_quote';

export interface LockedQuote {
  quote: QuoteDetailRow;
  /** A cotacao ACEITA da solicitacao (qualquer uma, inclusive esta), se houver. */
  accepted: AcceptedQuote | null;
}

/**
 * Trava solicitacao -> cotacao (FOR NO KEY UPDATE) e devolve a cotacao relida com a ACEITA da solicitacao.
 * Ordem fixa: o `generate` do PR 2 trava a solicitacao; travar na ordem inversa daria deadlock. O PR 4 deve usar ESTE helper.
 */
export async function lockIndentQuote(tx: Prisma.TransactionClient, quoteId: number): Promise<LockedQuote> {
  const head = await tx.$queryRaw<Array<{ requestId: number }>>`SELECT "requestId" FROM "IndentQuote" WHERE id = ${quoteId}`;
  const requestId = head[0]?.requestId;

  if (requestId === undefined) {
    throw new HttpError(404, 'Cotação não encontrada.');
  }

  await tx.$queryRaw`SELECT id FROM "IndentRequest" WHERE id = ${requestId} FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT id FROM "IndentQuote" WHERE id = ${quoteId} FOR NO KEY UPDATE`;

  const quote = await tx.indentQuote.findUnique({ where: { id: quoteId }, include: quoteDetailInclude });

  if (!quote) {
    throw new HttpError(404, 'Cotação não encontrada.');
  }

  const accepted = await tx.indentQuote.findFirst({
    where: { requestId: quote.requestId, status: 'ACEITA' },
    select: acceptedSelect,
  });

  return { quote, accepted };
}

/**
 * COTACAO -> RESPONDIDA na 1a resposta registrada (manual agora, portal no PR 4). CONVERTIDA/RESPONDIDA nao sao rebaixadas.
 * Deve rodar com a solicitacao travada.
 */
export async function applyRequestStatusAfterResponse(
  tx: Prisma.TransactionClient,
  request: { id: number; processNumber: string; status: string },
  user: IndentActor,
  now: Date = new Date(),
): Promise<void> {
  if (request.status !== 'COTACAO') {
    return;
  }

  await tx.indentRequest.update({ where: { id: request.id }, data: { status: 'RESPONDIDA', statusChangedAt: now } });
  await AuditLogService.log(
    {
      entityType: 'indent_request',
      entityId: request.id,
      action: 'indent_request.status_changed',
      performedById: user.id,
      beforeData: { status: request.status },
      afterData: { status: 'RESPONDIDA' },
      metadata: { processNumber: request.processNumber, reason: 'first_quote_response' },
    },
    tx,
  );
}

function refOf(quote: QuoteDetailRow): string {
  return formatQuoteRef(quote.request.processNumber, quote.revision);
}

// Nos 400 de data, o 3o argumento do HttpError (code) leva o campo (`path`) para o erro inline da tela.
// Ordem das checagens: solicitacao perdida -> status da cotacao -> aceite unico (o 404 ja saiu do lockIndentQuote).
function assertActionAllowed(action: IndentQuoteAction, { quote, accepted }: LockedQuote): void {
  if (quote.request.status === 'PERDIDA') {
    throw new HttpError(409, `A solicitação ${quote.request.processNumber} foi marcada como perdida.`);
  }

  if (!QUOTE_TRANSITIONS[action].includes(quote.status as IndentQuoteStatusName)) {
    throw new HttpError(
      409,
      `Esta cotação está ${QUOTE_STATUS_LABEL[quote.status as IndentQuoteStatusName]} e não permite ${QUOTE_ACTION_LABEL[action]}.`,
    );
  }

  if (accepted && ACTIONS_BLOCKED_AFTER_ACCEPT.includes(action)) {
    throw new HttpError(
      409,
      `Esta solicitação já tem uma cotação aceita (${formatQuoteRef(accepted.request.processNumber, accepted.revision)} · ${accepted.supplier.name}).`,
    );
  }
}

// Data informada no dia de hoje (BRT) grava o instante real; outro dia grava meio-dia BRT desse dia.
function instantOf(dateKey: string, now: Date): Date {
  return dateKey === todayKeyInSaoPaulo(now) ? now : new Date(`${dateKey}T12:00:00-03:00`);
}

function snapshot(quote: QuoteDetailRow) {
  return {
    status: quote.status,
    currency: quote.currency,
    validUntil: quote.validUntil ? dbDateToKey(quote.validUntil) : null,
    items: quote.items.map((item) => ({
      quoteItemId: item.id,
      packaging: item.packaging,
      fobPricePerKg: item.fobPricePerKg === null ? null : new Prisma.Decimal(item.fobPricePerKg).toFixed(4),
      cfrPricePerKg: item.cfrPricePerKg === null ? null : new Prisma.Decimal(item.cfrPricePerKg).toFixed(4),
    })),
  };
}

function formatDateKeyBr(key: string): string {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

async function run<T>(role: string, work: (tx: Prisma.TransactionClient, canWrite: boolean) => Promise<T>) {
  return prisma.$transaction((tx) => work(tx, WRITE_ROLES.includes(role)));
}

export class IndentQuoteWorkflowService {
  // RASCUNHO -> ENVIADA. O envio por e-mail e do PR 4; aqui so registra que o fornecedor recebeu a cotacao por fora.
  static async markSent(id: number, input: IndentQuoteMarkSentInput, user: IndentActor, role: string, now: Date = new Date()) {
    return run(role, async (tx, canWrite) => {
      const locked = await lockIndentQuote(tx, id);
      assertActionAllowed('mark-sent', locked);
      const { quote } = locked;

      if (input.sentOn > todayKeyInSaoPaulo(now)) {
        throw new HttpError(400, 'A data de envio não pode ser futura.', 'sentOn');
      }
      if (input.sentOn < todayKeyInSaoPaulo(quote.createdAt)) {
        throw new HttpError(400, 'A data de envio não pode ser anterior à criação da cotação.', 'sentOn');
      }

      await tx.indentQuote.update({
        where: { id },
        data: { status: 'ENVIADA', sentAt: instantOf(input.sentOn, now) },
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_quote.marked_sent',
          performedById: user.id,
          beforeData: { status: quote.status },
          afterData: { status: 'ENVIADA' },
          metadata: { ref: refOf(quote), sentOn: input.sentOn, via: 'manual' },
        },
        tx,
      );

      return loadQuoteDetail(tx, id, canWrite);
    });
  }

  // Item livre no RASCUNHO: cria produto (ou reaproveita), o item da solicitacao e o item desta cotacao, na mesma transacao.
  static async addFreeItem(id: number, input: IndentQuoteFreeItemInput, user: IndentActor, role: string) {
    return run(role, async (tx, canWrite) => {
      const locked = await lockIndentQuote(tx, id);
      assertActionAllowed('items', locked);
      const { quote } = locked;

      const { productId } = await IndentRequestService.resolveItemProduct(
        tx,
        input.description,
        quote.request.processNumber,
        user.id,
      );
      const last = await tx.indentRequestItem.aggregate({
        where: { requestId: quote.requestId },
        _max: { position: true },
      });
      const description = cleanProposedName(input.description);
      const requestItem = await tx.indentRequestItem.create({
        data: {
          requestId: quote.requestId,
          productId,
          description,
          quantityKg: input.quantityKg,
          confirmed: true,
          position: (last._max.position ?? -1) + 1,
        },
        select: { id: true },
      });
      await tx.indentQuoteItem.create({ data: { quoteId: id, requestItemId: requestItem.id }, select: { id: true } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_quote.item_added',
          performedById: user.id,
          afterData: { requestItemId: requestItem.id, description, quantityKg: input.quantityKg, productId },
          metadata: { ref: refOf(quote) },
        },
        tx,
      );

      return loadQuoteDetail(tx, id, canWrite);
    });
  }

  // ENVIADA -> RESPONDIDA com a oferta inteira (todos os itens). Resposta tardia (depois do aceite de outra cotacao) e permitida.
  static async recordResponse(id: number, input: IndentQuoteResponseInput, user: IndentActor, role: string, now: Date = new Date()) {
    return run(role, async (tx, canWrite) => {
      const locked = await lockIndentQuote(tx, id);
      assertActionAllowed('response', locked);
      const { quote, accepted } = locked;

      if (input.respondedOn > todayKeyInSaoPaulo(now)) {
        throw new HttpError(400, 'A data da resposta não pode ser futura.', 'respondedOn');
      }
      if (input.respondedOn < todayKeyInSaoPaulo(quote.sentAt ?? quote.createdAt)) {
        throw new HttpError(400, 'A data da resposta não pode ser anterior ao envio.', 'respondedOn');
      }

      const byId = new Map(quote.items.map((item) => [item.id, item]));
      if (input.items.some((item) => !byId.has(item.quoteItemId))) {
        throw new HttpError(400, 'Item inexistente nesta cotação.');
      }
      if (quote.items.some((item) => !input.items.some((entry) => entry.quoteItemId === item.id))) {
        throw new HttpError(400, 'Informe os preços de todos os itens.');
      }

      const before = snapshot(quote);

      for (const entry of input.items) {
        const fob = parsePricePerKg(entry.fobPricePerKg);
        const cfr = parsePricePerKg(entry.cfrPricePerKg);
        await tx.indentQuoteItem.update({
          where: { id: entry.quoteItemId },
          data: { packaging: entry.packaging, fobPricePerKg: fob, cfrPricePerKg: cfr },
        });
      }

      await tx.indentQuote.update({
        where: { id },
        data: {
          status: 'RESPONDIDA',
          respondedAt: instantOf(input.respondedOn, now),
          currency: input.currency,
          validUntil: dateKeyToDbDate(input.validUntil),
          productionLeadTimeDays: input.productionLeadTimeDays,
          paymentTerms: input.paymentTerms,
          manufacturer: input.manufacturer,
          notes: input.notes,
          destination: input.destination ?? quote.destination,
        },
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_quote.response_recorded',
          performedById: user.id,
          beforeData: before,
          afterData: {
            status: 'RESPONDIDA',
            currency: input.currency,
            validUntil: input.validUntil,
            items: input.items.map((entry) => ({
              quoteItemId: entry.quoteItemId,
              packaging: entry.packaging,
              fobPricePerKg: entry.fobPricePerKg,
              cfrPricePerKg: entry.cfrPricePerKg,
            })),
          },
          metadata: { ref: refOf(quote), via: 'manual', afterAcceptance: accepted !== null },
        },
        tx,
      );

      await applyRequestStatusAfterResponse(tx, quote.request, user, now);

      return loadQuoteDetail(tx, id, canWrite);
    });
  }

  // RESPONDIDA -> ACEITA; a solicitacao vira CONVERTIDA. Uma unica ACEITA por solicitacao (a linha da solicitacao esta travada).
  static async accept(id: number, user: IndentActor, role: string, now: Date = new Date()) {
    return run(role, async (tx, canWrite) => {
      const locked = await lockIndentQuote(tx, id);
      assertActionAllowed('accept', locked);
      const { quote } = locked;

      if (quote.validUntil && dbDateToKey(quote.validUntil) < todayKeyInSaoPaulo(now)) {
        throw new HttpError(
          409,
          `A validade desta cotação venceu em ${formatDateKeyBr(dbDateToKey(quote.validUntil))}. Peça uma revisão.`,
        );
      }

      await tx.indentQuote.update({ where: { id }, data: { status: 'ACEITA', decidedAt: now } });
      await tx.indentRequest.update({ where: { id: quote.requestId }, data: { status: 'CONVERTIDA', statusChangedAt: now } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_quote.accepted',
          performedById: user.id,
          beforeData: { status: quote.status },
          afterData: { status: 'ACEITA' },
          metadata: { ref: refOf(quote), supplierId: quote.supplierId, requestId: quote.requestId },
        },
        tx,
      );
      await AuditLogService.log(
        {
          entityType: 'indent_request',
          entityId: quote.requestId,
          action: 'indent_request.status_changed',
          performedById: user.id,
          beforeData: { status: quote.request.status },
          afterData: { status: 'CONVERTIDA' },
          metadata: { processNumber: quote.request.processNumber, reason: 'quote_accepted', quoteId: id },
        },
        tx,
      );

      return loadQuoteDetail(tx, id, canWrite);
    });
  }

  // RESPONDIDA -> RECUSADA. Nao checa validade e continua permitida depois do aceite de outra cotacao (encerra explicitamente).
  static async refuse(id: number, user: IndentActor, role: string, now: Date = new Date()) {
    return run(role, async (tx, canWrite) => {
      const locked = await lockIndentQuote(tx, id);
      assertActionAllowed('refuse', locked);
      const { quote, accepted } = locked;

      await tx.indentQuote.update({ where: { id }, data: { status: 'RECUSADA', decidedAt: now } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: id,
          action: 'indent_quote.refused',
          performedById: user.id,
          beforeData: { status: quote.status },
          afterData: { status: 'RECUSADA' },
          metadata: { ref: refOf(quote), afterAcceptance: accepted !== null },
        },
        tx,
      );

      return loadQuoteDetail(tx, id, canWrite);
    });
  }

  // RESPONDIDA -> REVISADA e nova cotacao RASCUNHO (revision = max + 1) do mesmo fornecedor, sem preco nem embalagem.
  // Devolve a cotacao NOVA no formato do detalhe.
  static async requestRevision(id: number, user: IndentActor, role: string) {
    try {
      return await run(role, async (tx, canWrite) => {
        const locked = await lockIndentQuote(tx, id);
        assertActionAllowed('revision', locked);
        const { quote } = locked;

        const max = await tx.indentQuote.aggregate({
          where: { requestId: quote.requestId, supplierId: quote.supplierId },
          _max: { revision: true },
        });
        const revision = (max._max.revision ?? quote.revision) + 1;

        const created = await tx.indentQuote.create({
          data: {
            requestId: quote.requestId,
            supplierId: quote.supplierId,
            revision,
            status: 'RASCUNHO',
            currency: quote.currency,
            incoterm: quote.incoterm,
            destination: quote.destination,
            exceptionReason: quote.exceptionReason,
            exceptionById: quote.exceptionById,
            exceptionByName: quote.exceptionByName,
            exceptionAt: quote.exceptionAt,
            baseQuoteId: quote.baseQuoteId ?? quote.id,
            createdById: user.id,
            items: { create: quote.items.map((item) => ({ requestItemId: item.requestItemId })) },
          },
          select: { id: true },
        });
        await tx.indentQuote.update({ where: { id }, data: { status: 'REVISADA' } });

        const newRef = formatQuoteRef(quote.request.processNumber, revision);
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'indent_quote.revision_requested',
            performedById: user.id,
            beforeData: { status: quote.status },
            afterData: { status: 'REVISADA' },
            metadata: { ref: refOf(quote), newQuoteId: created.id, revision, newRef },
          },
          tx,
        );
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: created.id,
            action: 'indent_quote.created_as_revision',
            performedById: user.id,
            afterData: {
              requestId: quote.requestId,
              supplierId: quote.supplierId,
              revision,
              baseQuoteId: quote.baseQuoteId ?? quote.id,
              previousQuoteId: id,
            },
            metadata: { ref: newRef },
          },
          tx,
        );

        return loadQuoteDetail(tx, created.id, canWrite);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'Já existe uma revisão em andamento para este fornecedor.');
      }
      throw error;
    }
  }
}
