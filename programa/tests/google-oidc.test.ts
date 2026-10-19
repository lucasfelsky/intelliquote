// requireGoogleOidc: autenticacao dos jobs internos (Cloud Scheduler) via ID token OIDC.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  env: {
    audience: 'intelliquote-internal-jobs' as string | undefined,
    invokerEmail: 'iq-jobs-scheduler@sq-comex-updates-3d22f.iam.gserviceaccount.com' as
      | string
      | undefined,
  },
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  },
}));

vi.mock('../src/config/env', () => ({
  internalJobsEnv: mocks.env,
}));

import { requireGoogleOidc } from '../src/middlewares/googleOidc';

const INVOKER = 'iq-jobs-scheduler@sq-comex-updates-3d22f.iam.gserviceaccount.com';

function buildApp() {
  const app = express();
  app.post('/jobs', requireGoogleOidc(), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

function ticket(payload: Record<string, unknown>) {
  return { getPayload: () => payload };
}

beforeEach(() => {
  mocks.verifyIdToken.mockReset();
  mocks.env.audience = 'intelliquote-internal-jobs';
  mocks.env.invokerEmail = INVOKER;
});

describe('requireGoogleOidc', () => {
  it('responde 503 (fail-closed) sem as envs de jobs internos', async () => {
    mocks.env.audience = undefined;
    const res = await request(buildApp()).post('/jobs').set('Authorization', 'Bearer abc');
    expect(res.status).toBe(503);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('responde 503 quando so o e-mail do invocador falta', async () => {
    mocks.env.invokerEmail = undefined;
    const res = await request(buildApp()).post('/jobs').set('Authorization', 'Bearer abc');
    expect(res.status).toBe(503);
  });

  it('responde 401 sem Bearer', async () => {
    const res = await request(buildApp()).post('/jobs');
    expect(res.status).toBe(401);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('responde 401 com token invalido', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('Invalid token signature'));
    const res = await request(buildApp()).post('/jobs').set('Authorization', 'Bearer ruim');
    expect(res.status).toBe(401);
  });

  it('responde 401 com e-mail diferente do invocador', async () => {
    mocks.verifyIdToken.mockResolvedValue(
      ticket({ email: 'outra@sq-comex-updates-3d22f.iam.gserviceaccount.com', email_verified: true }),
    );
    const res = await request(buildApp()).post('/jobs').set('Authorization', 'Bearer abc');
    expect(res.status).toBe(401);
  });

  it('responde 401 com email_verified=false', async () => {
    mocks.verifyIdToken.mockResolvedValue(ticket({ email: INVOKER, email_verified: false }));
    const res = await request(buildApp()).post('/jobs').set('Authorization', 'Bearer abc');
    expect(res.status).toBe(401);
  });

  it('chama next() com token valido e valida a audience configurada', async () => {
    mocks.verifyIdToken.mockResolvedValue(ticket({ email: INVOKER, email_verified: true }));
    const res = await request(buildApp()).post('/jobs').set('Authorization', 'Bearer bom');
    expect(res.status).toBe(200);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'bom',
      audience: 'intelliquote-internal-jobs',
    });
  });
});
