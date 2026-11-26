import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupplierPortalToken } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import {
  SupplierPortalService,
  PORTAL_INVALID_LINK_MESSAGE,
  REMINDER_SUCCESSOR_TOLERANCE_MS,
} from '../src/services/SupplierPortalService';
import { PortalHttpError } from '../src/utils/portalHttpError';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `supplier-portal-redirect-db-${Date.now()}`;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Este arquivo NAO chama runReminderSweep. Todo token nasce com dispatchEventId null (o sweep do
// arquivo supplier-portal-reminder-db.test.ts, que pode rodar em paralelo no CI, ignora: no_dispatch)
// e, nos casos deterministicos, com expiresAt <= agora + 2 dias.
describe('SupplierPortalService.validate - redirecionamento de link revogado (DB)', () => {
  let userId = 0;
  let supplierId = 0;
  let contactA = 0;
  let contactB = 0;
  const quoteIds: number[] = [];

  // Ancora de tempo: revogacao do token D ocorreu ha 1 h; D foi criado 1 dia antes.
  let T = new Date();
  let DEFAULT_EXPIRES = new Date();

  type TokenOpts = {
    quoteRequestId: number;
    contactId: number;
    createdAt?: Date;
    revokedAt?: Date | null;
    reminderSentAt?: Date | null;
    expiresAt?: Date;
  };
  type Made = { id: number; rawToken: string };

  async function makeQuote(suffix: string) {
    const quote = await prisma.quoteRequest.create({
      data: { requestCode: `QR-${runId}-${suffix}`, desiredIncoterm: ['FOB'], currency: 'USD' },
    });
    quoteIds.push(quote.id);
    return quote.id;
  }

  async function makeToken(opts: TokenOpts): Promise<Made> {
    const token = (await SupplierPortalService.createToken({
      quoteRequestId: opts.quoteRequestId,
      supplierId,
      supplierContactId: opts.contactId,
      createdById: userId,
      dispatchEventId: null,
      expiresAt: opts.expiresAt ?? DEFAULT_EXPIRES,
      reminderSentAt: opts.reminderSentAt ?? null,
    })) as SupplierPortalToken & { rawToken: string };
    const data: { createdAt?: Date; revokedAt?: Date | null } = {};
    if (opts.createdAt) data.createdAt = opts.createdAt;
    if (opts.revokedAt !== undefined) data.revokedAt = opts.revokedAt;
    if (Object.keys(data).length > 0) {
      await prisma.supplierPortalToken.update({ where: { id: token.id }, data });
    }
    return { id: token.id, rawToken: token.rawToken };
  }

  // D: revogado em T, criado em T - 1 dia.
  const makeRevoked = (quoteRequestId: number, contactId = contactA) =>
    makeToken({ quoteRequestId, contactId, createdAt: new Date(T.getTime() - DAY), revokedAt: T });

  async function expectInvalid(token: Made) {
    const attempt = SupplierPortalService.validate({ rawToken: token.rawToken });
    await expect(attempt).rejects.toBeInstanceOf(PortalHttpError);
    await expect(attempt).rejects.toMatchObject({ status: 404, message: PORTAL_INVALID_LINK_MESSAGE });
    const logs = await prisma.supplierPortalTokenLog.findMany({
      where: { tokenId: token.id, kind: 'INVALID' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].meta).toMatchObject({ reason: 'revoked' });
  }

  const viewLogs = (tokenId: number) =>
    prisma.supplierPortalTokenLog.findMany({ where: { tokenId, kind: 'VIEW' }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    T = new Date(Date.now() - 60 * MINUTE);
    DEFAULT_EXPIRES = new Date(Date.now() + DAY);

    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Redirect ${runId}`,
        email: `redirect-${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: role.id,
      },
    });
    userId = user.id;

    const supplier = await prisma.supplier.create({
      data: { name: `Fornecedor ${runId}`, acceptedIncoterms: ['FOB'], status: 'active' },
    });
    supplierId = supplier.id;
    contactA = (
      await prisma.supplierContact.create({
        data: { supplierId, name: 'Contato A', email: `contato-a-${runId}@fornecedor.example` },
      })
    ).id;
    contactB = (
      await prisma.supplierContact.create({
        data: { supplierId, name: 'Contato B', email: `contato-b-${runId}@fornecedor.example` },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // Tokens e logs caem em cascata com a cotacao.
    await prisma.quoteRequest.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // --- Matriz deterministica (createdAt/revokedAt fixados) ---

  testDbSkip('(a1) sucessor do lembrete na janela: validate(D) devolve R1 e loga o redirecionamento', async () => {
    const q = await makeQuote('a1');
    const d = await makeRevoked(q);
    const r1 = await makeToken({
      quoteRequestId: q,
      contactId: contactA,
      reminderSentAt: T,
      createdAt: new Date(T.getTime() - MINUTE),
    });

    const result = await SupplierPortalService.validate({ rawToken: d.rawToken });

    expect(result.token.id).toBe(r1.id);
    expect(result.alreadyResponded).toBe(false);
    expect(result.token.accessCount).toBe(1);
    const logs = await viewLogs(r1.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta).toMatchObject({ redirectedFromTokenId: d.id, hops: 1 });
  });

  testDbSkip('(a2) cadeia D -> R1 -> R2: validate(D) e validate(R1) devolvem R2 (2 saltos)', async () => {
    const q = await makeQuote('a2');
    const d = await makeRevoked(q);
    const r1 = await makeToken({
      quoteRequestId: q,
      contactId: contactA,
      reminderSentAt: T,
      createdAt: new Date(T.getTime() - MINUTE),
      revokedAt: new Date(T.getTime() + DAY),
    });
    const r2 = await makeToken({
      quoteRequestId: q,
      contactId: contactA,
      reminderSentAt: new Date(T.getTime() + DAY),
      createdAt: new Date(T.getTime() + DAY - MINUTE),
    });

    const fromD = await SupplierPortalService.validate({ rawToken: d.rawToken });
    expect(fromD.token.id).toBe(r2.id);
    const logs = await viewLogs(r2.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta).toMatchObject({ redirectedFromTokenId: d.id, hops: 2 });

    const fromR1 = await SupplierPortalService.validate({ rawToken: r1.rawToken });
    expect(fromR1.token.id).toBe(r2.id);
  });

  testDbSkip('(b) sucessor ativo sem reminderSentAt na janela: 404', async () => {
    const q = await makeQuote('b');
    const d = await makeRevoked(q);
    await makeToken({ quoteRequestId: q, contactId: contactA, createdAt: new Date(T.getTime() - MINUTE) });

    await expectInvalid(d);
  });

  testDbSkip('(c1) sucessor do lembrete de OUTRO contato da mesma cotacao: 404', async () => {
    const q = await makeQuote('c1');
    const d = await makeRevoked(q);
    await makeToken({
      quoteRequestId: q,
      contactId: contactB,
      reminderSentAt: T,
      createdAt: new Date(T.getTime() - MINUTE),
    });

    await expectInvalid(d);
  });

  testDbSkip('(c2) sucessor do lembrete do mesmo contato em OUTRA cotacao: 404', async () => {
    const q = await makeQuote('c2');
    const other = await makeQuote('c2-outra');
    const d = await makeRevoked(q);
    await makeToken({
      quoteRequestId: other,
      contactId: contactA,
      reminderSentAt: T,
      createdAt: new Date(T.getTime() - MINUTE),
    });

    await expectInvalid(d);
  });

  testDbSkip('(d1) sucessor criado depois da janela superior (revokedAt + tolerancia): 404', async () => {
    const q = await makeQuote('d1');
    const d = await makeRevoked(q);
    const createdAt = new Date(T.getTime() + REMINDER_SUCCESSOR_TOLERANCE_MS + MINUTE);
    await makeToken({ quoteRequestId: q, contactId: contactA, reminderSentAt: createdAt, createdAt });

    await expectInvalid(d);
  });

  testDbSkip('(d2) sucessor criado antes da janela inferior (revokedAt - tolerancia): 404', async () => {
    const q = await makeQuote('d2');
    const d = await makeRevoked(q);
    const createdAt = new Date(T.getTime() - REMINDER_SUCCESSOR_TOLERANCE_MS - MINUTE);
    // Ainda depois de D.createdAt (T - 1 dia): so a janela o exclui.
    expect(createdAt.getTime()).toBeGreaterThan(T.getTime() - DAY);
    await makeToken({ quoteRequestId: q, contactId: contactA, reminderSentAt: createdAt, createdAt });

    await expectInvalid(d);
  });

  testDbSkip('(d3) controle positivo de borda: sucessor 1 min antes do limite superior redireciona', async () => {
    const q = await makeQuote('d3');
    const d = await makeRevoked(q);
    const createdAt = new Date(T.getTime() + REMINDER_SUCCESSOR_TOLERANCE_MS - MINUTE);
    const r1 = await makeToken({ quoteRequestId: q, contactId: contactA, reminderSentAt: createdAt, createdAt });

    const result = await SupplierPortalService.validate({ rawToken: d.rawToken });

    expect(result.token.id).toBe(r1.id);
  });

  testDbSkip('(e) sucessor do lembrete na janela mas expirado: 404 com INVALID/revoked no original', async () => {
    const q = await makeQuote('e');
    const d = await makeRevoked(q);
    await makeToken({
      quoteRequestId: q,
      contactId: contactA,
      reminderSentAt: T,
      createdAt: new Date(T.getTime() - MINUTE),
      expiresAt: new Date(Date.now() - MINUTE),
    });

    await expectInvalid(d);
  });

  // --- Fluxos reais de revogacao (sem ajustar createdAt/revokedAt: tudo em ms, dentro da janela) ---

  testDbSkip('(f-reenvio) reenvio (revoke + create sem reminderSentAt): link antigo 404, novo valido', async () => {
    const q = await makeQuote('f-reenvio');
    const d = await makeToken({ quoteRequestId: q, contactId: contactA });

    // Mesmas chamadas de DispatchController (reenvio).
    await SupplierPortalService.revokeTokensForContact({ quoteRequestId: q, supplierContactId: contactA });
    const created = (await SupplierPortalService.createToken({
      quoteRequestId: q,
      supplierId,
      supplierContactId: contactA,
      createdById: userId,
      dispatchEventId: null,
      expiresAt: DEFAULT_EXPIRES,
    })) as SupplierPortalToken & { rawToken: string };

    await expectInvalid(d);
    const fresh = await SupplierPortalService.validate({ rawToken: created.rawToken });
    expect(fresh.token.id).toBe(created.id);
  });

  testDbSkip('(f-regenerate) regenerateToken: link antigo 404, novo valido', async () => {
    const q = await makeQuote('f-regenerate');
    const d = await makeToken({ quoteRequestId: q, contactId: contactA });

    const regenerated = await SupplierPortalService.regenerateToken({ tokenId: d.id, createdById: userId });

    await expectInvalid(d);
    const fresh = await SupplierPortalService.validate({ rawToken: regenerated.rawToken });
    expect(fresh.token.id).toBe(regenerated.created.id);
  });

  testDbSkip('(f-rotate) rotateTokenForReply: link antigo 404, novo valido', async () => {
    const q = await makeQuote('f-rotate');
    const d = await makeToken({ quoteRequestId: q, contactId: contactA });

    const rotated = await SupplierPortalService.rotateTokenForReply({
      quoteRequestId: q,
      supplierId,
      supplierContactId: contactA,
      createdById: userId,
    });

    await expectInvalid(d);
    const fresh = await SupplierPortalService.validate({ rawToken: rotated.rawToken });
    expect(fresh.token.id).toBe(rotated.created.id);
  });

  testDbSkip('(f-manual) revogacao manual (revokedAt = agora): link 404', async () => {
    const q = await makeQuote('f-manual');
    const d = await makeToken({ quoteRequestId: q, contactId: contactA });

    // Mesmo update de DispatchController.revokeToken.
    await prisma.supplierPortalToken.update({ where: { id: d.id }, data: { revokedAt: new Date() } });

    await expectInvalid(d);
  });

  testDbSkip('(f-lembrete-depois-reenvio) lembrete redireciona; reenvio posterior derruba D e R1', async () => {
    const q = await makeQuote('f-lembrete-reenvio');
    const d = await makeToken({ quoteRequestId: q, contactId: contactA });

    // Simula o lembrete: token novo com reminderSentAt; revoga o antigo (filtro de
    // SupplierPortalReminderService apos o envio).
    const r1 = await makeToken({ quoteRequestId: q, contactId: contactA, reminderSentAt: new Date() });
    await prisma.supplierPortalToken.updateMany({
      where: {
        quoteRequestId: q,
        supplierContactId: contactA,
        revokedAt: null,
        respondedAt: null,
        id: { not: r1.id },
      },
      data: { revokedAt: new Date() },
    });

    const viaReminder = await SupplierPortalService.validate({ rawToken: d.rawToken });
    expect(viaReminder.token.id).toBe(r1.id);

    // Reenvio manual (revoke + create sem reminderSentAt).
    await SupplierPortalService.revokeTokensForContact({ quoteRequestId: q, supplierContactId: contactA });
    await SupplierPortalService.createToken({
      quoteRequestId: q,
      supplierId,
      supplierContactId: contactA,
      createdById: userId,
      dispatchEventId: null,
      expiresAt: DEFAULT_EXPIRES,
    });

    await expectInvalid(d);
    await expectInvalid(r1);
  });

  testDbSkip('(f-manual-apos-reenvio-de-lembrete) revogar manualmente o token do reenvio: 404', async () => {
    const q = await makeQuote('f-manual-reenvio');
    const r1 = await makeToken({ quoteRequestId: q, contactId: contactA, reminderSentAt: new Date() });

    await SupplierPortalService.revokeTokensForContact({ quoteRequestId: q, supplierContactId: contactA });
    const n = (await SupplierPortalService.createToken({
      quoteRequestId: q,
      supplierId,
      supplierContactId: contactA,
      createdById: userId,
      dispatchEventId: null,
      expiresAt: DEFAULT_EXPIRES,
    })) as SupplierPortalToken & { rawToken: string };
    await prisma.supplierPortalToken.update({ where: { id: n.id }, data: { revokedAt: new Date() } });

    await expectInvalid({ id: n.id, rawToken: n.rawToken });
    await expectInvalid(r1);
  });
});
