import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

// PR4a (Credit Support): alternativa do parceiro na Comparacao + vencedor via parceiro, em
// Postgres real (scripts/test-critical-local.mjs). Cobre o invariante "no maximo UMA entre
// QuoteResponse.isWinner e CreditSupportRequest.isWinner" por cotacao.
const run = process.env.RUN_DB_TESTS === 'true';

describe.skipIf(!run)('Credit Support x Comparacao (DB) em Postgres isolado', () => {
  let prisma: any;
  let app: any;
  let cookies: string[] = [];
  let adminId = 0;
  let roleCreatedId: number | null = null;
  const supplierIds: number[] = [];
  const partnerIds: number[] = [];
  let quoteId = 0;
  let responseAId = 0;
  let responseBId = 0;
  const runId = `cs-cmp-${Date.now()}`;

  const tokenOf = (portalUrl: string) => new URL(portalUrl).searchParams.get('token') as string;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ app } = await import('../src/app'));

    const existing = await prisma.role.findUnique({ where: { name: 'admin' } });
    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    if (!existing) roleCreatedId = role.id;
    const user = await prisma.user.create({
      data: {
        name: `Admin ${runId}`,
        email: `${runId}@local.test`,
        passwordHash: await hashPassword('Test12345!'),
        roleId: role.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test12345!' });
    expect(login.status).toBe(200);
    cookies = login.headers['set-cookie'];

    const quote = await prisma.quoteRequest.create({
      data: {
        requestCode: `CSCMP-${runId}`,
        desiredIncoterm: ['FOB'],
        currency: 'USD',
        items: {
          create: [
            { productName: 'Item A', quantity: 5, unit: 'KG' },
            { productName: 'Item B', quantity: 3, unit: 'KG' },
          ],
        },
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    quoteId = quote.id;

    const createSupplierWithResponse = async (label: string, unitPrice: number) => {
      const supplier = await prisma.supplier.create({
        data: {
          name: `Fornecedor ${label} ${runId}`,
          country: 'CN',
          acceptedIncoterms: ['FOB'],
          contacts: { create: { name: `Contato ${label}`, email: `${runId}.${label}@local.test`, isPrimary: true } },
        },
      });
      supplierIds.push(supplier.id);
      const total = quote.items.reduce((sum: number, item: any) => sum + unitPrice * item.quantity, 0);
      const response = await prisma.quoteResponse.create({
        data: {
          quoteRequestId: quote.id,
          supplierId: supplier.id,
          offeredPrice: total.toFixed(2),
          currency: 'USD',
          exchangeRate: '5.000000',
          offeredIncoterm: 'FOB',
          paymentTermsDays: 30,
          items: {
            create: quote.items.map((item: any) => ({
              quoteRequestItemId: item.id,
              unitPrice: unitPrice.toFixed(2),
              quantity: item.quantity,
              totalPrice: (unitPrice * item.quantity).toFixed(2),
            })),
          },
        },
      });
      return response.id;
    };

    // A caro (12/un = 96), B barato (10/un = 80).
    responseAId = await createSupplierWithResponse('A', 12);
    responseBId = await createSupplierWithResponse('B', 10);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.mailLog.deleteMany({ where: { relatedEntityType: 'credit_support_request' } });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { performedById: adminId },
            { entityType: { in: ['credit_support_request', 'credit_partner'] } },
          ],
        },
      });
      await prisma.creditSupportRequest.deleteMany({ where: { quoteRequestId: quoteId } });
      await prisma.quoteRequest.deleteMany({ where: { id: quoteId } });
      await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await prisma.creditPartner.deleteMany({ where: { id: { in: partnerIds } } });
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
      if (roleCreatedId) {
        await prisma.role.deleteMany({ where: { id: roleCreatedId, users: { none: {} } } });
      }
    }
    await prisma?.$disconnect();
  });

  it('alternativa via parceiro vence a comparacao, PO ao fornecedor fica bloqueada, manual/reopen limpam as flags', async () => {
    const weights = { priceWeight: 100, paymentTermsWeight: 0, incotermWeight: 0, qualityWeight: 0 };
    const listUrl = `/api/v1/quote-requests/${quoteId}/credit-support`;

    // 0) Sem alternativa: B (barata) vence direto.
    const first = await request(app).post(`/api/v1/quote-requests/${quoteId}/compare`).set('Cookie', cookies).send(weights);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.candidateCount).toBe(2);
    expect((await prisma.quoteResponse.findUnique({ where: { id: responseBId } })).isWinner).toBe(true);

    // 1) Parceiro + encaminhamento de A + resposta do parceiro com preco < B (9/un = 72).
    const partnerRes = await request(app)
      .post('/api/v1/credit-partners')
      .set('Cookie', cookies)
      .send({ name: `Banco ${runId}`, contacts: [{ name: 'Ana', email: `ana.${runId}@banco.test` }] });
    expect(partnerRes.status, JSON.stringify(partnerRes.body)).toBe(201);
    partnerIds.push(partnerRes.body.id);

    const forward = await request(app)
      .post(`/api/v1/quote-responses/${responseAId}/credit-support`)
      .set('Cookie', cookies)
      .send({ creditPartnerId: partnerRes.body.id, contactIds: [partnerRes.body.contacts[0].id] });
    expect(forward.status, JSON.stringify(forward.body)).toBe(201);
    const creditId: number = forward.body.id;
    const token = tokenOf(forward.body.portalUrl);

    const quoteItems = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: quoteId }, orderBy: { id: 'asc' } });
    const submit = await request(app)
      .post(`/api/credit-portal/${token}/respond`)
      .send({
        paymentTermsDays: 90,
        validityDays: 30,
        items: quoteItems.map((item: any) => ({ quoteRequestItemId: item.id, unitPrice: 9 })),
      });
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);

    // 2) Preview: 3 candidatos, a alternativa e a vencedora.
    const preview = await request(app)
      .post(`/api/v1/quote-requests/${quoteId}/compare/preview`)
      .set('Cookie', cookies)
      .send(weights);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.candidateCount).toBe(3);
    expect(preview.body.winnerQuoteResponseId).toBe(responseAId);
    expect(preview.body.winnerCreditSupportRequestId).toBe(creditId);
    const viaPartner = preview.body.results.find((r: any) => r.creditSupportRequestId === creditId);
    expect(viaPartner).toMatchObject({
      quoteResponseId: responseAId,
      offeredPrice: 72,
      paymentTermsDays: 90,
      currency: 'USD',
      isWinner: true,
      creditPartner: { id: partnerRes.body.id },
      partnerContact: { email: `ana.${runId}@banco.test` },
      validityExpired: false,
    });

    // 3) Compare: flags e persistencia.
    const compare = await request(app).post(`/api/v1/quote-requests/${quoteId}/compare`).set('Cookie', cookies).send(weights);
    expect(compare.status, JSON.stringify(compare.body)).toBe(200);
    expect(compare.body.candidateCount).toBe(3);
    const credit = await prisma.creditSupportRequest.findUnique({ where: { id: creditId } });
    expect(credit.isWinner).toBe(true);
    const [respA, respB] = await Promise.all([
      prisma.quoteResponse.findUnique({ where: { id: responseAId } }),
      prisma.quoteResponse.findUnique({ where: { id: responseBId } }),
    ]);
    expect(respA.isWinner).toBe(false);
    expect(respB.isWinner).toBe(false);
    const comparison = await prisma.quoteComparison.findUnique({
      where: { id: compare.body.comparisonId },
      include: { results: { orderBy: { id: 'asc' } } },
    });
    expect(comparison.winnerQuoteResponseId).toBe(responseAId);
    expect(comparison.winnerCreditSupportRequestId).toBe(creditId);
    expect(comparison.results).toHaveLength(3);
    const winnerRows = comparison.results.filter((r: any) => r.isWinner);
    expect(winnerRows).toHaveLength(1);
    expect(winnerRows[0]).toMatchObject({ quoteResponseId: responseAId, creditSupportRequestId: creditId });
    expect(comparison.results.filter((r: any) => r.creditSupportRequestId === null)).toHaveLength(2);

    // Historico (aditivo): a linha via parceiro traz o parceiro.
    const history = await request(app).get(`/api/v1/quote-requests/${quoteId}/comparisons`).set('Cookie', cookies);
    expect(history.status).toBe(200);
    const latest = history.body.comparisons.find((c: any) => c.id === compare.body.comparisonId);
    expect(latest.winnerCreditSupportRequestId).toBe(creditId);
    const historyRow = latest.results.find((r: any) => r.creditSupportRequestId === creditId);
    expect(historyRow.creditSupportRequest).toEqual({ id: creditId, creditPartner: { id: partnerRes.body.id, name: `Banco ${runId}` } });

    // 4) PO ao fornecedor de origem: bloqueada (nao e a vencedora direta).
    const po = await request(app)
      .post(`/api/v1/quote-responses/${responseAId}/purchase-order`)
      .set('Cookie', cookies)
      .send({ fileName: 'po.pdf', contentBase64: 'JVBERi0xLjQK', fileType: 'application/pdf', fileSize: 12 });
    expect(po.status).toBe(400);
    expect(po.body.message).toMatch(/vencedor/);

    // 5) Painel: isWinner exposto.
    const list = await request(app).get(listUrl).set('Cookie', cookies);
    expect(list.status).toBe(200);
    expect(list.body.find((row: any) => row.id === creditId)).toMatchObject({ isWinner: true, status: 'responded', isStale: false });

    // 6) Manual: B direto (motivo obrigatorio porque a chave composta muda) -> flags trocam.
    const semMotivo = await request(app)
      .post(`/api/v1/quote-requests/${quoteId}/winner`)
      .set('Cookie', cookies)
      .send({ quoteResponseId: responseBId });
    expect(semMotivo.status).toBe(400);
    const manual = await request(app)
      .post(`/api/v1/quote-requests/${quoteId}/winner`)
      .set('Cookie', cookies)
      .send({ quoteResponseId: responseBId, reason: 'Compra direta.' });
    expect(manual.status, JSON.stringify(manual.body)).toBe(200);
    expect(manual.body).toEqual({ winnerQuoteResponseId: responseBId, winnerCreditSupportRequestId: null, comparisonId: compare.body.comparisonId });
    expect((await prisma.creditSupportRequest.findUnique({ where: { id: creditId } })).isWinner).toBe(false);
    expect((await prisma.quoteResponse.findUnique({ where: { id: responseBId } })).isWinner).toBe(true);
    expect((await prisma.quoteResponse.findUnique({ where: { id: responseAId } })).isWinner).toBe(false);
    const afterManual = await prisma.quoteComparison.findUnique({ where: { id: compare.body.comparisonId } });
    expect(afterManual.winnerQuoteResponseId).toBe(responseBId);
    expect(afterManual.winnerCreditSupportRequestId).toBeNull();

    // 7) Manual de volta para a alternativa (com motivo) -> so a alternativa fica true.
    const manualCredit = await request(app)
      .post(`/api/v1/quote-requests/${quoteId}/winner`)
      .set('Cookie', cookies)
      .send({ quoteResponseId: responseAId, creditSupportRequestId: creditId, reason: 'Prazo do parceiro.' });
    expect(manualCredit.status, JSON.stringify(manualCredit.body)).toBe(200);
    expect(manualCredit.body.winnerCreditSupportRequestId).toBe(creditId);
    expect((await prisma.creditSupportRequest.findUnique({ where: { id: creditId } })).isWinner).toBe(true);
    expect((await prisma.quoteResponse.findUnique({ where: { id: responseBId } })).isWinner).toBe(false);
    expect((await prisma.quoteResponse.findUnique({ where: { id: responseAId } })).isWinner).toBe(false);

    // 8) Reopen: tudo false.
    await prisma.quoteRequest.update({ where: { id: quoteId }, data: { status: 'closed', closedAt: new Date() } });
    const reopen = await request(app).post(`/api/v1/quote-requests/${quoteId}/reopen`).set('Cookie', cookies);
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(200);
    expect((await prisma.creditSupportRequest.findUnique({ where: { id: creditId } })).isWinner).toBe(false);
    expect((await prisma.quoteResponse.count({ where: { quoteRequestId: quoteId, isWinner: true } }))).toBe(0);
    const listAfter = await request(app).get(listUrl).set('Cookie', cookies);
    expect(listAfter.body.find((row: any) => row.id === creditId).isWinner).toBe(false);

    // 9) Revogar o encaminhamento vencedor zera a flag e ele some da comparacao.
    const manualAgain = await request(app)
      .post(`/api/v1/quote-requests/${quoteId}/winner`)
      .set('Cookie', cookies)
      .send({ quoteResponseId: responseAId, creditSupportRequestId: creditId, reason: 'Teste.' });
    expect(manualAgain.status).toBe(200);
    const revoke = await request(app).post(`/api/v1/credit-support-requests/${creditId}/revoke`).set('Cookie', cookies);
    expect(revoke.status).toBe(200);
    expect((await prisma.creditSupportRequest.findUnique({ where: { id: creditId } })).isWinner).toBe(false);
    const previewAfter = await request(app)
      .post(`/api/v1/quote-requests/${quoteId}/compare/preview`)
      .set('Cookie', cookies)
      .send(weights);
    expect(previewAfter.body.candidateCount).toBe(2);
    expect(previewAfter.body.excluded).toEqual([]);
    expect(previewAfter.body.winnerQuoteResponseId).toBe(responseBId);
  });
});
