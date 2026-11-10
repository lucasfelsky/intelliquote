import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastCotacaoVinculoService } from '../src/services/ForecastCotacaoVinculoService';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const runId = `ff${Date.now()}`;

// Ganchos de FECHAMENTO e PO enviada (E4b) no banco real. Tudo SINTETICO (repo publico). Data longe do dado real e dos demais
// testes de forecast.
const BASE_DATE = '2036-09-15';
const rotulos = rotulosDaQuinzena(BASE_DATE);
const U = runId.toUpperCase();
const FONTE_1 = `FONTE ${U} UM`;
const FONTE_2 = `FONTE ${U} DOIS`;
const NAME_A = `PRODUTO ${U} A`; // fonte 1
const NAME_B = `PRODUTO ${U} B`; // fonte 1
const NAME_C = `PRODUTO ${U} C`; // fonte 2

const produto = (linha: number, item: string, codigo: string, fonte: string, id: number) => ({
  linha,
  n: linha - 2,
  item,
  codigos: [codigo, '', '', '', '', '', ''],
  historico: [10, 20, 30, 40, 50],
  analiseForecast: null,
  obs: '',
  fonte,
  precoFechado: '',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
  productId: id,
});

describe('Forecast - fechamento e PO enviada (E4b, DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let snapshotId = 0;
  let supplier1 = 0;
  let supplier2 = 0;
  const ids: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 };
  const catalogo: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 };

  const postar = (body: object) =>
    request(app).post(`/api/v1/forecast/snapshots/${snapshotId}/cotacoes`).set('Cookie', cookies).send(body);
  const listar = () => request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/decisoes`).set('Cookie', cookies);
  const fechar = (id: number) => request(app).post(`/api/v1/quote-requests/${id}/close`).set('Cookie', cookies).send({});
  const reabrir = (id: number) => request(app).post(`/api/v1/quote-requests/${id}/reopen`).set('Cookie', cookies).send({});
  const enviarPo = (responseId: number) =>
    request(app)
      .post(`/api/v1/quote-responses/${responseId}/purchase-order`)
      .set('Cookie', cookies)
      .send({ fileName: 'po.pdf', contentBase64: Buffer.from('%PDF-1.4 sintetico').toString('base64'), fileType: 'application/pdf', fileSize: 18 });
  const decisao = (productId: number) =>
    prisma.forecastPurchaseDecision.findUnique({ where: { snapshotId_productId: { snapshotId, productId } } });
  const definirStatus = (productId: number, status: string) =>
    prisma.forecastPurchaseDecision.update({
      where: { snapshotId_productId: { snapshotId, productId } },
      data: { status },
    });
  const logsVia = async (via: string) =>
    (await prisma.auditLog.findMany({ where: { entityType: 'forecast_purchase_decision', performedById: adminId }, orderBy: { id: 'asc' } })).filter(
      (l) => (l.metadata as { via?: string } | null)?.via === via,
    );

  // Cria a cotacao (A 1000 kg e B 500 kg, fonte 1) pelo endpoint de lote; devolve ids da cotacao e dos itens.
  const cotacaoAB = async () => {
    const res = await postar({
      itens: [
        { productId: ids.A, quantidadeKg: 1000 },
        { productId: ids.B, quantidadeKg: 500 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.cotacoes[0].id as number;
    const itens = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: id } });
    const itemDe = (productId: number) => itens.find((i) => i.forecastProductId === productId)!.id;
    return { id, itemA: itemDe(ids.A), itemB: itemDe(ids.B) };
  };
  const resposta = async (quoteRequestId: number, supplierId: number, isWinner: boolean, itens: Array<{ item: number; quantity: number; unavailable?: boolean }>) =>
    prisma.quoteResponse.create({
      data: {
        quoteRequestId,
        supplierId,
        offeredPrice: 10,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
        isWinner,
        items: {
          create: itens.map((i) => ({
            quoteRequestItemId: i.item,
            unitPrice: i.unavailable ? 0 : 10,
            quantity: i.unavailable ? 0 : i.quantity,
            totalPrice: i.unavailable ? 0 : 10 * i.quantity,
            isUnavailable: i.unavailable === true,
          })),
        },
      },
    });

  const limpar = async () => {
    vi.restoreAllMocks();
    await prisma.quoteRequest.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { snapshotId } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
  };
  afterEach(async () => {
    if (process.env.RUN_DB_TESTS === 'true') await limpar();
  });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Fechamento ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'] as unknown as string[];

    for (const fonte of [FONTE_1, FONTE_2]) {
      await prisma.forecastSource.create({ data: { name: fonte, normalizedName: fonte, leadTimeDays: 30 } });
    }
    const item = async (nome: string) =>
      (await prisma.catalogItem.create({ data: { commercialName: `CAT ${U} ${nome}`, marketName: `CAT ${U} ${nome}` } })).id;
    catalogo.A = await item('A');
    catalogo.B = await item('B');
    catalogo.C = await item('C');
    const criar = async (name: string, code: string, catalogItemId: number) =>
      (
        await prisma.forecastProduct.create({
          data: {
            name,
            normalizedName: normalizeProductName(name),
            codes: { create: [{ position: 1, code, catalogItemId, packagingIsPrimary: true }] },
          },
        })
      ).id;
    ids.A = await criar(NAME_A, `${U}A1`, catalogo.A);
    ids.B = await criar(NAME_B, `${U}B1`, catalogo.B);
    ids.C = await criar(NAME_C, `${U}C1`, catalogo.C);

    const contato = { create: [{ name: 'Contato Sintetico', email: `contato.${runId}@exemplo.test`, isPrimary: true }] };
    supplier1 = (await prisma.supplier.create({ data: { name: `Fornecedor ${U} 1`, contacts: contato } })).id;
    supplier2 = (await prisma.supplier.create({ data: { name: `Fornecedor ${U} 2`, contacts: contato } })).id;

    snapshotId = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '09-2',
          baseDate: dateKeyToDbDate(BASE_DATE),
          half: 2,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: [
            produto(3, NAME_A, `${U}A1`, FONTE_1, ids.A),
            produto(4, NAME_B, `${U}B1`, FONTE_1, ids.B),
            produto(5, NAME_C, `${U}C1`, FONTE_2, ids.C),
          ],
          inputs: {
            estoque: [],
            vendasMes: ['A1', 'B1', 'C1'].map((c) => ({ codigo: `${U}${c}`, qtd: 400 })),
            vendasAtual: ['A1', 'B1', 'C1'].map((c) => ({ codigo: `${U}${c}`, qtd: 200 })),
            vendasAnual: ['A1', 'B1', 'C1'].map((c) => ({ codigo: `${U}${c}`, qtd: 4800 })),
            programacoes: [],
            chegadas: [],
            leadtime: [
              { fonte: FONTE_1, total: 30 },
              { fonte: FONTE_2, total: 30 },
            ],
            margem: [],
            clientesAtivos: [],
          },
          files: [],
          createdById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.quoteRequest.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { product: { name: { contains: U } } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.catalogItem.deleteMany({ where: { marketName: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.supplier.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('fechamento congela a quantidade da resposta vencedora; item indisponivel cai na cotada; confirma o status', async () => {
    const q = await cotacaoAB();
    await resposta(q.id, supplier1, true, [{ item: q.itemA, quantity: 800 }, { item: q.itemB, quantity: 0, unavailable: true }]);
    // Resposta NAO vencedora com quantidades diferentes: nao pode influenciar a Qtd. final.
    await resposta(q.id, supplier2, false, [{ item: q.itemA, quantity: 999 }, { item: q.itemB, quantity: 499 }]);

    const res = await fechar(q.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const a = await decisao(ids.A);
    expect(Number(a?.finalKg)).toBe(800); // vencedora
    expect(a?.finalQuoteRequestId).toBe(q.id);
    expect(a?.finalAt).toBeInstanceOf(Date);
    expect(a?.status).toBe('confirmado');
    expect(Number(a?.quantityKg)).toBe(1000); // a decisao em si nao muda
    const b = await decisao(ids.B);
    expect(Number(b?.finalKg)).toBe(500); // sem vencedor para o item (indisponivel): quantidade cotada
    expect(b?.status).toBe('confirmado');

    // AuditLog: ids, kg, origem e status; nunca texto livre.
    const logs = await logsVia('fechamento-cotacao');
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.entityId === String(a?.id))?.metadata).toMatchObject({
      quoteRequestId: q.id,
      finalKg: 800,
      origemQuantidade: 'vencedora',
      status: 'confirmado',
      antes: { finalKg: null, finalQuoteRequestId: null, status: 'nao' },
    });
    expect(logs.find((l) => l.entityId === String(b?.id))?.metadata).toMatchObject({ finalKg: 500, origemQuantidade: 'cotada' });
  });

  testDbSkip('sem nenhum vencedor mantem a cotada (nao zera nem apaga a Qtd. final do envio)', async () => {
    const q = await cotacaoAB();
    // Qtd. final do envio (E4a) ja gravada: 1000 / 500.
    await prisma.dispatchEvent.create({ data: { quoteRequestId: q.id, createdById: adminId, recipientsCount: 1, subject: 'S', status: 'completed' } });
    await ForecastCotacaoVinculoService.registrarEnvio(q.id, adminId);
    expect(Number((await decisao(ids.A))?.finalKg)).toBe(1000);

    expect((await fechar(q.id)).status).toBe(200);
    expect(Number((await decisao(ids.A))?.finalKg)).toBe(1000);
    expect(Number((await decisao(ids.B))?.finalKg)).toBe(500);
    expect((await decisao(ids.A))?.status).toBe('confirmado');
  });

  testDbSkip('item de outra cotacao (nao vinculado) nao e afetado; cotacao sem vinculo ao Forecast e ignorada', async () => {
    const q = await cotacaoAB();
    const outra = await postar({ itens: [{ productId: ids.C, quantidadeKg: 200 }] });
    expect(outra.status).toBe(201);
    const antes = await decisao(ids.C);

    const comum = await prisma.quoteRequest.create({ data: { requestCode: `QR-COMUM-${U}`, desiredIncoterm: ['FOB'], createdById: adminId } });
    await prisma.quoteRequestItem.create({ data: { quoteRequestId: comum.id, catalogItemId: catalogo.A, productName: 'X', quantity: 5, unit: 'KG' } });
    expect(await ForecastCotacaoVinculoService.registrarFechamento(comum.id, adminId)).toEqual({ atualizadas: 0 });
    expect(await ForecastCotacaoVinculoService.registrarPoEnviada(comum.id, adminId)).toEqual({ atualizadas: 0 });

    expect((await fechar(q.id)).status).toBe(200);
    const depois = await decisao(ids.C);
    expect(depois?.status).toBe(antes?.status);
    expect(depois?.finalKg).toBeNull();
    expect(depois?.finalQuoteRequestId).toBeNull();
    expect(depois?.updatedAt.toISOString()).toBe(antes?.updatedAt.toISOString());
  });

  testDbSkip('status nao regride: po e preco sobrevivem ao fechamento; confirmado sobe de cotando', async () => {
    const q = await cotacaoAB();
    await resposta(q.id, supplier1, true, [{ item: q.itemA, quantity: 800 }, { item: q.itemB, quantity: 450 }]);
    await definirStatus(ids.A, 'po');
    await definirStatus(ids.B, 'preco');
    expect((await fechar(q.id)).status).toBe(200);
    const a = await decisao(ids.A);
    const b = await decisao(ids.B);
    expect(a?.status).toBe('po');
    expect(b?.status).toBe('preco');
    // A quantidade congela mesmo assim.
    expect(Number(a?.finalKg)).toBe(800);
    expect(Number(b?.finalKg)).toBe(450);
  });

  testDbSkip('refechamento recalcula e sobrescreve sem duplicar decisao (idempotente), e a Qtd. final volta a cotada sem vencedor', async () => {
    const q = await cotacaoAB();
    const r1 = await resposta(q.id, supplier1, true, [{ item: q.itemA, quantity: 800 }, { item: q.itemB, quantity: 450 }]);
    const r2 = await resposta(q.id, supplier2, false, [{ item: q.itemA, quantity: 950 }, { item: q.itemB, quantity: 480 }]);
    expect((await fechar(q.id)).status).toBe(200);
    const primeira = await decisao(ids.A);
    expect(Number(primeira?.finalKg)).toBe(800);

    // Reabre (limpa os vencedores) e fecha de novo com OUTRO vencedor.
    expect((await reabrir(q.id)).status).toBe(200);
    await prisma.quoteResponse.update({ where: { id: r2.id }, data: { isWinner: true } });
    expect((await fechar(q.id)).status).toBe(200);
    const segunda = await decisao(ids.A);
    expect(Number(segunda?.finalKg)).toBe(950);
    expect(Number((await decisao(ids.B))?.finalKg)).toBe(480);
    expect(segunda?.finalAt!.getTime()).toBeGreaterThanOrEqual(primeira!.finalAt!.getTime());
    expect(await prisma.forecastPurchaseDecision.count({ where: { snapshotId, productId: ids.A } })).toBe(1);
    // O historico fica no AuditLog (2 fechamentos por item; o "antes" do 2o traz a quantidade do 1o).
    const logsA = (await logsVia('fechamento-cotacao')).filter((l) => l.entityId === String(segunda?.id));
    expect(logsA).toHaveLength(2);
    expect(logsA[1].metadata).toMatchObject({ finalKg: 950, antes: { finalKg: 800, status: 'confirmado' } });

    // Reabre e fecha SEM vencedor: recalcula para a quantidade cotada (nao fica a do vencedor anterior).
    expect((await reabrir(q.id)).status).toBe(200);
    expect((await fechar(q.id)).status).toBe(200);
    expect(Number((await decisao(ids.A))?.finalKg)).toBe(1000);
    expect(await prisma.quoteResponse.count({ where: { id: { in: [r1.id, r2.id] }, isWinner: true } })).toBe(0);
  });

  testDbSkip('alternativa via parceiro vencedora: vale a resposta de origem; cotacao mais nova dona do item nao e sobrescrita', async () => {
    const q = await cotacaoAB();
    const r1 = await resposta(q.id, supplier1, false, [{ item: q.itemA, quantity: 700 }, { item: q.itemB, quantity: 400 }]);
    const parceiro = await prisma.creditPartner.create({ data: { name: `Parceiro ${U}` } });
    await prisma.creditSupportRequest.create({
      data: {
        quoteRequestId: q.id,
        quoteResponseId: r1.id,
        supplierId: supplier1,
        creditPartnerId: parceiro.id,
        emailSubject: 'S',
        tokenHash: `hash-${runId}`,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        sourceResponseVersion: 1,
        currency: 'USD',
        offeredIncoterm: 'FOB',
        originalPaymentTermsDays: 30,
        originalTotalPrice: 1000,
        createdById: adminId,
        isWinner: true,
      },
    });
    expect((await fechar(q.id)).status).toBe(200);
    expect(Number((await decisao(ids.A))?.finalKg)).toBe(700);
    expect(Number((await decisao(ids.B))?.finalKg)).toBe(400);
    await prisma.creditSupportRequest.deleteMany({ where: { quoteRequestId: q.id } });
    await prisma.creditPartner.delete({ where: { id: parceiro.id } });

    // Outra cotacao MAIS NOVA (id maior) assume a Qtd. final de A: reabrir/fechar a antiga nao a sobrescreve.
    await reabrir(q.id);
    await prisma.forecastPurchaseDecision.update({
      where: { snapshotId_productId: { snapshotId, productId: ids.A } },
      data: { finalKg: 123, finalQuoteRequestId: q.id + 1000 },
    });
    expect((await fechar(q.id)).status).toBe(200);
    const a = await decisao(ids.A);
    expect(Number(a?.finalKg)).toBe(123);
    expect(a?.finalQuoteRequestId).toBe(q.id + 1000);
    expect(Number((await decisao(ids.B))?.finalKg)).toBe(500); // B segue da cotacao antiga (sem vencedor agora: cotada)
  });

  testDbSkip('PO enviada: so o item coberto pela proposta vai a po; idempotente; nao regride preco; nao muda a quantidade', async () => {
    const q = await cotacaoAB();
    const r1 = await resposta(q.id, supplier1, true, [{ item: q.itemA, quantity: 800 }, { item: q.itemB, quantity: 0, unavailable: true }]);
    expect((await fechar(q.id)).status).toBe(200);
    const antes = await decisao(ids.A);

    const res = await enviarPo(r1.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const a = await decisao(ids.A);
    expect(a?.status).toBe('po');
    expect(Number(a?.finalKg)).toBe(800); // quantidade intacta
    expect(a?.finalAt?.toISOString()).toBe(antes?.finalAt?.toISOString());
    expect((await decisao(ids.B))?.status).toBe('confirmado'); // item nao coberto pela proposta nao vai a po
    expect((await prisma.quoteRequest.findUnique({ where: { id: q.id } }))?.purchaseOrderSentAt).toBeInstanceOf(Date);

    // Idempotente: segunda chamada nao grava nem audita de novo.
    expect(await ForecastCotacaoVinculoService.registrarPoEnviada(q.id, adminId, r1.id)).toEqual({ atualizadas: 0 });
    const logs = await logsVia('po-enviada');
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toMatchObject({ quoteRequestId: q.id, status: 'po', antes: { status: 'confirmado' } });

    // Sem proposta informada valem todos os itens vinculados; preco nao regride.
    await definirStatus(ids.B, 'preco');
    expect(await ForecastCotacaoVinculoService.registrarPoEnviada(q.id, adminId)).toEqual({ atualizadas: 0 });
    expect((await decisao(ids.B))?.status).toBe('preco');
  });

  testDbSkip('falha do gancho nao derruba o fechamento nem o envio da PO', async () => {
    const q = await cotacaoAB();
    const r1 = await resposta(q.id, supplier1, true, [{ item: q.itemA, quantity: 800 }, { item: q.itemB, quantity: 450 }]);
    vi.spyOn(ForecastCotacaoVinculoService, 'registrarFechamento').mockRejectedValue(new Error('banco fora'));
    vi.spyOn(ForecastCotacaoVinculoService, 'registrarPoEnviada').mockRejectedValue(new Error('banco fora'));

    const fechamento = await fechar(q.id);
    expect(fechamento.status, JSON.stringify(fechamento.body)).toBe(200);
    expect((await prisma.quoteRequest.findUnique({ where: { id: q.id } }))?.status).toBe('closed');
    expect((await decisao(ids.A))?.finalKg).toBeNull();

    const po = await enviarPo(r1.id);
    expect(po.status, JSON.stringify(po.body)).toBe(200);
    expect((await prisma.quoteRequest.findUnique({ where: { id: q.id } }))?.purchaseOrderSentAt).toBeInstanceOf(Date);
  });

  testDbSkip('leitura: statusDerivado reflete cotacao fechada (confirmado) e PO enviada (po) a partir do vinculo', async () => {
    const q = await cotacaoAB();
    const derivado = async (productId: number) => {
      const lista = await listar();
      return (lista.body.data.decisoes as Array<Record<string, unknown>>).find((d) => d.productId === productId);
    };
    // Cotacao criada (aberta, nao enviada).
    expect(await derivado(ids.A)).toMatchObject({ statusDerivado: 'cotacao_criada', cotacao: { id: q.id, statusCotacao: 'criada' } });

    // Fechada SEM gancho (ex.: cotacao fechada antes da E4b): o status salvo e 'nao', a leitura mostra 'confirmado'.
    await prisma.quoteRequest.update({ where: { id: q.id }, data: { status: 'closed', closedAt: new Date() } });
    expect(await derivado(ids.A)).toMatchObject({ status: 'nao', statusDerivado: 'confirmado', cotacao: { statusCotacao: 'fechada' } });

    // PO enviada: 'po'; preco salvo nao regride.
    await definirStatus(ids.B, 'preco');
    await prisma.quoteRequest.update({ where: { id: q.id }, data: { purchaseOrderSentAt: new Date() } });
    expect(await derivado(ids.A)).toMatchObject({ statusDerivado: 'po', cotacao: { statusCotacao: 'po_enviada' } });
    expect(await derivado(ids.B)).toMatchObject({ status: 'preco', statusDerivado: 'preco' });

    // Sem cotacao vinculada vale o status congelado/salvo.
    await prisma.quoteRequest.delete({ where: { id: q.id } });
    expect(await derivado(ids.A)).toMatchObject({ status: 'nao', statusDerivado: 'nao', cotacao: null });
  });
});
