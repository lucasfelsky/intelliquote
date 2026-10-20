// Lembrete DIARIO (seg-sex, BRT) ao fornecedor que nao respondeu. Testa o sweep isolado:
//   - fim de semana em Brasilia (derivado da data BRT, nao do TZ do processo): nada consultado
//   - so pares com dispatch por e-mail; idade minima do token (10 h E data BRT anterior);
//     guarda de link aberto em 24 h sobre TODOS os tokens ativos do par
//   - paradas por cotacao/fornecedor (fechada, prazo, PO, vencedor, inativo, ja respondeu)
//   - orcamento de tempo, virada de dia e revalidacao pos-claim
//   - resumo unico por endereco de e-mail (1 cotacao = quote_reminder; 2+ = digest)
//   - idempotencia por claim (P2002, pre-filtro, 2 execucoes, corrida)
//   - falha previa/filtro comercial revoga o token FRESCO; falha do transporte NAO revoga
// Todas as datas em ISO com Z (BRT = UTC-3), entao o resultado independe do TZ do processo.
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getMailer: vi.fn(),
  SKIPPED_COMERCIAL_RECIPIENT: 'skipped_comercial_recipient',
  SKIPPED_COMERCIAL_LOOKUP_FAILED: 'skipped_comercial_lookup_failed',
}));

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../src/services/CompanyProfileService', () => ({
  CompanyProfileService: {
    get: vi.fn().mockResolvedValue({ companyName: 'SQ Quimica' }),
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    supplierPortalToken: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    supplierPortalResponse: { findMany: vi.fn() },
    quoteResponse: { findMany: vi.fn() },
    creditSupportRequest: { findMany: vi.fn() },
    supplierPortalReminderAddress: { create: vi.fn(), update: vi.fn() },
    supplierPortalReminder: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mockar o SupplierPortalService inteiro: o createToken REAL gera um raw
// token aleatorio (nao armazenado), o que impediria asserts do link.
vi.mock('../src/services/SupplierPortalService', () => ({
  SupplierPortalService: {
    createToken: vi.fn(),
  },
}));

import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { EmailTemplateService } from '../src/services/EmailTemplateService';
import { SupplierPortalService } from '../src/services/SupplierPortalService';
import {
  REMINDER_MIN_TOKEN_AGE_HOURS,
  REMINDER_SKIP_IF_SEEN_HOURS,
  REMINDER_SEND_HARD_LIMIT_MS,
  REMINDER_SWEEP_BUDGET_MS,
  SupplierPortalReminderService,
  isTokenOldEnough,
  isWeekendDateKey,
  wasOpenedRecently,
} from '../src/services/SupplierPortalReminderService';

type Mock = ReturnType<typeof vi.fn>;
const sendAndLogMock = sendAndLog as unknown as Mock;
const templateGetMock = EmailTemplateService.get as unknown as Mock;
const createTokenMock = SupplierPortalService.createToken as unknown as Mock;
const tokenFindMany = prisma.supplierPortalToken.findMany as unknown as Mock;
const tokenUpdateMany = prisma.supplierPortalToken.updateMany as unknown as Mock;
const portalResponseFindMany = prisma.supplierPortalResponse.findMany as unknown as Mock;
const quoteResponseFindMany = prisma.quoteResponse.findMany as unknown as Mock;
const creditFindMany = prisma.creditSupportRequest.findMany as unknown as Mock;
const addressCreate = prisma.supplierPortalReminderAddress.create as unknown as Mock;
const addressUpdate = prisma.supplierPortalReminderAddress.update as unknown as Mock;
const reminderFindMany = prisma.supplierPortalReminder.findMany as unknown as Mock;
const reminderCreate = prisma.supplierPortalReminder.create as unknown as Mock;
const reminderUpdate = prisma.supplierPortalReminder.update as unknown as Mock;

const CONTACT_EMAIL = 'li@shanghaichem.example';
const CONTACT_NAME = 'Li Wei';
const RAW_FRESH = 'fresh-raw-token-1234567890';
const EXPIRES = new Date('2026-11-10T18:00:00Z');

// Ter 2026-10-20 04:00 BRT (job diario).
const NOW = new Date('2026-10-20T07:00:00Z');
const TODAY = '2026-10-20';
const CREATED_OK = new Date('2026-10-19T07:00:00Z'); // 24 h e data BRT anterior

const HOUR = 3_600_000;

type QuoteRequestFixture = {
  requestCode: string;
  productName: string;
  status: string;
  deletedAt: Date | null;
  deadlineAt: Date | null;
  purchaseOrderSentAt: Date | null;
};

function quoteFixture(overrides: Partial<QuoteRequestFixture> = {}): QuoteRequestFixture {
  return {
    requestCode: 'QR-2026-042',
    productName: 'PI-TPO',
    status: 'open',
    deletedAt: null,
    deadlineAt: null,
    purchaseOrderSentAt: null,
    ...overrides,
  };
}

function activeToken(overrides: Record<string, unknown> = {}) {
  const contactId = (overrides.supplierContactId as number | undefined) ?? 9;
  return {
    id: 7,
    quoteRequestId: 5,
    supplierId: 2,
    supplierContactId: contactId,
    createdById: 1,
    dispatchEventId: 33 as number | null,
    expiresAt: EXPIRES,
    createdAt: CREATED_OK,
    lastSeenAt: null as Date | null,
    supplier: { name: 'Shanghai Chem Co.', status: 'active', deletedAt: null as Date | null },
    supplierContact: {
      name: CONTACT_NAME,
      email: contactId === 9 ? CONTACT_EMAIL : `contact-${contactId}@shanghaichem.example`,
    },
    quoteRequest: quoteFixture(),
    ...overrides,
  };
}

type TokenFixture = ReturnType<typeof activeToken>;

interface World {
  active?: TokenFixture[];
  respondedTokens?: Array<{ quoteRequestId: number; supplierId: number }>;
  portalResponses?: Array<{ quoteRequestId: number; supplierId: number }>;
  manualResponses?: Array<{ quoteRequestId: number; supplierId: number; isWinner?: boolean }>;
  creditWinners?: Array<{ quoteRequestId: number }>;
  /** Roda depois de cada claim gravado (permite mudar o "mundo" antes da revalidacao). */
  afterClaim?: () => void;
}

// Fake stateful: os claims vivem na closure e sobrevivem entre execucoes do mesmo teste.
function world(w: World = {}) {
  const claims = new Map<string, number>();
  const addressClaims = new Set<string>();
  let nextClaimId = 100;
  addressCreate.mockImplementation(async (args: { data: { addressHash: string; reminderDate: string } }) => {
    const key = `${args.data.addressHash}:${args.data.reminderDate}`;
    if (addressClaims.has(key)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
    addressClaims.add(key);
    return { id: addressClaims.size };
  });
  const claimKey = (c: { quoteRequestId: number; supplierContactId: number; reminderDate: string }) =>
    `${c.quoteRequestId}:${c.supplierContactId}:${c.reminderDate}`;

  tokenFindMany.mockImplementation(async (args: { where: { respondedAt: unknown } }) =>
    args.where.respondedAt === null ? (w.active ?? []) : (w.respondedTokens ?? []),
  );
  portalResponseFindMany.mockImplementation(async () => w.portalResponses ?? []);
  quoteResponseFindMany.mockImplementation(async () =>
    (w.manualResponses ?? []).map((r) => ({ isWinner: false, ...r })),
  );
  creditFindMany.mockImplementation(async () => w.creditWinners ?? []);
  reminderFindMany.mockImplementation(
    async (args: { where: { reminderDate: string; quoteRequestId: { in: number[] } } }) =>
      [...claims.keys()]
        .map((key) => {
          const [quoteRequestId, supplierContactId, reminderDate] = key.split(':');
          return {
            quoteRequestId: Number(quoteRequestId),
            supplierContactId: Number(supplierContactId),
            reminderDate,
          };
        })
        .filter(
          (c) =>
            c.reminderDate === args.where.reminderDate && args.where.quoteRequestId.in.includes(c.quoteRequestId),
        )
        .map(({ quoteRequestId, supplierContactId }) => ({ quoteRequestId, supplierContactId })),
  );
  reminderCreate.mockImplementation(
    async (args: { data: { quoteRequestId: number; supplierContactId: number; reminderDate: string } }) => {
      const key = claimKey(args.data);
      if (claims.has(key)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      nextClaimId += 1;
      claims.set(key, nextClaimId);
      w.afterClaim?.();
      return { id: nextClaimId };
    },
  );
  return { claims, addressClaims };
}

const hashOf = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

const run = (now: Date = NOW, options?: { realNow?: () => number }) =>
  SupplierPortalReminderService.runReminderSweep(now, options);

const isNotClause = (id: unknown): id is { not: number } =>
  typeof id === 'object' && id !== null && 'not' in id;
const byPairRevocations = () => tokenUpdateMany.mock.calls.filter(([args]) => isNotClause(args.where.id));
const byPairRevocation = () => byPairRevocations()[0];
const freshRevocations = () =>
  tokenUpdateMany.mock.calls.filter(
    ([args]) => typeof args.where.id === 'object' && args.where.id !== null && 'in' in args.where.id,
  );
const freshRevocation = () => freshRevocations()[0];

function expectNothingSent() {
  expect(reminderCreate).not.toHaveBeenCalled();
  expect(createTokenMock).not.toHaveBeenCalled();
  expect(sendAndLogMock).not.toHaveBeenCalled();
}

function mockFreshTokens(...ids: number[]) {
  createTokenMock.mockReset();
  for (const id of ids) {
    createTokenMock.mockResolvedValueOnce({ id, expiresAt: EXPIRES, rawToken: `raw-${id}-token` });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  createTokenMock.mockReset();
  createTokenMock.mockResolvedValue({ id: 88, expiresAt: EXPIRES, rawToken: RAW_FRESH });
  tokenUpdateMany.mockReset();
  tokenUpdateMany.mockResolvedValue({ count: 1 });
  reminderUpdate.mockReset();
  reminderUpdate.mockResolvedValue({});
  addressCreate.mockReset();
  addressUpdate.mockReset();
  addressUpdate.mockResolvedValue({});
  sendAndLogMock.mockReset();
  sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'smtp-1' });
  templateGetMock.mockClear();
});

describe('helpers puros', () => {
  it('isWeekendDateKey olha a chave BRT, nao o TZ do processo', () => {
    expect(isWeekendDateKey('2026-10-24')).toBe(true); // sabado
    expect(isWeekendDateKey('2026-10-25')).toBe(true); // domingo
    expect(isWeekendDateKey('2026-10-23')).toBe(false); // sexta
    expect(isWeekendDateKey('2026-10-26')).toBe(false); // segunda
  });

  it('wasOpenedRecently: null nao conta e 24 h exatas nao contam (estrito)', () => {
    expect(wasOpenedRecently(null, NOW)).toBe(false);
    expect(wasOpenedRecently(new Date(NOW.getTime() - 24 * HOUR), NOW)).toBe(false);
    expect(wasOpenedRecently(new Date(NOW.getTime() - 24 * HOUR + 1), NOW)).toBe(true);
  });

  it('isTokenOldEnough exige 10 h E data BRT anterior (limite inclusivo)', () => {
    const today = '2026-10-27';
    const now = new Date('2026-10-27T07:00:00Z');
    expect(isTokenOldEnough(new Date('2026-10-26T21:00:00Z'), now, today)).toBe(true); // 10 h exatas
    expect(isTokenOldEnough(new Date('2026-10-26T21:00:01Z'), now, today)).toBe(false); // 9 h 59 min
    expect(isTokenOldEnough(new Date('2026-10-26T05:00:00Z'), new Date('2026-10-26T20:00:00Z'), '2026-10-26')).toBe(false); // mesma data
  });

  it('as constantes valem 10 h, 24 h, 120 s (orcamento) e 240 s (limite duro de envio)', () => {
    expect(REMINDER_MIN_TOKEN_AGE_HOURS).toBe(10);
    expect(REMINDER_SKIP_IF_SEEN_HOURS).toBe(24);
    expect(REMINDER_SWEEP_BUDGET_MS).toBe(120_000);
    expect(REMINDER_SEND_HARD_LIMIT_MS).toBe(240_000);
  });
});

describe('fim de semana e data BRT', () => {
  it('sabado (BRT): weekend true, nada consultado, log do resumo chamado', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    world({ active: [activeToken()] });

    const result = await run(new Date('2026-10-24T15:00:00Z'));

    expect(result).toMatchObject({ weekend: true, reminderDate: '2026-10-24', due: 0, sent: 0 });
    expect(tokenFindMany).not.toHaveBeenCalled();
    expect(reminderFindMany).not.toHaveBeenCalled();
    expectNothingSent();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ weekend: true, reminderDate: '2026-10-24' }),
      expect.stringContaining('fim de semana'),
    );
    info.mockRestore();
  });

  it('domingo 23:30 BRT (segunda em UTC): fim de semana, nada consultado', async () => {
    world({ active: [activeToken()] });

    const result = await run(new Date('2026-10-26T02:30:00Z'));

    expect(result).toMatchObject({ weekend: true, reminderDate: '2026-10-25' });
    expect(tokenFindMany).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it('sexta 23:30 BRT (sabado em UTC): processa com reminderDate 2026-10-23', async () => {
    world({ active: [] });

    const result = await run(new Date('2026-10-24T02:30:00Z'));

    expect(result).toMatchObject({ weekend: false, reminderDate: '2026-10-23' });
    expect(tokenFindMany).toHaveBeenCalledTimes(1);
  });

  it('segunda 00:30 BRT (03:30Z): processa com reminderDate 2026-10-26', async () => {
    world({ active: [] });

    const result = await run(new Date('2026-10-26T03:30:00Z'));

    expect(result).toMatchObject({ weekend: false, reminderDate: '2026-10-26' });
    expect(tokenFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('SupplierPortalReminderService.runReminderSweep', () => {
  it('happy path ter 04:00 BRT: claim -> token novo (MESMO deadline) -> email -> revoga os outros -> claim sent', async () => {
    world({ active: [activeToken()] });

    const result = await run();

    expect(result).toMatchObject({
      reminderDate: TODAY,
      weekend: false,
      due: 1,
      sent: 1,
      pairsSent: 1,
      skipped: 0,
      failed: 0,
    });

    expect(reminderCreate).toHaveBeenCalledWith({
      data: {
        quoteRequestId: 5,
        supplierContactId: 9,
        reminderDate: TODAY,
        tokenId: 7,
        status: 'claimed',
      },
    });

    const createArgs = createTokenMock.mock.calls[0][0];
    expect(createArgs.expiresAt).toEqual(EXPIRES);
    expect(createArgs.reminderSentAt).toEqual(NOW);
    expect(createArgs.quoteRequestId).toBe(5);
    expect(createArgs.supplierContactId).toBe(9);
    expect(createArgs.createdById).toBe(1);
    expect(createArgs.dispatchEventId).toBe(33);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.to.email).toBe(CONTACT_EMAIL);
    expect('cc' in mail).toBe(false);
    expect(mail.subject).toContain('QR-2026-042');
    expect(mail.subject.toLowerCase()).toContain('reminder');
    expect(mail.text).toContain(RAW_FRESH);
    expect(mail.html).toContain(RAW_FRESH);
    expect(mail.templateId).toBe('quote_reminder');
    expect(mail.relatedEntityType).toBe('supplierPortalToken');
    expect(mail.relatedEntityId).toBe('7');
    expect(mail.templateVars).toEqual({
      reminderDate: TODAY,
      count: 1,
      items: [{ tokenId: 7, freshTokenId: 88, reminderId: 101, requestCode: 'QR-2026-042' }],
    });
    expect(JSON.stringify(mail.templateVars)).not.toContain(RAW_FRESH);

    expect(byPairRevocation()?.[0]).toEqual({
      where: {
        quoteRequestId: 5,
        supplierContactId: 9,
        revokedAt: null,
        respondedAt: null,
        id: { not: 88 },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'sent', sentAt: NOW, freshTokenId: 88 },
    });
  });

  it('a query de ativos filtra revogado, respondido e expirado', async () => {
    world({ active: [] });

    await run();

    const where = tokenFindMany.mock.calls[0][0].where;
    expect(where.revokedAt).toBeNull();
    expect(where.respondedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: NOW });
  });

  it('due = 0: loga todos os contadores zerados (sinal de que o job rodou)', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    world({ active: [] });

    const result = await run();

    expect(result).toMatchObject({ due: 0, sent: 0, skipped: 0, failed: 0 });
    expect(info).toHaveBeenCalledWith(
      {
        reminderDate: TODAY,
        weekend: false,
        due: 0,
        sent: 0,
        pairsSent: 0,
        skipped: 0,
        failed: 0,
        suppressed: 0,
        skippedNotYet: 0,
        skippedRecentlyOpened: 0,
        skippedResponded: 0,
        skippedQuoteClosed: 0,
        skippedPoSent: 0,
        skippedSupplierInactive: 0,
        skippedAlreadyClaimed: 0,
        skippedNoDispatch: 0,
        skippedWinnerChosen: 0,
        skippedDeadlinePassed: 0,
        skippedDuplicateAddress: 0,
        skippedAddressClaimed: 0,
        skippedNoActiveToken: 0,
        skippedAddressChanged: 0,
        skippedLateSend: 0,
        pairsFailed: 0,
        pairsRemaining: 0,
        skippedOnRevalidation: 0,
        budgetExhausted: false,
        dayChanged: false,
        remaining: 0,
        supersededTokens: 0,
        revokedTokens: 0,
      },
      'Sweep de lembretes diarios concluido.',
    );
    expect(portalResponseFindMany).not.toHaveBeenCalled();
    info.mockRestore();
  });
});

describe('so pares com dispatch por e-mail', () => {
  it('par so com token sem dispatchEventId: skippedNoDispatch, sem claim', async () => {
    world({ active: [activeToken({ dispatchEventId: null })] });

    const result = await run();

    expect(result).toMatchObject({ due: 1, skippedNoDispatch: 1, skipped: 1, sent: 0 });
    expectNothingSent();
  });

  it('token mais recente sem dispatch e mais antigo com dispatchEventId 33: envia e createToken recebe 33', async () => {
    world({
      active: [
        activeToken({ id: 12, dispatchEventId: null, createdAt: new Date('2026-10-19T08:00:00Z') }),
        activeToken({ id: 7, dispatchEventId: 33, createdAt: new Date('2026-10-18T07:00:00Z') }),
      ],
    });

    const result = await run();

    expect(result).toMatchObject({ sent: 1, skippedNoDispatch: 0 });
    expect(reminderCreate.mock.calls[0][0].data.tokenId).toBe(12);
    expect(createTokenMock.mock.calls[0][0].dispatchEventId).toBe(33);
  });
});

describe('idade minima do token (10 h E data BRT anterior)', () => {
  const MON = new Date('2026-10-26T07:00:00Z'); // seg 04:00 BRT
  const TUE = new Date('2026-10-27T07:00:00Z');
  const WED = new Date('2026-10-28T07:00:00Z');

  const rows: Array<{ label: string; createdAt: string; runs: Array<[Date, 'sent' | 'notYet']> }> = [
    {
      label: 'envio dom 20:00 BRT: seg 8h nao, ter envia',
      createdAt: '2026-10-25T23:00:00Z',
      runs: [[MON, 'notYet'], [TUE, 'sent']],
    },
    {
      label: 'envio seg 02:00 BRT: seg mesma data nao, ter envia',
      createdAt: '2026-10-26T05:00:00Z',
      runs: [[MON, 'notYet'], [TUE, 'sent']],
    },
    {
      label: 'envio seg 17:00 BRT: ter envia (11h)',
      createdAt: '2026-10-26T20:00:00Z',
      runs: [[TUE, 'sent']],
    },
    {
      label: 'envio seg 18:00 BRT: ter envia (10h exatas, limite inclusivo)',
      createdAt: '2026-10-26T21:00:00Z',
      runs: [[TUE, 'sent']],
    },
    {
      label: 'envio seg 19:00 BRT: ter NAO vale (9h), o 1o lembrete e na QUARTA',
      createdAt: '2026-10-26T22:00:00Z',
      runs: [[TUE, 'notYet'], [WED, 'sent']],
    },
  ];

  it.each(rows)('$label', async ({ createdAt, runs }) => {
    for (const [now, expected] of runs) {
      vi.clearAllMocks();
      createTokenMock.mockResolvedValue({ id: 88, expiresAt: EXPIRES, rawToken: RAW_FRESH });
      tokenUpdateMany.mockResolvedValue({ count: 1 });
      reminderUpdate.mockResolvedValue({});
      sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'smtp-1' });
      world({ active: [activeToken({ createdAt: new Date(createdAt) })] });

      const result = await run(now);

      if (expected === 'sent') {
        expect(result).toMatchObject({ sent: 1, skippedNotYet: 0 });
        expect(sendAndLogMock).toHaveBeenCalledTimes(1);
      } else {
        expect(result).toMatchObject({ sent: 0, skippedNotYet: 1, skipped: 1 });
        expectNothingSent();
      }
    }
  });
});

describe('guarda de link aberto nas ultimas 24 h', () => {
  it('lastSeenAt = now - 23h: pula, sem claim, sem token, sem envio', async () => {
    world({ active: [activeToken({ lastSeenAt: new Date(NOW.getTime() - 23 * HOUR) })] });

    const result = await run();

    expect(result).toMatchObject({ due: 1, sent: 0, skippedRecentlyOpened: 1, skipped: 1 });
    expectNothingSent();
  });

  it('lastSeenAt = now - 25h: envia', async () => {
    world({ active: [activeToken({ lastSeenAt: new Date(NOW.getTime() - 25 * HOUR) })] });

    const result = await run();

    expect(result).toMatchObject({ sent: 1, skippedRecentlyOpened: 0 });
  });

  it('pulo hoje nao grava claim: no dia seguinte (lastSeenAt > 24h) envia', async () => {
    const token = activeToken({ lastSeenAt: new Date(NOW.getTime() - 2 * HOUR) });
    const { claims } = world({ active: [token] });

    const first = await run();
    expect(first.skippedRecentlyOpened).toBe(1);
    expect(claims.size).toBe(0);

    const nextDay = new Date('2026-10-21T07:00:00Z');
    const second = await run(nextDay);
    expect(second).toMatchObject({ reminderDate: '2026-10-21', sent: 1, skippedRecentlyOpened: 0 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
  });

  it('olha TODOS os tokens ativos do par: antigo aberto ha 1h e mais recente null -> pula', async () => {
    world({
      active: [
        activeToken({ id: 12, createdAt: new Date('2026-10-19T08:00:00Z'), lastSeenAt: null }),
        activeToken({
          id: 7,
          createdAt: new Date('2026-10-18T07:00:00Z'),
          lastSeenAt: new Date(NOW.getTime() - 1 * HOUR),
        }),
      ],
    });

    const result = await run();

    expect(result).toMatchObject({ sent: 0, skippedRecentlyOpened: 1 });
    expectNothingSent();
  });
});

describe('condicoes de parada (sem claim e sem envio)', () => {
  it('cotacao closed', async () => {
    world({ active: [activeToken({ quoteRequest: quoteFixture({ status: 'closed' }) })] });
    expect(await run()).toMatchObject({ due: 1, skippedQuoteClosed: 1, skipped: 1, sent: 0 });
    expectNothingSent();
  });

  it('cotacao com deletedAt', async () => {
    world({ active: [activeToken({ quoteRequest: quoteFixture({ deletedAt: new Date() }) })] });
    expect(await run()).toMatchObject({ skippedQuoteClosed: 1, sent: 0 });
    expectNothingSent();
  });

  it('PO emitida (purchaseOrderSentAt setado)', async () => {
    world({ active: [activeToken({ quoteRequest: quoteFixture({ purchaseOrderSentAt: new Date() }) })] });
    expect(await run()).toMatchObject({ skippedPoSent: 1, sent: 0 });
    expectNothingSent();
  });

  it.each(['inactive', 'blocked'])('fornecedor %s', async (status) => {
    world({ active: [activeToken({ supplier: { name: 'X', status, deletedAt: null } })] });
    expect(await run()).toMatchObject({ skippedSupplierInactive: 1, sent: 0 });
    expectNothingSent();
  });

  it('fornecedor com deletedAt', async () => {
    world({ active: [activeToken({ supplier: { name: 'X', status: 'active', deletedAt: new Date() } })] });
    expect(await run()).toMatchObject({ skippedSupplierInactive: 1, sent: 0 });
    expectNothingSent();
  });

  it('token respondido (revogado) do MESMO contato', async () => {
    world({
      active: [activeToken()],
      respondedTokens: [{ quoteRequestId: 5, supplierId: 2 }],
    });
    expect(await run()).toMatchObject({ skippedResponded: 1, sent: 0 });
    expectNothingSent();
  });

  it('token respondido de OUTRO contato do mesmo fornecedor', async () => {
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 })],
      respondedTokens: [{ quoteRequestId: 5, supplierId: 2 }], // contato 10, mesmo fornecedor
    });
    expect(await run()).toMatchObject({ skippedResponded: 1, sent: 0 });
    expectNothingSent();
  });

  it('SupplierPortalResponse ativa', async () => {
    world({
      active: [activeToken()],
      portalResponses: [{ quoteRequestId: 5, supplierId: 2 }],
    });
    expect(await run()).toMatchObject({ skippedResponded: 1, sent: 0 });
    expectNothingSent();
  });

  it('QuoteResponse manual (resposta do COMEX)', async () => {
    world({
      active: [activeToken()],
      manualResponses: [{ quoteRequestId: 5, supplierId: 2 }],
    });
    expect(await run()).toMatchObject({ skippedResponded: 1, sent: 0 });
    expectNothingSent();
  });

  it('resposta de OUTRO fornecedor (sem vencedor) na mesma cotacao nao bloqueia', async () => {
    world({
      active: [activeToken()],
      manualResponses: [{ quoteRequestId: 5, supplierId: 99 }],
    });
    expect(await run()).toMatchObject({ skippedResponded: 0, sent: 1 });
  });

  it('as consultas em lote filtram deletedAt: null / respondedAt: { not: null } / isWinner e usam os ids das cotacoes', async () => {
    world({ active: [activeToken()] });

    await run();

    const respondedCall = tokenFindMany.mock.calls.find(([args]) => args.where.respondedAt !== null);
    expect(respondedCall?.[0].where).toEqual({ quoteRequestId: { in: [5] }, respondedAt: { not: null } });
    expect(portalResponseFindMany.mock.calls[0][0].where).toEqual({
      quoteRequestId: { in: [5] },
      deletedAt: null,
    });
    expect(quoteResponseFindMany.mock.calls[0][0]).toEqual({
      where: { quoteRequestId: { in: [5] }, deletedAt: null },
      select: { quoteRequestId: true, supplierId: true, isWinner: true },
    });
    expect(creditFindMany.mock.calls[0][0].where).toEqual({
      quoteRequestId: { in: [5] },
      isWinner: true,
    });
    expect(reminderFindMany.mock.calls[0][0].where).toEqual({
      reminderDate: TODAY,
      quoteRequestId: { in: [5] },
    });
  });

  it('cotacao fechada/PO/fornecedor inativo nao entram nas consultas em lote', async () => {
    world({ active: [activeToken({ quoteRequest: quoteFixture({ status: 'closed' }) })] });

    await run();

    expect(portalResponseFindMany).not.toHaveBeenCalled();
    expect(quoteResponseFindMany).not.toHaveBeenCalled();
    expect(creditFindMany).not.toHaveBeenCalled();
    expect(reminderFindMany).not.toHaveBeenCalled();
  });
});

describe('vencedor escolhido encerra a cotacao para todos os fornecedores', () => {
  it('QuoteResponse isWinner de OUTRO fornecedor: skippedWinnerChosen para os pares da cotacao', async () => {
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 }), activeToken({ id: 8, supplierContactId: 10 })],
      manualResponses: [{ quoteRequestId: 5, supplierId: 99, isWinner: true }],
    });

    const result = await run();

    expect(result).toMatchObject({ due: 2, skippedWinnerChosen: 2, sent: 0 });
    expectNothingSent();
  });

  it('CreditSupportRequest isWinner: mesmo efeito', async () => {
    world({
      active: [activeToken()],
      creditWinners: [{ quoteRequestId: 5 }],
    });

    const result = await run();

    expect(result).toMatchObject({ skippedWinnerChosen: 1, sent: 0 });
    expectNothingSent();
  });
});

describe('prazo da cotacao (data BRT inclusiva)', () => {
  it('prazo ontem (BRT): skippedDeadlinePassed', async () => {
    world({
      active: [activeToken({ quoteRequest: quoteFixture({ deadlineAt: new Date('2026-10-19T15:00:00Z') }) })],
    });

    const result = await run();

    expect(result).toMatchObject({ skippedDeadlinePassed: 1, sent: 0 });
    expectNothingSent();
  });

  it('prazo hoje 00:00 BRT (03:00Z, job as 07:00Z): ainda envia no ultimo dia', async () => {
    world({
      active: [activeToken({ quoteRequest: quoteFixture({ deadlineAt: new Date('2026-10-20T03:00:00Z') }) })],
    });

    const result = await run();

    expect(result).toMatchObject({ skippedDeadlinePassed: 0, sent: 1 });
  });

  it('prazo antes do expiresAt: assunto e corpo mostram a data do prazo', async () => {
    world({
      active: [activeToken({ quoteRequest: quoteFixture({ deadlineAt: new Date('2026-10-25T15:00:00Z') }) })],
    });

    await run();

    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.subject).toContain('25 Oct 2026');
    expect(mail.subject).not.toContain('10 Nov 2026');
    expect(mail.text).toContain('25 Oct 2026');
    expect(mail.html).toContain('25 Oct 2026');
  });

  it('prazo nulo: mostram o expiresAt', async () => {
    world({ active: [activeToken()] });

    await run();

    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.subject).toContain('10 Nov 2026');
    expect(mail.text).toContain('10 Nov 2026');
  });

  it('prazo depois do expiresAt: mostram o expiresAt', async () => {
    world({
      active: [activeToken({ quoteRequest: quoteFixture({ deadlineAt: new Date('2026-12-01T15:00:00Z') }) })],
    });

    await run();

    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.subject).toContain('10 Nov 2026');
    expect(mail.subject).not.toContain('01 Dec 2026');
  });
});

describe('idempotencia por claim', () => {
  it('create rejeita com P2002: sem token/envio, skippedAlreadyClaimed = 1', async () => {
    world({ active: [activeToken()] });
    reminderCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await run();

    expect(result).toMatchObject({ skippedAlreadyClaimed: 1, sent: 0, failed: 0 });
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('pre-filtro devolve o par: sem create', async () => {
    world({ active: [activeToken()] });
    reminderFindMany.mockResolvedValue([{ quoteRequestId: 5, supplierContactId: 9 }]);

    const result = await run();

    expect(result).toMatchObject({ skippedAlreadyClaimed: 1, sent: 0 });
    expectNothingSent();
  });

  it('erro de banco diferente de P2002 num par: o endereco vira failed, sem 500 e sem envio', async () => {
    world({ active: [activeToken()] });
    reminderCreate.mockRejectedValue(new Error('connection lost'));

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, pairsFailed: 1 });
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'failed' });
  });

  it('duas execucoes no mesmo dia (claims stateful): 1 envio no total', async () => {
    world({ active: [activeToken()] });

    const first = await run();
    const second = await run();

    expect(first.sent).toBe(1);
    expect(second).toMatchObject({ sent: 0, skippedAlreadyClaimed: 1 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    expect(reminderCreate).toHaveBeenCalledTimes(1);
  });

  it('duas execucoes em Promise.all (claim do endereco lanca P2002 no 2o): 1 envio', async () => {
    world({ active: [activeToken()] });

    const [a, b] = await Promise.all([run(), run()]);

    expect(a.sent + b.sent).toBe(1);
    expect(a.skippedAddressClaimed + b.skippedAddressClaimed).toBe(1);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    // O perdedor do endereco nao cria claims por par.
    expect(reminderCreate).toHaveBeenCalledTimes(1);
  });

  it('duas execucoes concorrentes com 2 cotacoes do mesmo endereco: 1 e-mail (resumo), nunca 2', async () => {
    const active = [
      activeToken({ id: 7, quoteRequestId: 5, quoteRequest: quoteFixture({ requestCode: 'QR-A' }) }),
      activeToken({ id: 8, quoteRequestId: 6, quoteRequest: quoteFixture({ requestCode: 'QR-B' }) }),
    ];
    world({ active });
    mockFreshTokens(88, 89);

    const [a, b] = await Promise.all([run(), run()]);

    expect(a.sent + b.sent).toBe(1);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    expect(sendAndLogMock.mock.calls[0][0].templateId).toBe('quote_reminder_digest');
  });

  it('claim do endereco com P2002: pula o endereco inteiro, sem claims por par, sem token, sem envio', async () => {
    world({ active: [activeToken()] });
    addressCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await run();

    expect(result).toMatchObject({ skippedAddressClaimed: 1, skipped: 1, sent: 0, failed: 0 });
    expectNothingSent();
    expect(addressUpdate).not.toHaveBeenCalled();
  });

  it('erro de banco diferente de P2002 no claim do endereco propaga', async () => {
    world({ active: [activeToken()] });
    addressCreate.mockRejectedValue(new Error('connection lost'));

    await expect(run()).rejects.toThrow('connection lost');
    expect(reminderCreate).not.toHaveBeenCalled();
  });

  it('o claim do endereco grava so o sha256 de lower(trim(email)) e a data do dia', async () => {
    world({ active: [activeToken({ supplierContact: { name: CONTACT_NAME, email: ' LI@Shanghaichem.example ' } })] });

    await run();

    expect(addressCreate).toHaveBeenCalledWith({
      data: { addressHash: hashOf(CONTACT_EMAIL), reminderDate: TODAY, status: 'claimed' },
    });
    expect(JSON.stringify(addressCreate.mock.calls).toLowerCase()).not.toContain('shanghaichem');
  });

  it('status do endereco acompanha o resultado: sent', async () => {
    world({ active: [activeToken()] });

    await run();

    expect(addressUpdate).toHaveBeenCalledWith({
      where: { addressHash_reminderDate: { addressHash: hashOf(CONTACT_EMAIL), reminderDate: TODAY } },
      data: { status: 'sent' },
    });
  });

  it('status do endereco acompanha o resultado: failed', async () => {
    world({ active: [activeToken()] });
    sendAndLogMock.mockResolvedValue({ status: 'failed', providerMessageId: '', error: 'SMTP' });

    await run();

    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'failed' });
  });

  it('status do endereco: skipped quando nenhum par sobra apos a revalidacao', async () => {
    const w: World = { active: [activeToken()] };
    w.afterClaim = () => {
      w.active![0].quoteRequest.status = 'closed';
    };
    world(w);

    await run();

    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'skipped' });
  });

  it('status do endereco: skipped quando todos os claims por par dao P2002', async () => {
    world({ active: [activeToken()] });
    reminderCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await run();

    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'skipped' });
  });
});

describe('agrupamento por par (cotacao, contato)', () => {
  it('2 tokens ativos do mesmo par (7 antigo, 12 novo): claim com tokenId 12, 1 envio, supersededTokens = 1', async () => {
    world({
      active: [
        activeToken({ id: 12, createdAt: new Date('2026-10-19T08:00:00Z') }),
        activeToken({ id: 7, createdAt: new Date('2026-10-18T07:00:00Z') }),
      ],
    });

    const result = await run();

    expect(result).toMatchObject({ due: 1, sent: 1, supersededTokens: 1 });
    expect(reminderCreate.mock.calls[0][0].data.tokenId).toBe(12);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    // A revogacao e por par (inclui o 7) e exclui o fresco.
    const where = byPairRevocation()?.[0].where;
    expect(where).toMatchObject({ quoteRequestId: 5, supplierContactId: 9, id: { not: 88 } });
  });

  it('contatos distintos (e-mails distintos) da mesma cotacao: 1 e-mail para cada', async () => {
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 }), activeToken({ id: 8, supplierContactId: 10 })],
    });

    const result = await run();

    expect(result).toMatchObject({ due: 2, sent: 2, pairsSent: 2 });
    expect(reminderCreate).toHaveBeenCalledTimes(2);
    expect(sendAndLogMock).toHaveBeenCalledTimes(2);
  });
});

describe('falhas de envio', () => {
  it('filtro comercial: claim suppressed, fresco revogado, revogacao por par NAO chamada', async () => {
    world({ active: [activeToken()] });
    sendAndLogMock.mockResolvedValue({
      status: 'failed',
      providerMessageId: '',
      error: 'skipped_comercial_recipient',
    });

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, suppressed: 1 });
    expect(freshRevocation()?.[0]).toEqual({
      where: { id: { in: [88] }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(byPairRevocation()).toBeUndefined();
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'suppressed', freshTokenId: 88, errorMessage: 'skipped_comercial_recipient' },
    });
  });

  it('filtro comercial com falha de consulta (LOOKUP_FAILED): fresco revogado, claim failed, sem suppressed', async () => {
    world({ active: [activeToken()] });
    sendAndLogMock.mockResolvedValue({
      status: 'failed',
      providerMessageId: '',
      error: 'skipped_comercial_lookup_failed',
    });

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, suppressed: 0 });
    expect(freshRevocation()).toBeDefined();
    expect(byPairRevocation()).toBeUndefined();
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'failed', freshTokenId: 88, errorMessage: 'skipped_comercial_lookup_failed' },
    });
  });

  it.each(['failed', 'queued'])('transporte retorna %s sem lancar: claim failed, token novo NAO revogado (F7), original intocado', async (status) => {
    world({ active: [activeToken()] });
    sendAndLogMock.mockResolvedValue({ status, providerMessageId: '', error: 'SMTP rejeitou o envio' });

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, suppressed: 0 });
    expect(freshRevocations()).toHaveLength(0);
    expect(byPairRevocations()).toHaveLength(0);
    expect(tokenUpdateMany).not.toHaveBeenCalled();
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'failed', freshTokenId: 88, errorMessage: `delivery_${status}` },
    });
  });

  it('sendAndLog lancando: claim failed, token novo NAO revogado (o e-mail pode ter saido)', async () => {
    world({ active: [activeToken()] });
    sendAndLogMock.mockRejectedValue(new Error(`SMTP down for ${CONTACT_EMAIL}`));

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(tokenUpdateMany).not.toHaveBeenCalled();
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'failed', freshTokenId: 88, errorMessage: 'delivery_error' },
    });
  });

  it('createToken lancando: claim failed sem freshTokenId e nada para revogar', async () => {
    world({ active: [activeToken()] });
    createTokenMock.mockRejectedValue(new Error('db down'));

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(tokenUpdateMany).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(reminderUpdate.mock.calls[0][0].data).toMatchObject({
      status: 'failed',
      freshTokenId: null,
      errorMessage: 'prepare_error',
    });
  });

  it('errorMessage do claim nunca guarda o texto do transporte (pode conter o e-mail)', async () => {
    world({ active: [activeToken()] });
    sendAndLogMock.mockResolvedValue({ status: 'failed', providerMessageId: '', error: `rejected ${CONTACT_EMAIL}` });

    await run();

    expect(JSON.stringify(reminderUpdate.mock.calls)).not.toContain(CONTACT_EMAIL);
  });

  it('falha pos-envio (revogacao lanca): sent = 1, sem excecao, sem failed', async () => {
    world({ active: [activeToken()] });
    tokenUpdateMany.mockRejectedValue(new Error('db down'));

    const result = await run();

    expect(result).toMatchObject({ sent: 1, failed: 0 });
  });

  it('um par com falha nao impede os demais', async () => {
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 }), activeToken({ id: 8, supplierContactId: 10 })],
    });
    sendAndLogMock
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce({ status: 'sent', providerMessageId: 'smtp-2' });

    const result = await run();

    expect(result).toMatchObject({ due: 2, sent: 1, failed: 1 });
  });
});

describe('orcamento de tempo e virada de dia', () => {
  it('orcamento estoura durante o envio do 1o endereco: o 2o nao ganha claim', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let clock = 0;
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 }), activeToken({ id: 8, supplierContactId: 10 })],
    });
    sendAndLogMock.mockImplementation(async () => {
      clock += REMINDER_SWEEP_BUDGET_MS + 1;
      return { status: 'sent', providerMessageId: 'smtp-1' };
    });

    const result = await run(NOW, { realNow: () => clock });

    expect(result).toMatchObject({
      sent: 1,
      budgetExhausted: true,
      dayChanged: false,
      remaining: 1,
      pairsRemaining: 1,
    });
    expect(reminderCreate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ budgetExhausted: true, remaining: 1, sent: 1 }),
      expect.stringContaining('orcamento de tempo esgotado'),
    );
    warn.mockRestore();
  });

  it('o orcamento conta por e-mail: 3 pares do MESMO endereco saem num e-mail so', async () => {
    let clock = 0;
    const quotes = [5, 6, 7].map((id) => ({
      quoteRequestId: id,
      quoteRequest: quoteFixture({ requestCode: `QR-2026-04${id}` }),
    }));
    world({
      active: quotes.map((q, i) =>
        activeToken({ id: 7 + i, supplierContactId: 9, supplier: { name: 'S', status: 'active', deletedAt: null }, ...q }),
      ),
    });
    createTokenMock.mockReset();
    createTokenMock
      .mockImplementationOnce(async () => {
        clock += REMINDER_SWEEP_BUDGET_MS + 1;
        return { id: 88, expiresAt: EXPIRES, rawToken: 'raw-88-token' };
      })
      .mockResolvedValueOnce({ id: 89, expiresAt: EXPIRES, rawToken: 'raw-89-token' })
      .mockResolvedValueOnce({ id: 90, expiresAt: EXPIRES, rawToken: 'raw-90-token' });

    const result = await run(NOW, { realNow: () => clock });

    expect(result).toMatchObject({ sent: 1, pairsSent: 3, budgetExhausted: false, remaining: 0 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    expect(createTokenMock).toHaveBeenCalledTimes(3);
  });

  it('virada de dia (seg 23:59:59 BRT): o 2o endereco nao e processado', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let clock = 0;
    const created = new Date('2026-10-17T07:00:00Z');
    world({
      active: [
        activeToken({ id: 7, supplierContactId: 9, createdAt: created }),
        activeToken({ id: 8, supplierContactId: 10, createdAt: created }),
      ],
    });
    sendAndLogMock.mockImplementation(async () => {
      clock += 2000;
      return { status: 'sent', providerMessageId: 'smtp-1' };
    });

    const result = await run(new Date('2026-10-20T02:59:59Z'), { realNow: () => clock });

    expect(result).toMatchObject({ reminderDate: '2026-10-19', sent: 1, dayChanged: true, budgetExhausted: false, remaining: 1 });
    expect(reminderCreate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ dayChanged: true, remaining: 1 }),
      expect.stringContaining('virada de dia'),
    );
    warn.mockRestore();
  });
});

describe('revalidacao pos-claim', () => {
  const rows: Array<{ label: string; reason: string; counter: string; mutate: (w: World) => void }> = [
    {
      label: 'chega QuoteResponse manual',
      reason: 'responded',
      counter: 'skippedResponded',
      mutate: (w) => w.manualResponses!.push({ quoteRequestId: 5, supplierId: 2 }),
    },
    {
      label: 'cotacao vira closed',
      reason: 'quote_closed',
      counter: 'skippedQuoteClosed',
      mutate: (w) => {
        w.active![0].quoteRequest.status = 'closed';
      },
    },
    {
      label: 'purchaseOrderSentAt setado',
      reason: 'po_sent',
      counter: 'skippedPoSent',
      mutate: (w) => {
        w.active![0].quoteRequest.purchaseOrderSentAt = new Date();
      },
    },
    {
      label: 'vencedor marcado',
      reason: 'winner_chosen',
      counter: 'skippedWinnerChosen',
      mutate: (w) => w.manualResponses!.push({ quoteRequestId: 5, supplierId: 99, isWinner: true }),
    },
    {
      label: 'fornecedor vira inactive',
      reason: 'supplier_inactive',
      counter: 'skippedSupplierInactive',
      mutate: (w) => {
        w.active![0].supplier.status = 'inactive';
      },
    },
    {
      label: 'lastSeenAt agora recente',
      reason: 'recently_opened',
      counter: 'skippedRecentlyOpened',
      mutate: (w) => {
        w.active![0].lastSeenAt = new Date(NOW.getTime() - HOUR);
      },
    },
    {
      label: 'token revogado (some dos ativos)',
      reason: 'no_active_token',
      counter: 'skippedNoActiveToken',
      mutate: (w) => {
        w.active!.length = 0;
      },
    },
    {
      label: 'token novo de re-dispatch criado agora',
      reason: 'not_yet',
      counter: 'skippedNotYet',
      mutate: (w) => {
        w.active!.unshift(activeToken({ id: 20, createdAt: NOW }));
      },
    },
  ];

  it.each(rows)('$label: claim skipped, sem token e sem envio', async ({ reason, counter, mutate }) => {
    const w: World = { active: [activeToken()], manualResponses: [] };
    w.afterClaim = () => mutate(w);
    world(w);

    const result = await run();

    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'skipped', errorMessage: `revalidation:${reason}` },
    });
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, skippedOnRevalidation: 1, [counter]: 1, skipped: 1 });
  });

  it('1 de 2 pares reprovado: sai e-mail de 1 cotacao com o template quote_reminder', async () => {
    const w: World = {
      active: [
        activeToken({ id: 7, quoteRequestId: 5, quoteRequest: quoteFixture({ requestCode: 'QR-2026-042' }) }),
        activeToken({ id: 8, quoteRequestId: 6, quoteRequest: quoteFixture({ requestCode: 'QR-2026-043' }) }),
      ],
    };
    w.afterClaim = () => {
      w.active![1].quoteRequest.status = 'closed';
    };
    world(w);

    const result = await run();

    expect(result).toMatchObject({ sent: 1, pairsSent: 1, skippedOnRevalidation: 1, skippedQuoteClosed: 1 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    expect(sendAndLogMock.mock.calls[0][0].templateId).toBe('quote_reminder');
    expect(templateGetMock).toHaveBeenCalledWith('quote_reminder', 'en');
    expect(sendAndLogMock.mock.calls[0][0].text).toContain('QR-2026-042');
  });
});

describe('resumo unico por endereco de e-mail', () => {
  function twoQuotes(overrides: [Record<string, unknown>, Record<string, unknown>] = [{}, {}]) {
    return [
      activeToken({
        id: 7,
        quoteRequestId: 5,
        quoteRequest: quoteFixture({ requestCode: 'QR-2026-042', productName: 'PI-TPO' }),
        ...overrides[0],
      }),
      activeToken({
        id: 8,
        quoteRequestId: 6,
        quoteRequest: quoteFixture({ requestCode: 'QR-2026-043', productName: 'Resina' }),
        ...overrides[1],
      }),
    ];
  }

  it('mesmo contato, 2 cotacoes: 1 e-mail digest com 2 links, 2 tokens, 2 revogacoes por par, 2 claims sent', async () => {
    world({ active: twoQuotes() });
    mockFreshTokens(88, 89);

    const result = await run();

    expect(result).toMatchObject({ due: 2, sent: 1, pairsSent: 2, failed: 0, revokedTokens: 2 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.templateId).toBe('quote_reminder_digest');
    expect(mail.subject).toBe('Reminder: 2 quotations pending — SQ Quimica');
    expect('cc' in mail).toBe(false);
    expect(mail.to).toEqual({ email: CONTACT_EMAIL, name: CONTACT_NAME });
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('QR-2026-042');
      expect(body).toContain('QR-2026-043');
      expect(body).toContain('raw-88-token');
      expect(body).toContain('raw-89-token');
    }
    expect(createTokenMock).toHaveBeenCalledTimes(2);
    expect(mail.templateVars).toEqual({
      reminderDate: TODAY,
      count: 2,
      items: [
        { tokenId: 7, freshTokenId: 88, reminderId: 101, requestCode: 'QR-2026-042' },
        { tokenId: 8, freshTokenId: 89, reminderId: 102, requestCode: 'QR-2026-043' },
      ],
    });
    expect(mail.relatedEntityId).toBe('7');
    expect(JSON.stringify(mail.templateVars)).not.toContain('raw-88-token');

    const revocations = byPairRevocations().map(([args]) => args.where);
    expect(revocations).toHaveLength(2);
    expect(revocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quoteRequestId: 5, id: { not: 88 }, respondedAt: null }),
        expect.objectContaining({ quoteRequestId: 6, id: { not: 89 }, respondedAt: null }),
      ]),
    );
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'sent', sentAt: NOW, freshTokenId: 88 },
    });
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 102 },
      data: { status: 'sent', sentAt: NOW, freshTokenId: 89 },
    });
    expect(templateGetMock).not.toHaveBeenCalled();
  });

  it('mesmo e-mail (maiusculas/espacos) em 2 contatos de fornecedores diferentes: 1 e-mail, saudacao do 1o par por requestCode', async () => {
    world({
      active: twoQuotes([
        {
          supplierContactId: 9,
          supplierContact: { name: 'Contato A', email: ' LI@X.example ' },
        },
        {
          supplierContactId: 10,
          supplierId: 3,
          supplierContact: { name: 'Contato Z', email: 'li@x.example' },
        },
      ]),
    });
    mockFreshTokens(88, 89);

    const result = await run();

    expect(result).toMatchObject({ sent: 1, pairsSent: 2 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.to).toEqual({ email: 'LI@X.example', name: 'Contato A' });
    expect(mail.text).toContain('Dear Contato A,');
  });

  it('mesmo e-mail e mesma cotacao via 2 contatos: 1 item (o candidate mais recente), skippedDuplicateAddress = 1', async () => {
    world({
      active: [
        activeToken({
          id: 7,
          supplierContactId: 9,
          supplierContact: { name: 'Contato A', email: 'dup@x.example' },
          createdAt: new Date('2026-10-18T07:00:00Z'),
        }),
        activeToken({
          id: 8,
          supplierContactId: 10,
          supplierContact: { name: 'Contato B', email: 'dup@x.example' },
          createdAt: new Date('2026-10-19T07:00:00Z'),
        }),
      ],
    });

    const result = await run();

    expect(result).toMatchObject({ due: 2, sent: 1, pairsSent: 1, skippedDuplicateAddress: 1, skipped: 1 });
    expect(reminderCreate).toHaveBeenCalledTimes(1);
    expect(reminderCreate.mock.calls[0][0].data.supplierContactId).toBe(10);
    expect(sendAndLogMock.mock.calls[0][0].templateId).toBe('quote_reminder');
  });

  it('1 cotacao: usa o EmailTemplate quote_reminder', async () => {
    world({ active: [activeToken()] });

    await run();

    expect(templateGetMock).toHaveBeenCalledWith('quote_reminder', 'en');
    expect(sendAndLogMock.mock.calls[0][0].templateId).toBe('quote_reminder');
  });

  it('P2002 em 1 de 2 pares: sai e-mail de 1 cotacao (template quote_reminder)', async () => {
    world({ active: twoQuotes() });
    const original = reminderCreate.getMockImplementation()!;
    reminderCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    reminderCreate.mockImplementation(original);

    const result = await run();

    expect(result).toMatchObject({ sent: 1, pairsSent: 1, skippedAlreadyClaimed: 1 });
    expect(sendAndLogMock.mock.calls[0][0].templateId).toBe('quote_reminder');
    expect(sendAndLogMock.mock.calls[0][0].text).toContain('QR-2026-043');
  });

  it('P2002 nos 2 pares: nenhum envio', async () => {
    world({ active: twoQuotes() });
    reminderCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await run();

    expect(result).toMatchObject({ sent: 0, skippedAlreadyClaimed: 2 });
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('resumo com status failed: 2 claims failed e nenhum token novo revogado', async () => {
    world({ active: twoQuotes() });
    mockFreshTokens(88, 89);
    sendAndLogMock.mockResolvedValue({ status: 'failed', providerMessageId: '', error: 'SMTP rejeitou o envio' });

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, suppressed: 0 });
    expect(tokenUpdateMany).not.toHaveBeenCalled();
    expect(reminderUpdate).toHaveBeenCalledTimes(2);
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'failed', freshTokenId: 88, errorMessage: 'delivery_failed' },
    });
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 102 },
      data: { status: 'failed', freshTokenId: 89, errorMessage: 'delivery_failed' },
    });
  });

  it('resumo suppressed (filtro comercial): 2 tokens novos revogados e 2 claims suppressed', async () => {
    world({ active: twoQuotes() });
    mockFreshTokens(88, 89);
    sendAndLogMock.mockResolvedValue({
      status: 'failed',
      providerMessageId: '',
      error: 'skipped_comercial_recipient',
    });

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, suppressed: 1 });
    expect(freshRevocations()).toHaveLength(1);
    expect(freshRevocation()?.[0].where).toEqual({ id: { in: [88, 89] }, revokedAt: null });
    expect(byPairRevocations()).toHaveLength(0);
    expect(reminderUpdate).toHaveBeenCalledTimes(2);
    for (const call of reminderUpdate.mock.calls) {
      expect(call[0].data.status).toBe('suppressed');
    }
  });

  it('createToken lanca no 2o par: o token novo do 1o e revogado, 2 claims failed, nenhum envio', async () => {
    world({ active: twoQuotes() });
    createTokenMock.mockReset();
    createTokenMock
      .mockResolvedValueOnce({ id: 88, expiresAt: EXPIRES, rawToken: 'raw-88-token' })
      .mockRejectedValueOnce(new Error('db down'));

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(freshRevocation()?.[0].where).toEqual({ id: { in: [88] }, revokedAt: null });
    expect(reminderUpdate).toHaveBeenCalledTimes(2);
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'failed', freshTokenId: 88, errorMessage: 'prepare_error' },
    });
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 102 },
      data: { status: 'failed', freshTokenId: null, errorMessage: 'prepare_error' },
    });
  });
});

describe('rodada 4: limite duro, ordem, dedupe, endereco alterado, erro por endereco, contadores', () => {
  const HARD = 240_000;

  it('B1: sweep passou de 240 s antes do sendAndLog: nao envia, revoga os tokens novos, claims e endereco skipped (late_send)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let clock = 0;
    world({ active: [activeToken()] });
    createTokenMock.mockReset();
    createTokenMock.mockImplementation(async () => {
      clock += HARD + 1;
      return { id: 88, expiresAt: EXPIRES, rawToken: RAW_FRESH };
    });

    const result = await run(NOW, { realNow: () => clock });

    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, failed: 0, skippedLateSend: 1, skipped: 1 });
    expect(freshRevocation()?.[0].where).toEqual({ id: { in: [88] }, revokedAt: null });
    expect(byPairRevocations()).toHaveLength(0);
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'skipped', freshTokenId: 88, errorMessage: 'late_send' },
    });
    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'skipped' });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ lateReason: 'late_send' }),
      expect.stringContaining('cancelado antes do envio'),
    );
    warn.mockRestore();
  });

  it('B1: logo abaixo de 240 s ainda envia', async () => {
    let clock = 0;
    world({ active: [activeToken()] });
    createTokenMock.mockReset();
    createTokenMock.mockImplementation(async () => {
      clock += HARD - 1;
      return { id: 88, expiresAt: EXPIRES, rawToken: RAW_FRESH };
    });

    const result = await run(NOW, { realNow: () => clock });

    expect(result).toMatchObject({ sent: 1, skippedLateSend: 0 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
  });

  it('B1: o dia virou entre os claims e o envio: nao envia (day_changed)', async () => {
    let clock = 0;
    world({ active: [activeToken({ createdAt: new Date('2026-10-17T07:00:00Z') })] });
    createTokenMock.mockReset();
    createTokenMock.mockImplementation(async () => {
      clock += 2000;
      return { id: 88, expiresAt: EXPIRES, rawToken: RAW_FRESH };
    });

    // seg 23:59:59 BRT; 2 s depois ja e' terca em Brasilia.
    const result = await run(new Date('2026-10-20T02:59:59Z'), { realNow: () => clock });

    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reminderDate: '2026-10-19', sent: 0, skippedLateSend: 1 });
    expect(freshRevocation()).toBeDefined();
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'skipped', freshTokenId: 88, errorMessage: 'day_changed' },
    });
    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'skipped' });
  });

  it('B2: a ordem dos enderecos e o embaralhamento diario sha256(addressHash + dia), deterministico', async () => {
    const emails = ['a1@x.example', 'b2@x.example', 'c3@x.example', 'd4@x.example', 'e5@x.example'];
    world({
      active: emails.map((email, i) =>
        activeToken({
          id: 20 + i,
          quoteRequestId: 30 + i,
          supplierContactId: 40 + i,
          supplierContact: { name: 'N', email },
        }),
      ),
    });

    await run();

    const shuffleKey = (email: string) =>
      createHash('sha256').update(`${hashOf(email)}${TODAY}`).digest('hex');
    const expected = [...emails].sort((a, b) => (shuffleKey(a) < shuffleKey(b) ? -1 : 1));
    const actual = sendAndLogMock.mock.calls.map(([mail]) => mail.to.email);
    expect(actual).toEqual(expected);
    // Fora da ordem alfabetica dos codigos/e-mails (senao o teste nao provaria nada).
    expect(expected).not.toEqual([...emails]);
  });

  it('B3: mesma cotacao em 2 FORNECEDORES diferentes no mesmo e-mail: 2 itens no resumo, com o nome do fornecedor', async () => {
    world({
      active: [
        activeToken({
          id: 7,
          supplierContactId: 9,
          supplierId: 2,
          supplier: { name: 'Fornecedor <Um> & Co', status: 'active', deletedAt: null },
        }),
        activeToken({
          id: 8,
          supplierContactId: 10,
          supplierId: 3,
          supplierContact: { name: 'Outro', email: CONTACT_EMAIL },
          supplier: { name: 'Fornecedor Dois', status: 'active', deletedAt: null },
        }),
      ],
    });
    mockFreshTokens(88, 89);

    const result = await run();

    expect(result).toMatchObject({ sent: 1, pairsSent: 2, skippedDuplicateAddress: 0 });
    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.templateId).toBe('quote_reminder_digest');
    expect(mail.html).toContain('Fornecedor &lt;Um&gt; &amp; Co');
    expect(mail.html).not.toContain('Fornecedor <Um>');
    expect(mail.html).toContain('Fornecedor Dois');
    expect(mail.text).toContain('supplier: Fornecedor <Um> & Co');
    expect(mail.text).toContain('supplier: Fornecedor Dois');
  });

  it('B3: 1 item usa o template quote_reminder com o supplierName nas vars', async () => {
    world({ active: [activeToken()] });
    templateGetMock.mockResolvedValueOnce({
      subject: '{{subject}}',
      htmlBody: '<p>{{supplierName}}</p>',
      textBody: 'S={{supplierName}}',
    });

    await run();

    expect(sendAndLogMock.mock.calls[0][0].html).toContain('Shanghai Chem Co.');
    expect(sendAndLogMock.mock.calls[0][0].text).toContain('S=Shanghai Chem Co.');
  });

  it('B4: e-mail do contato editado apos o claim do endereco: par skipped com address_changed, sem envio', async () => {
    const w: World = { active: [activeToken()] };
    w.afterClaim = () => {
      w.active![0].supplierContact.email = 'novo@x.example';
    };
    world(w);

    const result = await run();

    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'skipped', errorMessage: 'revalidation:address_changed' },
    });
    expect(result).toMatchObject({ sent: 0, skippedAddressChanged: 1, skippedOnRevalidation: 1, skipped: 1 });
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'skipped' });
  });

  it('B4: a normalizacao (trim/maiusculas) do mesmo e-mail NAO conta como alterado', async () => {
    const w: World = { active: [activeToken()] };
    w.afterClaim = () => {
      w.active![0].supplierContact.email = ` ${CONTACT_EMAIL.toUpperCase()} `;
    };
    world(w);

    const result = await run();

    expect(result).toMatchObject({ sent: 1, skippedAddressChanged: 0 });
  });

  it('B5: erro de banco num endereco nao derruba o sweep: endereco failed, claims failed, segue para o proximo', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 }), activeToken({ id: 8, supplierContactId: 10 })],
    });
    const original = reminderCreate.getMockImplementation()!;
    reminderCreate.mockRejectedValueOnce(new Error(`connection lost for ${CONTACT_EMAIL}`));
    reminderCreate.mockImplementation(original);

    const result = await run();

    expect(result).toMatchObject({ sent: 1, failed: 1, pairsFailed: 1, pairsSent: 1 });
    expect(addressUpdate.mock.calls.map(([args]) => args.data.status).sort()).toEqual(['failed', 'sent']);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/@shanghaichem\.example|connection lost/);
    error.mockRestore();
  });

  it('B5: erro no 2o claim do mesmo endereco: o 1o claim vira failed (address_error) e nada e enviado', async () => {
    world({
      active: [
        activeToken({ id: 7, quoteRequestId: 5, quoteRequest: quoteFixture({ requestCode: 'QR-A' }) }),
        activeToken({ id: 8, quoteRequestId: 6, quoteRequest: quoteFixture({ requestCode: 'QR-B' }) }),
      ],
    });
    const original = reminderCreate.getMockImplementation()!;
    reminderCreate.mockImplementationOnce(original);
    reminderCreate.mockRejectedValueOnce(new Error('db down'));

    const result = await run();

    expect(result).toMatchObject({ sent: 0, failed: 1, pairsFailed: 2 });
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { status: 'failed', errorMessage: 'address_error' },
    });
    expect(sendAndLogMock).not.toHaveBeenCalled();
    expect(addressUpdate.mock.calls[0][0].data).toEqual({ status: 'failed' });
  });

  it('B6: skippedAddressClaimed soma PARES (2 pares do endereco ja claimado = 2)', async () => {
    const { addressClaims } = world({
      active: [
        activeToken({ id: 7, quoteRequestId: 5, quoteRequest: quoteFixture({ requestCode: 'QR-A' }) }),
        activeToken({ id: 8, quoteRequestId: 6, quoteRequest: quoteFixture({ requestCode: 'QR-B' }) }),
      ],
    });
    addressClaims.add(`${hashOf(CONTACT_EMAIL)}:${TODAY}`);

    const result = await run();

    expect(result).toMatchObject({ due: 2, skippedAddressClaimed: 2, skipped: 2, sent: 0 });
    expectNothingSent();
  });

  it('B6: cenario misto fecha due = pairsSent + skipped + pairsFailed + pairsRemaining', async () => {
    let clock = 0;
    const mk = (id: number, contactId: number, email: string, extra: Record<string, unknown> = {}) =>
      activeToken({
        id,
        quoteRequestId: 100 + id,
        supplierContactId: contactId,
        supplierContact: { name: 'N', email },
        quoteRequest: quoteFixture({ requestCode: `QR-${id}` }),
        ...extra,
      });
    const { addressClaims } = world({
      active: [
        mk(1, 9, 'x@x.example'),
        mk(2, 10, 'x@x.example'), // mesmo endereco X: resumo de 2 pares
        mk(3, 11, 'y@x.example'), // falha de transporte
        mk(4, 12, 'z@x.example'),
        mk(5, 13, 'w@x.example'),
        mk(6, 14, 'v@x.example'), // endereco ja claimado por outro sweep
        mk(7, 15, 'u@x.example', { quoteRequest: quoteFixture({ requestCode: 'QR-7', status: 'closed' }) }),
        // duplicado de (cotacao 101, fornecedor 2) no endereco X
        activeToken({
          id: 8,
          quoteRequestId: 101,
          supplierContactId: 16,
          supplierContact: { name: 'N', email: 'x@x.example' },
          quoteRequest: quoteFixture({ requestCode: 'QR-1' }),
          createdAt: new Date('2026-10-18T07:00:00Z'),
        }),
      ],
    });
    addressClaims.add(`${hashOf('v@x.example')}:${TODAY}`);
    // Cada envio consome 60 s: depois de 2 e-mails o orcamento (120 s) estoura.
    sendAndLogMock.mockImplementation(async (mail: { to: { email: string } }) => {
      clock += 60_001;
      if (mail.to.email === 'y@x.example') throw new Error('SMTP down');
      return { status: 'sent', providerMessageId: 'smtp-1' };
    });

    const result = await run(NOW, { realNow: () => clock });

    expect(result.due).toBe(8);
    expect(result.budgetExhausted).toBe(true);
    expect(result.pairsRemaining).toBeGreaterThan(0);
    expect(result.pairsSent + result.skipped + result.pairsFailed + result.pairsRemaining).toBe(result.due);
    expect(result.skippedQuoteClosed).toBe(1);
    expect(result.skippedDuplicateAddress).toBe(1);
  });
});

describe('privacidade dos logs', () => {
  function spyLoggers() {
    return {
      info: vi.spyOn(logger, 'info').mockImplementation(() => undefined),
      warn: vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(logger, 'error').mockImplementation(() => undefined),
    };
  }
  const logged = (spies: ReturnType<typeof spyLoggers>) =>
    JSON.stringify([...spies.info.mock.calls, ...spies.warn.mock.calls, ...spies.error.mock.calls]);

  it('nenhum logger.* contem o e-mail, o nome do contato nem o token cru (1 cotacao por e-mail)', async () => {
    const spies = spyLoggers();
    world({
      active: [activeToken({ id: 7, supplierContactId: 9 }), activeToken({ id: 8, supplierContactId: 10 })],
    });
    sendAndLogMock
      .mockRejectedValueOnce(new Error(`SMTP rejected ${CONTACT_EMAIL} (${RAW_FRESH})`))
      .mockResolvedValueOnce({ status: 'sent', providerMessageId: 'smtp-2' });
    tokenUpdateMany.mockRejectedValue(new Error(`boom ${CONTACT_EMAIL}`));

    await run();

    const text = logged(spies);
    expect(spies.warn).toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalled();
    expect(text).not.toMatch(/@shanghaichem\.example/);
    expect(text).not.toContain(CONTACT_NAME);
    expect(text).not.toContain(RAW_FRESH);
    Object.values(spies).forEach((spy) => spy.mockRestore());
  });

  it('o caminho do resumo (2 cotacoes) tambem nao vaza e-mail, nome nem token cru', async () => {
    const spies = spyLoggers();
    world({
      active: [
        activeToken({ id: 7, quoteRequestId: 5, quoteRequest: quoteFixture({ requestCode: 'QR-A' }) }),
        activeToken({ id: 8, quoteRequestId: 6, quoteRequest: quoteFixture({ requestCode: 'QR-B' }) }),
      ],
    });
    mockFreshTokens(88, 89);
    sendAndLogMock.mockRejectedValueOnce(new Error(`SMTP rejected ${CONTACT_EMAIL} raw-88-token`));

    await run();
    mockFreshTokens(90, 91);
    world({
      active: [
        activeToken({ id: 7, quoteRequestId: 5, quoteRequest: quoteFixture({ requestCode: 'QR-A' }) }),
        activeToken({ id: 8, quoteRequestId: 6, quoteRequest: quoteFixture({ requestCode: 'QR-B' }) }),
      ],
    });
    sendAndLogMock.mockResolvedValue({ status: 'sent', providerMessageId: 'smtp-3' });
    tokenUpdateMany.mockRejectedValue(new Error(`boom ${CONTACT_EMAIL}`));
    await run();

    const text = logged(spies);
    expect(spies.warn).toHaveBeenCalled();
    expect(text).not.toContain(CONTACT_EMAIL);
    expect(text).not.toContain(CONTACT_NAME);
    expect(text).not.toMatch(/raw-\d+-token/);
    Object.values(spies).forEach((spy) => spy.mockRestore());
  });
});
