import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteResponse: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    quoteComparison: {
      create: vi.fn(),
      update: vi.fn(),
    },
    quoteRequest: {
      update: vi.fn(),
    },
  };

  const prisma = {
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
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
    supplier: {},
    supplierReview: {
      groupBy: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    quoteRequest: {
      findUnique: vi.fn(),
    },
    quoteResponse: {
      findMany: vi.fn(),
    },
    quoteComparison: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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
  supplierReview: {
    groupBy: ReturnType<typeof vi.fn>;
  };
  quoteResponse: {
    findMany: ReturnType<typeof vi.fn>;
  };
  quoteComparison: {
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    quoteResponse: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    quoteComparison: {
      create: ReturnType<typeof vi.fn>;
    };
    quoteRequest: {
      update: ReturnType<typeof vi.fn>;
    };
  };
};

describe('Comparison routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(prismaMock.__tx),
    );
  });

  it('persiste o historico da comparacao com pesos e executor', async () => {
    const cookies = await loginAs('comprador');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'open',
      currency: 'USD',
    });
    prismaMock.quoteResponse.findMany.mockResolvedValue([
      {
        id: 11,
        quoteRequestId: 1,
        supplierId: 101,
        offeredPrice: 100,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 40,
        insuranceCost: 10,
        otherFees: 20,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'EXW',
        paymentTermsDays: 10,
        isWinner: false,
        supplier: {
          id: 101,
          name: 'Global Parts Ltd',
          contacts: [{ id: 9001, name: 'Ana Vendas', email: 'ana@globalparts.example' }],
        },
      },
      {
        id: 12,
        quoteRequestId: 1,
        supplierId: 102,
        offeredPrice: 120,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 10,
        importDuty: 10,
        ipi: 4,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner: false,
        supplier: {
          id: 102,
          name: 'Nihon Trading',
          contacts: [{ id: 9002, name: 'Kenji Sales', email: 'kenji@nihon.example' }],
        },
      },
    ]);
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 999 });
    prismaMock.companyProfile.findUnique.mockResolvedValue({
      id: 1,
      awardApprovalThreshold: null,
    });
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send({
        priceWeight: 80,
        paymentTermsWeight: 10,
        incotermWeight: 10,
        qualityWeight: 10,
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results.some((item: { isWinner: boolean }) => item.isWinner)).toBe(true);
    // F1/F2: cada resultado carrega o nome do fornecedor e o contato principal
    // (nome/e-mail) para a UI exibir o nome real e montar o mailto de "Responder".
    for (const item of response.body.results as Array<{
      supplierId: number;
      supplier?: { name: string };
      contact?: { email: string } | null;
    }>) {
      expect(item.supplier?.name).toBeTruthy();
      expect(item.contact?.email).toMatch(/@/);
    }
    expect(prismaMock.__tx.quoteComparison.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quoteRequestId: 1,
          executedById: 1,
          priceWeight: 80,
          paymentTermsWeight: 10,
          incotermWeight: 10,
          qualityWeight: 10,
          results: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({
                exchangeRate: expect.any(Number),
                cifValue: expect.any(Number),
                totalLandedCost: expect.any(Number),
              }),
            ]),
          }),
        }),
      }),
    );
    // A comparacao nao fecha mais a cotacao: concluir e' acao separada (/close).
    expect(prismaMock.__tx.quoteRequest.update).not.toHaveBeenCalled();
  });

  it('retorna o historico auditavel por cotacao', async () => {
    const cookies = await loginAs('viewer');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
    });
    prismaMock.quoteComparison.findMany.mockResolvedValue([
      {
        id: 501,
        quoteRequestId: 1,
        priceWeight: 50,
        paymentTermsWeight: 30,
        incotermWeight: 20,
        createdAt: new Date('2026-03-25T18:00:00.000Z'),
        executedBy: {
          id: 1,
          name: 'Comprador Teste',
          email: 'comprador@intelliquote.local',
        },
        results: [
          {
            id: 701,
            supplierId: 101,
            offeredPrice: '100.00',
            offeredIncoterm: 'CIF',
            paymentTermsDays: 30,
            priceScore: 48.2,
            paymentTermsScore: 30,
            incotermScore: 16,
            totalScore: 94.2,
            isWinner: true,
            quoteResponse: {
              supplier: {
                id: 101,
                name: 'Global Parts Ltd',
              },
            },
          },
        ],
      },
    ]);

    const response = await request(app)
      .get('/api/v1/quote-requests/1/comparisons')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.quoteRequestId).toBe(1);
    expect(response.body.comparisons).toHaveLength(1);
    expect(response.body.comparisons[0].results[0].isWinner).toBe(true);
  });

  it('permite recomparar cotacao fechada sem reabrir e sem fecha-la de novo', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'closed',
      currency: 'USD',
    });
    prismaMock.quoteResponse.findMany.mockResolvedValue([
      {
        id: 11,
        quoteRequestId: 1,
        supplierId: 101,
        offeredPrice: 100,
        currency: 'BRL',
        exchangeRate: 1,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 0,
        importDuty: 0,
        ipi: 0,
        pis: 0,
        cofins: 0,
        offeredIncoterm: 'EXW',
        paymentTermsDays: 10,
        isWinner: false,
      },
      {
        id: 12,
        quoteRequestId: 1,
        supplierId: 102,
        offeredPrice: 120,
        currency: 'BRL',
        exchangeRate: 1,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 0,
        importDuty: 0,
        ipi: 0,
        pis: 0,
        cofins: 0,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner: false,
      },
    ]);
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 1000 });
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send({});

    expect(response.status).toBe(200);
    expect(prismaMock.quoteResponse.findMany).toHaveBeenCalled();
    // Recomparar nao reabre nem fecha a cotacao.
    expect(prismaMock.__tx.quoteRequest.update).not.toHaveBeenCalled();
  });

  it('bloqueia comparacao sem exchangeRate valida para moeda estrangeira', async () => {
    const cookies = await loginAs('gestor');

    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-20260325-DEMO01',
      status: 'open',
      currency: 'USD',
    });
    prismaMock.quoteResponse.findMany.mockResolvedValue([
      {
        id: 11,
        quoteRequestId: 1,
        supplierId: 101,
        offeredPrice: 100,
        currency: 'USD',
        exchangeRate: 0,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 0,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner: false,
      },
      {
        id: 12,
        quoteRequestId: 1,
        supplierId: 102,
        offeredPrice: 120,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 0,
        importDuty: 14,
        ipi: 5,
        pis: 2.1,
        cofins: 9.65,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 60,
        isWinner: false,
      },
    ]);
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('exchangeRate');
    expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  describe('Award Approval Gate', () => {
    it('Comparação acima do threshold: pendingApproval: true, isWinner não setado, QuoteComparison criado com approvalStatus: pending', async () => {
      const cookies = await loginAs('admin');
      
      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        status: 'open',
      });
      prismaMock.quoteResponse.findMany.mockResolvedValue([
        {
          id: 11,
          quoteRequestId: 1,
          supplierId: 101,
          offeredPrice: 100000,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 0,
          insuranceCost: 0,
          otherFees: 0,
          importDuty: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          offeredIncoterm: 'CIF',
          paymentTermsDays: 30,
          isWinner: false,
        },
        {
          id: 12,
          quoteRequestId: 1,
          supplierId: 102,
          offeredPrice: 120000,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 0,
          insuranceCost: 0,
          otherFees: 0,
          importDuty: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          offeredIncoterm: 'CIF',
          paymentTermsDays: 30,
          isWinner: false,
        },
      ]);
      prismaMock.companyProfile.findUnique.mockResolvedValue({
        id: 1,
        awardApprovalThreshold: 50000,
      });
      prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
      prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 999 });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare')
        .set('Cookie', cookies)
        .send({ priceWeight: 80, paymentTermsWeight: 10, incotermWeight: 10, qualityWeight: 0 });

      expect(response.status).toBe(200);
      expect(response.body.pendingApproval).toBe(true);
      expect(response.body.thresholdValue).toBe(50000);
      expect(response.body.results[0].isWinner).toBe(true);
      
      expect(prismaMock.__tx.quoteComparison.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: 'pending',
          })
        })
      );
    });

    it('Comparação abaixo do threshold (ou sem threshold): comportamento idêntico ao de antes', async () => {
      const cookies = await loginAs('admin');
      
      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        status: 'open',
      });
      prismaMock.quoteResponse.findMany.mockResolvedValue([
        {
          id: 11,
          quoteRequestId: 1,
          supplierId: 101,
          offeredPrice: 10000,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 0,
          insuranceCost: 0,
          otherFees: 0,
          importDuty: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          offeredIncoterm: 'CIF',
          paymentTermsDays: 30,
          isWinner: false,
        },
        {
          id: 12,
          quoteRequestId: 1,
          supplierId: 102,
          offeredPrice: 12000,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 0,
          insuranceCost: 0,
          otherFees: 0,
          importDuty: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          offeredIncoterm: 'CIF',
          paymentTermsDays: 30,
          isWinner: false,
        },
      ]);
      prismaMock.companyProfile.findUnique.mockResolvedValue({
        id: 1,
        awardApprovalThreshold: 50000, // threshold maior que valor
      });
      prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
      prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 999 });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare')
        .set('Cookie', cookies)
        .send({ priceWeight: 80, paymentTermsWeight: 10, incotermWeight: 10, qualityWeight: 0 });

      expect(response.status).toBe(200);
      expect(response.body.pendingApproval).toBe(false);
      expect(response.body.results[0].isWinner).toBe(true);
      
      expect(prismaMock.__tx.quoteComparison.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            approvalStatus: 'not_required',
          })
        })
      );
    });

    it('approve — sucesso: seta isWinner/approvalStatus: approved/approvedById/approvedAt, audit log action: approve_award', async () => {
      const cookies = await loginAs('admin');

      prismaMock.quoteComparison.findUnique.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        approvalStatus: 'pending',
        winnerQuoteResponseId: 11,
      });
      prismaMock.quoteComparison.findFirst.mockResolvedValue({ id: 999 });
      prismaMock.__tx.quoteComparison.update.mockResolvedValue({});
      prismaMock.__tx.quoteResponse.update.mockResolvedValue({});

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 999 },
          data: expect.objectContaining({
            approvalStatus: 'approved',
            approvedById: 1,
            approvedAt: expect.any(Date),
          })
        })
      );
      expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 11 },
          data: { isWinner: true },
        })
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'approve_award',
            entityId: '1',
          })
        })
      );
    });

    it('approve — 409 se comparisonId não é o mais recente', async () => {
      const cookies = await loginAs('admin');

      prismaMock.quoteComparison.findUnique.mockResolvedValue({
        id: 998,
        quoteRequestId: 1,
        approvalStatus: 'pending',
        winnerQuoteResponseId: 11,
      });
      prismaMock.quoteComparison.findFirst.mockResolvedValue({ id: 999 });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/998/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/não é a comparação mais recente/i);
    });

    it('approve — 400 se a comparação não está pending', async () => {
      const cookies = await loginAs('admin');

      prismaMock.quoteComparison.findUnique.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        approvalStatus: 'approved',
        winnerQuoteResponseId: 11,
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/não está pendente/i);
    });

    it('approve — RBAC: comprador recebe 403', async () => {
      const cookies = await loginAs('comprador');

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(403);
    });
  });

  // Preview: mesmo calculo do /compare, mas nunca persiste nada -- usado pelo
  // recalculo ao vivo dos toggles no front (sem $transaction, sem mutar
  // isWinner, sem criar QuoteComparison/AuditLog).
  describe('Preview comparison (sem persistir)', () => {
    it('com 2 propostas retorna ranking + winner e NAO persiste nada', async () => {
      const cookies = await loginAs('viewer');

      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-20260325-DEMO01',
        status: 'open',
        currency: 'USD',
      });
      prismaMock.quoteResponse.findMany.mockResolvedValue([
        {
          id: 11,
          quoteRequestId: 1,
          supplierId: 101,
          offeredPrice: 100,
          currency: 'USD',
          exchangeRate: 5.4,
          freightCost: 40,
          insuranceCost: 10,
          otherFees: 20,
          importDuty: 14,
          ipi: 5,
          pis: 2.1,
          cofins: 9.65,
          offeredIncoterm: 'EXW',
          paymentTermsDays: 10,
          isWinner: false,
          supplier: {
            id: 101,
            name: 'Global Parts Ltd',
            contacts: [{ id: 9001, name: 'Ana Vendas', email: 'ana@globalparts.example' }],
          },
        },
        {
          id: 12,
          quoteRequestId: 1,
          supplierId: 102,
          offeredPrice: 120,
          currency: 'USD',
          exchangeRate: 5.4,
          freightCost: 0,
          insuranceCost: 0,
          otherFees: 10,
          importDuty: 10,
          ipi: 4,
          pis: 2.1,
          cofins: 9.65,
          offeredIncoterm: 'FOB',
          paymentTermsDays: 30,
          isWinner: false,
          supplier: {
            id: 102,
            name: 'Nihon Trading',
            contacts: [{ id: 9002, name: 'Kenji Sales', email: 'kenji@nihon.example' }],
          },
        },
      ]);
      prismaMock.companyProfile.findUnique.mockResolvedValue({
        id: 1,
        awardApprovalThreshold: null,
      });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send({ priceWeight: 80, paymentTermsWeight: 10, incotermWeight: 10, qualityWeight: 0 });

      expect(response.status).toBe(200);
      expect(response.body.responseCount).toBe(2);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results.some((item: { isWinner: boolean }) => item.isWinner)).toBe(true);
      expect(response.body.winnerQuoteResponseId).toBeTruthy();
      const mockedResponseIds = [11, 12];
      for (const item of response.body.results as Array<{
        quoteResponseId: number;
        isWinner: boolean;
        supplier?: { name: string };
        contact?: { email: string } | null;
      }>) {
        expect(item.quoteResponseId).toBeTruthy();
        expect(mockedResponseIds).toContain(item.quoteResponseId);
        expect(item.supplier?.name).toBeTruthy();
        expect(item.contact?.email).toMatch(/@/);
        if (item.isWinner) {
          expect(item.quoteResponseId).toBe(response.body.winnerQuoteResponseId);
        }
      }

      // Nada foi persistido: nem transacao, nem update de isWinner, nem
      // criacao de QuoteComparison/AuditLog.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('com 1 proposta retorna responseCount 1 (sem gate de minimo 2)', async () => {
      const cookies = await loginAs('viewer');

      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-20260325-DEMO01',
        status: 'open',
        currency: 'BRL',
      });
      prismaMock.quoteResponse.findMany.mockResolvedValue([
        {
          id: 11,
          quoteRequestId: 1,
          supplierId: 101,
          offeredPrice: 100,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 0,
          insuranceCost: 0,
          otherFees: 0,
          importDuty: 0,
          ipi: 0,
          pis: 0,
          cofins: 0,
          offeredIncoterm: 'EXW',
          paymentTermsDays: 10,
          isWinner: false,
          supplier: {
            id: 101,
            name: 'Global Parts Ltd',
            contacts: [{ id: 9001, name: 'Ana Vendas', email: 'ana@globalparts.example' }],
          },
        },
      ]);
      prismaMock.companyProfile.findUnique.mockResolvedValue({
        id: 1,
        awardApprovalThreshold: null,
      });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.responseCount).toBe(1);
      expect(response.body.results).toHaveLength(1);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
    });

    it('sem nenhuma proposta retorna responseCount 0 e results vazio', async () => {
      const cookies = await loginAs('viewer');

      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-20260325-DEMO01',
        status: 'open',
        currency: 'BRL',
      });
      prismaMock.quoteResponse.findMany.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.responseCount).toBe(0);
      expect(response.body.results).toEqual([]);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
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
