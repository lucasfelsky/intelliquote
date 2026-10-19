// Rotas internas de jobs (Cloud Scheduler): /api/internal/jobs/*.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  refresh: vi.fn(),
  runReminderSweep: vi.fn(),
  reminder: { enabled: true, windowHours: 48 },
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
    internalJobsEnv: {
      audience: 'intelliquote-internal-jobs',
      invokerEmail: 'iq-jobs-scheduler@sq-comex-updates-3d22f.iam.gserviceaccount.com',
    },
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
  mocks.reminder.enabled = true;
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
