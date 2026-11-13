import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cleanProposedName, normalizeItemNameKey } from '../utils/commercialItemName';
import { buildPaginatedResponse, HttpError } from '../utils/http';
import { formatProcessNumber } from '../utils/indentProcessNumber';
import { businessDaysSince } from '../utils/indentQueue';
import { todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import type {
  IndentConfirmItemsInput,
  IndentRequestCreateInput,
  IndentRequestListQuery,
} from '../validators/indentRequest';
import { AuditLogService } from './AuditLogService';

const ENTITY_TYPE = 'indent_request';

// Ate 3 repeticoes depois da 1a tentativa (4 no total) quando o numero ou o nome do produto colidem.
const MAX_CREATE_ATTEMPTS = 4;

export interface IndentActor {
  id: number;
  name: string;
}

const detailInclude = {
  client: {
    select: {
      id: true,
      name: true,
      cnpj: true,
      city: true,
      pipedriveOrgId: true,
      supplierRuleMode: true,
      ruleReason: true,
      supplierRules: {
        select: { supplierId: true, supplier: { select: { name: true } } },
        orderBy: { supplier: { name: 'asc' as const } },
      },
    },
  },
  items: {
    orderBy: { position: 'asc' as const },
    include: { product: { select: { id: true, name: true, cas: true, origin: true } } },
  },
  quotes: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      status: true,
      revision: true,
      exceptionReason: true,
      exceptionByName: true,
      exceptionAt: true,
      supplier: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.IndentRequestInclude;

type DetailRow = Prisma.IndentRequestGetPayload<{ include: typeof detailInclude }>;

const listInclude = {
  client: { select: { id: true, name: true, city: true, supplierRuleMode: true } },
  items: {
    orderBy: { position: 'asc' as const },
    select: { description: true, quantityKg: true, product: { select: { name: true } } },
  },
  quotes: { select: { status: true } },
} satisfies Prisma.IndentRequestInclude;

type ListRow = Prisma.IndentRequestGetPayload<{ include: typeof listInclude }>;

const ANSWERED_QUOTE_STATUSES = ['RESPONDIDA', 'ACEITA', 'RECUSADA'];

// "Na fila ha": so NOVA (inclui cliente pendente) e COTACAO; demais status nao contam.
function queueDaysFor(row: { status: string; stageEnteredAt: Date }, now: Date): number | null {
  if (row.status !== 'NOVA' && row.status !== 'COTACAO') {
    return null;
  }
  return businessDaysSince(row.stageEnteredAt, now);
}

function toNumber(value: unknown): number {
  return Number(String(value));
}

function serializeDetail(row: DetailRow, now: Date) {
  return {
    id: row.id,
    processNumber: row.processNumber,
    origin: row.origin,
    pipedriveDealId: row.pipedriveDealId,
    dealTitle: row.dealTitle,
    dealType: row.dealType,
    rawNote: row.rawNote,
    ownerName: row.ownerName,
    createdByName: row.createdByName,
    status: row.status,
    clientPending: row.clientId === null,
    createdAt: row.createdAt,
    stageEnteredAt: row.stageEnteredAt,
    queueBusinessDays: queueDaysFor(row, now),
    client: row.client
      ? {
          id: row.client.id,
          name: row.client.name,
          cnpj: row.client.cnpj,
          city: row.client.city,
          pipedriveOrgId: row.client.pipedriveOrgId,
          supplierRuleMode: row.client.supplierRuleMode,
          ruleReason: row.client.ruleReason,
          supplierRules: row.client.supplierRules.map((rule) => ({
            supplierId: rule.supplierId,
            name: rule.supplier.name,
          })),
        }
      : null,
    items: row.items.map((item) => ({
      id: item.id,
      position: item.position,
      description: item.description,
      name: item.product?.name ?? item.description,
      quantityKg: toNumber(item.quantityKg),
      confirmed: item.confirmed,
      productId: item.productId,
      product: item.product
        ? { id: item.product.id, name: item.product.name, cas: item.product.cas, origin: item.product.origin }
        : null,
      isFree: item.productId === null || item.product?.origin === 'LIVRE',
    })),
    quotes: row.quotes.map((quote) => ({
      id: quote.id,
      status: quote.status,
      revision: quote.revision,
      supplier: { id: quote.supplier.id, name: quote.supplier.name },
      exception: quote.exceptionReason
        ? { reason: quote.exceptionReason, byName: quote.exceptionByName, at: quote.exceptionAt }
        : null,
    })),
  };
}

function serializeListRow(row: ListRow, now: Date) {
  const first = row.items[0];
  const answered = row.quotes.filter((quote) => ANSWERED_QUOTE_STATUSES.includes(quote.status)).length;

  return {
    id: row.id,
    processNumber: row.processNumber,
    createdAt: row.createdAt,
    origin: row.origin,
    pipedriveDealId: row.pipedriveDealId,
    ownerName: row.ownerName,
    status: row.status,
    clientPending: row.clientId === null,
    client: row.client
      ? {
          id: row.client.id,
          name: row.client.name,
          city: row.client.city,
          supplierRuleMode: row.client.supplierRuleMode,
        }
      : null,
    itemsSummary: {
      firstName: first ? (first.product?.name ?? first.description) : null,
      count: row.items.length,
      totalKg: row.items.reduce((sum, item) => sum + toNumber(item.quantityKg), 0),
    },
    quotes: { total: row.quotes.length, answered },
    queueBusinessDays: queueDaysFor(row, now),
  };
}

function uniqueTargetText(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.join(',');
  }
  return typeof target === 'string' ? target : '';
}

// Colisao de numero (concorrencia ou numero gravado por fora) ou de nameKey de item livre criado em paralelo:
// refazer a transacao inteira resolve os dois (o Postgres aborta a transacao no erro).
function isRetryableCreateConflict(error: unknown): boolean {
  const target = uniqueTargetText(error);
  return target !== null && /processNumber|processSeq|processYear|nameKey/.test(target);
}

function monthStartInSaoPaulo(now: Date): Date {
  // O Brasil nao tem horario de verao desde 2019: BRT = UTC-3 o ano todo.
  return new Date(`${todayKeyInSaoPaulo(now).slice(0, 7)}-01T00:00:00-03:00`);
}

const FILTER_WHERE: Record<IndentRequestListQuery['filter'], Prisma.IndentRequestWhereInput> = {
  todas: {},
  pipedrive: { origin: 'PIPEDRIVE' },
  iq: { origin: 'IQ_INDENT' },
  nova: { status: 'NOVA', clientId: { not: null } },
  pendente: { clientId: null },
};

export class IndentRequestService {
  static async list(query: IndentRequestListQuery, now: Date = new Date()) {
    const where: Prisma.IndentRequestWhereInput = {
      ...FILTER_WHERE[query.filter],
      ...(query.q
        ? {
            OR: [
              { processNumber: { contains: query.q, mode: 'insensitive' } },
              { client: { name: { contains: query.q, mode: 'insensitive' } } },
              { items: { some: { description: { contains: query.q, mode: 'insensitive' } } } },
              { items: { some: { product: { name: { contains: query.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const pagination = {
      page: query.page,
      pageSize: query.pageSize,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    };

    const [rows, total, todas, pipedrive, iq, nova, pendente, emCotacao, respondidas, convertidasNoMes] =
      await Promise.all([
        prisma.indentRequest.findMany({
          where,
          include: listInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.indentRequest.count({ where }),
        prisma.indentRequest.count({ where: FILTER_WHERE.todas }),
        prisma.indentRequest.count({ where: FILTER_WHERE.pipedrive }),
        prisma.indentRequest.count({ where: FILTER_WHERE.iq }),
        prisma.indentRequest.count({ where: FILTER_WHERE.nova }),
        prisma.indentRequest.count({ where: FILTER_WHERE.pendente }),
        prisma.indentRequest.count({ where: { status: 'COTACAO' } }),
        prisma.indentRequest.count({ where: { status: 'RESPONDIDA' } }),
        prisma.indentRequest.count({
          where: { status: 'CONVERTIDA', statusChangedAt: { gte: monthStartInSaoPaulo(now) } },
        }),
      ]);

    return {
      ...buildPaginatedResponse(
        rows.map((row) => serializeListRow(row, now)),
        total,
        pagination,
      ),
      counts: { todas, pipedrive, iq, nova, pendente },
      kpis: { novas: nova, emCotacao, respondidas, convertidasNoMes },
    };
  }

  // Badge do menu: novas com cliente (cliente pendente nao entra).
  static async newCount() {
    return { count: await prisma.indentRequest.count({ where: FILTER_WHERE.nova }) };
  }

  static async clientOptions() {
    return prisma.indentClient.findMany({
      where: { isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
  }

  static async getById(id: number, now: Date = new Date()) {
    const row = await prisma.indentRequest.findUnique({ where: { id }, include: detailInclude });

    if (!row) {
      throw new HttpError(404, 'Solicitação não encontrada.');
    }

    return serializeDetail(row, now);
  }

  // Solicitacao lancada no IQ Indent: responsavel e autoria vem do usuario logado; itens nascem confirmados.
  static async create(input: IndentRequestCreateInput, user: IndentActor, now: Date = new Date()) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await prisma.$transaction((tx) => IndentRequestService.createOnce(tx, input, user, now));
      } catch (error) {
        if (!isRetryableCreateConflict(error)) {
          throw error;
        }
        if (attempt >= MAX_CREATE_ATTEMPTS) {
          throw new HttpError(409, 'Não foi possível reservar o número da solicitação. Tente de novo.');
        }
      }
    }
  }

  private static async createOnce(
    tx: Prisma.TransactionClient,
    input: IndentRequestCreateInput,
    user: IndentActor,
    now: Date,
  ) {
    const client = await tx.indentClient.findUnique({
      where: { id: input.clientId },
      select: { id: true, isActive: true },
    });

    if (!client || !client.isActive) {
      throw new HttpError(400, 'Cliente inexistente ou inativo.');
    }

    // Produtos informados pelo id: precisam existir e estar ativos.
    const explicitIds = Array.from(
      new Set(input.items.flatMap((item) => (item.productId !== undefined ? [item.productId] : []))),
    );

    if (explicitIds.length > 0) {
      const found = await tx.indentProduct.findMany({
        where: { id: { in: explicitIds } },
        select: { id: true, isActive: true },
      });
      const byId = new Map(found.map((product) => [product.id, product]));

      for (const id of explicitIds) {
        const product = byId.get(id);
        if (!product) {
          throw new HttpError(400, 'Produto inexistente.');
        }
        if (!product.isActive) {
          throw new HttpError(400, 'Produto inativo no catálogo do Indent.');
        }
      }
    }

    // Numero: trava a linha do ano (FOR UPDATE), parte do maior entre a sequencia e o maior numero ja gravado.
    const year = Number(todayKeyInSaoPaulo(now).slice(0, 4));
    await tx.$executeRaw`INSERT INTO "IndentSequence"("year", "lastNumber", "updatedAt") VALUES (${year}, 0, now()) ON CONFLICT ("year") DO NOTHING`;
    const sequenceRows = await tx.$queryRaw<Array<{ lastNumber: number }>>`SELECT "lastNumber" FROM "IndentSequence" WHERE "year" = ${year} FOR UPDATE`;
    const written = await tx.indentRequest.aggregate({
      where: { processYear: year },
      _max: { processSeq: true },
    });
    const seq = Math.max(Number(sequenceRows[0]?.lastNumber ?? 0), written._max.processSeq ?? 0) + 1;
    await tx.$executeRaw`UPDATE "IndentSequence" SET "lastNumber" = ${seq}, "updatedAt" = now() WHERE "year" = ${year}`;
    const processNumber = formatProcessNumber(year, seq);

    // Itens digitados a mao: reaproveita o produto de mesmo nameKey (qualquer origem/estado) ou cria LIVRE.
    const freeKeys = Array.from(
      new Set(
        input.items
          .filter((item) => item.productId === undefined)
          .map((item) => normalizeItemNameKey(item.description)),
      ),
    );
    const freeProductIdByKey = new Map<string, number>();
    const createdFree: Array<{ id: number; name: string }> = [];

    if (freeKeys.length > 0) {
      const existing = await tx.indentProduct.findMany({
        where: { nameKey: { in: freeKeys } },
        select: { id: true, nameKey: true },
      });
      for (const product of existing) {
        freeProductIdByKey.set(product.nameKey, product.id);
      }

      for (const key of freeKeys) {
        if (freeProductIdByKey.has(key)) {
          continue;
        }
        const source = input.items.find(
          (item) => item.productId === undefined && normalizeItemNameKey(item.description) === key,
        );
        const name = cleanProposedName(source?.description ?? key);
        const created = await tx.indentProduct.create({
          data: { name, nameKey: key, unit: 'kg', origin: 'LIVRE', sourceRequestNumber: processNumber },
        });
        freeProductIdByKey.set(key, created.id);
        createdFree.push({ id: created.id, name });
      }
    }

    const created = await tx.indentRequest.create({
      data: {
        processNumber,
        processYear: year,
        processSeq: seq,
        origin: 'IQ_INDENT',
        clientId: input.clientId,
        ownerName: user.name,
        createdById: user.id,
        createdByName: user.name,
        items: {
          create: input.items.map((item, position) => ({
            productId: item.productId ?? freeProductIdByKey.get(normalizeItemNameKey(item.description)) ?? null,
            description: cleanProposedName(item.description),
            quantityKg: item.quantityKg,
            confirmed: true,
            position,
          })),
        },
      },
      include: detailInclude,
    });

    for (const product of createdFree) {
      await AuditLogService.log(
        {
          entityType: 'indent_product',
          entityId: product.id,
          action: 'indent_product.created_from_request',
          performedById: user.id,
          afterData: { name: product.name, origin: 'LIVRE', sourceRequestNumber: processNumber },
          metadata: { processNumber },
        },
        tx,
      );
    }

    await AuditLogService.log(
      {
        entityType: ENTITY_TYPE,
        entityId: created.id,
        action: 'indent_request.created',
        performedById: user.id,
        afterData: {
          processNumber,
          origin: 'IQ_INDENT',
          clientId: input.clientId,
          ownerName: user.name,
          items: created.items.map((item) => ({
            productId: item.productId,
            description: item.description,
            quantityKg: toNumber(item.quantityKg),
          })),
        },
      },
      tx,
    );

    return serializeDetail(created, now);
  }

  // Confirmar itens: so no backend neste PR (sem UI). Nada mudou = sem escrita e sem log.
  static async confirmItems(id: number, input: IndentConfirmItemsInput, user: IndentActor, now: Date = new Date()) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.indentRequest.findUnique({
        where: { id },
        select: {
          id: true,
          processNumber: true,
          status: true,
          items: { select: { id: true, productId: true, confirmed: true } },
        },
      });

      if (!request) {
        throw new HttpError(404, 'Solicitação não encontrada.');
      }
      if (request.status !== 'NOVA') {
        throw new HttpError(409, 'Os itens desta solicitação já foram cotados.');
      }

      const byId = new Map(request.items.map((item) => [item.id, item]));
      const targets = input.itemIds.map((itemId) => byId.get(itemId));

      if (targets.some((item) => !item)) {
        throw new HttpError(400, 'Item inexistente nesta solicitação.');
      }

      const found = targets as Array<{ id: number; productId: number | null; confirmed: boolean }>;

      if (found.some((item) => item.productId === null)) {
        throw new HttpError(400, 'Escolha o produto do item antes de confirmar.');
      }

      const pending = found.filter((item) => !item.confirmed).map((item) => item.id);

      if (pending.length > 0) {
        await tx.indentRequestItem.updateMany({
          where: { id: { in: pending }, requestId: id },
          data: { confirmed: true },
        });

        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: id,
            action: 'indent_request.items_confirmed',
            performedById: user.id,
            metadata: { processNumber: request.processNumber, itemIds: pending },
          },
          tx,
        );
      }

      const row = await tx.indentRequest.findUnique({ where: { id }, include: detailInclude });

      if (!row) {
        throw new HttpError(404, 'Solicitação não encontrada.');
      }

      return serializeDetail(row, now);
    });
  }
}
