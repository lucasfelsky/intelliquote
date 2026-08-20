import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteResponse: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    quoteComparisonResult: {
      updateMany: vi.fn(),
    },
    quoteComparison: {
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
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
    quoteRequest: {
      findUnique: vi.fn(),
    },
    quoteResponse: {
      findFirst: vi.fn(),
    },
    quoteComparison: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
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
  quoteRequest: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  quoteResponse: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  quoteComparison: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    quoteResponse: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    quoteComparisonResult: {
      updateMany: ReturnType<typeof vi.fn>;
    };
    quoteComparison: {
      update: ReturnType<typeof vi.fn>;
    };
    auditLog: {
      create: ReturnType<typeof vi.fn>;
    };
  };
};

describe('Winner override routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prismaMock.__tx),
    );
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    prismaMock.__tx.quoteComparisonResult.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.__tx.quoteComparison.update.mockResolvedValue({});
    prismaMock.__tx.auditLog.create.mockResolvedValue({});
    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'open',
    });
  });

  it('200: override para o mesmo vencedor calculado sem motivo', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      id: 11,
      quoteRequestId: 1,
      deletedAt: null,
    });
    prismaMock.quoteComparison.findFirst.mockResolvedValue({
      id: 999,
      quoteRequestId: 1,
      winnerQuoteResponseId: 11,
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 11 });

    expect(response.status).toBe(200);
    expect(response.body.winnerQuoteResponseId).toBe(11);
    expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { isWinner: true },
    });
    expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: { winnerQuoteResponseId: 11, approvalStatus: 'not_required' },
    });
  });

  it('400: escolhido difere do calculado e sem motivo — pede motivo, nenhuma escrita', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      id: 12,
      quoteRequestId: 1,
      deletedAt: null,
    });
    prismaMock.quoteComparison.findFirst.mockResolvedValue({
      id: 999,
      quoteRequestId: 1,
      winnerQuoteResponseId: 11,
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 12 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/motivo/i);
    expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteComparison.update).not.toHaveBeenCalled();
    expect(prismaMock.__tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('200: escolhido difere do calculado com motivo — audita manual_winner e atualiza vencedor', async () => {
    const cookies = await loginAs('admin');

    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      id: 12,
      quoteRequestId: 1,
      deletedAt: null,
    });
    prismaMock.quoteComparison.findFirst.mockResolvedValue({
      id: 999,
      quoteRequestId: 1,
      winnerQuoteResponseId: 11,
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 12, reason: 'Melhor prazo de entrega negociado com o fornecedor.' });

    expect(response.status).toBe(200);
    expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { isWinner: true },
    });
    expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: { winnerQuoteResponseId: 12, approvalStatus: 'not_required' },
    });
    expect(prismaMock.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'manual_winner',
          entityId: '1',
          metadata: expect.objectContaining({
            reason: 'Melhor prazo de entrega negociado com o fornecedor.',
            previousWinnerQuoteResponseId: 11,
            newWinnerQuoteResponseId: 12,
            comparisonId: 999,
          }),
        }),
      }),
    );
  });

  it('404: quoteResponseId nao pertence a cotacao (ou soft-deleted)', async () => {
    const cookies = await loginAs('admin');

    prismaMock.quoteResponse.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 999 });

    expect(response.status).toBe(404);
    expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
  });

  it('200/sem-comparacao: cotacao sem QuoteComparison previa nao exige motivo nem atualiza comparison', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      id: 21,
      quoteRequestId: 1,
      deletedAt: null,
    });
    prismaMock.quoteComparison.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 21 });

    expect(response.status).toBe(200);
    expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { isWinner: true },
    });
    expect(prismaMock.__tx.quoteComparisonResult.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteComparison.update).not.toHaveBeenCalled();
  });

  it('403: viewer nao pode definir vencedor manual', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 11 });

    expect(response.status).toBe(403);
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
