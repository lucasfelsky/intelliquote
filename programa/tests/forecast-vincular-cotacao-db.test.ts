import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastCotacaoVinculoService } from '../src/services/ForecastCotacaoVinculoService';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const runId = `fv${Date.now()}`;

// Vincular cotacao EXISTENTE a um item do Forecast (PR2) no banco real. Tudo SINTETICO (repo publico). Data longe do dado
// real e dos demais testes de forecast.
const BASE_DATE = '2036-09-15';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const U = runId.toUpperCase();
const FONTE_1 = `FONTE ${U} UM`;
const FONTE_2 = `FONTE ${U} DOIS`;
const NAME_A = `PRODUTO ${U} A`; // fonte 1, na lista, 2 codigos/embalagens (A1 e A2), ambos vinculados ao catalogo
const NAME_B = `PRODUTO ${U} B`; // fonte 2, na lista

const produto = (linha: number, item: string, codigos: string[], fonte: string, id: number) => ({
  linha,
  n: linha - 2,
  item,
  codigos: [...codigos, ...Array(7 - codigos.length).fill('')],
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

describe('Forecast - vincular cotacao existente a um item (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let snapshotId = 0;
  let snapshot2Id = 0;
  let contador = 0;
  const ids: Record<'A' | 'B', number> = { A: 0, B: 0 };
  const catalogo: Record<'A1' | 'A2' | 'B', number> = { A1: 0, A2: 0, B: 0 };

  const url = (rota: 'cotacoes-abertas' | 'vinculo-cotacao', productId: number, snapshot = snapshotId) =>
    `/api/v1/forecast/snapshots/${snapshot}/${rota}/${productId}`;
  const listarAbertas = (productId: number, snapshot = snapshotId) =>
    request(app).get(url('cotacoes-abertas', productId, snapshot)).set('Cookie', cookies);
  const vincular = (productId: number, body: object, snapshot = snapshotId) =>
    request(app).put(url('vinculo-cotacao', productId, snapshot)).set('Cookie', cookies).send(body);
  const desvincular = (productId: number, snapshot = snapshotId) =>
    request(app).delete(url('vinculo-cotacao', productId, snapshot)).set('Cookie', cookies);
  const listarDecisoes = (snapshot = snapshotId) =>
    request(app).get(`/api/v1/forecast/snapshots/${snapshot}/decisoes`).set('Cookie', cookies);
  const lote = (productId: number, quantidadeKg: number) =>
    request(app)
      .post(`/api/v1/forecast/snapshots/${snapshotId}/cotacoes`)
      .set('Cookie', cookies)
      .send({ itens: [{ productId, quantidadeKg }] });
  const decisao = (productId: number, snapshot = snapshotId) =>
    prisma.forecastPurchaseDecision.findUnique({ where: { snapshotId_productId: { snapshotId: snapshot, productId } } });
  const itensDe = (quoteRequestId: number) =>
    prisma.quoteRequestItem.findMany({ where: { quoteRequestId }, orderBy: { id: 'asc' } });
  const logs = (entityType: string) =>
    prisma.auditLog.findMany({ where: { entityType, performedById: adminId }, orderBy: { id: 'asc' } });

  // Cotacao sintetica (sem Forecast): um item por entrada de `itens` (catalogo, quantidade, unidade).
  const cotacao = async (
    itens: Array<{ catalogItemId: number; quantity: number; unit?: string; vinculo?: { snapshotId: number; productId: number } }>,
    opcoes: { status?: 'open' | 'closed'; enviada?: boolean; excluida?: boolean } = {},
  ) => {
    contador += 1;
    const q = await prisma.quoteRequest.create({
      data: {
        requestCode: `QR-${U}-${contador}`,
        desiredIncoterm: ['FOB'],
        status: opcoes.status ?? 'open',
        deletedAt: opcoes.excluida ? new Date() : null,
        createdById: adminId,
        items: {
          create: itens.map((i) => ({
            catalogItemId: i.catalogItemId,
            productName: `ITEM ${U}`,
            quantity: i.quantity,
            unit: i.unit ?? 'KG',
            forecastSnapshotId: i.vinculo?.snapshotId ?? null,
            forecastProductId: i.vinculo?.productId ?? null,
          })),
        },
      },
    });
    if (opcoes.enviada) await enviar(q.id);
    return q;
  };
  const enviar = (quoteRequestId: number) =>
    prisma.dispatchEvent.create({
      data: { quoteRequestId, createdById: adminId, recipientsCount: 1, subject: 'S', status: 'completed' },
    });

  const limpar = async () => {
    vi.restoreAllMocks();
    await prisma.quoteRequest.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { snapshotId: { in: [snapshotId, snapshot2Id] } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
  };

  const criarQuinzena = async (label: string) =>
    (
      await prisma.forecastSnapshot.create({
        data: {
          label,
          baseDate: dateKeyToDbDate(BASE_DATE),
          half: 2,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: [
            produto(3, NAME_A, [`${U}A1`, `${U}A2`], FONTE_1, ids.A),
            produto(4, NAME_B, [`${U}B1`], FONTE_2, ids.B),
          ],
          inputs: {
            estoque: [],
            vendasMes: ['A1', 'B1'].map((c) => ({ codigo: `${U}${c}`, qtd: 400 })),
            vendasAtual: ['A1', 'B1'].map((c) => ({ codigo: `${U}${c}`, qtd: 200 })),
            vendasAnual: ['A1', 'B1'].map((c) => ({ codigo: `${U}${c}`, qtd: 4800 })),
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

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Vinculo ${runId}`,
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
    catalogo.A1 = await item('A1');
    catalogo.A2 = await item('A2');
    catalogo.B = await item('B');

    const criar = async (name: string, codes: Array<{ code: string; catalogItemId: number; principal?: boolean }>) =>
      (
        await prisma.forecastProduct.create({
          data: {
            name,
            normalizedName: normalizeProductName(name),
            codes: {
              create: codes.map((c, i) => ({
                position: i + 1,
                code: c.code,
                catalogItemId: c.catalogItemId,
                packagingIsPrimary: c.principal === true,
              })),
            },
          },
        })
      ).id;
    ids.A = await criar(NAME_A, [
      { code: `${U}A1`, catalogItemId: catalogo.A1 },
      { code: `${U}A2`, catalogItemId: catalogo.A2, principal: true },
    ]);
    ids.B = await criar(NAME_B, [{ code: `${U}B1`, catalogItemId: catalogo.B }]);
    snapshotId = await criarQuinzena('09-2');
    snapshot2Id = await criarQuinzena('09-1');
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // Cotacoes (itens, envios e respostas em cascata) e decisoes saem ANTES das quinzenas e dos produtos (FKs Restrict).
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

  testDbSkip('vincula cotacao aberta nao enviada: itens ligados, decisao criada com a quantidade cotada e AuditLog', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 1000 }]);
    const res = await vincular(ids.A, { quoteRequestId: q.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      acao: 'vincular',
      quoteRequestId: q.id,
      requestCode: q.requestCode,
      itensVinculados: 1,
      movidosDeOutraQuinzena: 0,
      decisao: { productId: ids.A, quantidadeKg: 1000, status: 'nao' },
    });
    const [item] = await itensDe(q.id);
    expect(item).toMatchObject({ forecastSnapshotId: snapshotId, forecastProductId: ids.A });
    const dec = await decisao(ids.A);
    expect(Number(dec?.quantityKg)).toBe(1000);
    expect(dec?.finalKg).toBeNull();

    const lista = await listarDecisoes();
    const d = (lista.body.data.decisoes as Array<{ productId: number }>).find((x) => x.productId === ids.A);
    expect(d).toMatchObject({ cotacao: { id: q.id, statusCotacao: 'criada' }, statusDerivado: 'cotacao_criada' });

    const logsItem = await logs('quote_request_item');
    expect(logsItem).toHaveLength(1);
    expect(logsItem[0].metadata).toMatchObject({
      via: 'forecast-vincular',
      operacao: 'vincular',
      quoteRequestId: q.id,
      antes: null,
      depois: { snapshotId, productId: ids.A },
    });
    const logsDec = await logs('forecast_purchase_decision');
    expect(logsDec).toHaveLength(1);
    expect(logsDec[0]).toMatchObject({ action: 'create' });
    expect(logsDec[0].metadata).toMatchObject({ via: 'forecast-vincular', quantidadeKg: 1000 });
    await limpar();
  });

  testDbSkip('repetir o PUT = nenhuma, sem AuditLog novo', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 700 }]);
    expect((await vincular(ids.A, { quoteRequestId: q.id })).status).toBe(200);
    const antes = await prisma.auditLog.count({ where: { performedById: adminId } });
    const res = await vincular(ids.A, { quoteRequestId: q.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ acao: 'nenhuma', itensVinculados: 0, movidosDeOutraQuinzena: 0 });
    expect(await prisma.auditLog.count({ where: { performedById: adminId } })).toBe(antes);
    await limpar();
  });

  testDbSkip('as embalagens do produto (qualquer codigo do catalogo) casam e a quantidade soma os itens em KG', async () => {
    const q = await cotacao([
      { catalogItemId: catalogo.A1, quantity: 600 },
      { catalogItemId: catalogo.A2, quantity: 400 },
      { catalogItemId: catalogo.B, quantity: 99 },
    ]);
    const lista = await listarAbertas(ids.A);
    expect(lista.status).toBe(200);
    const achada = (lista.body.data.cotacoes as Array<{ id: number; itens: unknown[] }>).find((c) => c.id === q.id);
    expect(achada?.itens).toHaveLength(2); // so as embalagens do produto A

    const res = await vincular(ids.A, { quoteRequestId: q.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ itensVinculados: 2, decisao: { quantidadeKg: 1000 } });
    const itens = await itensDe(q.id);
    expect(itens.filter((i) => i.forecastProductId === ids.A)).toHaveLength(2);
    expect(itens.find((i) => i.catalogItemId === catalogo.B)?.forecastProductId).toBeNull();
    await limpar();
  });

  testDbSkip('cotacao ja enviada: Qtd. final = cotada e status cotando', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 1200 }], { enviada: true });
    const res = await vincular(ids.A, { quoteRequestId: q.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dec = await decisao(ids.A);
    expect(Number(dec?.finalKg)).toBe(1200);
    expect(dec?.finalQuoteRequestId).toBe(q.id);
    expect(dec?.finalAt).toBeInstanceOf(Date);
    expect(dec?.status).toBe('cotando');
    const envio = (await logs('forecast_purchase_decision')).filter((l) => (l.metadata as { via?: string }).via === 'forecast-vincular');
    expect(envio.length).toBeGreaterThanOrEqual(1);
    await limpar();
  });

  testDbSkip('cotacao fechada = 409; fechada e excluida ficam fora do GET; item em UN aparece desabilitado com o motivo', async () => {
    const fechada = await cotacao([{ catalogItemId: catalogo.A1, quantity: 10 }], { status: 'closed' });
    const excluida = await cotacao([{ catalogItemId: catalogo.A1, quantity: 10 }], { excluida: true });
    const emUn = await cotacao([{ catalogItemId: catalogo.A1, quantity: 5, unit: 'UN' }]);
    const aberta = await cotacao([{ catalogItemId: catalogo.A1, quantity: 10 }]);

    const res = await vincular(ids.A, { quoteRequestId: fechada.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`A cotação ${fechada.requestCode} está fechada.`);
    expect((await vincular(ids.A, { quoteRequestId: emUn.id })).status).toBe(400);
    expect((await vincular(ids.A, { quoteRequestId: 99_999_999 })).status).toBe(404);
    expect(await decisao(ids.A)).toBeNull();

    const lista = await listarAbertas(ids.A);
    expect(lista.status).toBe(200);
    const porId = new Map((lista.body.data.cotacoes as Array<{ id: number }>).map((c) => [c.id, c as Record<string, unknown>]));
    expect(porId.has(fechada.id)).toBe(false);
    expect(porId.has(excluida.id)).toBe(false);
    expect(porId.get(aberta.id)).toMatchObject({ podeVincular: true, motivo: null, vinculadaAEsteItem: false, statusCotacao: 'criada' });
    expect(porId.get(emUn.id)).toMatchObject({
      podeVincular: false,
      motivo: 'O item está em UN; só itens em KG entram no Forecast.',
    });
    await limpar();
  });

  testDbSkip('GET: fornecedores distintos (respostas vivas) e quinzena/produto invalidos', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 10 }]);
    const fornecedor = await prisma.supplier.create({ data: { name: `FORNECEDOR ${U}` } });
    await prisma.quoteResponse.create({
      data: { quoteRequestId: q.id, supplierId: fornecedor.id, offeredPrice: 10, offeredIncoterm: 'FOB', paymentTermsDays: 30 },
    });
    const lista = await listarAbertas(ids.A);
    const achada = (lista.body.data.cotacoes as Array<{ id: number; fornecedores: string[] }>).find((c) => c.id === q.id);
    expect(achada?.fornecedores).toEqual([`FORNECEDOR ${U}`]);

    expect((await listarAbertas(ids.A, 99_999_999)).status).toBe(404);
    expect((await listarAbertas(99_999_999)).status).toBe(400); // produto fora da quinzena
    await limpar();
  });

  testDbSkip('item ligado a outra quinzena e MOVIDO; AuditLog guarda o vinculo antigo e a decisao antiga fica intacta', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 800, vinculo: { snapshotId: snapshot2Id, productId: ids.A } }]);
    const antiga = await prisma.forecastPurchaseDecision.create({
      data: {
        snapshotId: snapshot2Id,
        productId: ids.A,
        quantityKg: 800,
        status: 'cotando',
        suggestedKg: 800,
        demandKg: 700,
        finalKg: 800,
        finalAt: new Date('2036-09-01T00:00:00Z'),
        finalQuoteRequestId: q.id,
      },
    });

    const res = await vincular(ids.A, { quoteRequestId: q.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ acao: 'vincular', itensVinculados: 1, movidosDeOutraQuinzena: 1 });
    const [item] = await itensDe(q.id);
    expect(item).toMatchObject({ forecastSnapshotId: snapshotId, forecastProductId: ids.A });

    const [log] = await logs('quote_request_item');
    expect(log.metadata).toMatchObject({
      via: 'forecast-vincular',
      antes: { snapshotId: snapshot2Id, productId: ids.A },
      depois: { snapshotId, productId: ids.A },
    });
    const depois = await decisao(ids.A, snapshot2Id);
    expect(depois?.updatedAt.getTime()).toBe(antiga.updatedAt.getTime());
    expect(depois).toMatchObject({ status: 'cotando', finalQuoteRequestId: q.id });
    expect(Number(depois?.finalKg)).toBe(800);
    await limpar();
  });

  testDbSkip('item ligado a OUTRO produto da MESMA quinzena = 409', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 10, vinculo: { snapshotId, productId: ids.B } }]);
    const res = await vincular(ids.A, { quoteRequestId: q.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Um item da cotação já está ligado a outro produto desta quinzena.');
    await limpar();
  });

  testDbSkip('depois do vinculo, "Cotar" (lote) do mesmo produto e recusado com 409', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 500 }]);
    expect((await vincular(ids.A, { quoteRequestId: q.id })).status).toBe(200);
    const res = await lote(ids.A, 300);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain(q.requestCode);
    await limpar();
  });

  testDbSkip('desvincular REGRIDE: cotacao enviada vinculada -> status nao e Qtd. final nula', async () => {
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 900 }], { enviada: true });
    expect((await vincular(ids.A, { quoteRequestId: q.id })).status).toBe(200);
    expect((await decisao(ids.A))?.status).toBe('cotando');

    const res = await desvincular(ids.A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ acao: 'desvincular', decisao: { status: 'nao' } });
    const dec = await decisao(ids.A);
    expect(dec).toMatchObject({ status: 'nao', finalKg: null, finalAt: null, finalQuoteRequestId: null });
    expect(Number(dec?.quantityKg)).toBe(900); // a quantidade decidida nao muda
    const [item] = await itensDe(q.id);
    expect(item).toMatchObject({ forecastSnapshotId: null, forecastProductId: null });

    const logsDec = (await logs('forecast_purchase_decision')).filter((l) => (l.metadata as { via?: string }).via === 'forecast-desvincular');
    expect(logsDec).toHaveLength(1);
    expect(logsDec[0].metadata).toMatchObject({ quoteRequestId: q.id, status: 'nao', antes: { status: 'cotando', finalQuoteRequestId: q.id } });

    // Idempotente: nada mais ligado.
    expect((await desvincular(ids.A)).body.data).toMatchObject({ acao: 'nenhuma' });
    await limpar();
  });

  testDbSkip('desvincular NAO regride o status com outra cotacao viva ligada (fechada) nem quando o status e confirmado', async () => {
    // (1) Outra cotacao FECHADA ainda ligada ao item: o status fica em cotando (a Qtd. final da solta e zerada).
    const fechada = await cotacao([{ catalogItemId: catalogo.A2, quantity: 50, vinculo: { snapshotId, productId: ids.A } }], { status: 'closed' });
    const q = await cotacao([{ catalogItemId: catalogo.A1, quantity: 900 }], { enviada: true });
    expect((await vincular(ids.A, { quoteRequestId: q.id })).status).toBe(200);
    const res = await desvincular(ids.A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await decisao(ids.A)).toMatchObject({ status: 'cotando', finalKg: null, finalQuoteRequestId: null });
    expect((await itensDe(fechada.id))[0].forecastProductId).toBe(ids.A); // a fechada segue ligada
    await limpar();

    // (2) Status confirmado nunca regride.
    const q2 = await cotacao([{ catalogItemId: catalogo.A1, quantity: 900 }], { enviada: true });
    expect((await vincular(ids.A, { quoteRequestId: q2.id })).status).toBe(200);
    await prisma.forecastPurchaseDecision.update({
      where: { snapshotId_productId: { snapshotId, productId: ids.A } },
      data: { status: 'confirmado' },
    });
    expect((await desvincular(ids.A)).status).toBe(200);
    expect((await decisao(ids.A))?.status).toBe('confirmado');
    await limpar();
  });

  testDbSkip('desvincular so com cotacao aberta: so fechada ligada = 409', async () => {
    const fechada = await cotacao([{ catalogItemId: catalogo.A1, quantity: 50, vinculo: { snapshotId, productId: ids.A } }], { status: 'closed' });
    const res = await desvincular(ids.A);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`A cotação ${fechada.requestCode} está fechada; o vínculo não pode ser desfeito.`);
    expect((await itensDe(fechada.id))[0].forecastProductId).toBe(ids.A);
    await limpar();
  });

  testDbSkip('trocar: sem `substituir` = 409; enviada -> nao enviada zera a Qtd. final e volta a nao; -> enviada segue a nova', async () => {
    const a = await cotacao([{ catalogItemId: catalogo.A1, quantity: 900 }], { enviada: true });
    const b = await cotacao([{ catalogItemId: catalogo.A1, quantity: 300 }]);
    expect((await vincular(ids.A, { quoteRequestId: a.id })).status).toBe(200);

    const semSubstituir = await vincular(ids.A, { quoteRequestId: b.id });
    expect(semSubstituir.status).toBe(409);
    expect(semSubstituir.body.message).toBe(`O item já está na cotação aberta ${a.requestCode}. Use Trocar.`);

    // A enviada -> B nao enviada: status nao e Qtd. final nula; B ligada, A solta.
    const res = await vincular(ids.A, { quoteRequestId: b.id, substituir: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ acao: 'trocar', quoteRequestId: b.id, itensVinculados: 1 });
    expect(await decisao(ids.A)).toMatchObject({ status: 'nao', finalKg: null, finalAt: null, finalQuoteRequestId: null });
    expect((await itensDe(a.id))[0]).toMatchObject({ forecastSnapshotId: null, forecastProductId: null });
    expect((await itensDe(b.id))[0]).toMatchObject({ forecastSnapshotId: snapshotId, forecastProductId: ids.A });
    expect(
      (await logs('quote_request_item')).some((l) => (l.metadata as { operacao?: string }).operacao === 'trocar-saida'),
    ).toBe(true);

    // B nao enviada -> C ENVIADA: Qtd. final = a cotada de C.
    const c = await cotacao([{ catalogItemId: catalogo.A1, quantity: 450 }], { enviada: true });
    const res2 = await vincular(ids.A, { quoteRequestId: c.id, substituir: true });
    expect(res2.status, JSON.stringify(res2.body)).toBe(200);
    const dec = await decisao(ids.A);
    expect(Number(dec?.finalKg)).toBe(450);
    expect(dec?.finalQuoteRequestId).toBe(c.id);
    expect(dec?.status).toBe('cotando');
    await limpar();
  });

  testDbSkip('outros fluxos continuam sem regredir: depois do fechamento (confirmado), o envio de outra cotacao mantem confirmado', async () => {
    const a = await cotacao([{ catalogItemId: catalogo.A1, quantity: 900 }], { enviada: true });
    expect((await vincular(ids.A, { quoteRequestId: a.id })).status).toBe(200);
    await prisma.quoteRequest.update({ where: { id: a.id }, data: { status: 'closed' } });
    await ForecastCotacaoVinculoService.registrarFechamento(a.id, adminId);
    expect((await decisao(ids.A))?.status).toBe('confirmado');

    const b = await cotacao([{ catalogItemId: catalogo.A1, quantity: 100, vinculo: { snapshotId, productId: ids.A } }], { enviada: true });
    await ForecastCotacaoVinculoService.registrarEnvio(b.id, adminId);
    expect((await decisao(ids.A))?.status).toBe('confirmado');
    await limpar();
  });
});
