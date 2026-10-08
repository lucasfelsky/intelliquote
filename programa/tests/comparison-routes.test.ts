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
  const requestedItems = [1, 2].map((id) => ({ id, quantity: 1 }));

  const proposal = (
    id: number,
    supplierId: number,
    items: Array<{ id: number; unitPrice: number; unavailable?: boolean }>,
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
        quantity: item.unavailable ? 0 : 1,
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
      'Sao necessarias pelo menos duas propostas completas para comparar (1 com item temporariamente indisponivel ficaram fora do ranking).',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  it('proposta parcial SEM flag continua dando o 400 de sempre (preview e compare)', async () => {
    const cookies = await loginAs('comprador');
    const partial = complete(11, 101, [10, 20]);
    partial.items = partial.items.slice(0, 1);
    mockEnv([partial, complete(12, 102, [10, 20])]);

    for (const suffix of ['/compare/preview', '/compare']) {
      const response = await request(app)
        .post(`/api/v1/quote-requests/1${suffix}`)
        .set('Cookie', cookies)
        .send(weights);
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('todos os itens');
    }
    expect(prismaMock.__tx.quoteComparison.create).not.toHaveBeenCalled();
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
      mockPendingComparison();
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        items: [{ isUnavailable: false }, { isUnavailable: true }],
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
      mockPendingComparison();
      prismaMock.quoteResponse.findFirst.mockResolvedValue({
        items: [{ isUnavailable: false }, { isUnavailable: false }],
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
