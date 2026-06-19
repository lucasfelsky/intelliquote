import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteResponse: {
      updateMany: vi.fn(),
    },
    quoteRequest: {
      update: vi.fn(),
    },
  };

  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    supplier: {},
    quoteComparison: {
      findFirst: vi.fn(),
    },
    quoteRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    quoteRequestItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    quoteResponse: {},
    $transaction: vi.fn(async (callback) => callback(tx)),
    __tx: tx,
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  session: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  quoteComparison: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  quoteRequest: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  quoteRequestItem: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    quoteResponse: {
      updateMany: ReturnType<typeof vi.fn>;
    };
    quoteRequest: {
      update: ReturnType<typeof vi.fn>;
    };
  };
};

describe('Quote workflow routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prismaMock.__tx),
    );
  });

  it('reabre uma cotacao fechada e limpa a vencedora atual', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 5,
      status: 'closed',
    });
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 3 });
    prismaMock.__tx.quoteRequest.update.mockResolvedValue({
      id: 5,
      status: 'open',
      closedAt: null,
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/5/reopen')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(prismaMock.__tx.quoteResponse.updateMany).toHaveBeenCalledWith({
      where: { quoteRequestId: 5 },
      data: { isWinner: false },
    });
    expect(prismaMock.__tx.quoteRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: {
          status: 'open',
          closedAt: null,
        },
      }),
    );
  });

  it('bloqueia alteracao direta de status pela rota de update da cotacao', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app)
      .put('/api/v1/quote-requests/5')
      .set('Cookie', cookies)
      .send({
        status: 'closed',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('acoes de fechar ou reabrir');
    expect(prismaMock.quoteRequest.update).not.toHaveBeenCalled();
  });

  it('bloqueia criacao de item em cotacao fechada', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 5,
      status: 'closed',
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/5/items')
      .set('Cookie', cookies)
      .send({
        productName: 'Kit de Vedacao',
        quantity: 10,
        unit: 'UN',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('cotacoes fechadas');
    expect(prismaMock.quoteRequestItem.create).not.toHaveBeenCalled();
  });

  it('impede mover item para outra cotacao', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteRequestItem.findUnique.mockResolvedValue({
      id: 9,
      quoteRequestId: 5,
      productName: 'Kit de Vedacao',
      quantity: 10,
      unit: 'UN',
      quoteRequest: {
        id: 5,
        status: 'open',
      },
    });

    const response = await request(app)
      .put('/api/v1/quote-request-items/9')
      .set('Cookie', cookies)
      .send({
        quoteRequestId: 6,
        productName: 'Kit de Vedacao',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('mover um item');
    expect(prismaMock.quoteRequestItem.update).not.toHaveBeenCalled();
  });
});

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: {
      name: role,
    },
  });

  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: {
      name: role,
    },
  });

  prismaMock.session.create.mockResolvedValue({
    id: 'session-1',
  });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}
