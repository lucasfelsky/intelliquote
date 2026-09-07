// POST /admin/demo/reset — guarda dupla ANTES de qualquer delete:
//   1. !demoEnv.enabled -> 404 (nao revela o endpoint em producao normal).
//   2. header x-demo-reset-token != demoEnv.resetToken (ou token nao
//      configurado) -> 401.
// Quando liberado: transacao (mockada) que apaga dados e re-executa o seed
// demo (mockado). Sem DB real — so' verificamos que o pipeline e' chamado.

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { demoEnvState, seedDemoMock, transactionMock } = vi.hoisted(() => ({
  demoEnvState: {
    enabled: true,
    resetToken: 'secret-token' as string | null,
    userPassword: null as string | null,
  },
  seedDemoMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env')>();
  return {
    ...actual,
    demoEnv: demoEnvState,
  };
});

vi.mock('../prisma/seed-demo', () => ({
  seedDemo: seedDemoMock,
}));

// tx generico: qualquer model.deleteMany({}) resolve vazio. Cobre todas as
// tabelas que DemoController apaga na ordem FK-safe sem precisar listar
// cada uma aqui.
const fakeTx = new Proxy(
  {},
  {
    get: () => ({ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }),
  },
);

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

import { app } from '../src/app';

const RESEED_RESULT = {
  roles: 4,
  users: 1,
  families: 2,
  catalogItems: 4,
  suppliers: 4,
  supplierContacts: 4,
  quoteRequests: 3,
  quoteResponses: 3,
};

describe('POST /admin/demo/reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demoEnvState.enabled = true;
    demoEnvState.resetToken = 'secret-token';
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx),
    );
    seedDemoMock.mockResolvedValue(RESEED_RESULT);
  });

  it('retorna 404 quando DEMO_MODE esta desligado (nao revela o endpoint em producao)', async () => {
    demoEnvState.enabled = false;

    const response = await request(app)
      .post('/admin/demo/reset')
      .set('x-demo-reset-token', 'secret-token');

    expect(response.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(seedDemoMock).not.toHaveBeenCalled();
  });

  it('retorna 401 com token errado', async () => {
    const response = await request(app)
      .post('/admin/demo/reset')
      .set('x-demo-reset-token', 'token-errado');

    expect(response.status).toBe(401);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('retorna 401 quando nenhum header de token e enviado', async () => {
    const response = await request(app).post('/admin/demo/reset');

    expect(response.status).toBe(401);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('retorna 401 quando demoEnv.resetToken nao esta configurado (null)', async () => {
    demoEnvState.resetToken = null;

    const response = await request(app)
      .post('/admin/demo/reset')
      .set('x-demo-reset-token', 'qualquer-coisa');

    expect(response.status).toBe(401);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('retorna 200 e chama o pipeline de reset (delete + seed) quando DEMO_MODE on e token correto', async () => {
    const response = await request(app)
      .post('/admin/demo/reset')
      .set('x-demo-reset-token', 'secret-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, reseeded: RESEED_RESULT });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(seedDemoMock).toHaveBeenCalledTimes(1);
    expect(seedDemoMock.mock.calls[0][0]).toBe(fakeTx);
  });

  it('propaga erro do pipeline como 500 sem vazar detalhe interno', async () => {
    seedDemoMock.mockRejectedValue(new Error('boom'));

    const response = await request(app)
      .post('/admin/demo/reset')
      .set('x-demo-reset-token', 'secret-token');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Erro interno do servidor.');
  });
});
