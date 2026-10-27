import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz varios logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

// Sem metodos de escrita para forecastProduct/quoteResponseItem de proposito: qualquer escrita estoura (500).
vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastProduct: { findUnique: vi.fn() },
    quoteResponseItem: { findMany: vi.fn() },
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
  forecastProduct: { findUnique: Mock };
  quoteResponseItem: { findMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/products/42/ultimo-preco';

// Produto 42 com 3 codigos: TST0001 e TST0003 ligados ao catalogItem 77, TST0002 ao 88, TST0004 sem vinculo.
const produto = (extra: Record<string, unknown> = {}) => ({
  id: 42,
  codes: [
    { code: 'TST0001', position: 1, catalogItemId: 77 },
    { code: 'TST0002', position: 2, catalogItemId: 88 },
    { code: 'TST0003', position: 3, catalogItemId: 77 },
    { code: 'TST0004', position: 4, catalogItemId: null },
  ],
  ...extra,
});

const candidata = () => ({
  id: 5,
  unitPrice: new Prisma.Decimal('12.34'),
  quoteRequestItem: { id: 50, unit: 'KG', catalogItemId: 77 },
  quoteResponse: {
    id: 9,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    supplier: { name: 'FORNECEDOR SINTETICO 1' },
    quoteRequest: {
      id: 901,
      requestCode: 'QR-SINT-0001',
      status: 'closed',
      closedAt: new Date('2031-03-10T15:00:00.000Z'),
      purchaseOrderSentAt: new Date('2031-03-12T15:00:00.000Z'),
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.forecastProduct.findUnique.mockResolvedValue(produto());
  prismaMock.quoteResponseItem.findMany.mockResolvedValue([candidata()]);
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe('Forecast ultimo preco - autenticacao e papeis', () => {
  it('sem login -> 401', async () => {
    const response = await request(app).get(PATH);
    expect(response.status).toBe(401);
    expect(prismaMock.forecastProduct.findUnique).not.toHaveBeenCalled();
  });

  it('Bearer invalido (ex.: token de portal) -> 401', async () => {
    const response = await request(app).get(PATH).set('Authorization', 'Bearer token-invalido');
    expect(response.status).toBe(401);
    expect(prismaMock.forecastProduct.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.quoteResponseItem.findMany).not.toHaveBeenCalled();
  });

  it('comercial -> 403 sem consultar produto nem cotacoes', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastProduct.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.quoteResponseItem.findMany).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador', 'gestor', 'viewer'] as Role[])('%s -> 200', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.productId).toBe(42);
  });
});

describe('Forecast ultimo preco - contrato', () => {
  it.each(['abc', '0', '-1', '1.5'])('id "%s" -> 400 Produto invalido.', async (id) => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`/api/v1/forecast/products/${id}/ultimo-preco`).set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto invalido.');
    expect(prismaMock.forecastProduct.findUnique).not.toHaveBeenCalled();
  });

  it('produto inexistente -> 404', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Produto nao encontrado.');
    expect(prismaMock.quoteResponseItem.findMany).not.toHaveBeenCalled();
  });

  it('produto inativo -> 200 normal (consulta historica; o select nem le isActive)', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produto({ isActive: false }));
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.ultimoPreco).not.toBeNull();
  });

  it('com preco: devolve o formato do contrato', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        productId: 42,
        motivo: null,
        ultimoPreco: {
          valorUnitario: '12.34',
          moeda: 'USD',
          unidade: 'KG',
          incoterm: 'FOB',
          fornecedor: 'FORNECEDOR SINTETICO 1',
          cotacao: { id: 901, codigo: 'QR-SINT-0001' },
          fechadaEm: '2031-03-10',
          poEnviadaEm: '2031-03-12',
          catalogItemId: 77,
          codigos: ['TST0001', 'TST0003'],
        },
      },
    });
  });

  it('sem catalogItemId em nenhum codigo -> 200 sem_vinculo_catalogo e nenhuma consulta de cotacao', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto({ codes: [{ code: 'TST0004', position: 1, catalogItemId: null }] }),
    );
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ productId: 42, ultimoPreco: null, motivo: 'sem_vinculo_catalogo' });
    expect(prismaMock.quoteResponseItem.findMany).not.toHaveBeenCalled();
  });

  it('produto sem codigos -> sem_vinculo_catalogo', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produto({ codes: [] }));
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.motivo).toBe('sem_vinculo_catalogo');
  });

  it('sem candidatas -> 200 sem_cotacao_vencedora', async () => {
    prismaMock.quoteResponseItem.findMany.mockResolvedValue([]);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ productId: 42, ultimoPreco: null, motivo: 'sem_cotacao_vencedora' });
  });
});

describe('Forecast ultimo preco - consulta (where/select)', () => {
  it('filtra deletedAt nos 4 niveis, so vencedora, so fechada ou com PO, sem item indisponivel nem preco zero', async () => {
    const cookies = await loginAs('viewer');
    await request(app).get(PATH).set('Cookie', cookies);
    expect(prismaMock.quoteResponseItem.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.quoteResponseItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          isUnavailable: false,
          unitPrice: { gt: 0 },
          quoteRequestItem: { deletedAt: null, catalogItemId: { in: [77, 88] } },
          quoteResponse: {
            deletedAt: null,
            isWinner: true,
            quoteRequest: {
              deletedAt: null,
              OR: [{ status: 'closed' }, { purchaseOrderSentAt: { not: null } }],
            },
          },
        },
      }),
    );
  });

  it('catalogItemId: in com ids distintos e nao nulos de todos os codigos', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto({
        codes: [
          { code: 'TST0001', position: 1, catalogItemId: 77 },
          { code: 'TST0002', position: 2, catalogItemId: 77 },
          { code: 'TST0003', position: 3, catalogItemId: 88 },
          { code: 'TST0004', position: 4, catalogItemId: null },
          { code: 'TST0005', position: 5, catalogItemId: 99 },
        ],
      }),
    );
    const cookies = await loginAs('viewer');
    await request(app).get(PATH).set('Cookie', cookies);
    const where = prismaMock.quoteResponseItem.findMany.mock.calls[0][0].where;
    expect(where.quoteRequestItem.catalogItemId).toEqual({ in: [77, 88, 99] });
  });

  it('le o produto por id com os codigos em ordem de posicao', async () => {
    const cookies = await loginAs('viewer');
    await request(app).get(PATH).set('Cookie', cookies);
    expect(prismaMock.forecastProduct.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: {
        id: true,
        codes: { select: { code: true, position: true, catalogItemId: true }, orderBy: { position: 'asc' } },
      },
    });
  });

  it('o select do fornecedor e so { name: true } (sem contato, e-mail, notas, custo)', async () => {
    const cookies = await loginAs('viewer');
    await request(app).get(PATH).set('Cookie', cookies);
    const select = prismaMock.quoteResponseItem.findMany.mock.calls[0][0].select;
    expect(select.quoteResponse.select.supplier).toEqual({ select: { name: true } });
    expect(select).toEqual({
      id: true,
      unitPrice: true,
      quoteRequestItem: { select: { id: true, unit: true, catalogItemId: true } },
      quoteResponse: {
        select: {
          id: true,
          currency: true,
          offeredIncoterm: true,
          supplier: { select: { name: true } },
          quoteRequest: {
            select: { id: true, requestCode: true, status: true, closedAt: true, purchaseOrderSentAt: true },
          },
        },
      },
    });
  });

  it('a resposta nao contem campos sensiveis', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    const texto = JSON.stringify(response.body);
    for (const proibido of ['email', 'contacts', 'notes', 'targetPrice', 'totalLandedCost']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('so leitura: nunca grava AuditLog nem abre transacao', async () => {
    const cookies = await loginAs('admin');
    prismaMock.auditLog.create.mockClear();
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(Object.keys(prismaMock.forecastProduct)).toEqual(['findUnique']);
    expect(Object.keys(prismaMock.quoteResponseItem)).toEqual(['findMany']);
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
