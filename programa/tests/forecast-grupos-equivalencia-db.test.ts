import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fg${Date.now()}`;

// Datas longe do dado real e dos demais testes de forecast. Tudo SINTETICO (repo publico).
const BASE_DATE = '2035-06-15';
const HOJE = '2035-06-20';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const U = runId.toUpperCase();
const CODE_A = `${U}A1`;
const CODE_A2 = `${U}A2`;
const CODE_B = `${U}B1`;
const CODE_C = `${U}C1`;
const CODE_NOVO = `${U}N1`;
const CODE_D1 = `${U}D1`;
const CODE_D2 = `${U}D2`;
const CODE_E = `${U}E1`;
const CODE_F1 = `${U}F1`;
const CODE_F2 = `${U}F2`;
const NAME_A = `PRODUTO ${U} A`;
const NAME_B = `PRODUTO ${U} B`;
const NAME_C = `PRODUTO ${U} C`;
const NAME_D1 = `PRODUTO ${U} D1`;
const NAME_D2 = `PRODUTO ${U} D2`;
const NAME_E = `PRODUTO ${U} E INATIVO`;
const NAME_F1 = `PRODUTO ${U} F1`;
const NAME_F2 = `PRODUTO ${U} F2`;
const NAME_NOVO = `PRODUTO ${U} NOVO`;
const FONTE_A = `FONTE ${U} A`;
const FONTE_B = `FONTE ${U} B`;
const FONTE_C = `FONTE ${U} C`;
const GRUPO = `GRUPO ${U}`;

type Relatorio = {
  totais: { itens: number };
  fora: { semLeadTime: number; cobertosPorGrupo: number };
  grupos: Array<{
    fonte: string;
    itens: Array<{
      productId: number | null;
      item: string;
      quantidadeSugerida: number;
      grupo?: { id: number; nome: string; membros: Array<{ productId: number; principal: boolean }> };
    }>;
  }>;
  cobertosPorGrupo: {
    itens: Array<{ productId: number; item: string; grupoNome: string; estoqueDoGrupo: number; cobertura: number | null; quantidadeSugerida: number }>;
  };
  gruposDeEquivalencia: Array<{ id: number; nome: string; situacao: string; demanda: number | null; estoque: number }>;
};

// Caso B (numeros sinteticos): A (FONTE A, lead 60, Q 100, U 0), B (FONTE B, lead 60, Q 50, U 1.000), C (sem lead time,
// U 200). Sozinho, A compraria 300. Grupo: estoque 1.200, T 300, Q 150 -> AN_g = +750 (coberto, cobertura 8,0 meses).
describe('Forecast - grupos de equivalencia (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productA = 0;
  let productB = 0;
  let productC = 0;
  let productE = 0;
  let productF1 = 0;
  let productF2 = 0;
  let sourceAId = 0;
  let sourceBId = 0;
  let sourceCId = 0;
  let familyId = 0;
  let snapshotId = 0;
  let grupoId = 0;

  const grupoBody = (over: Record<string, unknown> = {}) => ({
    nome: GRUPO,
    observacao: `OBS ${U}`,
    produtoIds: [productA, productB, productC],
    principalProdutoId: productA,
    ...over,
  });
  const criar = (body: unknown) => request(app).post('/api/v1/forecast/equivalence-groups').set('Cookie', cookies).send(body as object);
  const editar = (id: number, body: unknown) =>
    request(app).patch(`/api/v1/forecast/equivalence-groups/${id}`).set('Cookie', cookies).send(body as object);
  const desfazer = (id: number) => request(app).delete(`/api/v1/forecast/equivalence-groups/${id}`).set('Cookie', cookies);

  const relatorio = async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}/relatorio-compras?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.data as Relatorio;
  };
  const nomesNaLista = (r: Relatorio) => r.grupos.flatMap((g) => g.itens).map((i) => i.item);
  const grupoDe = async (id: number) => (await prisma.forecastProduct.findUniqueOrThrow({ where: { id } })).equivalenceGroupId;

  const draft = (name: string, codes: string[], notes: string | null = null): ProductDraft => ({
    name,
    normalizedName: normalizeProductName(name),
    sheetOrder: null,
    sourceKey: null,
    notes,
    fixedPriceFlag: false,
    packaging: null,
    noFractioning: false,
    sampleQty: null,
    sampleRequestNote: null,
    codes: codes.map((code, i) => ({ position: i + 1, code })),
  });

  // Reimportacao da planilha so com os produtos deste teste (o banco pode ter outros).
  const reimportar = async (drafts: ProductDraft[], inativar: number[] = []) => {
    await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, drafts, new Set());
      await ForecastProductService.apply(
        tx,
        { ...plan, inativados: plan.inativados.filter((p) => inativar.includes(p.id)) },
        new Map(),
        adminId,
      );
    });
  };

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

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Grupos ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    familyId = (await prisma.itemFamily.create({ data: { name: `Familia ${runId}` } })).id;
    const fonte = (name: string, leadTimeDays: number | null) =>
      prisma.forecastSource.create({ data: { name, normalizedName: name, leadTimeDays } });
    sourceAId = (await fonte(FONTE_A, 60)).id;
    sourceBId = (await fonte(FONTE_B, 60)).id;
    sourceCId = (await fonte(FONTE_C, null)).id;

    const novo = async (name: string, codes: string[], sourceId: number | null, isActive = true) =>
      (
        await prisma.forecastProduct.create({
          data: {
            name,
            normalizedName: normalizeProductName(name),
            sourceId,
            isActive,
            codes: { create: codes.map((code, i) => ({ position: i + 1, code })) },
          },
        })
      ).id;
    productA = await novo(NAME_A, [CODE_A, CODE_A2], sourceAId);
    productB = await novo(NAME_B, [CODE_B], sourceBId);
    productC = await novo(NAME_C, [CODE_C], sourceCId);
    productE = await novo(NAME_E, [CODE_E], null, false);
    productF1 = await novo(NAME_F1, [CODE_F1], null);
    productF2 = await novo(NAME_F2, [CODE_F2], null);

    // Quinzena sintetica congelada direto no banco (motor por produto). Vendas = Q em todos os meses.
    const snapshot = await prisma.forecastSnapshot.create({
      data: {
        label: '06-2',
        baseDate: dateKeyToDbDate(BASE_DATE),
        half: 2,
        origin: 'planilha',
        months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
        products: [
          { ...produto(3, NAME_A, CODE_A, FONTE_A, productA), historico: [100, 100, 100, 100, 100] },
          { ...produto(4, NAME_B, CODE_B, FONTE_B, productB), historico: [50, 50, 50, 50, 50] },
          { ...produto(5, NAME_C, CODE_C, FONTE_C, productC), historico: [0, 0, 0, 0, 0] },
        ],
        inputs: {
          estoque: [
            { codigo: CODE_B, qtd: 1000 },
            { codigo: CODE_C, qtd: 200 },
          ],
          vendasMes: [
            { codigo: CODE_A, qtd: 100 },
            { codigo: CODE_B, qtd: 50 },
          ],
          vendasAtual: [],
          vendasAnual: [
            { codigo: CODE_A, qtd: 1100 },
            { codigo: CODE_B, qtd: 550 },
          ],
          programacoes: [],
          chegadas: [],
          leadtime: [
            { fonte: FONTE_A, total: 60 },
            { fonte: FONTE_B, total: 60 },
          ],
          margem: [],
          clientesAtivos: [],
        },
        files: [],
        createdById: adminId,
      },
    });
    snapshotId = snapshot.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastEquivalenceGroup.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.itemFamily.deleteMany({ where: { name: { contains: runId } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('antes do grupo: A compra 300 kg e nao ha grupo no relatorio', async () => {
    const r = await relatorio();
    expect(r.grupos.flatMap((g) => g.itens).map((i) => [i.item, i.quantidadeSugerida])).toEqual([[NAME_A, 300]]);
    expect(r.cobertosPorGrupo).toEqual({ itens: [] });
    expect(r.gruposDeEquivalencia).toEqual([]);
    expect(r.fora.cobertosPorGrupo).toBe(0);
    expect(r.fora.semLeadTime).toBe(1); // C, sozinho, e sem lead time
    const list = await request(app).get('/api/v1/forecast/equivalence-groups').set('Cookie', cookies);
    expect(list.status).toBe(200);
    expect(list.body.data.filter((g: { nome: string }) => g.nome === GRUPO)).toEqual([]);
  });

  testDbSkip('criar o grupo (A principal, B, C): grava o vinculo nos 3, 1 AuditLog com so ids', async () => {
    const res = await criar(grupoBody({ nome: `  ${GRUPO}  ` }));
    expect(res.status).toBe(201);
    grupoId = res.body.data.id;
    expect(res.body.data).toMatchObject({ nome: GRUPO, observacao: `OBS ${U}`, principalProdutoId: productA });
    expect(res.body.data.membros.map((m: { id: number }) => m.id).sort()).toEqual([productA, productB, productC].sort());
    for (const id of [productA, productB, productC]) expect(await grupoDe(id)).toBe(grupoId);
    const bruto = await prisma.forecastEquivalenceGroup.findUniqueOrThrow({ where: { id: grupoId } });
    expect(bruto.normalizedName).toBe(normalizeProductName(GRUPO));
    expect(bruto.createdById).toBe(adminId);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_equivalence_group', entityId: String(grupoId), action: 'create' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].performedById).toBe(adminId);
    expect(logs[0].metadata).toEqual({ produtoIds: [productA, productB, productC], principalProdutoId: productA });
    expect(JSON.stringify(logs[0])).not.toContain(U);
  });

  testDbSkip('relatorio: grupo coberto (+750, cobertura 8,0); A vai para "cobertos"; C nao perde o estoque; snapshot intocado', async () => {
    const antes = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    const r = await relatorio();
    expect(nomesNaLista(r)).toEqual([]);
    expect(r.totais.itens).toBe(0);
    expect(r.fora.semLeadTime).toBe(0);
    expect(r.fora.cobertosPorGrupo).toBe(1);
    expect(r.cobertosPorGrupo.itens).toHaveLength(1);
    expect(r.cobertosPorGrupo.itens[0]).toMatchObject({
      productId: productA,
      item: NAME_A,
      grupoNome: GRUPO,
      quantidadeSugerida: 300,
      estoqueDoGrupo: 1200,
      cobertura: 8,
      // Rodada 5 do Comex: a observacao do grupo (cadastro) chega ao item coberto e ao grupo do relatorio.
      grupoObservacao: `OBS ${U}`,
    });
    expect(r.gruposDeEquivalencia).toHaveLength(1);
    expect(r.gruposDeEquivalencia[0]).toMatchObject({ id: grupoId, nome: GRUPO, situacao: 'coberto', estoque: 1200, observacao: `OBS ${U}` });
    expect(r.gruposDeEquivalencia[0].demanda).toBeCloseTo(750, 6);

    const calc = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}?hoje=${HOJE}`).set('Cookie', cookies);
    const linhas = calc.body.data.linhas as Array<{ productId: number; grupo: { id: number; nome: string; principalProductId: number; observacao: string | null } | null }>;
    for (const id of [productA, productB, productC]) {
      expect(linhas.find((l) => l.productId === id)?.grupo).toEqual({ id: grupoId, nome: GRUPO, principalProductId: productA, observacao: `OBS ${U}` });
    }
    const depois = await prisma.forecastSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect({ products: depois.products, inputs: depois.inputs, months: depois.months }).toEqual({
      products: antes.products,
      inputs: antes.inputs,
      months: antes.months,
    });
  });

  testDbSkip('um produto so em um grupo: B ja esta em outro grupo -> 409 com os nomes; nada novo e gravado', async () => {
    const outro = await criar({ nome: `outro ${U}`, produtoIds: [productF1, productB] });
    expect(outro.status).toBe(409);
    expect(JSON.stringify(outro.body)).toContain(`O produto ${NAME_B} já está no grupo ${GRUPO}.`);
    expect(await grupoDe(productF1)).toBeNull();
    expect(await prisma.forecastEquivalenceGroup.count({ where: { name: { contains: U } } })).toBe(1);
  });

  testDbSkip('produto inativo (400) e inexistente (400): nada e gravado', async () => {
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productE } })).isActive).toBe(false);
    const inativo = await criar({ nome: `inativo ${U}`, produtoIds: [productE, productF1] });
    expect(inativo.status).toBe(400);
    expect(JSON.stringify(inativo.body)).toContain('está inativo');
    const inexistente = await criar({ nome: `fantasma ${U}`, produtoIds: [2_000_000_000, productF1] });
    expect(inexistente.status).toBe(400);
    expect(await grupoDe(productF1)).toBeNull();
    expect(await prisma.forecastEquivalenceGroup.count({ where: { name: { contains: U } } })).toBe(1);
  });

  testDbSkip('nome igual ao de um grupo existente (so muda a caixa) -> 409 e os produtos continuam livres', async () => {
    const res = await criar({ nome: GRUPO.toLowerCase(), produtoIds: [productF1, productF2] });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Já existe um grupo de equivalência com esse nome.');
    expect(await grupoDe(productF1)).toBeNull();
    expect(await grupoDe(productF2)).toBeNull();
    expect(await prisma.forecastEquivalenceGroup.count({ where: { name: { contains: U, mode: 'insensitive' } } })).toBe(1);
  });

  testDbSkip('o XLSX do relatorio ganha a aba "Grupos de equivalência" com total e membros', async () => {
    const res = await request(app)
      .get(`/api/v1/forecast/snapshots/${snapshotId}/relatorio-compras/xlsx?hoje=${HOJE}`)
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    const wb = new exceljs.Workbook();
    await wb.xlsx.load(Buffer.from(res.body.data.contentBase64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Grupos de equivalência')!;
    expect(ws).toBeTruthy();
    expect(ws.rowCount).toBe(1 + 1 + 3);
    expect(String(ws.getRow(2).getCell(1).value)).toBe(GRUPO);
    expect(String(ws.getRow(2).getCell(2).value)).toBe('Coberto pelo estoque somado');
    expect(Number(ws.getRow(2).getCell(6).value)).toBe(1200);
    const motivo = String(ws.getRow(3).getCell(11).value);
    expect(motivo).toContain(`Coberto pelo grupo ${GRUPO}: estoque somado 1.200 kg, cobertura 8,0 meses`);
  });

  testDbSkip('reimportar a planilha (produto alterado) PRESERVA o vinculo do grupo nos 3 produtos', async () => {
    await reimportar([draft(NAME_A, [CODE_A, CODE_A2], `NOTA ${U}`), draft(NAME_B, [CODE_B]), draft(NAME_C, [CODE_C])]);
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA } });
    expect(a.notes).toBe(`NOTA ${U}`); // a reimportacao de fato gravou o produto (mesmo id)
    for (const id of [productA, productB, productC]) expect(await grupoDe(id)).toBe(grupoId);
    expect((await prisma.forecastEquivalenceGroup.findUniqueOrThrow({ where: { id: grupoId } })).principalProductId).toBe(productA);
    expect((await relatorio()).gruposDeEquivalencia).toHaveLength(1);
  });

  testDbSkip('reimportar com os codigos reordenados (codigos apagados e recriados) tambem preserva o vinculo', async () => {
    await reimportar([draft(NAME_A, [CODE_A2, CODE_A]), draft(NAME_B, [CODE_B]), draft(NAME_C, [CODE_C])]);
    const a = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productA }, include: { codes: true } });
    expect(a.codes.map((c) => c.code).sort()).toEqual([CODE_A, CODE_A2].sort());
    expect(a.equivalenceGroupId).toBe(grupoId);
  });

  testDbSkip('produto ausente da reimportacao e inativado, mas fica no grupo; ao voltar ativo o vinculo continua', async () => {
    await reimportar([draft(NAME_A, [CODE_A, CODE_A2]), draft(NAME_B, [CODE_B])], [productC]);
    const inativo = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productC } });
    expect(inativo.isActive).toBe(false);
    expect(inativo.equivalenceGroupId).toBe(grupoId);

    await reimportar([draft(NAME_A, [CODE_A, CODE_A2]), draft(NAME_B, [CODE_B]), draft(NAME_C, [CODE_C])]);
    const volta = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productC } });
    expect(volta.isActive).toBe(true);
    expect(volta.equivalenceGroupId).toBe(grupoId);
  });

  testDbSkip('produto criado pela tela (POST /forecast/products) nasce sem grupo e nao mexe nos vinculos dos outros', async () => {
    const res = await request(app)
      .post('/api/v1/forecast/products')
      .set('Cookie', cookies)
      .send({ nome: NAME_NOVO, codigos: [CODE_NOVO], sourceId: sourceAId, familyId });
    expect(res.status).toBe(201);
    expect(await grupoDe(res.body.data.id)).toBeNull();
    for (const id of [productA, productB, productC]) expect(await grupoDe(id)).toBe(grupoId);
    // O codigo adicionado pela tela a um membro tambem nao tira o produto do grupo.
    const cod = await request(app)
      .post(`/api/v1/forecast/products/${productB}/codigos`)
      .set('Cookie', cookies)
      .send({ codigo: `${U}B2` });
    expect(cod.status).toBe(201);
    expect(await grupoDe(productB)).toBe(grupoId);
  });

  testDbSkip('editar: tirar B e o principal passa a ser C; o grupo A+C precisa comprar 100 kg (na lista, FONTE A)', async () => {
    const res = await editar(grupoId, { produtoIds: [productA, productC], principalProdutoId: productC });
    expect(res.status).toBe(200);
    expect(await grupoDe(productB)).toBeNull();
    expect(await grupoDe(productA)).toBe(grupoId);
    expect(await grupoDe(productC)).toBe(grupoId);
    expect((await prisma.forecastEquivalenceGroup.findUniqueOrThrow({ where: { id: grupoId } })).principalProductId).toBe(productC);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_equivalence_group', entityId: String(grupoId), action: 'update' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toEqual({
      produtoIds: [productA, productC],
      principalProdutoId: productC,
      camposAlterados: ['principalProdutoId', 'produtoIds'],
    });

    // A + C: estoque 200, Q 100, T = 100/30*60 = 200 (C nao tem lead time e entra com 0) -> AN_g = 200 - 200 - 100 = -100.
    // O principal e C (sem lead time): a data-limite usa o lead time do outro membro (60 dias).
    const r = await relatorio();
    const itens = r.grupos.flatMap((g) => g.itens);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ item: GRUPO, productId: productC, quantidadeSugerida: 100 });
    expect(itens[0].grupo?.membros.map((m) => m.productId).sort()).toEqual([productA, productC].sort());
    expect(r.cobertosPorGrupo.itens).toEqual([]);
    expect(r.gruposDeEquivalencia[0]).toMatchObject({ situacao: 'na-lista' });
    // B voltou a avulso: nao esta na lista (tem folga) e nao conta como "sem lead time".
    expect(r.fora.semLeadTime).toBe(0);
  });

  testDbSkip('editar sem alteracao nao audita de novo; principal fora dos membros -> 400', async () => {
    const antes = await prisma.auditLog.count({ where: { entityType: 'forecast_equivalence_group', entityId: String(grupoId) } });
    expect((await editar(grupoId, { nome: GRUPO })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityType: 'forecast_equivalence_group', entityId: String(grupoId) } })).toBe(antes);
    const fora = await editar(grupoId, { principalProdutoId: productB });
    expect(fora.status).toBe(400);
    expect(await editar(2_000_000_000, { nome: `x ${U}` })).toMatchObject({ status: 404 });
  });

  testDbSkip('desfazer: DELETE, membros voltam a avulsos (SetNull), AuditLog com os ids de antes e A volta a comprar 300 kg', async () => {
    const res = await desfazer(grupoId);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: grupoId });
    expect(await prisma.forecastEquivalenceGroup.findUnique({ where: { id: grupoId } })).toBeNull();
    for (const id of [productA, productB, productC]) expect(await grupoDe(id)).toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'forecast_equivalence_group', entityId: String(grupoId), action: 'delete' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].beforeData).toEqual({ produtoIds: [productA, productC], principalProdutoId: productC });
    expect(JSON.stringify(logs[0])).not.toContain(U);

    const r = await relatorio();
    expect(r.grupos.flatMap((g) => g.itens).map((i) => [i.item, i.quantidadeSugerida])).toEqual([[NAME_A, 300]]);
    expect(r.gruposDeEquivalencia).toEqual([]);
    expect((await desfazer(grupoId)).status).toBe(404);
  });

  testDbSkip('apagar o produto principal (FK SetNull) deixa o grupo sem principal e os outros membros no grupo', async () => {
    const d1 = (
      await prisma.forecastProduct.create({
        data: { name: NAME_D1, normalizedName: normalizeProductName(NAME_D1), codes: { create: [{ position: 1, code: CODE_D1 }] } },
      })
    ).id;
    const d2 = (
      await prisma.forecastProduct.create({
        data: { name: NAME_D2, normalizedName: normalizeProductName(NAME_D2), codes: { create: [{ position: 1, code: CODE_D2 }] } },
      })
    ).id;
    const res = await criar({ nome: `FK ${U}`, produtoIds: [d1, d2], principalProdutoId: d1 });
    expect(res.status).toBe(201);
    const id = res.body.data.id as number;
    await prisma.forecastProduct.delete({ where: { id: d1 } });
    const grupo = await prisma.forecastEquivalenceGroup.findUniqueOrThrow({ where: { id }, include: { members: true } });
    expect(grupo.principalProductId).toBeNull();
    expect(grupo.members.map((m) => m.id)).toEqual([d2]);
    expect((await desfazer(id)).status).toBe(200);
  });
});
