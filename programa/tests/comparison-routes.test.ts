import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    quoteComparisonResult: { updateMany: vi.fn() },
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
    creditSupportRequest: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const prisma = {
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    // PR4a: alternativas via parceiro (default: nenhuma) — casos atuais seguem identicos.
    creditSupportRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
      findFirst: vi.fn(),
    },
    quoteRequest: {
      findUnique: vi.fn(),
    },
    quoteResponse: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
    findFirst: ReturnType<typeof vi.fn>;
  };
  quoteComparison: {
    findMany: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  creditSupportRequest: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  __tx: {
    quoteResponse: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    quoteComparison: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    quoteComparisonResult: {
      updateMany: ReturnType<typeof vi.fn>;
    };
    quoteRequest: {
      update: ReturnType<typeof vi.fn>;
    };
    creditSupportRequest: {
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
};

describe('Comparison routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findFirst.mockResolvedValue(null);
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

  it('compara propostas em USD sem exigir cambio para o ranking', async () => {
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

    expect(response.status).toBe(200);
    expect(prismaMock.__tx.quoteComparison.create).toHaveBeenCalled();
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
          where: { id: 11, deletedAt: null, quoteRequest: { id: 1, deletedAt: null } },
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
        items: [1, 2, 3].map(id => ({ id, quantity: 1 })),
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
          items: [12, 18, null].map((leadTimeDays, i) => ({ quoteRequestItemId: i + 1, quantity: 1, unitPrice: [20, 30, 50][i], leadTimeDays })),
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
          items: [25, null, null].map((leadTimeDays, i) => ({ quoteRequestItemId: i + 1, quantity: 1, unitPrice: 40, leadTimeDays })),
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

      // leadTimeDays = MAIOR leadTimeDays entre os itens da resposta (nulls ignorados).
      const resultById = new Map(
        (response.body.results as Array<{ quoteResponseId: number; leadTimeDays: number | null }>).map(
          (item) => [item.quoteResponseId, item.leadTimeDays],
        ),
      );
      expect(resultById.get(11)).toBe(18);
      expect(resultById.get(12)).toBe(25);

      // Nada foi persistido: nem transacao, nem update de isWinner, nem
      // criacao de QuoteComparison/AuditLog.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('leadTimeDays cai no valor de topo da QuoteResponse sem itens com lead time, e null sem nenhum dado', async () => {
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
          leadTimeDays: 40,
          items: [],
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
          leadTimeDays: null,
          items: [],
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
      const resultById = new Map(
        (response.body.results as Array<{ quoteResponseId: number; leadTimeDays: number | null }>).map(
          (item) => [item.quoteResponseId, item.leadTimeDays],
        ),
      );
      // id 11: items sem lead time -> cai no leadTimeDays de topo (40).
      expect(resultById.get(11)).toBe(40);
      // id 12: nem itens nem leadTimeDays de topo -> null.
      expect(resultById.get(12)).toBeNull();
    });

    it('devolve originPort e itemOrigins por proposta sem alterar score nem landed cost (informativo)', async () => {
      const cookies = await loginAs('viewer');

      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-20260325-DEMO01',
        status: 'open',
        currency: 'USD',
        items: [1, 2].map((id) => ({ id, quantity: 1 })),
      });
      prismaMock.companyProfile.findUnique.mockResolvedValue({
        id: 1,
        awardApprovalThreshold: null,
      });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const buildResponses = (withOrigin: boolean) => [
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
          originPort: withOrigin ? 'Shanghai' : null,
          items: [
            {
              quoteRequestItemId: 1,
              quantity: 1,
              unitPrice: 40,
              leadTimeDays: 12,
              originPort: null,
              quoteRequestItem: { productName: 'Produto A' },
            },
            {
              quoteRequestItemId: 2,
              quantity: 1,
              unitPrice: 60,
              leadTimeDays: 18,
              originPort: withOrigin ? 'Ningbo' : null,
              quoteRequestItem: { productName: 'Produto B' },
            },
          ],
          supplier: { id: 101, name: 'Global Parts Ltd', contacts: [] },
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
          originPort: null,
          items: [
            {
              quoteRequestItemId: 1,
              quantity: 1,
              unitPrice: 60,
              leadTimeDays: 25,
              originPort: null,
              quoteRequestItem: { productName: 'Produto A' },
            },
            {
              quoteRequestItemId: 2,
              quantity: 1,
              unitPrice: 60,
              leadTimeDays: 25,
              originPort: null,
              quoteRequestItem: { productName: 'Produto B' },
            },
          ],
          supplier: { id: 102, name: 'Nihon Trading', contacts: [] },
        },
      ];

      type Result = {
        quoteResponseId: number;
        totalScore: number;
        totalLandedCost: number;
        originPort: string | null;
        itemOrigins: Array<{
          quoteRequestItemId: number;
          productName: string | null;
          originPort: string | null;
          overridden: boolean;
        }>;
      };
      const weights = { priceWeight: 80, paymentTermsWeight: 10, incotermWeight: 10, qualityWeight: 0 };

      prismaMock.quoteResponse.findMany.mockResolvedValue(buildResponses(true));
      const withOrigin = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);
      prismaMock.quoteResponse.findMany.mockResolvedValue(buildResponses(false));
      const withoutOrigin = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(withOrigin.status).toBe(200);
      expect(withoutOrigin.status).toBe(200);

      const byId = (body: { results: Result[] }) =>
        new Map(body.results.map((item) => [item.quoteResponseId, item]));
      const a = byId(withOrigin.body);
      const b = byId(withoutOrigin.body);

      expect(a.get(11)?.originPort).toBe('Shanghai');
      expect(a.get(11)?.itemOrigins).toEqual([
        { quoteRequestItemId: 1, productName: 'Produto A', originPort: 'Shanghai', overridden: false },
        { quoteRequestItemId: 2, productName: 'Produto B', originPort: 'Ningbo', overridden: true },
      ]);
      expect(a.get(12)?.originPort).toBeNull();
      expect(a.get(12)?.itemOrigins.every((item) => item.originPort === null && !item.overridden)).toBe(true);
      expect(b.get(11)?.itemOrigins.every((item) => item.originPort === null)).toBe(true);

      // Informativo: score, landed cost e vencedora identicos com ou sem origem.
      for (const id of [11, 12]) {
        expect(a.get(id)?.totalScore).toBe(b.get(id)?.totalScore);
        expect(a.get(id)?.totalLandedCost).toBe(b.get(id)?.totalLandedCost);
      }
      expect(withOrigin.body.winnerQuoteResponseId).toBe(withoutOrigin.body.winnerQuoteResponseId);
    });

    it('devolve dgItems por proposta sem alterar score nem landed cost (informativo); indisponivel nao conta', async () => {
      const cookies = await loginAs('viewer');

      prismaMock.quoteRequest.findUnique.mockResolvedValue({
        id: 1,
        requestCode: 'QR-20260325-DEMO01',
        status: 'open',
        currency: 'USD',
        items: [1, 2].map((id) => ({ id, quantity: 1 })),
      });
      prismaMock.companyProfile.findUnique.mockResolvedValue({
        id: 1,
        awardApprovalThreshold: null,
      });
      prismaMock.supplierReview.groupBy.mockResolvedValue([]);

      const buildResponses = (withDg: boolean) => [
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
          originPort: null,
          items: [
            {
              quoteRequestItemId: 1,
              quantity: 1,
              unitPrice: 40,
              leadTimeDays: 12,
              originPort: null,
              isUnavailable: false,
              isDangerousGood: withDg,
              quoteRequestItem: { productName: 'Produto A' },
            },
            {
              quoteRequestItemId: 2,
              quantity: 1,
              unitPrice: 60,
              leadTimeDays: 18,
              originPort: null,
              isUnavailable: false,
              isDangerousGood: false,
              quoteRequestItem: { productName: 'Produto B' },
            },
          ],
          supplier: { id: 101, name: 'Global Parts Ltd', contacts: [] },
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
          originPort: null,
          items: [
            {
              quoteRequestItemId: 1,
              quantity: 1,
              unitPrice: 60,
              leadTimeDays: 25,
              originPort: null,
              isUnavailable: false,
              isDangerousGood: false,
              quoteRequestItem: { productName: 'Produto A' },
            },
            {
              quoteRequestItemId: 2,
              quantity: 1,
              unitPrice: 60,
              leadTimeDays: 25,
              originPort: null,
              isUnavailable: false,
              isDangerousGood: withDg,
              quoteRequestItem: { productName: 'Produto B' },
            },
          ],
          supplier: { id: 102, name: 'Nihon Trading', contacts: [] },
        },
      ];

      type Result = {
        quoteResponseId: number;
        totalScore: number;
        totalLandedCost: number;
        dgItems: Array<{ quoteRequestItemId: number; productName: string }>;
      };
      const weights = { priceWeight: 80, paymentTermsWeight: 10, incotermWeight: 10, qualityWeight: 0 };

      prismaMock.quoteResponse.findMany.mockResolvedValue(buildResponses(true));
      const withDg = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);
      prismaMock.quoteResponse.findMany.mockResolvedValue(buildResponses(false));
      const withoutDg = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(withDg.status).toBe(200);
      expect(withoutDg.status).toBe(200);
      expect(prismaMock.quoteResponse.findMany.mock.calls.at(-1)?.[0].include.items.select).toMatchObject({
        isDangerousGood: true,
      });

      const byId = (body: { results: Result[] }) =>
        new Map(body.results.map((item) => [item.quoteResponseId, item]));
      const a = byId(withDg.body);
      const b = byId(withoutDg.body);

      expect(a.get(11)?.dgItems).toEqual([{ quoteRequestItemId: 1, productName: 'Produto A' }]);
      expect(a.get(12)?.dgItems).toEqual([{ quoteRequestItemId: 2, productName: 'Produto B' }]);
      expect(b.get(11)?.dgItems).toEqual([]);
      expect(b.get(12)?.dgItems).toEqual([]);

      // Informativo: score, landed cost e vencedora identicos com ou sem DG.
      for (const id of [11, 12]) {
        expect(a.get(id)?.totalScore).toBe(b.get(id)?.totalScore);
        expect(a.get(id)?.totalLandedCost).toBe(b.get(id)?.totalLandedCost);
      }
      expect(withDg.body.winnerQuoteResponseId).toBe(withoutDg.body.winnerQuoteResponseId);
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

describe('Comparison routes - item temporariamente indisponivel (fora do ranking)', () => {
  const requestedItems = [1, 2].map((id) => ({ id, quantity: 1, productName: `Produto ${id}` }));

  const proposal = (
    id: number,
    supplierId: number,
    items: Array<{ id: number; unitPrice: number; unavailable?: boolean; quantity?: number }>,
    extra: Record<string, unknown> = {},
  ) => {
    const offered = items
      .filter((item) => !item.unavailable)
      .reduce((sum, item) => sum + item.unitPrice, 0);
    return {
      id,
      quoteRequestId: 1,
      supplierId,
      offeredPrice: offered,
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
      isWinner: false,
      items: items.map((item) => ({
        quoteRequestItemId: item.id,
        quantity: item.unavailable ? 0 : item.quantity ?? 1,
        unitPrice: item.unavailable ? 0 : item.unitPrice,
        leadTimeDays: null,
        originPort: null,
        isUnavailable: Boolean(item.unavailable),
        quoteRequestItem: { productName: `Produto ${item.id}` },
      })),
      supplier: { id: supplierId, name: `Fornecedor ${supplierId}`, contacts: [] },
      ...extra,
    };
  };
  const complete = (id: number, supplierId: number, prices: [number, number]) =>
    proposal(id, supplierId, [
      { id: 1, unitPrice: prices[0] },
      { id: 2, unitPrice: prices[1] },
    ]);
  const withUnavailableItem = (id: number, supplierId: number) =>
    proposal(id, supplierId, [{ id: 1, unitPrice: 1 }, { id: 2, unitPrice: 0, unavailable: true }]);
  const allUnavailable = (id: number, supplierId: number) =>
    proposal(id, supplierId, [
      { id: 1, unitPrice: 0, unavailable: true },
      { id: 2, unitPrice: 0, unavailable: true },
    ]);

  const weights = { priceWeight: 100, paymentTermsWeight: 0, incotermWeight: 0, qualityWeight: 0 };

  function mockEnv(responses: unknown[]) {
    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-UN',
      status: 'open',
      currency: 'USD',
      items: requestedItems,
    });
    prismaMock.quoteResponse.findMany.mockResolvedValue(responses);
    prismaMock.companyProfile.findUnique.mockResolvedValue({ id: 1, awardApprovalThreshold: null });
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 999, approvalStatus: 'not_required' });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock.__tx));
  });

  it('preview: proposta com item indisponivel vai para `excluded` e nao entra no ranking nem pode vencer', async () => {
    const cookies = await loginAs('viewer');
    // A indisponivel parece a "mais barata" (1) se o sentinel 0 vazasse; completas custam 30 e 50.
    mockEnv([withUnavailableItem(11, 101), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.responseCount).toBe(3);
    expect(response.body.results.map((r: { quoteResponseId: number }) => r.quoteResponseId).sort()).toEqual([12, 13]);
    expect(response.body.winnerQuoteResponseId).toBe(12);
    // priceScore da mais barata COMPLETA = 100 (min so entre as completas).
    const winner = response.body.results.find((r: { quoteResponseId: number }) => r.quoteResponseId === 12);
    expect(winner.priceScore).toBe(100);
    expect(response.body.excluded).toEqual([
      {
        quoteResponseId: 11,
        supplierId: 101,
        supplier: { id: 101, name: 'Fornecedor 101' },
        creditSupportRequestId: null,
        creditPartner: null,
        reason: 'unavailable',
        unavailableItems: [{ quoteRequestItemId: 2, productName: 'Produto 2' }],
      },
    ]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  it('preview: proposta TODA indisponivel (offeredPrice 0) fica excluida e todos os scores sao finitos', async () => {
    const cookies = await loginAs('viewer');
    mockEnv([allUnavailable(11, 101), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.excluded).toHaveLength(1);
    expect(response.body.excluded[0].unavailableItems).toHaveLength(2);
    for (const result of response.body.results as Array<Record<string, number>>) {
      for (const key of ['offeredPrice', 'totalLandedCost', 'priceScore', 'totalScore']) {
        expect(Number.isFinite(result[key])).toBe(true);
      }
      expect(result.offeredPrice).toBeGreaterThan(0);
    }
    expect(response.body.winnerQuoteResponseId).toBe(12);
  });

  it('preview: sem nenhuma proposta completa responde 200 com results [] e `excluded`', async () => {
    const cookies = await loginAs('viewer');
    mockEnv([withUnavailableItem(11, 101), allUnavailable(12, 102)]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
    expect(response.body.winnerQuoteResponseId).toBeNull();
    expect(response.body.responseCount).toBe(2);
    expect(response.body.excluded.map((e: { quoteResponseId: number }) => e.quoteResponseId)).toEqual([11, 12]);
  });

  it('preview: sem item indisponivel `excluded` vem vazio e o ranking segue como antes', async () => {
    const cookies = await loginAs('viewer');
    mockEnv([complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.excluded).toEqual([]);
  });

  it('compare: persiste so as completas, devolve `excluded` e registra os ids excluidos no audit', async () => {
    const cookies = await loginAs('comprador');
    mockEnv([withUnavailableItem(11, 101), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { id: number }) => r.id).sort()).toEqual([12, 13]);
    expect(response.body.excluded.map((e: { quoteResponseId: number }) => e.quoteResponseId)).toEqual([11]);
    const created = prismaMock.__tx.quoteComparison.create.mock.calls[0][0].data;
    expect(created.winnerQuoteResponseId).toBe(12);
    expect(created.results.create.map((r: { quoteResponseId: number }) => r.quoteResponseId).sort()).toEqual([12, 13]);
    // so a vencedora (completa) e marcada
    expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { isWinner: true } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'compare',
          metadata: expect.objectContaining({ excludedQuoteResponseIds: [11] }),
        }),
      }),
    );
  });

  it('compare: com menos de 2 completas responde 400 explicando as excluidas e NAO cria comparison', async () => {
    const cookies = await loginAs('comprador');
    mockEnv([withUnavailableItem(11, 101), complete(12, 102, [10, 20])]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'Sao necessarias pelo menos duas propostas completas para comparar (1 ficaram fora do ranking: item indisponivel, proposta parcial ou oferta do parceiro desatualizada).',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  describe('proposta parcial nao derruba a comparacao (cotacao 49)', () => {
    const missingItem = (id: number, supplierId: number) => {
      const partial = complete(id, supplierId, [10, 20]);
      partial.items = partial.items.slice(0, 1);
      return partial;
    };
    // Item 1 cotado com quantidade 3 (pedido 1): ranking usa 10 x 1 + 20 x 1 = 30.
    const adjustedQuantity = (id: number, supplierId: number) =>
      proposal(id, supplierId, [{ id: 1, unitPrice: 10, quantity: 3 }, { id: 2, unitPrice: 20 }], {
        offeredPrice: 50,
      });
    const extraItem = (id: number, supplierId: number) =>
      proposal(id, supplierId, [
        { id: 1, unitPrice: 10 },
        { id: 2, unitPrice: 20 },
        { id: 99, unitPrice: 5 },
      ]);

    it('preview: quantidade divergente ENTRA no ranking com unitario x quantidade pedida, sinalizada', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([adjustedQuantity(11, 101), complete(12, 102, [15, 20]), complete(13, 103, [20, 30])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.responseCount).toBe(3);
      expect(response.body.excluded).toEqual([]);
      expect(response.body.results).toHaveLength(3);
      const adjusted = response.body.results.find((r: { quoteResponseId: number }) => r.quoteResponseId === 11);
      expect(adjusted.offeredPrice).toBe(30);
      expect(adjusted.quantityAdjusted).toBe(true);
      expect(adjusted.quantityMismatches).toEqual([
        { quoteRequestItemId: 1, productName: 'Produto 1', requested: 1, offered: 3 },
      ]);
      // e a mais barata a quantidade pedida (30 < 35 < 50): pode vencer.
      expect(adjusted.priceScore).toBe(100);
      expect(response.body.winnerQuoteResponseId).toBe(11);
      const plain = response.body.results.find((r: { quoteResponseId: number }) => r.quoteResponseId === 12);
      expect(plain.quantityAdjusted).toBe(false);
      expect(plain.quantityMismatches).toEqual([]);
    });

    it('compare: quantidade divergente e persistida no ranking com o preco ajustado e pode vencer', async () => {
      const cookies = await loginAs('comprador');
      mockEnv([adjustedQuantity(11, 101), complete(12, 102, [15, 20]), complete(13, 103, [20, 30])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.excluded).toEqual([]);
      const adjusted = response.body.results.find((r: { id: number }) => r.id === 11);
      expect(adjusted.quantityAdjusted).toBe(true);
      expect(adjusted.offeredPrice).toBe(30);
      const created = prismaMock.__tx.quoteComparison.create.mock.calls[0][0].data;
      expect(created.winnerQuoteResponseId).toBe(11);
      expect(created.results.create.find((r: { quoteResponseId: number }) => r.quoteResponseId === 11).offeredPrice).toBe(30);
      expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { isWinner: true } });
    });

    it('preview: 2 completas + 1 com item faltando -> 200, parcial em `excluded` com o motivo', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([missingItem(11, 101), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.responseCount).toBe(3);
      expect(response.body.results.map((r: { quoteResponseId: number }) => r.quoteResponseId).sort()).toEqual([12, 13]);
      expect(response.body.winnerQuoteResponseId).toBe(12);
      expect(response.body.excluded).toEqual([
        {
          quoteResponseId: 11,
          supplierId: 101,
          supplier: { id: 101, name: 'Fornecedor 101' },
          creditSupportRequestId: null,
          creditPartner: null,
          reason: 'partial',
          unavailableItems: [],
          partial: {
            missingItems: [{ quoteRequestItemId: 2, productName: 'Produto 2' }],
            quantityMismatches: [],
            extraItems: [],
            duplicateItems: [],
          },
        },
      ]);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('preview: item extra/duplicado vai para `excluded` com extraItems/duplicateItems (nome via relacao)', async () => {
      const cookies = await loginAs('viewer');
      const duplicated = complete(14, 104, [10, 20]);
      duplicated.items = [...duplicated.items, duplicated.items[0]];
      mockEnv([extraItem(11, 101), duplicated, complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.excluded.map((e: { quoteResponseId: number }) => e.quoteResponseId)).toEqual([11, 14]);
      expect(response.body.excluded[0].partial.extraItems).toEqual([{ quoteRequestItemId: 99, productName: 'Produto 99' }]);
      expect(response.body.excluded[1].partial.duplicateItems).toEqual([{ quoteRequestItemId: 1, productName: 'Produto 1' }]);
    });

    it('compare: 2 completas + 1 parcial -> 200 e a parcial fica registrada em excludedQuoteResponseIds', async () => {
      const cookies = await loginAs('comprador');
      mockEnv([missingItem(11, 101), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.results.map((r: { id: number }) => r.id).sort()).toEqual([12, 13]);
      expect(response.body.excluded[0]).toMatchObject({ quoteResponseId: 11, reason: 'partial' });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'compare',
            metadata: expect.objectContaining({ excludedQuoteResponseIds: [11] }),
          }),
        }),
      );
    });

    it('preview: 1 completa + 1 parcial -> 200 com 1 resultado (by-pass) e o motivo', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([missingItem(11, 101), complete(12, 102, [10, 20])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.responseCount).toBe(2);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].quoteResponseId).toBe(12);
      expect(response.body.excluded[0].partial.missingItems[0].productName).toBe('Produto 2');
    });

    it('compare: 1 completa + 1 parcial -> 400 com a mensagem nova e NAO cria comparison', async () => {
      const cookies = await loginAs('comprador');
      mockEnv([missingItem(11, 101), complete(12, 102, [10, 20])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'Sao necessarias pelo menos duas propostas completas para comparar (1 ficaram fora do ranking: item indisponivel, proposta parcial ou oferta do parceiro desatualizada).',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
    });

    it('winner (escolha manual): item extra/duplicado -> 400 "itens inconsistentes" e nada e gravado', async () => {
      const cookies = await loginAs('comprador');
      mockEnv([]);
      prismaMock.quoteResponse.findFirst.mockResolvedValue(extraItem(11, 101));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/winner')
        .set('Cookie', cookies)
        .send({ quoteResponseId: 11, reason: 'preferencia' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'Proposta com itens inconsistentes nao pode ser escolhida como vencedora: item nao pertence mais a cotacao: Produto 99.',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
    });

    it('winner (escolha manual): item faltando PODE ser escolhida (200) e quantidade divergente tambem', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.__tx.quoteComparisonResult.updateMany.mockResolvedValue({ count: 0 });

      for (const chosen of [missingItem(11, 101), adjustedQuantity(11, 101)]) {
        vi.clearAllMocks();
        prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock.__tx));
        mockEnv([]);
        prismaMock.quoteComparison.findFirst.mockResolvedValue(null);
        prismaMock.quoteResponse.findFirst.mockResolvedValue(chosen);

        const response = await request(app)
          .post('/api/v1/quote-requests/1/winner')
          .set('Cookie', cookies)
          .send({ quoteResponseId: 11, reason: 'preferencia' });

        expect(response.status).toBe(200);
        expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 11, deletedAt: null }, data: { isWinner: true } }),
        );
      }
    });
  });

  describe('approveAward revalida o vencedor da comparacao pendente', () => {
    function mockPendingComparison() {
      prismaMock.quoteComparison.findUnique.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        approvalStatus: 'pending',
        winnerQuoteResponseId: 11,
      });
      prismaMock.quoteComparison.findFirst.mockResolvedValue({ id: 999 });
      prismaMock.__tx.quoteComparison.update.mockResolvedValue({});
      prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    }

    it('vencedor que virou item indisponivel apos a comparacao -> 409, nada e alterado', async () => {
      const cookies = await loginAs('admin');
      mockEnv([]);
      mockPendingComparison();
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        id: 11,
        offeredPrice: 10,
        items: [
          { quoteRequestItemId: 1, quantity: 1, unitPrice: 10, isUnavailable: false },
          { quoteRequestItemId: 2, quantity: 0, unitPrice: 0, isUnavailable: true },
        ],
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'A proposta vencedora mudou (itens indisponíveis). Refaça a comparação antes de aprovar.',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteResponse.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.update).not.toHaveBeenCalled();
    });

    it('vencedor completo -> aprova como antes', async () => {
      const cookies = await loginAs('admin');
      mockEnv([]);
      mockPendingComparison();
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        id: 11,
        offeredPrice: 30,
        items: [
          { quoteRequestItemId: 1, quantity: 1, unitPrice: 10, isUnavailable: false },
          { quoteRequestItemId: 2, quantity: 1, unitPrice: 20, isUnavailable: false },
        ],
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvalStatus: 'approved' }),
        }),
      );
      expect(prismaMock.__tx.quoteResponse.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isWinner: true } }),
      );
    });

    it('vencedor com item indisponivel E item faltando (partial) -> 409 de indisponivel, nada e alterado', async () => {
      const cookies = await loginAs('admin');
      mockEnv([]);
      mockPendingComparison();
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        id: 11,
        offeredPrice: 0,
        items: [{ quoteRequestItemId: 1, quantity: 0, unitPrice: 0, isUnavailable: true }],
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'A proposta vencedora mudou (itens indisponíveis). Refaça a comparação antes de aprovar.',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.update).not.toHaveBeenCalled();
    });

    it('vencedor que ficou com item extra/duplicado -> 409, nada e alterado', async () => {
      const cookies = await loginAs('admin');
      mockEnv([]);
      mockPendingComparison();
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        id: 11,
        offeredPrice: 30,
        items: [
          { quoteRequestItemId: 1, quantity: 1, unitPrice: 10, isUnavailable: false },
          { quoteRequestItemId: 2, quantity: 1, unitPrice: 20, isUnavailable: false },
          { quoteRequestItemId: 99, quantity: 1, unitPrice: 5, isUnavailable: false },
        ],
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('não pertencem mais à cotação ou duplicados');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.quoteComparison.update).not.toHaveBeenCalled();
    });

    it('vencedor com item faltando ou quantidade divergente -> aprova (decisao 2026-10-12)', async () => {
      const cookies = await loginAs('admin');
      for (const items of [
        [{ quoteRequestItemId: 1, quantity: 1, unitPrice: 10, isUnavailable: false }],
        [
          { quoteRequestItemId: 1, quantity: 3, unitPrice: 10, isUnavailable: false },
          { quoteRequestItemId: 2, quantity: 1, unitPrice: 20, isUnavailable: false },
        ],
      ]) {
        vi.clearAllMocks();
        prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock.__tx));
        mockEnv([]);
        mockPendingComparison();
        prismaMock.quoteResponse.findFirst.mockResolvedValue({ id: 11, offeredPrice: 30, items });

        const response = await request(app)
          .post('/api/v1/quote-requests/1/comparisons/999/approve')
          .set('Cookie', cookies);

        expect(response.status).toBe(200);
        expect(prismaMock.__tx.quoteComparison.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ approvalStatus: 'approved' }) }),
        );
      }
    });
  });

  it('winner (escolha manual): proposta com item indisponivel -> 400 e nada e gravado', async () => {
    const cookies = await loginAs('comprador');
    mockEnv([]);
    prismaMock.quoteResponse.findFirst.mockResolvedValue({
      ...withUnavailableItem(11, 101),
      items: withUnavailableItem(11, 101).items,
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/winner')
      .set('Cookie', cookies)
      .send({ quoteResponseId: 11, reason: 'preferencia' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'Proposta com item temporariamente indisponivel nao pode ser escolhida como vencedora.',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteResponse.update).not.toHaveBeenCalled();
  });
  describe('preview: vencedora gravada (escolha manual) em `persistedWinner`', () => {
    const manualAudit = (winnerQuoteResponseId: number, winnerCreditSupportRequestId: number | null = null) => ({
      action: 'manual_winner',
      afterData: { winnerQuoteResponseId, winnerCreditSupportRequestId },
    });
    const partialWith = (id: number, supplierId: number, extra: Record<string, unknown> = {}) =>
      proposal(id, supplierId, [{ id: 1, unitPrice: 1 }, { id: 2, unitPrice: 0, unavailable: true }], extra);

    it('(a) parcial gravada como vencedora + ultimo audit manual_winner => manual true; vencedor do score intacto', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([partialWith(11, 101, { isWinner: true }), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);
      prismaMock.auditLog.findFirst.mockResolvedValue(manualAudit(11));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.persistedWinner).toEqual({ quoteResponseId: 11, creditSupportRequestId: null, manual: true });
      expect(response.body.winnerQuoteResponseId).toBe(12);
      expect(prismaMock.auditLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: 'quote_request',
            entityId: '1',
            action: { in: ['compare', 'manual_winner', 'approve_award', 'reopen'] },
          }),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('(b) ranqueada gravada + ultimo audit compare => manual false', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([complete(12, 102, [10, 20]), { ...complete(13, 103, [20, 30]), isWinner: true }]);
      prismaMock.auditLog.findFirst.mockResolvedValue({ action: 'compare', afterData: null });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.persistedWinner).toEqual({ quoteResponseId: 13, creditSupportRequestId: null, manual: false });
      expect(response.body.winnerQuoteResponseId).toBe(12);
    });

    it('(c) audit manual_winner apontando para OUTRO id => manual false', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([partialWith(11, 101, { isWinner: true }), complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);
      prismaMock.auditLog.findFirst.mockResolvedValue(manualAudit(13));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.persistedWinner).toEqual({ quoteResponseId: 11, creditSupportRequestId: null, manual: false });
    });

    it('(d) sem nenhuma isWinner => chave omitida e auditLog.findFirst nao e chamado', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([complete(12, 102, [10, 20]), complete(13, 103, [20, 30])]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect('persistedWinner' in response.body).toBe(false);
      expect(prismaMock.auditLog.findFirst).not.toHaveBeenCalled();
    });

    it('(e) sem nenhuma completa e parcial manual => persistedWinner com manual true', async () => {
      const cookies = await loginAs('viewer');
      mockEnv([partialWith(11, 101, { isWinner: true }), allUnavailable(12, 102)]);
      prismaMock.auditLog.findFirst.mockResolvedValue(manualAudit(11));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/compare/preview')
        .set('Cookie', cookies)
        .send(weights);

      expect(response.status).toBe(200);
      expect(response.body.results).toEqual([]);
      expect(response.body.persistedWinner).toEqual({ quoteResponseId: 11, creditSupportRequestId: null, manual: true });
    });
  });
});

// PR4a (Credit Support): encaminhamento `responded` entra na Comparacao como candidato
// proprio ("Fornecedor X via Parceiro Y"), com a identidade (quoteResponseId, creditSupportRequestId).
describe('Comparison routes - alternativa via parceiro (Credit Support, PR4a)', () => {
  const requestedItems = (quantity = 1) =>
    [1, 2].map((id) => ({ id, quantity, productName: `Produto ${id}` }));

  // Resposta de origem com os campos que o computeIsStale/buildSnapshot le (version, totalPrice,
  // quoteRequestItem.unit/quantity) alem dos usados pela comparacao.
  const origin = (
    id: number,
    supplierId: number,
    items: Array<{ id: number; unitPrice: number; quantity?: number; unavailable?: boolean }>,
    extra: Record<string, unknown> = {},
  ) => {
    const offered = items
      .filter((item) => !item.unavailable)
      .reduce((sum, item) => sum + item.unitPrice * (item.quantity ?? 1), 0);
    return {
      id,
      quoteRequestId: 1,
      supplierId,
      version: 1,
      deletedAt: null,
      offeredPrice: offered,
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
      leadTimeDays: 15,
      originPort: 'Ningbo',
      isWinner: false,
      items: items.map((item) => ({
        quoteRequestItemId: item.id,
        quantity: item.unavailable ? 0 : item.quantity ?? 1,
        unitPrice: item.unavailable ? 0 : item.unitPrice,
        totalPrice: item.unavailable ? 0 : item.unitPrice * (item.quantity ?? 1),
        leadTimeDays: null,
        originPort: null,
        deletedAt: null,
        isUnavailable: Boolean(item.unavailable),
        isDangerousGood: false,
        quoteRequestItem: { productName: `Produto ${item.id}`, unit: 'KG', quantity: item.quantity ?? 1, deletedAt: null },
      })),
      supplier: {
        id: supplierId,
        name: `Fornecedor ${supplierId}`,
        contacts: [{ id: supplierId * 10, name: `Contato ${supplierId}`, email: `c${supplierId}@f.example` }],
      },
      ...extra,
    };
  };

  // Encaminhamento respondido da resposta 12 (Fornecedor 102) via Banco Alfa (parceiro 5).
  const creditRow = (
    items: Array<{ id: number; originalUnitPrice: number; partnerUnitPrice: number | null; quantity?: number; unavailable?: boolean }>,
    extra: Record<string, unknown> = {},
  ) => {
    const partnerTotal = items
      .filter((item) => !item.unavailable && item.partnerUnitPrice !== null)
      .reduce((sum, item) => sum + (item.partnerUnitPrice ?? 0) * (item.quantity ?? 1), 0);
    return {
      id: 7,
      quoteRequestId: 1,
      quoteResponseId: 12,
      supplierId: 102,
      creditPartnerId: 5,
      creditPartnerContactId: 50,
      currency: 'USD',
      offeredIncoterm: 'FOB',
      revokedAt: null,
      respondedAt: new Date('2026-10-01T00:00:00.000Z'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      partnerPaymentTermsDays: 90,
      partnerValidityDays: 30,
      partnerTotalPrice: new Prisma.Decimal(partnerTotal),
      isWinner: false,
      supplier: { id: 102, name: 'Fornecedor 102' },
      creditPartner: { id: 5, name: 'Banco Alfa' },
      creditPartnerContact: { id: 50, name: 'Ana Credito', email: 'ana@alfa.example' },
      items: items.map((item, index) => ({
        id: 700 + index,
        requestId: 7,
        quoteRequestItemId: item.id,
        position: index + 1,
        productName: `Produto ${item.id}`,
        quantity: item.quantity ?? 1,
        isUnavailable: Boolean(item.unavailable),
        originalUnitPrice: new Prisma.Decimal(item.unavailable ? 0 : item.originalUnitPrice),
        partnerUnitPrice: item.unavailable || item.partnerUnitPrice === null ? null : new Prisma.Decimal(item.partnerUnitPrice),
      })),
      ...extra,
    };
  };

  const weights = { priceWeight: 100, paymentTermsWeight: 0, incotermWeight: 0, qualityWeight: 0 };

  function mockEnv(responses: unknown[], creditRows: unknown[], items = requestedItems()) {
    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 1,
      requestCode: 'QR-CS',
      status: 'open',
      currency: 'USD',
      items,
    });
    // O mesmo findMany atende a carga das respostas e a carga das origens (filtrada por id).
    prismaMock.quoteResponse.findMany.mockResolvedValue(responses);
    prismaMock.creditSupportRequest.findMany.mockResolvedValue(creditRows);
    prismaMock.companyProfile.findUnique.mockResolvedValue({ id: 1, awardApprovalThreshold: null });
    prismaMock.supplierReview.groupBy.mockResolvedValue([]);
    prismaMock.__tx.quoteResponse.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.__tx.quoteResponse.update.mockResolvedValue({});
    prismaMock.__tx.creditSupportRequest.update.mockResolvedValue({});
    prismaMock.__tx.creditSupportRequest.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.__tx.quoteComparison.create.mockResolvedValue({ id: 999, approvalStatus: 'not_required' });
  }

  const twoDirect = () => [origin(12, 102, [{ id: 1, unitPrice: 10 }, { id: 2, unitPrice: 20 }]), origin(13, 103, [{ id: 1, unitPrice: 20 }, { id: 2, unitPrice: 30 }])];
  const cheaperPartner = () => creditRow([{ id: 1, originalUnitPrice: 10, partnerUnitPrice: 9 }, { id: 2, originalUnitPrice: 20, partnerUnitPrice: 18 }]);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock.__tx));
  });

  it('preview: alternativa completa entra com preco/prazo do parceiro e incoterm/moeda/cambio/contato da origem', async () => {
    const cookies = await loginAs('viewer');
    mockEnv(twoDirect(), [cheaperPartner()]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(prismaMock.creditSupportRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { quoteRequestId: 1, revokedAt: null, respondedAt: { not: null } },
      }),
    );
    expect(response.body.responseCount).toBe(2);
    expect(response.body.candidateCount).toBe(3);
    expect(response.body.results).toHaveLength(3);
    const viaPartner = response.body.results.find((r: { creditSupportRequestId: number | null }) => r.creditSupportRequestId === 7);
    expect(viaPartner).toMatchObject({
      quoteResponseId: 12,
      supplierId: 102,
      supplier: { id: 102, name: 'Fornecedor 102' },
      offeredPrice: 27,
      paymentTermsDays: 90,
      currency: 'USD',
      exchangeRate: 5,
      offeredIncoterm: 'FOB',
      contact: { id: 1020, name: 'Contato 102', email: 'c102@f.example' },
      leadTimeDays: 15,
      originPort: 'Ningbo',
      creditPartner: { id: 5, name: 'Banco Alfa' },
      partnerContact: { id: 50, name: 'Ana Credito', email: 'ana@alfa.example' },
      partnerValidityDays: 30,
      validityExpired: false, // respondida em 2026-10-01 + 30d ainda vale
      quantityAdjusted: false,
      isWinner: true,
    });
    // Mesmo fornecedor, duas linhas: a direta continua e NAO e vencedora.
    const direct = response.body.results.find((r: { quoteResponseId: number; creditSupportRequestId: number | null }) => r.quoteResponseId === 12 && r.creditSupportRequestId === null);
    expect(direct).toMatchObject({ offeredPrice: 30, paymentTermsDays: 30, isWinner: false, creditPartner: null, partnerContact: null, partnerValidityDays: null, validityExpired: false });
    expect(response.body.results.filter((r: { isWinner: boolean }) => r.isWinner)).toHaveLength(1);
    expect(response.body.winnerQuoteResponseId).toBe(12);
    expect(response.body.winnerCreditSupportRequestId).toBe(7);
    // priceScore da mais barata (alternativa) = 100
    expect(viaPartner.priceScore).toBe(100);
    expect(response.body.excluded).toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('preview: validade do parceiro vencida NAO exclui, so sinaliza validityExpired (aprovacao 8)', async () => {
    const cookies = await loginAs('viewer');
    mockEnv(twoDirect(), [creditRow(
      [{ id: 1, originalUnitPrice: 10, partnerUnitPrice: 9 }, { id: 2, originalUnitPrice: 20, partnerUnitPrice: 18 }],
      { respondedAt: new Date('2026-01-01T00:00:00.000Z'), partnerValidityDays: 15 },
    )]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    const viaPartner = response.body.results.find((r: { creditSupportRequestId: number | null }) => r.creditSupportRequestId === 7);
    expect(viaPartner).toMatchObject({ validityExpired: true, partnerValidityDays: 15, isWinner: true });
    expect(response.body.excluded).toEqual([]);
  });

  it('preview: alternativa `adjusted` (snapshot qtd 8, pedido 10) entra com partnerUnitPrice x 10 e quantityAdjusted', async () => {
    const cookies = await loginAs('viewer');
    const responses = [
      origin(12, 102, [{ id: 1, unitPrice: 10, quantity: 8 }, { id: 2, unitPrice: 20, quantity: 8 }]),
      origin(13, 103, [{ id: 1, unitPrice: 20, quantity: 10 }, { id: 2, unitPrice: 30, quantity: 10 }]),
    ];
    const row = creditRow([
      { id: 1, originalUnitPrice: 10, partnerUnitPrice: 9, quantity: 8 },
      { id: 2, originalUnitPrice: 20, partnerUnitPrice: 18, quantity: 8 },
    ]);
    mockEnv(responses, [row], requestedItems(10));

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    const viaPartner = response.body.results.find((r: { creditSupportRequestId: number | null }) => r.creditSupportRequestId === 7);
    expect(viaPartner.offeredPrice).toBe(270); // (9 + 18) x 10
    expect(viaPartner.quantityAdjusted).toBe(true);
    expect(viaPartner.quantityMismatches).toEqual([
      { quoteRequestItemId: 1, productName: 'Produto 1', requested: 10, offered: 8 },
      { quoteRequestItemId: 2, productName: 'Produto 2', requested: 10, offered: 8 },
    ]);
    expect(viaPartner.isWinner).toBe(true);
  });

  it('preview: snapshot com item indisponivel -> `excluded` reason unavailable com creditSupportRequestId e creditPartner', async () => {
    const cookies = await loginAs('viewer');
    const responses = [
      origin(12, 102, [{ id: 1, unitPrice: 10 }, { id: 2, unitPrice: 0, unavailable: true }]),
      ...twoDirect().slice(1),
      origin(14, 104, [{ id: 1, unitPrice: 25 }, { id: 2, unitPrice: 35 }]),
    ];
    const row = creditRow([
      { id: 1, originalUnitPrice: 10, partnerUnitPrice: 9 },
      { id: 2, originalUnitPrice: 0, partnerUnitPrice: null, unavailable: true },
    ]);
    mockEnv(responses, [row]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { quoteResponseId: number }) => r.quoteResponseId).sort()).toEqual([13, 14]);
    expect(response.body.candidateCount).toBe(2);
    expect(response.body.excluded).toEqual([
      expect.objectContaining({ quoteResponseId: 12, creditSupportRequestId: null, creditPartner: null, reason: 'unavailable' }),
      {
        quoteResponseId: 12,
        supplierId: 102,
        supplier: { id: 102, name: 'Fornecedor 102' },
        creditSupportRequestId: 7,
        creditPartner: { id: 5, name: 'Banco Alfa' },
        reason: 'unavailable',
        unavailableItems: [{ quoteRequestItemId: 2, productName: 'Produto 2' }],
      },
    ]);
  });

  it('preview: origem mudou de preco depois do encaminhamento -> `excluded` reason stale (nao entra no ranking)', async () => {
    const cookies = await loginAs('viewer');
    // Snapshot congelou 10/20; a origem agora cota 11/20.
    const responses = [origin(12, 102, [{ id: 1, unitPrice: 11 }, { id: 2, unitPrice: 20 }]), ...twoDirect().slice(1)];
    mockEnv(responses, [cheaperPartner()]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results.every((r: { creditSupportRequestId: number | null }) => r.creditSupportRequestId === null)).toBe(true);
    expect(response.body.winnerCreditSupportRequestId).toBeNull();
    expect(response.body.excluded).toEqual([
      {
        quoteResponseId: 12,
        supplierId: 102,
        supplier: { id: 102, name: 'Fornecedor 102' },
        creditSupportRequestId: 7,
        creditPartner: { id: 5, name: 'Banco Alfa' },
        reason: 'stale',
        unavailableItems: [],
      },
    ]);
  });

  it('preview: origem excluida (soft-delete) -> alternativa stale; revogada/nao respondida nunca chega (where do findMany)', async () => {
    const cookies = await loginAs('viewer');
    // A carga das respostas (deletedAt null) nao traz a 12; a carga das origens tambem nao.
    mockEnv(twoDirect().slice(1).concat(origin(14, 104, [{ id: 1, unitPrice: 25 }, { id: 2, unitPrice: 35 }])), [cheaperPartner()]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.excluded).toEqual([
      expect.objectContaining({ quoteResponseId: 12, creditSupportRequestId: 7, reason: 'stale' }),
    ]);
    expect(prismaMock.creditSupportRequest.findMany.mock.calls[0][0].where).toEqual({
      quoteRequestId: 1,
      revokedAt: null,
      respondedAt: { not: null },
    });
  });

  it('compare: 1 fornecedor + 1 alternativa respondida = 2 candidatos -> compara (aprovacao 7)', async () => {
    const cookies = await loginAs('comprador');
    mockEnv(twoDirect().slice(0, 1), [cheaperPartner()]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.candidateCount).toBe(2);
    expect(response.body.comparisonId).toBe(999);
  });

  it('compare: parceiro vence -> CreditSupportRequest.isWinner true, resposta direta NAO marcada, comparison/result com a identidade', async () => {
    const cookies = await loginAs('comprador');
    mockEnv(twoDirect(), [cheaperPartner()]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.candidateCount).toBe(3);
    expect(response.body.winnerQuoteResponseId).toBeNull(); // sem alcada: como antes
    expect(response.body.winnerCreditSupportRequestId).toBeNull();
    const tx = prismaMock.__tx;
    expect(tx.quoteResponse.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, deletedAt: null }, data: { isWinner: false } });
    expect(tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, isWinner: true }, data: { isWinner: false } });
    expect(tx.creditSupportRequest.update).toHaveBeenCalledTimes(1);
    expect(tx.creditSupportRequest.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { isWinner: true } });
    expect(tx.quoteResponse.update).not.toHaveBeenCalled();
    const created = tx.quoteComparison.create.mock.calls[0][0].data;
    expect(created.winnerQuoteResponseId).toBe(12);
    expect(created.winnerCreditSupportRequestId).toBe(7);
    const rows = created.results.create as Array<{ quoteResponseId: number; creditSupportRequestId: number | null; isWinner: boolean }>;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.creditSupportRequestId === 7)).toMatchObject({ quoteResponseId: 12, isWinner: true });
    expect(rows.filter((r) => r.creditSupportRequestId === null).map((r) => r.quoteResponseId).sort()).toEqual([12, 13]);
    expect(rows.filter((r) => r.isWinner)).toHaveLength(1);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'compare',
          afterData: expect.objectContaining({ winnerQuoteResponseId: 12, winnerCreditSupportRequestId: 7 }),
          metadata: expect.objectContaining({ winnerCreditSupportRequestId: 7, creditSupportRequestIds: [7], excludedCreditSupportRequestIds: [] }),
        }),
      }),
    );
  });

  it('compare: direta vence -> limpa as alternativas (updateMany false) e nao marca nenhuma', async () => {
    const cookies = await loginAs('comprador');
    // Parceiro mais caro que a origem.
    const row = creditRow([{ id: 1, originalUnitPrice: 10, partnerUnitPrice: 12 }, { id: 2, originalUnitPrice: 20, partnerUnitPrice: 24 }]);
    mockEnv(twoDirect(), [row]);

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    const tx = prismaMock.__tx;
    expect(tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, isWinner: true }, data: { isWinner: false } });
    expect(tx.creditSupportRequest.update).not.toHaveBeenCalled();
    expect(tx.quoteResponse.update).toHaveBeenCalledTimes(1);
    expect(tx.quoteResponse.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { isWinner: true } });
    const created = tx.quoteComparison.create.mock.calls[0][0].data;
    expect(created.winnerQuoteResponseId).toBe(12);
    expect(created.winnerCreditSupportRequestId).toBeNull();
  });

  it('preview: alternativa via parceiro gravada como vencedora + audit manual_winner => persistedWinner com o parceiro e manual true', async () => {
    const cookies = await loginAs('viewer');
    mockEnv(twoDirect(), [{ ...cheaperPartner(), isWinner: true }]);
    prismaMock.auditLog.findFirst.mockResolvedValue({
      action: 'manual_winner',
      afterData: { winnerQuoteResponseId: 12, winnerCreditSupportRequestId: 7 },
    });

    const response = await request(app)
      .post('/api/v1/quote-requests/1/compare/preview')
      .set('Cookie', cookies)
      .send(weights);

    expect(response.status).toBe(200);
    expect(response.body.persistedWinner).toEqual({ quoteResponseId: 12, creditSupportRequestId: 7, manual: true });
  });

  describe('approve com vencedor via parceiro', () => {
    function mockPending(winnerCreditSupportRequestId: number | null) {
      prismaMock.quoteComparison.findUnique.mockResolvedValue({
        id: 999,
        quoteRequestId: 1,
        approvalStatus: 'pending',
        winnerQuoteResponseId: 12,
        winnerCreditSupportRequestId,
      });
      prismaMock.quoteComparison.findFirst.mockResolvedValue({ id: 999 });
      prismaMock.__tx.quoteComparison.update.mockResolvedValue({});
      prismaMock.__tx.quoteComparisonResult.updateMany.mockResolvedValue({ count: 1 });
    }

    it('credito vencedor valido -> 200, CreditSupportRequest.isWinner true e result com creditSupportRequestId', async () => {
      const cookies = await loginAs('admin');
      mockEnv(twoDirect(), []);
      mockPending(7);
      prismaMock.creditSupportRequest.findFirst.mockResolvedValue(cheaperPartner());
      prismaMock.quoteResponse.findFirst.mockResolvedValue(twoDirect()[0]);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.creditSupportRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7, quoteRequestId: 1, quoteResponseId: 12, revokedAt: null, respondedAt: { not: null } },
        }),
      );
      const tx = prismaMock.__tx;
      expect(tx.quoteResponse.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, deletedAt: null }, data: { isWinner: false } });
      expect(tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, isWinner: true }, data: { isWinner: false } });
      expect(tx.creditSupportRequest.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { isWinner: true } });
      expect(tx.quoteResponse.update).not.toHaveBeenCalled();
      expect(tx.quoteComparisonResult.updateMany).toHaveBeenCalledWith({
        where: { comparisonId: 999, quoteResponseId: 12, creditSupportRequestId: 7 },
        data: { isWinner: true },
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'approve_award',
            afterData: expect.objectContaining({ winnerQuoteResponseId: 12, winnerCreditSupportRequestId: 7 }),
          }),
        }),
      );
    });

    it('vencedor direto -> result marcado com creditSupportRequestId null (a linha via parceiro do mesmo id nao vence)', async () => {
      const cookies = await loginAs('admin');
      mockEnv(twoDirect(), []);
      mockPending(null);
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        id: 12,
        offeredPrice: 30,
        items: [
          { quoteRequestItemId: 1, quantity: 1, unitPrice: 10, isUnavailable: false },
          { quoteRequestItemId: 2, quantity: 1, unitPrice: 20, isUnavailable: false },
        ],
      });

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(prismaMock.creditSupportRequest.findFirst).not.toHaveBeenCalled();
      const tx = prismaMock.__tx;
      expect(tx.creditSupportRequest.updateMany).toHaveBeenCalledWith({ where: { quoteRequestId: 1, isWinner: true }, data: { isWinner: false } });
      expect(tx.creditSupportRequest.update).not.toHaveBeenCalled();
      expect(tx.quoteResponse.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isWinner: true } }));
      expect(tx.quoteComparisonResult.updateMany).toHaveBeenCalledWith({
        where: { comparisonId: 999, quoteResponseId: 12, creditSupportRequestId: null },
        data: { isWinner: true },
      });
    });

    it('credito revogado/inexistente -> 409 e nada e alterado', async () => {
      const cookies = await loginAs('admin');
      mockEnv(twoDirect(), []);
      mockPending(7);
      prismaMock.creditSupportRequest.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('A oferta do parceiro mudou ou foi revogada. Refaca a comparacao.');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('credito stale (origem mudou de preco) -> 409 e nada e alterado', async () => {
      const cookies = await loginAs('admin');
      mockEnv(twoDirect(), []);
      mockPending(7);
      prismaMock.creditSupportRequest.findFirst.mockResolvedValue(cheaperPartner());
      prismaMock.quoteResponse.findFirst.mockResolvedValue(origin(12, 102, [{ id: 1, unitPrice: 11 }, { id: 2, unitPrice: 20 }]));

      const response = await request(app)
        .post('/api/v1/quote-requests/1/comparisons/999/approve')
        .set('Cookie', cookies);

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('A oferta do parceiro mudou ou foi revogada. Refaca a comparacao.');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.__tx.creditSupportRequest.update).not.toHaveBeenCalled();
    });
  });
});

// O login e' limitado por rate limit (por IP): reaproveita o cookie ja obtido por papel.
const cookieCache = new Map<string, string[]>();

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

  const cached = cookieCache.get(role);
  if (cached) {
    return cached;
  }

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  const cookies = loginResponse.headers['set-cookie'];
  if (cookies) {
    cookieCache.set(role, cookies as unknown as string[]);
  }
  return cookies;
}

describe('ComparisonCandidateService - vencedora gravada', () => {
  it('(f) persistedWinnerOf: alternativa vencedora tem identidade composta; direta => null no parceiro; nenhuma => null', async () => {
    const { persistedWinnerOf } = await import('../src/services/ComparisonCandidateService');

    expect(
      persistedWinnerOf(
        [{ id: 12, isWinner: false }],
        [{ id: 12, creditSupportRequestId: 7, isWinner: true }],
      ),
    ).toEqual({ quoteResponseId: 12, creditSupportRequestId: 7 });
    expect(
      persistedWinnerOf([{ id: 11, isWinner: false }, { id: 13, isWinner: true }], []),
    ).toEqual({ quoteResponseId: 13, creditSupportRequestId: null });
    expect(
      persistedWinnerOf([{ id: 11, isWinner: false }], [{ id: 12, creditSupportRequestId: 7, isWinner: false }]),
    ).toBeNull();
  });

  it('(g) isManualWinnerActive: creditSupportRequestId divergente => false; igual => true; audit nao manual => false', async () => {
    const { isManualWinnerActive } = await import('../src/services/ComparisonCandidateService');
    const clientWith = (latest: unknown) =>
      ({ auditLog: { findFirst: vi.fn().mockResolvedValue(latest) } }) as unknown as Parameters<typeof isManualWinnerActive>[0];
    const manual = { action: 'manual_winner', afterData: { winnerQuoteResponseId: 12, winnerCreditSupportRequestId: 7 } };

    expect(await isManualWinnerActive(clientWith(manual), 1, { quoteResponseId: 12, creditSupportRequestId: 7 })).toBe(true);
    expect(await isManualWinnerActive(clientWith(manual), 1, { quoteResponseId: 12, creditSupportRequestId: 8 })).toBe(false);
    expect(await isManualWinnerActive(clientWith(manual), 1, { quoteResponseId: 12, creditSupportRequestId: null })).toBe(false);
    expect(await isManualWinnerActive(clientWith({ action: 'compare', afterData: null }), 1, { quoteResponseId: 12, creditSupportRequestId: 7 })).toBe(false);
    expect(await isManualWinnerActive(clientWith(null), 1, { quoteResponseId: 12, creditSupportRequestId: 7 })).toBe(false);
  });
});
