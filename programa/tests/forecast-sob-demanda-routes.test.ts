import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastProduct: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastProduct: { findUnique: Mock; update: Mock; findMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/products/5/compra-sob-demanda';

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  forecastProduct: { findUnique: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
};

const produto = (extra: Partial<{ purchaseOnDemand: boolean; purchaseOnDemandNote: string | null }> = {}) => ({
  id: 5,
  purchaseOnDemand: false,
  purchaseOnDemandNote: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  tx.forecastProduct.findUnique.mockResolvedValue(produto());
  tx.forecastProduct.update.mockResolvedValue({});
  tx.auditLog.create.mockResolvedValue({});
});

describe('PATCH /forecast/products/:id/compra-sob-demanda - papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).patch(PATH).send({ sobDemanda: true })).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ sobDemanda: true });
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.forecastProduct.update).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s marca: 200 com a marca e o motivo', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ sobDemanda: true, motivo: '  MOTIVO SINTETICO  ' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ productId: 5, sobDemanda: true, motivo: 'MOTIVO SINTETICO' });
    expect(tx.forecastProduct.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { purchaseOnDemand: true, purchaseOnDemandNote: 'MOTIVO SINTETICO' },
    });
  });
});

describe('PATCH /forecast/products/:id/compra-sob-demanda - validacao e erros', () => {
  it('Zod: corpo sem sobDemanda, tipo errado, motivo curto ou longo -> 400 em portugues', async () => {
    const cookies = await loginAs('admin');
    const casos: Array<[unknown, string]> = [
      [{}, 'Informe se a compra é sob demanda (true/false).'],
      [{ sobDemanda: 'sim' }, 'Informe se a compra é sob demanda (true/false).'],
      [{ sobDemanda: true, motivo: 'ab' }, 'O motivo precisa ter ao menos 3 caracteres.'],
      [{ sobDemanda: true, motivo: 'x'.repeat(301) }, 'O motivo aceita no máximo 300 caracteres.'],
      [{ sobDemanda: true, motivo: 12 }, 'O motivo deve ser um texto (ou null).'],
    ];
    for (const [corpo, mensagem] of casos) {
      const response = await request(app).patch(PATH).set('Cookie', cookies).send(corpo as object);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(mensagem);
    }
    expect(tx.forecastProduct.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('motivo com 300 caracteres e motivo so de espacos (= sem motivo) sao aceitos', async () => {
    const cookies = await loginAs('comprador');
    const longo = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ sobDemanda: true, motivo: 'x'.repeat(300) });
    expect(longo.status).toBe(200);
    const vazio = await request(app).patch(PATH).set('Cookie', cookies).send({ sobDemanda: true, motivo: '   ' });
    expect(vazio.status).toBe(200);
    expect(vazio.body.data.motivo).toBeNull();
  });

  it('id invalido -> 400; produto inexistente -> 404 sem gravar', async () => {
    const cookies = await loginAs('admin');
    const ruim = await request(app)
      .patch('/api/v1/forecast/products/abc/compra-sob-demanda')
      .set('Cookie', cookies)
      .send({ sobDemanda: true });
    expect(ruim.status).toBe(400);

    tx.forecastProduct.findUnique.mockResolvedValue(null);
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ sobDemanda: true });
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Produto nao encontrado.');
    expect(tx.forecastProduct.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /forecast/products/:id/compra-sob-demanda - gravacao e auditoria', () => {
  it('AuditLog vai pelo tx (nao pelo prisma), so com ids e flags: sem o texto do motivo e sem nome', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ sobDemanda: true, motivo: 'MOTIVO SINTETICO' });
    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const data = tx.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      entityType: 'forecast_product',
      entityId: '5',
      action: 'purchase_on_demand_update',
      performedById: 1,
      metadata: { antes: false, depois: true, comMotivo: true },
    });
    expect(JSON.stringify(data)).not.toContain('MOTIVO SINTETICO');
    expect(JSON.stringify(data)).not.toContain('PRODUTO');
  });

  it('desmarcar limpa o motivo, qualquer que seja o motivo enviado', async () => {
    tx.forecastProduct.findUnique.mockResolvedValue(
      produto({ purchaseOnDemand: true, purchaseOnDemandNote: 'MOTIVO SINTETICO' }),
    );
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ sobDemanda: false, motivo: 'OUTRO MOTIVO' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ productId: 5, sobDemanda: false, motivo: null });
    expect(tx.forecastProduct.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { purchaseOnDemand: false, purchaseOnDemandNote: null },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ antes: true, depois: false, comMotivo: false });
  });

  it('sem alteracao: 200, nao grava e nao audita', async () => {
    tx.forecastProduct.findUnique.mockResolvedValue(
      produto({ purchaseOnDemand: true, purchaseOnDemandNote: 'MOTIVO SINTETICO' }),
    );
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ sobDemanda: true, motivo: 'MOTIVO SINTETICO' });
    expect(response.status).toBe(200);
    expect(response.body.data.sobDemanda).toBe(true);
    expect(tx.forecastProduct.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  });
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
