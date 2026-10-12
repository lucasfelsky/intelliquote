import { Prisma } from '@prisma/client';
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
    creditSupportRequest: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const prisma = {
    companyProfile: { findUnique: vi.fn().mockResolvedValue({ id: 1, awardApprovalThreshold: null }) },
    creditSupportRequest: {
      findFirst: vi.fn(),
    },
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
  creditSupportRequest: {
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
    creditSupportRequest: {
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
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
    prismaMock.__tx.creditSupportRequest.update.mockResolvedValue({});
    prismaMock.__tx.creditSupportRequest.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.creditSupportRequest.findFirst.mockResolvedValue(null);
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
    expect(response.body.winnerCreditSupportRequestId).toBeNull();
    expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith({
      where: { id: 11, deletedAt: null },
      data: { isWinner: true },
    });
    expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: { winnerQuoteResponseId: 11, winnerCreditSupportRequestId: null, approvalStatus: 'not_required', approvedById: null, approvedAt: null },
    });
    // PR4a: vencedora direta zera qualquer alternativa via parceiro da cotacao e nao marca nenhuma.
    expect(prismaMock.__tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({
      where: { quoteRequestId: 1, isWinner: true },
      data: { isWinner: false },
    });
    expect(prismaMock.__tx.creditSupportRequest.update).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteComparisonResult.updateMany).toHaveBeenCalledWith({
      where: { comparisonId: 999, quoteResponseId: 11, creditSupportRequestId: null },
      data: { isWinner: true },
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
      where: { id: 12, deletedAt: null },
      data: { isWinner: true },
    });
    expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: { winnerQuoteResponseId: 12, winnerCreditSupportRequestId: null, approvalStatus: 'not_required', approvedById: null, approvedAt: null },
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
      where: { id: 21, deletedAt: null },
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

  // PR4a (Credit Support): escolher a alternativa via parceiro da resposta `quoteResponseId`.
  describe('vencedor manual via parceiro (creditSupportRequestId)', () => {
    const requestedItems = [{ id: 1, quantity: 1, productName: 'Produto 1' }];

    // Resposta de origem com os campos lidos pelo computeIsStale/buildSnapshot.
    const originResponse = (unitPrice = 10, unavailable = false) => ({
      id: 11,
      quoteRequestId: 1,
      supplierId: 100,
      deletedAt: null,
      version: 1,
      currency: 'USD',
      exchangeRate: 5,
      freightCost: 0,
      insuranceCost: 0,
      otherFees: 0,
      importDuty: 0,
      ipi: 0,
      pis: 0,
      cofins: 0,
      offeredIncoterm: 'FOB',
      paymentTermsDays: 30,
      offeredPrice: unavailable ? 0 : unitPrice,
      items: [
        {
          quoteRequestItemId: 1,
          quantity: unavailable ? 0 : 1,
          unitPrice: unavailable ? 0 : unitPrice,
          totalPrice: unavailable ? 0 : unitPrice,
          deletedAt: null,
          isUnavailable: unavailable,
          isDangerousGood: false,
          quoteRequestItem: { productName: 'Produto 1', unit: 'KG', quantity: 1, deletedAt: null },
        },
      ],
      supplier: { id: 100, name: 'Fornecedor 100', contacts: [] },
    });

    const creditRow = (unavailable = false) => ({
      id: 7,
      quoteRequestId: 1,
      quoteResponseId: 11,
      supplierId: 100,
      creditPartnerId: 5,
      creditPartnerContactId: null,
      currency: 'USD',
      offeredIncoterm: 'FOB',
      revokedAt: null,
      respondedAt: new Date('2026-10-01T00:00:00.000Z'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      partnerPaymentTermsDays: 60,
      partnerValidityDays: 30,
      partnerTotalPrice: new Prisma.Decimal(unavailable ? 0 : 9),
      isWinner: false,
      supplier: { id: 100, name: 'Fornecedor 100' },
      creditPartner: { id: 5, name: 'Banco Alfa' },
      creditPartnerContact: null,
      items: [
        {
          id: 700,
          requestId: 7,
          quoteRequestItemId: 1,
          position: 1,
          productName: 'Produto 1',
          quantity: 1,
          isUnavailable: unavailable,
          originalUnitPrice: new Prisma.Decimal(unavailable ? 0 : 10),
          partnerUnitPrice: unavailable ? null : new Prisma.Decimal(9),
        },
      ],
    });

    beforeEach(() => {
      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-CS',
        status: 'open',
        items: requestedItems,
      });
      // O mesmo findFirst atende a resposta escolhida e a carga da origem (loadCreditCandidateForAward).
      prismaMock.quoteResponse.findFirst.mockResolvedValue(originResponse());
      prismaMock.quoteComparison.findFirst.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        winnerQuoteResponseId: 11,
        winnerCreditSupportRequestId: null,
      });
      prismaMock.creditSupportRequest.findFirst.mockResolvedValue(creditRow());
    });

    it('400: mesma origem, mas via parceiro (chave composta difere do calculado) exige motivo', async () => {
      const cookies = await loginAs('admin');

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, creditSupportRequestId: 7 });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/motivo/i);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('200: com motivo marca CreditSupportRequest.isWinner, nao marca a resposta e grava a identidade composta', async () => {
      const cookies = await loginAs('admin');

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, creditSupportRequestId: 7, reason: 'Prazo do parceiro e melhor.' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ winnerQuoteResponseId: 11, winnerCreditSupportRequestId: 7, comparisonId: 999 });
      expect(prismaMock.creditSupportRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7, quoteRequestId: 1, quoteResponseId: 11, revokedAt: null, respondedAt: { not: null } },
        }),
      );
      const tx = prismaMock.__tx;
      expect(tx.quoteResponse.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, deletedAt: null }, data: { isWinner: false } });
      expect(tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, isWinner: true }, data: { isWinner: false } });
      expect(tx.creditSupportRequest.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { isWinner: true } });
      expect(tx.quoteResponse.update).not.toHaveBeenCalled();
      expect(tx.quoteComparisonResult.updateMany).toHaveBeenCalledWith({
        where: { comparisonId: 999, quoteResponseId: 11, creditSupportRequestId: 7 },
        data: { isWinner: true },
      });
      expect(tx.quoteComparison.update).toHaveBeenCalledWith({
        where: { id: 999 },
        data: { winnerQuoteResponseId: 11, winnerCreditSupportRequestId: 7, approvalStatus: 'not_required', approvedById: null, approvedAt: null },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'manual_winner',
            afterData: { winnerQuoteResponseId: 11, winnerCreditSupportRequestId: 7 },
            metadata: expect.objectContaining({ previousWinnerCreditSupportRequestId: null, winnerCreditSupportRequestId: 7 }),
          }),
        }),
      );
    });

    it('200: escolher de novo a mesma alternativa ja vencedora nao exige motivo', async () => {
      const cookies = await loginAs('admin');
      prismaMock.quoteComparison.findFirst.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        winnerQuoteResponseId: 11,
        winnerCreditSupportRequestId: 7,
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, creditSupportRequestId: 7 });

      expect(response.status).toBe(200);
      expect(prismaMock.__tx.creditSupportRequest.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { isWinner: true } });
    });

    it('404: encaminhamento de outra cotacao/resposta, revogado ou nao respondido', async () => {
      const cookies = await loginAs('admin');
      prismaMock.creditSupportRequest.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, creditSupportRequestId: 99, reason: 'x' });

      expect(response.status).toBe(404);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.creditSupportRequest.update).not.toHaveBeenCalled();
    });

    it('409: oferta do parceiro stale (origem mudou de preco) nao pode ser escolhida', async () => {
      const cookies = await loginAs('admin');
      prismaMock.quoteResponse.findFirst.mockResolvedValue(originResponse(11));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, creditSupportRequestId: 7, reason: 'x' });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('A oferta do parceiro mudou ou foi revogada. Refaca a comparacao.');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('400: cesta do parceiro com item indisponivel nao pode ser escolhida', async () => {
      const cookies = await loginAs('admin');
      prismaMock.quoteResponse.findFirst.mockResolvedValue(originResponse(10, true));
      prismaMock.creditSupportRequest.findFirst.mockResolvedValue(creditRow(true));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, creditSupportRequestId: 7, reason: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/indisponivel/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('200: trocar da alternativa para a direta da MESMA origem exige motivo e limpa a alternativa', async () => {
      const cookies = await loginAs('admin');
      prismaMock.quoteComparison.findFirst.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        winnerQuoteResponseId: 11,
        winnerCreditSupportRequestId: 7,
      });

      const semMotivo = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11 });
      expect(semMotivo.status).toBe(400);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, reason: 'Prefiro comprar direto.' });

      expect(response.status).toBe(200);
      expect(response.body.winnerCreditSupportRequestId).toBeNull();
      const tx = prismaMock.__tx;
      expect(tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, isWinner: true }, data: { isWinner: false } });
      expect(tx.creditSupportRequest.update).not.toHaveBeenCalled();
      expect(tx.quoteResponse.update).toHaveBeenCalledWith({ where: { id: 11, deletedAt: null }, data: { isWinner: true } });
      expect(tx.quoteComparisonResult.updateMany).toHaveBeenCalledWith({
        where: { comparisonId: 999, quoteResponseId: 11, creditSupportRequestId: null },
        data: { isWinner: true },
      });
    });
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
