import exceljs from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastProductCadastroService } from '../src/services/ForecastProductCadastroService';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fp${Date.now()}`;

// Datas longe do dado real e dos demais testes de forecast. Tudo SINTETICO (repo publico).
const BASE_DATE = '2034-06-15';
const LABEL = '06-2';
const HOJE = '2034-06-20';
const ANTERIOR = '2034-05'; // base-1
const HIST = ['2033-12', '2034-01', '2034-02', '2034-03', '2034-04']; // base-6..base-2
const ALL_MONTHS = [...HIST, ANTERIOR];

const U = runId.toUpperCase();
const CODE_BASE = `${U}B1`; // produto ja cadastrado (ativo)
const CODE_NOVO = `${U}N1`; // pendente: vira produto novo
const CODE_NOVO_2 = `${U}N2`; // pendente: entra depois como 2o codigo do produto novo
const CODE_INATIVO = `${U}I1`; // codigo de produto INATIVO
const CODE_SO_SALDO = `${U}S1`; // so saldo
const SOURCE_NAME = `FONTE ${U} 1`;
const SOURCE_SEM_LT = `FONTE ${U} 2`;
const NAME_BASE = `PRODUTO ${U} BASE`;
const NAME_INATIVO = `PRODUTO ${U} INATIVO`;
const NAME_NOVO = `PRODUTO ${U} NOVO`;

type Cell = string | number | Date | null;

async function xlsxBase64(headers: string[], rows: Cell[][]): Promise<string> {
  const wb = new exceljs.Workbook();
  const ws = wb.addWorksheet('Sheet');
  headers.forEach((h, i) => (ws.getCell(1, i + 1).value = h));
  rows.forEach((row, ri) =>
    row.forEach((value, ci) => {
      if (value !== null) ws.getCell(2 + ri, ci + 1).value = value;
    }),
  );
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

const d = (key: string): Date => {
  const [y, m, day] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const VAZIO = ' ';
const file = (fileName: string, contentBase64: string) => ({ fileName, contentBase64 });

const SALDO_HEADERS = ['Código', 'Descrição', 'Depósito', 'Unidade', 'Saldo Físico Disponível', 'Saldo Ped. Venda', 'Saldo Final', 'Empresa'];
const saldoRow = (codigo: string, qtd: number): Cell[] => [codigo, 'x', 'DEPOSITO TESTE', 'KG', qtd, 0, qtd, 'SQ QUIMICA'];
const VENDAS_HEADERS = ['Descr. Item', 'Item', 'Unid. Medida', 'Quantidade ', 'Empresa'];
const vendasRow = (codigo: string, qtd: number): Cell[] => ['x', codigo, 'KG', qtd, 'SQ QUIMICA'];
const PROG_HEADERS = ['Orçamento', 'Status', 'Data Faturamento', 'Cód. Item', 'Qtde.'];
const FUP_HEADERS = ['STATUS', 'CÓD. SQ', 'QTD - KGS', 'ETD (EMBARQUE)', 'ETA (CHEGADA)', 'ETA FINAL'];

async function reports() {
  return {
    saldo: file(
      'saldo.xlsx',
      await xlsxBase64(SALDO_HEADERS, [
        saldoRow(CODE_BASE, 50),
        saldoRow(CODE_NOVO, 12),
        saldoRow(CODE_SO_SALDO, 7),
      ]),
    ),
    vendasMes: file(
      'vendas-mes.xlsx',
      await xlsxBase64(VENDAS_HEADERS, [
        vendasRow(CODE_BASE, 30),
        vendasRow(CODE_NOVO, 40),
        vendasRow(CODE_NOVO_2, 5),
        vendasRow(CODE_INATIVO, 3),
      ]),
    ),
    vendasAtual: file('vendas-atual.xlsx', await xlsxBase64(VENDAS_HEADERS, [vendasRow(CODE_NOVO, 8)])),
    vendasAnual: file(
      'vendas-anual.xlsx',
      await xlsxBase64(VENDAS_HEADERS, [vendasRow(CODE_BASE, 360), vendasRow(CODE_NOVO, 300)]),
    ),
    programacao: file(
      'programacao.xlsx',
      await xlsxBase64(PROG_HEADERS, [[1, 'Pendente', d('2034-06-20'), CODE_NOVO_2, 60]]),
    ),
    fup: file(
      'fup.xlsx',
      await xlsxBase64(FUP_HEADERS, [['EM TRANSITO', CODE_NOVO, 500, VAZIO, d('2034-06-25'), VAZIO]]),
    ),
  };
}

describe('Forecast - produtos pendentes de cadastro (DB)', () => {
  let cookies: string[] = [];
  let adminId: number;
  let familyId: number;
  let familyInativaId: number;
  let sourceId: number;
  let sourceSemLtId: number;
  let baseProductId: number;
  let inativoProductId: number;
  let novoProductId: number;
  let snapshotId: number;

  const post = (path: string, body: unknown) =>
    request(app).post(path).set('Cookie', cookies).send(body as object);
  const preview = async () =>
    request(app)
      .post('/api/v1/forecast/import/dbcorp/preview')
      .set('Cookie', cookies)
      .send({ label: LABEL, baseDate: BASE_DATE, files: await reports() });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Pendentes ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    familyId = (await prisma.itemFamily.create({ data: { name: `Familia ${runId}` } })).id;
    familyInativaId = (await prisma.itemFamily.create({ data: { name: `Familia inativa ${runId}`, isActive: false } })).id;
    sourceId = (
      await prisma.forecastSource.create({
        data: { name: SOURCE_NAME, normalizedName: SOURCE_NAME, leadTimeDays: 30 },
      })
    ).id;
    sourceSemLtId = (
      await prisma.forecastSource.create({ data: { name: SOURCE_SEM_LT, normalizedName: SOURCE_SEM_LT } })
    ).id;
    baseProductId = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_BASE,
          normalizedName: NAME_BASE,
          sheetOrder: 90001,
          sourceId,
          codes: { create: [{ position: 1, code: CODE_BASE }] },
        },
      })
    ).id;
    inativoProductId = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_INATIVO,
          normalizedName: NAME_INATIVO,
          sheetOrder: 90002,
          isActive: false,
          codes: { create: [{ position: 1, code: CODE_INATIVO }] },
        },
      })
    ).id;
    // Historico dos 5 meses (o confirm exige).
    await prisma.forecastMonthlySale.createMany({
      data: HIST.flatMap((yearMonth) => [
        { code: CODE_BASE, yearMonth, quantity: 10, sourceLabel: `semente ${runId}` },
        { code: CODE_NOVO, yearMonth, quantity: 20, sourceLabel: `semente ${runId}` },
      ]),
    });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastMonthlySale.deleteMany({ where: { yearMonth: { in: ALL_MONTHS } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
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

  testDbSkip('preview DBCorp lista os pendentes com o consumo do DBCorp (sem gravar nada)', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.erros).toEqual([]);
    expect(data.pendentes.totalItens).toBe(3);
    expect(data.pendentes.omitidos).toBe(0);
    expect(data.pendentes.itens.map((i: { codigo: string }) => i.codigo)).toEqual([CODE_NOVO, CODE_NOVO_2, CODE_INATIVO]);
    expect(data.pendentes.itens[0]).toMatchObject({
      situacao: 'sem_cadastro',
      produtoInativo: null,
      vendasMes: 40,
      vendasAtual: 8,
      vendasAnual: 300,
      programacao: 0,
      chegadas: 500,
      saldo: 12,
    });
    expect(data.pendentes.itens[1]).toMatchObject({ vendasMes: 5, programacao: 60 });
    expect(data.pendentes.itens[2]).toMatchObject({
      situacao: 'produto_inativo',
      produtoInativo: { id: inativoProductId, nome: NAME_INATIVO },
    });
    expect(data.pendentes.soSaldo).toEqual({ codigos: 1, kg: 7 });
    expect(data.avisos).toContain(
      '3 códigos com venda, programação ou chegada no DBCorp não estão no cadastro e ficam FORA do cálculo até completar o cadastro.',
    );
    expect(await prisma.forecastSnapshot.count({ where: { createdById: adminId } })).toBe(0);
  });

  testDbSkip('POST /forecast/products: valida fonte/familia/codigo e cria com origin dbcorp + AuditLog', async () => {
    const corpo = { nome: NAME_NOVO, codigos: [CODE_NOVO], sourceId, familyId };
    const url = '/api/v1/forecast/products';

    const semLeadTime = await post(url, { ...corpo, sourceId: sourceSemLtId });
    expect(semLeadTime.status).toBe(400);
    expect(semLeadTime.body.message).toBe('A fonte escolhida não tem lead time cadastrado.');
    expect((await post(url, { ...corpo, familyId: familyInativaId })).status).toBe(400);
    const codigoUsado = await post(url, { ...corpo, nome: `${NAME_NOVO} X`, codigos: [CODE_BASE] });
    expect(codigoUsado.status).toBe(409);
    expect(codigoUsado.body.message).toBe(`O código ${CODE_BASE} já pertence ao produto ${NAME_BASE}.`);
    // Codigo de produto INATIVO tambem e codigo usado (nao ha reativacao pela tela).
    expect((await post(url, { ...corpo, nome: `${NAME_NOVO} Y`, codigos: [CODE_INATIVO] })).status).toBe(409);
    expect((await post(url, { ...corpo, nome: NAME_BASE })).status).toBe(409);
    expect(await prisma.forecastProduct.count({ where: { name: { contains: NAME_NOVO } } })).toBe(0);

    const ok = await post(url, corpo);
    expect(ok.status).toBe(201);
    novoProductId = ok.body.data.id;
    expect(ok.body.data).toMatchObject({
      nome: NAME_NOVO,
      origem: 'dbcorp',
      fonteId: sourceId,
      familiaId: familyId,
      codigos: [{ posicao: 1, codigo: CODE_NOVO }],
    });

    const row = await prisma.forecastProduct.findUniqueOrThrow({
      where: { id: novoProductId },
      include: { codes: true },
    });
    expect(row).toMatchObject({ origin: 'dbcorp', isActive: true, sheetOrder: null, sourceId, familyId });
    expect(row.codes.map((c) => [c.position, c.code, c.packagingQtyKg])).toEqual([[1, CODE_NOVO, null]]);

    const audits = await prisma.auditLog.findMany({
      where: { performedById: adminId, entityType: 'forecast_product', entityId: String(novoProductId) },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('create');
    expect(audits[0].metadata).toEqual({ source: 'dbcorp_pendente', sourceId, familyId, codigos: 1 });
    expect(JSON.stringify(audits[0])).not.toContain(U);
  });

  testDbSkip('novo preview: o codigo sai dos pendentes e o produto entra no calculo (confirm + GET)', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body.data.produtos.total).toBe(2); // base + novo (o inativo nao conta)
    expect(res.body.data.pendentes.itens.map((i: { codigo: string }) => i.codigo)).toEqual([CODE_NOVO_2, CODE_INATIVO]);
    expect(res.body.data.relatorios.vendasMes.codigosSemProduto).toBe(2);

    const confirm = await post('/api/v1/forecast/import/dbcorp/confirm', {
      label: LABEL,
      baseDate: BASE_DATE,
      files: await reports(),
    });
    expect(confirm.status).toBe(201);
    snapshotId = confirm.body.data.snapshotId;

    const calc = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}?hoje=${HOJE}`).set('Cookie', cookies);
    expect(calc.status).toBe(200);
    const linha = (calc.body.data.linhas as Array<{ productId: number | null; U: number; O: number; P: number; chegadas: number[]; fonte: string }>)
      .find((l) => l.productId === novoProductId)!;
    expect(linha).toBeDefined();
    expect(linha).toMatchObject({ U: 12, O: 40, P: 8, fonte: SOURCE_NAME });
    expect(linha.chegadas).toEqual([500, 0, 0, 0, 0]);

    const pend = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/pendentes`).set('Cookie', cookies);
    expect(pend.status).toBe(200);
    expect(pend.body.data).toMatchObject({ aplicavel: true, snapshotId, label: LABEL, totalItens: 2 });
    expect(pend.body.data.itens.map((i: { codigo: string }) => i.codigo)).toEqual([CODE_NOVO_2, CODE_INATIVO]);
    expect(pend.body.data.soSaldo).toEqual({ codigos: 1, kg: 7 });
  });

  testDbSkip('POST /forecast/products/:id/codigos usa a menor posicao livre (sem embalagem) e audita', async () => {
    const url = `/api/v1/forecast/products/${novoProductId}/codigos`;
    // Libera um buraco: posicoes 1 e 3 ocupadas -> o novo codigo vai para a 2.
    await prisma.forecastProductCode.create({
      data: { productId: novoProductId, position: 3, code: `${U}N3` },
    });
    const ok = await post(url, { codigo: ` ${CODE_NOVO_2.toLowerCase()} ` });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ produtoId: novoProductId, codigo: { posicao: 2, codigo: CODE_NOVO_2 } });

    const codigos = await prisma.forecastProductCode.findMany({
      where: { productId: novoProductId },
      orderBy: { position: 'asc' },
    });
    expect(codigos.map((c) => [c.position, c.code])).toEqual([
      [1, CODE_NOVO],
      [2, CODE_NOVO_2],
      [3, `${U}N3`],
    ]);
    expect(codigos[1].packagingQtyKg).toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { performedById: adminId, entityType: 'forecast_product', action: 'code_add' },
    });
    expect(audit.entityId).toBe(String(novoProductId));
    expect(audit.metadata).toMatchObject({ source: 'dbcorp_pendente', position: 2 });
    expect(JSON.stringify(audit)).not.toContain(U);

    // Repetir -> 409; produto inativo -> 400; produto inexistente -> 404.
    expect((await post(url, { codigo: CODE_NOVO_2 })).status).toBe(409);
    expect((await post(`/api/v1/forecast/products/${inativoProductId}/codigos`, { codigo: `${U}Z9` })).status).toBe(400);
    expect((await post('/api/v1/forecast/products/2147483000/codigos', { codigo: `${U}Z9` })).status).toBe(404);

    // O pendente da quinzena ja gravada sai da lista (cadastro ATUAL); a quinzena em si nao muda.
    const pend = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/pendentes`).set('Cookie', cookies);
    expect(pend.body.data.itens.map((i: { codigo: string }) => i.codigo)).toEqual([CODE_INATIVO]);
  });

  testDbSkip('import da PLANILHA nao inativa o produto da tela (com aviso) e o adota quando o nome vem na planilha', async () => {
    const draft = (name: string, codes: string[]): ProductDraft => ({
      name,
      normalizedName: name,
      sheetOrder: 1,
      sourceKey: SOURCE_NAME,
      notes: null,
      fixedPriceFlag: false,
      packaging: null,
      noFractioning: false,
      sampleQty: null,
      sampleRequestNote: null,
      codes: codes.map((code, index) => ({ position: index + 1, code })),
    });
    const known = new Set([SOURCE_NAME]);
    const sourceIdByKey = new Map([[SOURCE_NAME, sourceId]]);

    // 0) Codigo acrescentado pela tela ao produto da PLANILHA: a resposta traz a origem e o preview do import avisa.
    const acrescentado = await ForecastProductCadastroService.addCode(baseProductId, { codigo: `${U}B2` }, adminId);
    expect(acrescentado.produtoOrigem).toBe('planilha');
    const preview = await prisma.$transaction((tx) =>
      ForecastProductService.plan(tx, [draft(NAME_BASE, [CODE_BASE])], known),
    );
    expect(
      preview.avisos.some((a) =>
        /^\d+ códigos acrescentados pela tela não estão na planilha e serão removidos\. Inclua-os na planilha\.$/.test(a),
      ),
    ).toBe(true);

    // 1) Planilha SEM o produto da tela (so o base): ele nao entra em `inativados`; o base ausente nao existe aqui.
    const semNovo = await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, [draft(NAME_BASE, [CODE_BASE])], known);
      await ForecastProductService.apply(tx, plan, sourceIdByKey, adminId);
      return plan;
    });
    expect(semNovo.inativados.map((i) => i.id)).not.toContain(novoProductId);
    expect(semNovo.avisos).toContain(
      '1 produtos cadastrados pela tela a partir do DBCorp não estão na planilha e continuam ativos.',
    );
    const aindaAtivo = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: novoProductId } });
    expect(aindaAtivo).toMatchObject({ isActive: true, origin: 'dbcorp' });
    // O produto base (planilha) segue como 'planilha'.
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: baseProductId } })).origin).toBe('planilha');

    // 2) Planilha COM o mesmo nome: adota (alterado + aviso) e vira 'planilha'.
    const comNovo = await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(
        tx,
        [draft(NAME_BASE, [CODE_BASE]), draft(NAME_NOVO, [CODE_NOVO, CODE_NOVO_2, `${U}N3`])],
        known,
      );
      const item = plan.items.find((i) => i.draft.normalizedName === NAME_NOVO)!;
      expect(item.existingId).toBe(novoProductId);
      expect(item.change).toBe('alterado');
      expect(item.fieldsChanged).toBe(true);
      await ForecastProductService.apply(tx, plan, sourceIdByKey, adminId);
      return plan;
    });
    expect(comNovo.avisos).toContain('1 produtos cadastrados pela tela passam a vir da planilha: fonte, família e códigos escolhidos na tela serão substituídos pelos da planilha.');
    expect(comNovo.avisos.some((a) => a.includes('continuam ativos'))).toBe(false);
    const adotado = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: novoProductId } });
    expect(adotado).toMatchObject({ isActive: true, origin: 'planilha' });

    // 3) Depois de adotado, sair da planilha volta a inativar (regra normal da planilha).
    const sai = await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, [draft(NAME_BASE, [CODE_BASE])], known);
      await ForecastProductService.apply(tx, plan, sourceIdByKey, adminId);
      return plan;
    });
    expect(sai.inativados.map((i) => i.id)).toContain(novoProductId);
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: novoProductId } })).isActive).toBe(false);
  });
});
