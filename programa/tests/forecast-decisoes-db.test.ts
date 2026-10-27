import { spawnSync } from 'node:child_process';
import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fp${Date.now()}`;

// Quantidade decidida de compra (PR3) no banco real. Tudo SINTETICO (repo publico). Datas longe do dado real e dos demais
// testes de forecast.
const BASE_DATE = '2036-04-15';
const HOJE = '2036-04-20';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const U = runId.toUpperCase();
const CODE_A = `${U}A1`;
const CODE_B = `${U}B1`;
const CODE_C = `${U}C1`;
const NAME_A = `PRODUTO ${U} A`;
const NAME_B = `PRODUTO ${U} B`;
const NAME_C = `PRODUTO ${U} C`;
const FONTE = `FONTE ${U}`;
const OBSERVACAO = `OBSERVACAO SINTETICA ${U}`;
const MIGRATION_SQL = 'prisma/migrations/20261026120000_forecast_purchase_decision/migration.sql';

const produto = (linha: number, item: string, codigo: string, id: number) => ({
  linha,
  n: linha - 2,
  item,
  codigos: [codigo, '', '', '', '', '', ''],
  historico: [10, 20, 30, 40, 50],
  analiseForecast: null,
  obs: '',
  fonte: FONTE,
  precoFechado: '',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
  productId: id,
});

describe('Forecast - quantidade decidida de compra (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productA = 0;
  let productB = 0;
  let productC = 0;
  let snapshotId = 0;

  const url = (snapshot: number, productId: number) => `/api/v1/forecast/snapshots/${snapshot}/decisoes/${productId}`;
  const put = (productId: number, body: object, snapshot = snapshotId) =>
    request(app).put(url(snapshot, productId)).set('Cookie', cookies).send(body);
  const listar = (snapshot = snapshotId) =>
    request(app).get(`/api/v1/forecast/snapshots/${snapshot}/decisoes`).set('Cookie', cookies);
  const contar = (snapshot = snapshotId) => prisma.forecastPurchaseDecision.count({ where: { snapshotId: snapshot } });
  const logs = (decisionId: number) =>
    prisma.auditLog.findMany({
      where: { entityType: 'forecast_purchase_decision', entityId: String(decisionId) },
      orderBy: { id: 'asc' },
    });

  type ItemDoRelatorio = { productId: number | null; item: string; quantidadeFinal: number; demanda: number };
  const itensDaLista = async (snapshot = snapshotId) => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshot}/relatorio-compras?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    return (res.body.data.grupos as Array<{ itens: ItemDoRelatorio[] }>).flatMap((g) => g.itens);
  };

  // Quinzena sintetica congelada direto no banco: A e C entram na lista de compra (estoque 0, mesma demanda); B tem estoque
  // de sobra (fica FORA da lista). Todos tem linha na quinzena.
  const criarQuinzena = async (label: string) =>
    (
      await prisma.forecastSnapshot.create({
        data: {
          label,
          baseDate: dateKeyToDbDate(BASE_DATE),
          half: 2,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: [produto(3, NAME_A, CODE_A, productA), produto(4, NAME_B, CODE_B, productB), produto(5, NAME_C, CODE_C, productC)],
          inputs: {
            estoque: [{ codigo: CODE_B, qtd: 1_000_000 }],
            vendasMes: [CODE_A, CODE_B, CODE_C].map((codigo) => ({ codigo, qtd: 400 })),
            vendasAtual: [CODE_A, CODE_B, CODE_C].map((codigo) => ({ codigo, qtd: 200 })),
            vendasAnual: [CODE_A, CODE_B, CODE_C].map((codigo) => ({ codigo, qtd: 4800 })),
            programacoes: [],
            chegadas: [],
            leadtime: [{ fonte: FONTE, total: 30 }],
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
        name: `Admin Forecast Decisao ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    await prisma.forecastSource.create({ data: { name: FONTE, normalizedName: FONTE, leadTimeDays: 30 } });
    const criar = async (name: string, code: string) =>
      (
        await prisma.forecastProduct.create({
          data: { name, normalizedName: normalizeProductName(name), codes: { create: [{ position: 1, code }] } },
        })
      ).id;
    productA = await criar(NAME_A, CODE_A);
    productB = await criar(NAME_B, CODE_B);
    productC = await criar(NAME_C, CODE_C);
    snapshotId = await criarQuinzena('04-2');
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // As decisoes saem ANTES das quinzenas e dos produtos (FKs Restrict).
    await prisma.forecastPurchaseDecision.deleteMany({ where: { product: { name: { contains: U } } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('schema: colunas, precisao, default, indices e FKs Restrict', async () => {
    const cols: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT column_name, is_nullable, column_default, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'ForecastPurchaseDecision'`;
    const col = (nome: string) => cols.find((c) => c.column_name === nome);
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['createdAt', 'decidedById', 'demandKg', 'id', 'note', 'productId', 'quantityKg', 'snapshotId', 'status', 'suggestedKg', 'updatedAt'].sort(),
    );
    for (const nome of ['quantityKg', 'suggestedKg', 'demandKg']) {
      expect(Number(col(nome)?.numeric_precision), nome).toBe(18);
      expect(Number(col(nome)?.numeric_scale), nome).toBe(6);
      expect(col(nome)?.is_nullable, nome).toBe('NO');
    }
    expect(col('status')?.is_nullable).toBe('NO');
    expect(String(col('status')?.column_default)).toContain("'nao'");
    expect(col('note')?.is_nullable).toBe('YES');
    expect(col('decidedById')?.is_nullable).toBe('YES');

    const idx: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ForecastPurchaseDecision'`;
    const unico = idx.find((i) => i.indexname === 'ForecastPurchaseDecision_snapshotId_productId_key');
    expect(String(unico?.indexdef)).toMatch(/UNIQUE.*\("snapshotId", "productId"\)/);
    expect(idx.some((i) => i.indexname === 'ForecastPurchaseDecision_productId_idx')).toBe(true);

    const fks: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
      WHERE conrelid = '"ForecastPurchaseDecision"'::regclass AND contype = 'f'`;
    expect(fks.map((f) => f.conname).sort()).toEqual([
      'ForecastPurchaseDecision_productId_fkey',
      'ForecastPurchaseDecision_snapshotId_fkey',
    ]);
    // 'r' = RESTRICT.
    expect(fks.every((f) => f.confdeltype === 'r')).toBe(true);
  });

  testDbSkip('drift: o diff do Prisma nao cita a tabela; a migration reaplicada e idempotente e preserva os dados', async () => {
    const diff = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'diff',
        '--from-url',
        process.env.DATABASE_URL!,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
      ],
      { encoding: 'utf-8' },
    );
    expect(diff.status, diff.stderr).toBe(0);
    // O diff global nao e vazio por indices parciais que o schema nao modela; so a tabela deste PR importa.
    expect(diff.stdout).not.toMatch(/ForecastPurchaseDecision/);

    const antes = await prisma.forecastPurchaseDecision.create({
      data: { snapshotId, productId: productC, quantityKg: 7, suggestedKg: 1, demandKg: -1 },
    });
    // So no banco embutido do teste (DATABASE_URL local): reaplica o SQL da migration por cima da tabela ja criada.
    const reaplicar = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'execute', '--file', MIGRATION_SQL, '--url', process.env.DATABASE_URL!],
      { encoding: 'utf-8' },
    );
    expect(reaplicar.status, `${reaplicar.stdout}${reaplicar.stderr}`).toBe(0);
    const depois = await prisma.forecastPurchaseDecision.findUniqueOrThrow({ where: { id: antes.id } });
    expect(Number(depois.quantityKg)).toBe(7);
    await prisma.forecastPurchaseDecision.delete({ where: { id: antes.id } });
  }, 120_000);

  testDbSkip('GET sem decisoes devolve lista vazia', async () => {
    const res = await listar();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ snapshotId, label: '04-2', decisoes: [] });
  });

  let decisaoA = 0;

  testDbSkip('create: congela Qtd. final e demanda do relatorio, status padrao e AuditLog sem a observacao', async () => {
    const lista = await itensDaLista();
    const itemA = lista.find((i) => i.productId === productA);
    expect(itemA).toBeDefined();
    expect(lista.some((i) => i.productId === productB)).toBe(false);

    const res = await put(productA, { quantidadeKg: 1234.567, observacao: OBSERVACAO });
    expect(res.status).toBe(200);
    expect(res.body.data.acao).toBe('create');
    expect(res.body.data.decisao).toMatchObject({
      productId: productA,
      quantidadeKg: 1234.567,
      status: 'nao',
      observacao: OBSERVACAO,
      decididaPorId: adminId,
    });
    expect(res.body.data.decisao.sugeridaKg).toBeCloseTo(itemA!.quantidadeFinal, 6);
    expect(res.body.data.decisao.demandaKg).toBeCloseTo(itemA!.demanda, 6);

    const row = await prisma.forecastPurchaseDecision.findUniqueOrThrow({
      where: { snapshotId_productId: { snapshotId, productId: productA } },
    });
    decisaoA = row.id;
    expect(Number(row.quantityKg)).toBe(1234.567);
    expect(Number(row.suggestedKg)).toBeCloseTo(itemA!.quantidadeFinal, 6);
    expect(Number(row.demandKg)).toBeCloseTo(itemA!.demanda, 6);

    const registros = await logs(decisaoA);
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ action: 'create', performedById: adminId });
    expect(registros[0].metadata).toMatchObject({
      snapshotId,
      productId: productA,
      label: '04-2',
      quantidadeKg: 1234.567,
      status: 'nao',
      comObservacao: true,
    });
    expect(JSON.stringify(registros[0])).not.toContain(OBSERVACAO);

    const lido = await listar();
    expect(lido.body.data.decisoes).toHaveLength(1);
    expect(lido.body.data.decisoes[0]).toMatchObject({ productId: productA, quantidadeKg: 1234.567 });
  });

  testDbSkip('update so de status nao recongela; mudar a quantidade recongela; repetir nao grava nem audita', async () => {
    const antes = await prisma.forecastPurchaseDecision.findUniqueOrThrow({ where: { id: decisaoA } });
    // Simula o cadastro mudar depois: os congelados da decisao nao podem acompanhar uma mudanca so de status.
    await prisma.forecastPurchaseDecision.update({ where: { id: decisaoA }, data: { suggestedKg: 1, demandKg: -1 } });
    const mudou = await prisma.forecastPurchaseDecision.findUniqueOrThrow({ where: { id: decisaoA } });

    const status = await put(productA, { quantidadeKg: 1234.567, status: 'po' });
    expect(status.status).toBe(200);
    expect(status.body.data.acao).toBe('update');
    expect(status.body.data.decisao.status).toBe('po');
    const depoisStatus = await prisma.forecastPurchaseDecision.findUniqueOrThrow({ where: { id: decisaoA } });
    expect(Number(depoisStatus.suggestedKg)).toBe(1);
    expect(Number(depoisStatus.demandKg)).toBe(-1);
    expect(depoisStatus.updatedAt.getTime()).toBeGreaterThanOrEqual(mudou.updatedAt.getTime());

    const quantidade = await put(productA, { quantidadeKg: 0 });
    expect(quantidade.status).toBe(200);
    expect(quantidade.body.data.acao).toBe('update');
    expect(quantidade.body.data.decisao.quantidadeKg).toBe(0);
    const itemA = (await itensDaLista()).find((i) => i.productId === productA)!;
    const depoisQtd = await prisma.forecastPurchaseDecision.findUniqueOrThrow({ where: { id: decisaoA } });
    expect(Number(depoisQtd.quantityKg)).toBe(0);
    expect(Number(depoisQtd.suggestedKg)).toBeCloseTo(itemA.quantidadeFinal, 6);
    expect(Number(depoisQtd.demandKg)).toBeCloseTo(itemA.demanda, 6);
    expect(depoisQtd.status).toBe('po');
    expect(depoisQtd.note).toBe(OBSERVACAO);
    expect(antes.createdAt.getTime()).toBe(depoisQtd.createdAt.getTime());

    const repetido = await put(productA, { quantidadeKg: 0 });
    expect(repetido.status).toBe(200);
    expect(repetido.body.data.acao).toBe('nenhuma');

    const registros = await logs(decisaoA);
    expect(registros.map((r) => r.action)).toEqual(['create', 'update', 'update']);
    expect(registros[1].metadata).toMatchObject({ camposAlterados: ['status'], antes: { quantidadeKg: 1234.567, status: 'nao' } });
    expect(registros[2].metadata).toMatchObject({ camposAlterados: ['quantidadeKg'], quantidadeKg: 0 });
    expect(JSON.stringify(registros)).not.toContain(OBSERVACAO);
  });

  testDbSkip('item fora da lista e produto fora da quinzena -> 400', async () => {
    const fora = await put(productB, { quantidadeKg: 10 });
    expect(fora.status).toBe(400);
    expect(fora.body.message).toBe('O item não está na lista de compra desta quinzena.');
    const semLinha = await put(999_999_999, { quantidadeKg: 10 });
    expect(semLinha.status).toBe(400);
    expect(semLinha.body.message).toBe('O produto não faz parte desta quinzena.');
    expect(await contar()).toBe(1);
  });

  testDbSkip('delete: apaga a linha, audita e apagar de novo e "nenhuma"', async () => {
    const res = await put(productA, { quantidadeKg: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ acao: 'delete', decisao: null });
    expect(await contar()).toBe(0);
    const registros = await logs(decisaoA);
    expect(registros.map((r) => r.action)).toEqual(['create', 'update', 'update', 'delete']);
    expect(JSON.stringify(registros)).not.toContain(OBSERVACAO);
    const de_novo = await put(productA, { quantidadeKg: null });
    expect(de_novo.body.data).toEqual({ acao: 'nenhuma', decisao: null });
  });

  testDbSkip('duas gravacoes simultaneas de criacao: so 200/409 e exatamente 1 linha', async () => {
    const [um, dois] = await Promise.all([put(productC, { quantidadeKg: 100 }), put(productC, { quantidadeKg: 200 })]);
    for (const r of [um, dois]) expect([200, 409]).toContain(r.status);
    expect(await prisma.forecastPurchaseDecision.count({ where: { snapshotId, productId: productC } })).toBe(1);
    const perdedor = [um, dois].find((r) => r.status === 409);
    if (perdedor) {
      expect(perdedor.body.message).toBe(
        'A quantidade decidida deste item acabou de ser gravada por outra pessoa. Atualize a tela e confira.',
      );
    }
  });

  testDbSkip('a chave (quinzena, produto) e unica: create duplicado rejeita com P2002', async () => {
    await expect(
      prisma.forecastPurchaseDecision.create({
        data: { snapshotId, productId: productC, quantityKg: 1, suggestedKg: 1, demandKg: -1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  testDbSkip('XLSX do relatorio e MACRO via rota: decisao nas 3 colunas e em AO (inclusive 0); sem decisao mantem o congelado', async () => {
    const decidida = await put(productA, { quantidadeKg: 55.5, status: 'confirmado', observacao: OBSERVACAO });
    expect(decidida.status).toBe(200);
    // O produto C ja tem decisao (corrida acima); trocar para 0 prova que o zero nao some do arquivo.
    expect((await put(productC, { quantidadeKg: 0 })).status).toBe(200);

    const baixar = async (layout?: string) => {
      const res = await request(app)
        .get(`/api/v1/forecast/snapshots/${snapshotId}/relatorio-compras/xlsx?hoje=${HOJE}${layout ? `&layout=${layout}` : ''}`)
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      const wb = new exceljs.Workbook();
      await wb.xlsx.load(Buffer.from(res.body.data.contentBase64, 'base64') as unknown as ArrayBuffer);
      return wb;
    };

    const relatorio = await baixar();
    const ws = relatorio.getWorksheet('Por urgência')!;
    const cabecalho = Array.from({ length: ws.columnCount }, (_, i) => String(ws.getRow(1).getCell(i + 1).value ?? ''));
    expect(cabecalho.slice(-4)).toEqual(['Qtd. decidida (kg)', 'Status da decisão', 'Obs. da decisão', 'Observação']);
    const col = (nome: string) => cabecalho.indexOf(nome) + 1;
    const linhaDoItem = (nome: string) => {
      let achada = 0;
      ws.eachRow((row, n) => {
        if (String(row.getCell(1).value) === nome) achada = n;
      });
      expect(achada, nome).toBeGreaterThan(0);
      return ws.getRow(achada);
    };
    expect(linhaDoItem(NAME_A).getCell(col('Qtd. decidida (kg)')).value).toBe(55.5);
    expect(linhaDoItem(NAME_A).getCell(col('Status da decisão')).value).toBe('Confirmado, aguarda PO');
    expect(linhaDoItem(NAME_A).getCell(col('Obs. da decisão')).value).toBe(OBSERVACAO);
    expect(linhaDoItem(NAME_C).getCell(col('Qtd. decidida (kg)')).value).toBe(0);

    const macro = (await baixar('macro')).getWorksheet('FORECAST (MACRO)')!;
    expect(macro.getCell('AO3').value).toBe(55.5);
    expect(macro.getCell('AO5').value).toBe(0);
    // B nao tem decisao: AO continua o analiseForecast congelado (nulo).
    expect(macro.getCell('AO4').value ?? null).toBeNull();
  }, 60_000);

  testDbSkip('retencao: excluir a quinzena mantem as decisoes; GET/PUT -> 404; mesmo rotulo novo comeca vazio', async () => {
    const outra = await criarQuinzena('04-1');
    const criada = await put(productA, { quantidadeKg: 321 }, outra);
    expect(criada.status).toBe(200);
    expect(await contar(outra)).toBe(1);

    const excluir = await request(app).delete(`/api/v1/forecast/snapshots/${outra}`).set('Cookie', cookies);
    expect(excluir.status).toBe(200);
    expect(await contar(outra)).toBe(1);

    expect((await listar(outra)).status).toBe(404);
    expect((await put(productA, { quantidadeKg: 5 }, outra)).status).toBe(404);
    expect((await put(productA, { quantidadeKg: null }, outra)).status).toBe(404);
    expect(await contar(outra)).toBe(1);

    const nova = await criarQuinzena('04-1');
    const lista = await listar(nova);
    expect(lista.status).toBe(200);
    expect(lista.body.data.decisoes).toEqual([]);

    // Restrict: nem a quinzena nem o produto com decisao saem fisicamente.
    await expect(prisma.forecastSnapshot.delete({ where: { id: outra } })).rejects.toThrow(
      /ForecastPurchaseDecision_snapshotId_fkey/,
    );
    await expect(prisma.forecastProduct.delete({ where: { id: productA } })).rejects.toThrow(
      /ForecastPurchaseDecision_productId_fkey/,
    );
  });
});
