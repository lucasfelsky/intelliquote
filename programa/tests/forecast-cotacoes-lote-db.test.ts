import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Spy na geracao do codigo da cotacao: por padrao e a funcao real; um teste a forca a repetir o codigo na 2a cotacao do lote
// para provocar uma falha NO MEIO da transacao (P2002 em requestCode) e provar a atomicidade.
vi.mock('../src/utils/requestCode', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/utils/requestCode')>();
  return { ...real, buildRequestCode: vi.fn(real.buildRequestCode) };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastCotacaoVinculoService } from '../src/services/ForecastCotacaoVinculoService';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';
import { buildRequestCode } from '../src/utils/requestCode';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
// O teste de schema roda `prisma migrate diff` (processo filho, varios segundos): o teto padrao de 5 s nao serve.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const runId = `fl${Date.now()}`;

// Cotacoes em lote a partir do Forecast (E4a) no banco real. Tudo SINTETICO (repo publico). Data longe do dado real e dos
// demais testes de forecast.
const BASE_DATE = '2036-08-15';
const HOJE = '2036-08-20';
const rotulos = rotulosDaQuinzena(BASE_DATE);
const LABEL = '08-2';

const U = runId.toUpperCase();
const FONTE_1 = `FONTE ${U} UM`;
const FONTE_2 = `FONTE ${U} DOIS`;
const NAME_A = `PRODUTO ${U} A`; // fonte 1, na lista, 2 codigos (o 2o e a embalagem principal)
const NAME_B = `PRODUTO ${U} B`; // fonte 2, na lista
const NAME_C = `PRODUTO ${U} C`; // fonte 1, na lista, SEM codigo vinculado ao catalogo
const NAME_D = `PRODUTO ${U} D`; // fonte 2, FORA da lista (estoque de sobra), candidato
const NAME_E = `PRODUTO ${U} E`; // fonte 1, na lista, item do catalogo INATIVO
const NAME_FORA = `PRODUTO ${U} FORA`; // existe no cadastro, nao esta na quinzena
const OBSERVACAO = `OBSERVACAO SINTETICA ${U}`;
const MIGRATION_SQL = 'prisma/migrations/20261110140000_forecast_cotacao_vinculo/migration.sql';

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

describe('Forecast - cotacoes em lote e Qtd. final (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let snapshotId = 0;
  const ids: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'FORA', number> = { A: 0, B: 0, C: 0, D: 0, E: 0, FORA: 0 };
  const catalogo: Record<'A1' | 'A2' | 'B' | 'D' | 'E', number> = { A1: 0, A2: 0, B: 0, D: 0, E: 0 };

  const urlLote = (snapshot = snapshotId) => `/api/v1/forecast/snapshots/${snapshot}/cotacoes`;
  const postar = (body: object, snapshot = snapshotId) => request(app).post(urlLote(snapshot)).set('Cookie', cookies).send(body);
  const listar = (snapshot = snapshotId) =>
    request(app).get(`/api/v1/forecast/snapshots/${snapshot}/decisoes`).set('Cookie', cookies);
  const putDecisao = (productId: number, body: object, snapshot = snapshotId) =>
    request(app).put(`/api/v1/forecast/snapshots/${snapshot}/decisoes/${productId}`).set('Cookie', cookies).send(body);
  const cotacoesDoUsuario = () =>
    prisma.quoteRequest.findMany({ where: { createdById: adminId }, orderBy: { id: 'asc' }, include: { items: true } });
  const decisao = (productId: number, snapshot = snapshotId) =>
    prisma.forecastPurchaseDecision.findUnique({ where: { snapshotId_productId: { snapshotId: snapshot, productId } } });
  const logs = (entityType: string) =>
    prisma.auditLog.findMany({ where: { entityType, performedById: adminId }, orderBy: { id: 'asc' } });

  // Limpa o que um teste criou (cotacoes e decisoes da quinzena) para o proximo comecar do zero.
  const limpar = async () => {
    await prisma.quoteRequest.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { snapshotId } });
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
            produto(5, NAME_C, [`${U}C1`], FONTE_1, ids.C),
            produto(6, NAME_D, [`${U}D1`], FONTE_2, ids.D),
            produto(7, NAME_E, [`${U}E1`], FONTE_1, ids.E),
          ],
          inputs: {
            // D tem estoque de sobra: fica FORA da lista de compra (candidato 'sem-falta').
            estoque: [{ codigo: `${U}D1`, qtd: 1_000_000 }],
            vendasMes: ['A1', 'B1', 'C1', 'D1', 'E1'].map((c) => ({ codigo: `${U}${c}`, qtd: 400 })),
            vendasAtual: ['A1', 'B1', 'C1', 'D1', 'E1'].map((c) => ({ codigo: `${U}${c}`, qtd: 200 })),
            vendasAnual: ['A1', 'B1', 'C1', 'D1', 'E1'].map((c) => ({ codigo: `${U}${c}`, qtd: 4800 })),
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
        name: `Admin Forecast Lote ${runId}`,
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
    const item = async (nome: string, isActive = true) =>
      (await prisma.catalogItem.create({ data: { commercialName: `CAT ${U} ${nome}`, marketName: `CAT ${U} ${nome}`, isActive } })).id;
    catalogo.A1 = await item('A1');
    catalogo.A2 = await item('A2');
    catalogo.B = await item('B');
    catalogo.D = await item('D');
    catalogo.E = await item('E', false);

    const criar = async (name: string, codes: Array<{ code: string; catalogItemId: number | null; principal?: boolean }>) =>
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
    ids.C = await criar(NAME_C, [{ code: `${U}C1`, catalogItemId: null }]);
    ids.D = await criar(NAME_D, [{ code: `${U}D1`, catalogItemId: catalogo.D }]);
    ids.E = await criar(NAME_E, [{ code: `${U}E1`, catalogItemId: catalogo.E }]);
    ids.FORA = await criar(NAME_FORA, []);
    snapshotId = await criarQuinzena(LABEL);
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // Cotacoes (itens e envios em cascata) e decisoes saem ANTES das quinzenas e dos produtos (FKs Restrict).
    await prisma.quoteRequest.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { product: { name: { contains: U } } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.catalogItem.deleteMany({ where: { marketName: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('schema: colunas anulaveis, indice, sem FK; a migration reaplicada e idempotente e preserva os dados', async () => {
    const colunas = async (tabela: string) => {
      const cols: Array<Record<string, unknown>> = await prisma.$queryRaw`
        SELECT column_name, is_nullable, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns WHERE table_name = ${tabela}`;
      return (nome: string) => cols.find((c) => c.column_name === nome);
    };
    const item = await colunas('QuoteRequestItem');
    for (const nome of ['forecastSnapshotId', 'forecastProductId']) {
      expect(item(nome)?.is_nullable, nome).toBe('YES');
      expect(item(nome)?.data_type, nome).toBe('integer');
    }
    const dec = await colunas('ForecastPurchaseDecision');
    expect(dec('finalKg')?.is_nullable).toBe('YES');
    expect(Number(dec('finalKg')?.numeric_precision)).toBe(18);
    expect(Number(dec('finalKg')?.numeric_scale)).toBe(6);
    expect(dec('finalAt')?.is_nullable).toBe('YES');
    expect(dec('finalQuoteRequestId')?.is_nullable).toBe('YES');

    const idx: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'QuoteRequestItem'`;
    const indice = idx.find((i) => i.indexname === 'QuoteRequestItem_forecastSnapshotId_forecastProductId_idx');
    expect(String(indice?.indexdef)).toMatch(/\("forecastSnapshotId", "forecastProductId"\)/);

    // Sem FK nas colunas novas (decisao de projeto: existencia conferida no service).
    const fks: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND conrelid IN ('"QuoteRequestItem"'::regclass, '"ForecastPurchaseDecision"'::regclass)`;
    const nomes = fks.map((f) => String(f.conname));
    expect(nomes.filter((n) => /forecastSnapshotId|forecastProductId|finalQuoteRequestId/.test(n))).toEqual([]);

    const diff = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-url', process.env.DATABASE_URL!, '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
      { encoding: 'utf-8' },
    );
    expect(diff.status, diff.stderr).toBe(0);
    expect(diff.stdout).not.toMatch(/forecastSnapshotId|forecastProductId|finalKg|finalAt|finalQuoteRequestId/);

    // Reaplica o SQL da migration por cima das colunas ja criadas (so no banco embutido do teste): nada se perde.
    await prisma.forecastPurchaseDecision.create({
      data: { snapshotId, productId: ids.A, quantityKg: 5, suggestedKg: 5, demandKg: -5, finalKg: 7, finalQuoteRequestId: 99 },
    });
    const reaplicar = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'execute', '--file', MIGRATION_SQL, '--url', process.env.DATABASE_URL!],
      { encoding: 'utf-8' },
    );
    expect(reaplicar.status, `${reaplicar.stdout}${reaplicar.stderr}`).toBe(0);
    const depois = await decisao(ids.A);
    expect(Number(depois?.finalKg)).toBe(7);
    expect(depois?.finalQuoteRequestId).toBe(99);
    await limpar();
  });

  testDbSkip('multi-fonte: uma cotacao por fonte, itens vinculados, decisoes gravadas e AuditLog sem texto livre', async () => {
    const res = await postar({
      itens: [
        { productId: ids.A, quantidadeKg: 1500.001, observacao: OBSERVACAO },
        { productId: ids.B, quantidadeKg: 20 },
        { productId: ids.D, quantidadeKg: 300, incluidoManualmente: true },
      ],
      destinationPort: ' Santos ',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { snapshotId: sid, label, cotacoes } = res.body.data;
    expect(sid).toBe(snapshotId);
    expect(label).toBe(LABEL);
    expect(cotacoes).toHaveLength(2);

    const [c1, c2] = cotacoes;
    expect(c1.fonte).toBe(FONTE_1);
    expect(c2.fonte).toBe(FONTE_2);
    expect(c1.requestCode).toMatch(/^QR-\d{8}-[0-9A-F]{6}$/);
    // Fonte 1: so o A, com o codigo da embalagem principal (A2) e o item de catalogo dele; kg inteiro para cima.
    expect(c1.itens).toEqual([
      expect.objectContaining({ productId: ids.A, item: NAME_A, catalogItemId: catalogo.A2, codigo: `${U}A2`, quantidadeKg: 1501 }),
    ]);
    expect(c2.itens.map((i: { productId: number; quantidadeKg: number; catalogItemId: number }) => [i.productId, i.quantidadeKg, i.catalogItemId])).toEqual([
      [ids.B, 20, catalogo.B],
      [ids.D, 300, catalogo.D],
    ]);

    const salvas = await cotacoesDoUsuario();
    expect(salvas.map((q) => q.id)).toEqual([c1.id, c2.id]);
    for (const q of salvas) {
      expect(q).toMatchObject({
        status: 'open',
        description: `Forecast ${LABEL}`,
        desiredIncoterm: ['FOB'],
        originPort: 'Shanghai',
        destinationPort: 'Santos',
        currency: 'USD',
        deadlineAt: null,
        createdById: adminId,
      });
    }
    const itensDaQuinzena = salvas.flatMap((q) => q.items);
    expect(itensDaQuinzena).toHaveLength(3);
    for (const it of itensDaQuinzena) {
      expect(it).toMatchObject({ unit: 'KG', forecastSnapshotId: snapshotId, notes: null, deletedAt: null });
      expect(it.destinationPort).toBe('Santos'); // herda o porto da cotacao
    }
    // A observacao NUNCA vai ao item da cotacao (pode chegar ao fornecedor).
    expect(itensDaQuinzena.every((it) => it.notes === null && it.description === null)).toBe(true);
    expect(itensDaQuinzena.map((it) => [it.forecastProductId, it.quantity]).sort()).toEqual(
      [[ids.A, 1501], [ids.B, 20], [ids.D, 300]].sort(),
    );

    // Decisoes: criadas com a quantidade EXATA (nao a cotada), referencia congelada e flag de item fora da lista.
    const a = await decisao(ids.A);
    expect(Number(a?.quantityKg)).toBe(1500.001);
    expect(a?.note).toBe(OBSERVACAO);
    expect(a?.status).toBe('nao');
    expect(a?.manuallyIncluded).toBe(false);
    expect(a?.finalKg).toBeNull();
    expect(a?.finalAt).toBeNull();
    expect(Number(a?.suggestedKg)).toBeGreaterThan(0);
    const b = await decisao(ids.B);
    expect(b?.note).toBeNull();
    expect(Number((await decisao(ids.D))?.quantityKg)).toBe(300);
    expect((await decisao(ids.D))?.manuallyIncluded).toBe(true);

    // AuditLog: 1 por cotacao, 1 por item e 1 por decisao, so ids/contagens; o texto livre nao aparece em lugar nenhum.
    const logsQuote = await logs('quote_request');
    expect(logsQuote).toHaveLength(2);
    expect(logsQuote.map((l) => l.action)).toEqual(['create', 'create']);
    expect(logsQuote[0].metadata).toMatchObject({
      via: 'forecast-cotacoes-lote',
      forecastSnapshotId: snapshotId,
      forecastLabel: LABEL,
      fonte: FONTE_1,
      totalItens: 1,
      totalCotacoesDoLote: 2,
    });
    expect(await logs('quote_request_item')).toHaveLength(3);
    const logsDecisao = await logs('forecast_purchase_decision');
    expect(logsDecisao).toHaveLength(3);
    expect(logsDecisao.every((l) => (l.metadata as { via?: string }).via === 'cotacao-lote')).toBe(true);
    const todos = JSON.stringify(await prisma.auditLog.findMany({ where: { performedById: adminId } }));
    expect(todos).not.toContain(OBSERVACAO);

    // Leitura: cada decisao traz a cotacao vinculada (criada, nao enviada) e o status derivado.
    const lista = await listar();
    expect(lista.status).toBe(200);
    const porProduto = new Map<number, Record<string, unknown>>(
      (lista.body.data.decisoes as Array<{ productId: number }>).map((d) => [d.productId, d as unknown as Record<string, unknown>]),
    );
    expect(porProduto.get(ids.A)).toMatchObject({
      cotacao: { id: c1.id, requestCode: c1.requestCode, statusCotacao: 'criada' },
      finalKg: null,
      finalAt: null,
      statusDerivado: 'cotacao_criada',
      quantidadeKg: 1500.001,
    });
    expect(porProduto.get(ids.D)).toMatchObject({ cotacao: { id: c2.id }, incluidoManualmente: true });
    await limpar();
  });

  testDbSkip('cabecalho opcional da cotacao: Incoterms, moeda, origem e prazo valem para todas as cotacoes do lote', async () => {
    const res = await postar({
      itens: [
        { productId: ids.A, quantidadeKg: 10 },
        { productId: ids.B, quantidadeKg: 10 },
      ],
      desiredIncoterm: ['CIF', 'FOB'],
      currency: 'eur',
      originPort: 'Rotterdam',
      deadlineAt: '2036-09-30T00:00:00.000Z',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const salvas = await cotacoesDoUsuario();
    expect(salvas).toHaveLength(2);
    for (const q of salvas) {
      expect(q.desiredIncoterm).toEqual(['CIF', 'FOB']);
      expect(q.currency).toBe('EUR');
      expect(q.originPort).toBe('Rotterdam');
      expect(q.deadlineAt?.toISOString()).toBe('2036-09-30T00:00:00.000Z');
    }
    await limpar();
  });

  testDbSkip('atomico: falha na 2a cotacao do lote (codigo repetido) desfaz a 1a, as decisoes e o AuditLog', async () => {
    const mock = vi.mocked(buildRequestCode);
    const original = mock.getMockImplementation();
    let primeiro: string | null = null;
    mock.mockImplementation(() => {
      // 1a chamada real; a 2a repete o codigo e estoura a unique de requestCode dentro da transacao.
      if (primeiro === null) {
        primeiro = `QR-20360820-${U.slice(-6)}`;
      }
      return primeiro;
    });
    try {
      const res = await postar({
        itens: [
          { productId: ids.A, quantidadeKg: 10 },
          { productId: ids.B, quantidadeKg: 10 },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.message).toBe('Conflito ao gerar o código da cotação. Tente novamente.');
    } finally {
      if (original) mock.mockImplementation(original);
    }
    expect(await cotacoesDoUsuario()).toHaveLength(0);
    expect(await prisma.quoteRequestItem.count({ where: { forecastSnapshotId: snapshotId } })).toBe(0);
    expect(await prisma.forecastPurchaseDecision.count({ where: { snapshotId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { performedById: adminId } })).toBe(0);
  });

  testDbSkip('lote inteiro recusado (sem gravar nada): sem vinculo ao catalogo, catalogo inativo, fora da lista, nao candidato', async () => {
    // C: nenhum codigo vinculado; E: item do catalogo inativo. Os dois motivos vem juntos na mensagem.
    const juntos = await postar({
      itens: [
        { productId: ids.A, quantidadeKg: 10 },
        { productId: ids.C, quantidadeKg: 10 },
        { productId: ids.E, quantidadeKg: 10 },
      ],
    });
    expect(juntos.status).toBe(409);
    expect(juntos.body.message).toContain(`${NAME_C}: Nenhum código deste produto está vinculado a um item do catálogo.`);
    expect(juntos.body.message).toContain(`${NAME_E}: o item do catálogo CAT ${U} E está inativo`);

    // D esta fora da lista de compra: sem `incluidoManualmente` o item nao entra (400, mesma regra do PUT de decisao).
    const foraDaLista = await postar({ itens: [{ productId: ids.D, quantidadeKg: 10 }] });
    expect(foraDaLista.status).toBe(400);
    expect(foraDaLista.body.message).toContain(`${NAME_D}: o item não está na lista de compra desta quinzena`);

    // Produto de fora da quinzena e quinzena inexistente.
    const foraDaQuinzena = await postar({ itens: [{ productId: ids.FORA, quantidadeKg: 10 }] });
    expect(foraDaQuinzena.status).toBe(400);
    expect(foraDaQuinzena.body.message).toBe(`Produto fora desta quinzena: ${ids.FORA}.`);
    expect((await postar({ itens: [{ productId: ids.A, quantidadeKg: 10 }] }, snapshotId + 999_999)).status).toBe(404);

    // Nada foi gravado em nenhum dos casos.
    expect(await cotacoesDoUsuario()).toHaveLength(0);
    expect(await prisma.forecastPurchaseDecision.count({ where: { snapshotId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { performedById: adminId } })).toBe(0);
  });

  testDbSkip('quinzena excluida (soft delete) responde 404 e nao cria nada', async () => {
    const excluida = await criarQuinzena('08-1');
    await prisma.forecastSnapshot.update({ where: { id: excluida }, data: { deletedAt: new Date() } });
    const res = await postar({ itens: [{ productId: ids.A, quantidadeKg: 10 }] }, excluida);
    expect(res.status).toBe(404);
    expect(await cotacoesDoUsuario()).toHaveLength(0);
    await prisma.forecastSnapshot.delete({ where: { id: excluida } });
  });

  testDbSkip('decisao existente: atualiza quantidade (recongela) e mantem a observacao; o PUT concorrente da 409', async () => {
    const criada = await putDecisao(ids.A, { quantidadeKg: 100, observacao: OBSERVACAO });
    expect(criada.status).toBe(200);
    const lido = (criada.body.data.decisao as { atualizadaEm: string }).atualizadaEm;

    const res = await postar({ itens: [{ productId: ids.A, quantidadeKg: 250.5, atualizadoEm: lido }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const depois = await decisao(ids.A);
    expect(Number(depois?.quantityKg)).toBe(250.5);
    expect(depois?.note).toBe(OBSERVACAO); // observacao ausente no item = nao mexe
    expect(depois?.updatedAt.toISOString()).not.toBe(lido);
    const logsDecisao = await logs('forecast_purchase_decision');
    const update = logsDecisao.find((l) => l.action === 'update' && (l.metadata as { via?: string }).via === 'cotacao-lote');
    expect(update?.metadata).toMatchObject({
      quantidadeKg: 250.5,
      antes: { quantidadeKg: 100, status: 'nao' },
      camposAlterados: ['quantidadeKg'],
    });
    await limpar();
  });

  testDbSkip('concorrencia otimista: atualizadoEm velho, atualizadoEm:null com decisao existente e dois lotes juntos dao 409', async () => {
    const primeira = await putDecisao(ids.A, { quantidadeKg: 100 });
    const velho = (primeira.body.data.decisao as { atualizadaEm: string }).atualizadaEm;
    // Outra pessoa grava depois: o `atualizadaEm` lido pelo cliente fica velho.
    await new Promise((r) => setTimeout(r, 15));
    expect((await putDecisao(ids.A, { quantidadeKg: 120 })).status).toBe(200);

    const velha = await postar({ itens: [{ productId: ids.A, quantidadeKg: 130, atualizadoEm: velho }] });
    expect(velha.status).toBe(409);
    expect(velha.body.message).toBe(
      'A quantidade decidida de um dos itens acabou de ser gravada por outra pessoa. Atualize a tela e confira.',
    );
    const naoViu = await postar({ itens: [{ productId: ids.A, quantidadeKg: 130, atualizadoEm: null }] });
    expect(naoViu.status).toBe(409);
    expect(await cotacoesDoUsuario()).toHaveLength(0);
    expect(Number((await decisao(ids.A))?.quantityKg)).toBe(120);

    // Dois lotes do mesmo item ao mesmo tempo: o lock da quinzena serializa; o 2o ve o item ja cotado e recebe 409.
    const [x, y] = await Promise.all([
      postar({ itens: [{ productId: ids.B, quantidadeKg: 40 }] }),
      postar({ itens: [{ productId: ids.B, quantidadeKg: 40 }] }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const perdedor = x.status === 409 ? x : y;
    expect(perdedor.body.message).toContain('já está na cotação aberta');
    expect(await prisma.quoteRequestItem.count({ where: { forecastSnapshotId: snapshotId, forecastProductId: ids.B } })).toBe(1);
    await limpar();
  });

  testDbSkip('item ja em cotacao aberta e recusado; depois de fechada a cotacao, pode cotar de novo', async () => {
    const primeira = await postar({ itens: [{ productId: ids.A, quantidadeKg: 10 }] });
    expect(primeira.status).toBe(201);
    const q1 = primeira.body.data.cotacoes[0] as { id: number; requestCode: string };

    const repetida = await postar({ itens: [{ productId: ids.A, quantidadeKg: 10 }] });
    expect(repetida.status).toBe(409);
    expect(repetida.body.message).toContain(`${NAME_A}: já está na cotação aberta ${q1.requestCode}`);

    await prisma.quoteRequest.update({ where: { id: q1.id }, data: { status: 'closed', closedAt: new Date() } });
    const nova = await postar({ itens: [{ productId: ids.A, quantidadeKg: 12 }] });
    expect(nova.status, JSON.stringify(nova.body)).toBe(201);
    const q2 = nova.body.data.cotacoes[0] as { id: number };
    expect(q2.id).toBeGreaterThan(q1.id);

    // A leitura mostra a cotacao viva mais recente do item.
    const lista = await listar();
    const a = (lista.body.data.decisoes as Array<{ productId: number; cotacao: { id: number } | null }>).find((d) => d.productId === ids.A);
    expect(a?.cotacao?.id).toBe(q2.id);

    // Cotacao excluida (soft delete) nao conta como vinculo.
    await prisma.quoteRequest.update({ where: { id: q2.id }, data: { deletedAt: new Date() } });
    const aposExcluir = await listar();
    const a2 = (aposExcluir.body.data.decisoes as Array<{ productId: number; cotacao: { id: number } | null }>).find((d) => d.productId === ids.A);
    expect(a2?.cotacao?.id).toBe(q1.id);
    await limpar();
  });

  testDbSkip('leitura aditiva: decisao sem cotacao vinculada (item antigo) segue com o status congelado e sem Qtd. final', async () => {
    expect((await putDecisao(ids.B, { quantidadeKg: 33, status: 'confirmado' })).status).toBe(200);
    const lista = await listar();
    expect(lista.status).toBe(200);
    const b = (lista.body.data.decisoes as Array<Record<string, unknown>>).find((d) => d.productId === ids.B);
    expect(b).toMatchObject({
      status: 'confirmado',
      statusDerivado: 'confirmado',
      cotacao: null,
      finalKg: null,
      finalAt: null,
      quantidadeKg: 33,
    });
    // O PUT segue com o formato antigo (sem os campos novos).
    const put = await putDecisao(ids.B, { quantidadeKg: 34 });
    expect(Object.keys(put.body.data.decisao)).not.toContain('cotacao');
    expect(Object.keys(put.body.data.decisao)).not.toContain('finalKg');
    await limpar();
  });

  testDbSkip('gancho do envio: preenche Qtd. final (kg cotado), finalAt, cotacao e status; reenvio nao mexe na data', async () => {
    const res = await postar({
      itens: [
        { productId: ids.A, quantidadeKg: 1500.4, observacao: OBSERVACAO },
        { productId: ids.B, quantidadeKg: 20 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [cotacaoA, cotacaoB] = res.body.data.cotacoes as Array<{ id: number }>;
    // B ja estava em 'confirmado' (nao pode regredir para 'cotando').
    expect((await putDecisao(ids.B, { quantidadeKg: 20, status: 'confirmado' })).status).toBe(200);

    // Evento de envio entregue (o gancho roda depois que o DispatchController o grava como completed/partial).
    await prisma.dispatchEvent.create({
      data: { quoteRequestId: cotacaoA.id, createdById: adminId, recipientsCount: 1, subject: 'S', status: 'completed' },
    });
    await prisma.dispatchEvent.create({
      data: { quoteRequestId: cotacaoB.id, createdById: adminId, recipientsCount: 1, subject: 'S', status: 'completed' },
    });
    const r1 = await ForecastCotacaoVinculoService.registrarEnvio(cotacaoA.id, adminId);
    expect(r1.atualizadas).toBe(1);
    await ForecastCotacaoVinculoService.registrarEnvio(cotacaoB.id, adminId);

    const a = await decisao(ids.A);
    expect(Number(a?.finalKg)).toBe(1501); // quantidade COTADA (kg inteiro), nao os 1500,4 decididos
    expect(a?.finalQuoteRequestId).toBe(cotacaoA.id);
    expect(a?.finalAt).toBeInstanceOf(Date);
    expect(a?.status).toBe('cotando');
    expect(Number(a?.quantityKg)).toBe(1500.4); // a decisao em si nao muda
    const b = await decisao(ids.B);
    expect(b?.status).toBe('confirmado');
    expect(Number(b?.finalKg)).toBe(20);

    const lista = await listar();
    const da = (lista.body.data.decisoes as Array<Record<string, unknown>>).find((d) => d.productId === ids.A);
    expect(da).toMatchObject({
      cotacao: { id: cotacaoA.id, statusCotacao: 'enviada' },
      finalKg: 1501,
      statusDerivado: 'cotando',
    });
    expect(typeof da?.finalAt).toBe('string');

    // AuditLog do gancho: ids, kg e status; nunca o texto livre.
    const envio = (await logs('forecast_purchase_decision')).filter((l) => (l.metadata as { via?: string }).via === 'envio-cotacao');
    expect(envio).toHaveLength(2);
    expect(envio.find((l) => l.entityId === String(a?.id))?.metadata).toMatchObject({
      quoteRequestId: cotacaoA.id,
      finalKg: 1501,
      status: 'cotando',
      antes: { finalKg: null, finalQuoteRequestId: null, status: 'nao' },
    });
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { performedById: adminId } }))).not.toContain(OBSERVACAO);

    // Reenvio (outro lote de destinatarios): mesma cotacao, nada muda (nem a data); sem alteracao nao audita.
    const finalAt = a?.finalAt?.toISOString();
    const r2 = await ForecastCotacaoVinculoService.registrarEnvio(cotacaoA.id, adminId);
    expect(r2.atualizadas).toBe(0);
    expect((await decisao(ids.A))?.finalAt?.toISOString()).toBe(finalAt);
    // Quantidade cotada mudou entre os envios: atualiza o kg, mantem a data do 1o envio.
    await prisma.quoteRequestItem.updateMany({ where: { quoteRequestId: cotacaoA.id }, data: { quantity: 1600 } });
    expect((await ForecastCotacaoVinculoService.registrarEnvio(cotacaoA.id, adminId)).atualizadas).toBe(1);
    const reenviada = await decisao(ids.A);
    expect(Number(reenviada?.finalKg)).toBe(1600);
    expect(reenviada?.finalAt?.toISOString()).toBe(finalAt);
    await limpar();
  });

  testDbSkip('gancho do envio: cotacao sem vinculo ao Forecast e decisao apagada sao ignoradas (sem erro)', async () => {
    const comum = await prisma.quoteRequest.create({
      data: { requestCode: `QR-COMUM-${U}`, desiredIncoterm: ['FOB'], createdById: adminId },
    });
    await prisma.quoteRequestItem.create({
      data: { quoteRequestId: comum.id, catalogItemId: catalogo.A1, productName: 'X', quantity: 5, unit: 'KG' },
    });
    expect(await ForecastCotacaoVinculoService.registrarEnvio(comum.id, adminId)).toEqual({ atualizadas: 0 });

    const res = await postar({ itens: [{ productId: ids.A, quantidadeKg: 10 }] });
    expect(res.status).toBe(201);
    const q = res.body.data.cotacoes[0] as { id: number };
    // A decisao e apagada (PUT null) depois de criada a cotacao: o gancho nao falha nem recria a decisao.
    expect((await putDecisao(ids.A, { quantidadeKg: null })).status).toBe(200);
    expect(await ForecastCotacaoVinculoService.registrarEnvio(q.id, adminId)).toEqual({ atualizadas: 0 });
    expect(await decisao(ids.A)).toBeNull();
    await limpar();
  });
});
