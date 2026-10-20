// Rotas internas de jobs (Cloud Scheduler): /api/internal/jobs/*.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  refresh: vi.fn(),
  runReminderSweep: vi.fn(),
  runExpiryAlertSweep: vi.fn(),
  jobsEnv: {
    audience: 'intelliquote-internal-jobs' as string | undefined,
    invokerEmail: 'iq-jobs-scheduler@sq-comex-updates-3d22f.iam.gserviceaccount.com' as string | undefined,
  },
  reminder: { enabled: true },
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  },
}));

vi.mock('../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env')>();
  return {
    ...actual,
    internalJobsEnv: mocks.jobsEnv,
    reminderEnv: mocks.reminder,
  };
});

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../src/services/ExchangeRateService', () => ({
  ExchangeRateService: {
    refresh: mocks.refresh,
    listLatest: vi.fn(),
    getRateToBrl: vi.fn(),
  },
}));

vi.mock('../src/services/SupplierPortalReminderService', () => ({
  SupplierPortalReminderService: { runReminderSweep: mocks.runReminderSweep },
}));

vi.mock('../src/services/SupplierDocumentAlertService', () => ({
  SupplierDocumentAlertService: { runExpiryAlertSweep: mocks.runExpiryAlertSweep },
}));

import { app } from '../src/app';

const INVOKER = 'iq-jobs-scheduler@sq-comex-updates-3d22f.iam.gserviceaccount.com';

function authorizeOidc() {
  mocks.verifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: INVOKER, email_verified: true }),
  });
}

beforeEach(() => {
  mocks.verifyIdToken.mockReset();
  mocks.refresh.mockReset();
  mocks.runReminderSweep.mockReset();
  mocks.runExpiryAlertSweep.mockReset();
  mocks.reminder.enabled = true;
  mocks.jobsEnv.audience = 'intelliquote-internal-jobs';
  mocks.jobsEnv.invokerEmail = INVOKER;
});

describe('POST /api/internal/jobs/exchange-rates', () => {
  it('rejeita sem OIDC (401) e nao chama refresh', async () => {
    const res = await request(app).post('/api/internal/jobs/exchange-rates');
    expect(res.status).toBe(401);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function snapshotsFor(referenceDate: string) {
    return [
      { currency: 'USD', rateToBrl: 5.1, referenceDate, fetchedAt: new Date(), source: 'BCB_PTAX' },
    ];
  }

  it('503 em dia util quando o Fechamento de hoje ainda nao saiu (grava o anterior)', async () => {
    authorizeOidc();
    // Segunda 2026-10-19 13:30 BRT = 16:30Z; ultimo Fechamento eh de sexta.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T16:30:00.000Z'));
    mocks.refresh.mockResolvedValue(snapshotsFor('2026-10-16'));
    const res = await request(app)
      .post('/api/internal/jobs/exchange-rates')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ referenceDate: '2026-10-16', today: '2026-10-19' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('200 em dia util quando o Fechamento eh de hoje (BRT, mesmo apos virada UTC)', async () => {
    authorizeOidc();
    // Segunda 2026-10-19 23:30 BRT = 2026-10-20T02:30Z: "hoje" continua 19/10.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T02:30:00.000Z'));
    mocks.refresh.mockResolvedValue(snapshotsFor('2026-10-19'));
    const res = await request(app)
      .post('/api/internal/jobs/exchange-rates')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
  });

  it('200 no fim de semana com o Fechamento de sexta (sem retry)', async () => {
    authorizeOidc();
    // Sabado 2026-10-17 13:30 BRT.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T16:30:00.000Z'));
    mocks.refresh.mockResolvedValue(snapshotsFor('2026-10-16'));
    const res = await request(app)
      .post('/api/internal/jobs/exchange-rates')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
  });

  it('200 com OIDC valido, sem cookie/login, chamando refresh 1x', async () => {
    authorizeOidc();
    // Sexta 2026-10-16 14:00 BRT: Fechamento do dia disponivel.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T17:00:00.000Z'));
    mocks.refresh.mockResolvedValue([
      { currency: 'USD', rateToBrl: 5.1, referenceDate: '2026-10-16', fetchedAt: new Date(), source: 'BCB_PTAX' },
      { currency: 'EUR', rateToBrl: 5.9, referenceDate: '2026-10-16', fetchedAt: new Date(), source: 'BCB_PTAX' },
    ]);
    const res = await request(app)
      .post('/api/internal/jobs/exchange-rates')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      refreshed: 2,
      currencies: ['USD', 'EUR'],
      referenceDate: '2026-10-16',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('503 quando refresh nao obteve nenhuma taxa (Scheduler repete)', async () => {
    authorizeOidc();
    mocks.refresh.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/internal/jobs/exchange-rates')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(503);
  });

  it('500 em erro inesperado', async () => {
    authorizeOidc();
    mocks.refresh.mockRejectedValue(new Error('db fora'));
    const res = await request(app)
      .post('/api/internal/jobs/exchange-rates')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/internal/jobs/supplier-reminders', () => {
  it('rejeita sem OIDC (401)', async () => {
    const res = await request(app).post('/api/internal/jobs/supplier-reminders');
    expect(res.status).toBe(401);
    expect(mocks.runReminderSweep).not.toHaveBeenCalled();
  });

  it('200 com o resultado do sweep, chamando runReminderSweep 1x', async () => {
    authorizeOidc();
    mocks.runReminderSweep.mockResolvedValue({ due: 3, sent: 2, skipped: 1, failed: 0 });
    const res = await request(app)
      .post('/api/internal/jobs/supplier-reminders')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ due: 3, sent: 2, skipped: 1, failed: 0 });
    expect(mocks.runReminderSweep).toHaveBeenCalledTimes(1);
  });

  it('REMINDER_ENABLED=false nao chama o sweep e responde 200 skipped', async () => {
    authorizeOidc();
    mocks.reminder.enabled = false;
    const res = await request(app)
      .post('/api/internal/jobs/supplier-reminders')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ skipped: 'disabled' });
    expect(mocks.runReminderSweep).not.toHaveBeenCalled();
  });

  it('500 em erro inesperado do sweep', async () => {
    authorizeOidc();
    mocks.runReminderSweep.mockRejectedValue(new Error('smtp'));
    const res = await request(app)
      .post('/api/internal/jobs/supplier-reminders')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/internal/jobs/supplier-document-alerts', () => {
  const URL = '/api/internal/jobs/supplier-document-alerts';

  it('503 sem audience configurada, sem chamar o service', async () => {
    mocks.jobsEnv.audience = undefined;
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(503);
    expect(mocks.runExpiryAlertSweep).not.toHaveBeenCalled();
  });

  it('401 sem Bearer, sem chamar o service', async () => {
    const res = await request(app).post(URL);
    expect(res.status).toBe(401);
    expect(mocks.runExpiryAlertSweep).not.toHaveBeenCalled();
  });

  it('401 quando o e-mail do token e de outra conta, sem chamar o service', async () => {
    mocks.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'outra@sq-comex-updates-3d22f.iam.gserviceaccount.com', email_verified: true }),
    });
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(401);
    expect(mocks.runExpiryAlertSweep).not.toHaveBeenCalled();
  });

  it('200 com OIDC valido: chama o sweep 1x com Date e devolve o resumo', async () => {
    authorizeOidc();
    mocks.runExpiryAlertSweep.mockResolvedValue({
      outcome: 'sent',
      documents: 2,
      releasedOrphans: 0,
      recoveredOrphans: 0,
      inFlight: 0,
    });
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 1, documents: 2, releasedOrphans: 0, recoveredOrphans: 0, inFlight: 0 });
    expect(mocks.runExpiryAlertSweep).toHaveBeenCalledTimes(1);
    expect(mocks.runExpiryAlertSweep.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('200 com reason no_recipients (sem e-mail)', async () => {
    authorizeOidc();
    mocks.runExpiryAlertSweep.mockResolvedValue({
      outcome: 'no_recipients',
      documents: 0,
      releasedOrphans: 1,
      recoveredOrphans: 0,
      inFlight: 0,
    });
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sent: 0,
      documents: 0,
      reason: 'no_recipients',
      releasedOrphans: 1,
      recoveredOrphans: 0,
      inFlight: 0,
    });
  });

  it('200 com reason nothing_due e already_claimed', async () => {
    authorizeOidc();
    for (const outcome of ['nothing_due', 'already_claimed']) {
      mocks.runExpiryAlertSweep.mockResolvedValueOnce({
        outcome,
        documents: 0,
        releasedOrphans: 0,
        recoveredOrphans: 0,
        inFlight: 0,
      });
      const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ sent: 0, documents: 0, reason: outcome });
    }
  });

  it('200 sent com inFlight > 0 inclui inFlight no body (sem forcar 503)', async () => {
    authorizeOidc();
    mocks.runExpiryAlertSweep.mockResolvedValue({
      outcome: 'sent',
      documents: 1,
      releasedOrphans: 0,
      recoveredOrphans: 0,
      inFlight: 2,
    });
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, documents: 1, inFlight: 2 });
  });

  it('503 quando outra execucao esta em andamento (in_progress), para o Scheduler repetir', async () => {
    authorizeOidc();
    mocks.runExpiryAlertSweep.mockResolvedValue({
      outcome: 'in_progress',
      documents: 0,
      releasedOrphans: 0,
      recoveredOrphans: 0,
      inFlight: 3,
    });
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: 'Outra execucao em andamento; tente de novo.', inFlight: 3 });
  });

  it('500 quando o envio falha (send_failed), para o Scheduler repetir', async () => {
    authorizeOidc();
    mocks.runExpiryAlertSweep.mockResolvedValue({
      outcome: 'send_failed',
      documents: 2,
      releasedOrphans: 0,
      recoveredOrphans: 0,
    });
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Falha ao enviar o aviso de documentos.', documents: 2 });
  });

  it('500 quando o service lanca', async () => {
    authorizeOidc();
    mocks.runExpiryAlertSweep.mockRejectedValue(new Error('db fora'));
    const res = await request(app).post(URL).set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Falha no job de avisos de documentos.' });
  });
});
