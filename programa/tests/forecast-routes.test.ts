import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORECAST_SHEETS, FORECAST_TOO_LARGE_MESSAGE } from '../src/constants/forecast';
import type { Quinzena } from '../src/utils/forecastTypes';
import { hashPassword } from '../src/utils/password';
import { forecastDbcorpConfirmSchema, forecastDbcorpPreviewSchema } from '../src/validators/forecast';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSource: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    forecastProduct: { findMany: vi.fn() },
    forecastAtypicalMonth: { findMany: vi.fn() },
    forecastCommercialDemand: { findMany: vi.fn() },
    forecastProductCode: { findMany: vi.fn() },
    forecastSnapshot: { findMany: vi.fn(), findFirst: vi.fn() },
    forecastMonthlySale: { findMany: vi.fn() },
    catalogItem: { findMany: vi.fn() },
    supplier: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastSource: { findMany: Mock; findUnique: Mock; update: Mock };
  forecastProduct: { findMany: Mock };
  forecastAtypicalMonth: { findMany: Mock };
  forecastCommercialDemand: { findMany: Mock };
  forecastProductCode: { findMany: Mock };
  forecastSnapshot: { findMany: Mock; findFirst: Mock };
  forecastMonthlySale: { findMany: Mock };
  catalogItem: { findMany: Mock };
  supplier: { findFirst: Mock; findMany: Mock };
  $transaction: Mock;
};

// Fixture ANONIMIZADA (repo publico).
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const READ_ROLES: Role[] = ['admin', 'comprador', 'gestor', 'viewer'];
const WRITE_ROLES: Role[] = ['admin', 'comprador'];

const validPreviewBody = {
  contentBase64: Buffer.from('conteudo qualquer').toString('base64'),
  fileName: 'quinzena.xlsx',
  label: '10-2',
  baseDate: '2026-10-15',
};
const validConfirmBody = {
  ...validPreviewBody,
  options: { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true },
};

// Quinzena DBCorp: os arquivos sao lixo de proposito (so interessa o que roda antes da leitura).
const fakeFile = (name: string) => ({
  fileName: name,
  contentBase64: Buffer.from('conteudo qualquer').toString('base64'),
});
const validDbcorpBody = {
  label: '10-2',
  baseDate: '2026-10-15',
  files: {
    saldo: fakeFile('saldo.xlsx'),
    vendasMes: fakeFile('vendas-mes.xlsx'),
    vendasAtual: fakeFile('vendas-atual.xlsx'),
    vendasAnual: fakeFile('vendas-anual.xlsx'),
    programacao: fakeFile('programacao.xlsx'),
    fup: fakeFile('fup.xlsx'),
  },
};

// Planilha sintetica no formato da 1B (10 abas) com 1 produto e a VENDAS MENSAL SEM linhas.
async function workbookSemVendasBase64(): Promise<string> {
  const wb = new exceljs.Workbook();
  const sheets = Object.fromEntries(
    Object.entries(FORECAST_SHEETS).map(([key, name]) => [key, wb.addWorksheet(name)]),
  ) as Record<keyof typeof FORECAST_SHEETS, exceljs.Worksheet>;
  const macro = sheets.macro;
  macro.getCell('O2').value = '09'; // mes anterior a 2026-10-15
  macro.getCell('A3').value = 1;
  macro.getCell('B3').value = 'TST0001';
  macro.getCell('I3').value = 'PRODUTO TESTE';
  macro.getCell('Q3').value = { formula: '1+0', result: 1 };
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

describe('Forecast routes - autenticacao e papeis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.forecastSource.findMany.mockResolvedValue([]);
    prismaMock.forecastProduct.findMany.mockResolvedValue([]);
    prismaMock.forecastSnapshot.findMany.mockResolvedValue([]);
  });

  const endpoints: Array<{ method: 'get' | 'post' | 'patch'; path: string; body?: unknown }> = [
    { method: 'post', path: '/api/v1/forecast/import/workbook/preview', body: validPreviewBody },
    { method: 'post', path: '/api/v1/forecast/import/workbook/confirm', body: validConfirmBody },
    { method: 'post', path: '/api/v1/forecast/import/dbcorp/preview', body: validDbcorpBody },
    { method: 'post', path: '/api/v1/forecast/import/dbcorp/confirm', body: validDbcorpBody },
    { method: 'get', path: '/api/v1/forecast/sources' },
    { method: 'patch', path: '/api/v1/forecast/sources/1', body: { isActive: false } },
    { method: 'get', path: '/api/v1/forecast/products' },
    { method: 'get', path: '/api/v1/forecast/snapshots' },
    { method: 'get', path: '/api/v1/forecast/snapshots/1' },
    { method: 'get', path: '/api/v1/forecast/snapshots/1/relatorio-compras' },
    { method: 'get', path: '/api/v1/forecast/snapshots/1/relatorio-compras/xlsx' },
  ];

  it.each(endpoints)('sem login: $method $path -> 401', async ({ method, path, body }) => {
    const response = await request(app)[method](path).send(body as object);
    expect(response.status).toBe(401);
  });

  it.each(endpoints)('comercial: $method $path -> 403', async ({ method, path, body }) => {
    const cookies = await loginAs('comercial');
    const response = await request(app)[method](path).set('Cookie', cookies).send(body as object);
    expect(response.status).toBe(403);
  });

  it.each(['viewer', 'gestor'] as const)('%s: escrita -> 403', async (role) => {
    const cookies = await loginAs(role);
    for (const { method, path, body } of endpoints.filter((e) => e.method !== 'get')) {
      const response = await request(app)[method](path).set('Cookie', cookies).send(body as object);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it.each(READ_ROLES)('%s: leituras -> 200', async (role) => {
    const cookies = await loginAs(role);
    for (const path of ['sources', 'products', 'snapshots']) {
      const response = await request(app).get(`/api/v1/forecast/${path}`).set('Cookie', cookies);
      expect(response.status, path).toBe(200);
      expect(response.body).toEqual({ data: [] });
    }
  });

  it.each(WRITE_ROLES)('%s: passa do RBAC na escrita (corpo invalido -> 400, nao 403)', async (role) => {
    const cookies = await loginAs(role);
    for (const path of [
      'import/workbook/preview',
      'import/workbook/confirm',
      'import/dbcorp/preview',
      'import/dbcorp/confirm',
    ]) {
      const response = await request(app).post(`/api/v1/forecast/${path}`).set('Cookie', cookies).send({});
      expect(response.status, path).toBe(400);
    }
  });
});

describe('Forecast routes - validacao (Zod)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preview: corpo vazio, rotulo e data invalidos -> 400', async () => {
    const cookies = await loginAs('comprador');
    const post = (body: unknown) =>
      request(app).post('/api/v1/forecast/import/workbook/preview').set('Cookie', cookies).send(body as object);

    expect((await post({})).status).toBe(400);
    expect((await post({ ...validPreviewBody, contentBase64: '' })).status).toBe(400);
    expect((await post({ ...validPreviewBody, label: '10-3' })).status).toBe(400);
    expect((await post({ ...validPreviewBody, label: 'abc' })).status).toBe(400);
    expect((await post({ ...validPreviewBody, baseDate: '2026-02-30' })).status).toBe(400);
    expect((await post({ ...validPreviewBody, baseDate: '15/10/2026' })).status).toBe(400);
    expect((await post({ ...validPreviewBody, fileName: '' })).status).toBe(400);
  });

  it('preview: arquivo que nao e xlsx -> 400 com mensagem (sem tocar no banco)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post('/api/v1/forecast/import/workbook/preview')
      .set('Cookie', cookies)
      .send(validPreviewBody);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/xlsx/i);
    expect(prismaMock.forecastSource.findMany).not.toHaveBeenCalled();
  });

  it('confirm: exige as 3 opcoes e ao menos uma verdadeira', async () => {
    const cookies = await loginAs('admin');
    const post = (options: unknown) =>
      request(app)
        .post('/api/v1/forecast/import/workbook/confirm')
        .set('Cookie', cookies)
        .send({ ...validPreviewBody, options });

    expect((await post(undefined)).status).toBe(400);
    expect((await post({ atualizarCadastro: true })).status).toBe(400);
    const nenhuma = await post({ atualizarCadastro: false, gravarHistorico: false, criarQuinzena: false });
    expect(nenhuma.status).toBe(400);
    expect(nenhuma.body.message).toMatch(/ao menos uma opcao/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('dbcorp: corpo sem saldo, rotulo, data e arquivo invalidos -> 400 (sem tocar no banco)', async () => {
    const cookies = await loginAs('comprador');
    const { saldo: _saldo, ...semSaldo } = validDbcorpBody.files;
    void _saldo;
    const fupVazio = { ...validDbcorpBody.files, fup: { fileName: 'fup.xlsx', contentBase64: '' } };
    for (const path of ['preview', 'confirm']) {
      const post = (body: unknown) =>
        request(app).post(`/api/v1/forecast/import/dbcorp/${path}`).set('Cookie', cookies).send(body as object);

      expect((await post({ ...validDbcorpBody, files: semSaldo })).status, path).toBe(400);
      expect((await post({ ...validDbcorpBody, files: undefined })).status, path).toBe(400);
      expect((await post({ ...validDbcorpBody, label: '10-3' })).status, path).toBe(400);
      expect((await post({ ...validDbcorpBody, baseDate: '2026-02-30' })).status, path).toBe(400);
      expect((await post({ ...validDbcorpBody, files: fupVazio })).status, path).toBe(400);
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.findMany).not.toHaveBeenCalled();
  });

  it('dbcorp: 2a quinzena exige vendasAtual; na 1a quinzena passa da validacao', async () => {
    const cookies = await loginAs('admin');
    const { vendasAtual: _vendasAtual, ...semAtual } = validDbcorpBody.files;
    void _vendasAtual;
    const post = (label: string) =>
      request(app)
        .post('/api/v1/forecast/import/dbcorp/preview')
        .set('Cookie', cookies)
        .send({ ...validDbcorpBody, label, files: semAtual });

    const segunda = await post('10-2');
    expect(segunda.status).toBe(400);
    expect(segunda.body.message).toBe('Na 2a quinzena envie o relatorio de vendas do mes atual (ate o dia 15).');

    // 10-1 sem vendasAtual passa do Zod e so falha na leitura do arquivo (que aqui e lixo).
    const primeira = await post('10-1');
    expect(primeira.status).toBe(400);
    expect(primeira.body.message).not.toBe(segunda.body.message);
    expect(primeira.body.message).toMatch(/invalido \(envie \.xlsx\)/);
    expect(prismaMock.forecastProduct.findMany).not.toHaveBeenCalled();
  });

  it('dbcorp: prazosEstimativa invalido -> 400 (preview e confirm), sem tocar no banco', async () => {
    const cookies = await loginAs('comprador');
    const prazo = (over: object = {}) => ({ sourceId: 1, prontidaoDias: 35, etdDias: 35, ...over });
    const casos: Array<[string, unknown, RegExp]> = [
      ['fonte repetida', [prazo(), prazo({ prontidaoDias: 20 })], /Fonte repetida/],
      ['366 dias (prontidao)', [prazo({ prontidaoDias: 366 })], /no maximo 365/],
      ['366 dias (etd)', [prazo({ etdDias: 366 })], /no maximo 365/],
      ['dias negativos', [prazo({ etdDias: -1 })], /negativos/],
      ['dias fracionarios', [prazo({ prontidaoDias: 12.5 })], /inteiro/],
      ['dias em texto', [prazo({ prontidaoDias: '20' })], /inteiro/],
      ['sourceId zero', [prazo({ sourceId: 0 })], /Fonte invalida/],
      ['sourceId fracionario', [prazo({ sourceId: 1.5 })], /Fonte invalida/],
      ['sem dias de ETD', [{ sourceId: 1, prontidaoDias: 35 }], /inteiro/],
      ['nao e lista', { sourceId: 1 }, /./],
      [
        '501 fontes',
        Array.from({ length: 501 }, (_, i) => prazo({ sourceId: i + 1 })),
        /no maximo 500/,
      ],
    ];
    for (const path of ['preview', 'confirm']) {
      for (const [nome, prazosEstimativa, mensagem] of casos) {
        const response = await request(app)
          .post(`/api/v1/forecast/import/dbcorp/${path}`)
          .set('Cookie', cookies)
          .send({ ...validDbcorpBody, prazosEstimativa });
        expect(response.status, `${path}: ${nome}`).toBe(400);
        expect(response.body.message, `${path}: ${nome}`).toMatch(mensagem);
      }
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.forecastProduct.findMany).not.toHaveBeenCalled();
  });

  it('dbcorp: prazosEstimativa valido (ou ausente) passa do Zod e o Zod NAO descarta o campo', async () => {
    const cookies = await loginAs('admin');
    const prazosEstimativa = [
      { sourceId: 1, prontidaoDias: 0, etdDias: 365 },
      { sourceId: 2, prontidaoDias: 20, etdDias: 35 },
    ];
    // Arquivos-lixo: passa da validacao e so falha na leitura do .xlsx (400 com outra mensagem).
    for (const path of ['preview', 'confirm']) {
      for (const body of [{ ...validDbcorpBody, prazosEstimativa }, validDbcorpBody, { ...validDbcorpBody, prazosEstimativa: [] }]) {
        const response = await request(app)
          .post(`/api/v1/forecast/import/dbcorp/${path}`)
          .set('Cookie', cookies)
          .send(body);
        expect(response.status, path).toBe(400);
        expect(response.body.message, path).toMatch(/invalido \(envie \.xlsx\)/);
      }
    }
    // O schema compartilhado pelo preview e pelo confirm mantem a lista (o confirm repete o calculo do preview).
    expect(forecastDbcorpPreviewSchema.parse({ ...validDbcorpBody, prazosEstimativa }).prazosEstimativa).toEqual(
      prazosEstimativa,
    );
    expect(forecastDbcorpConfirmSchema.parse({ ...validDbcorpBody, prazosEstimativa }).prazosEstimativa).toEqual(
      prazosEstimativa,
    );
    expect(forecastDbcorpPreviewSchema.parse(validDbcorpBody).prazosEstimativa).toBeUndefined();
  });

  it('PATCH /sources/:id: id e corpo invalidos -> 400', async () => {
    const cookies = await loginAs('comprador');
    const patch = (path: string, body: unknown) =>
      request(app).patch(path).set('Cookie', cookies).send(body as object);

    expect((await patch('/api/v1/forecast/sources/abc', { isActive: true })).status).toBe(400);
    expect((await patch('/api/v1/forecast/sources/1', {})).status).toBe(400);
    expect((await patch('/api/v1/forecast/sources/1', { leadTimeDays: -1 })).status).toBe(400);
    expect((await patch('/api/v1/forecast/sources/1', { leadTimeDays: 1.5 })).status).toBe(400);
    expect((await patch('/api/v1/forecast/sources/1', { supplierId: 0 })).status).toBe(400);
    expect((await patch('/api/v1/forecast/sources/1', { isActive: 'sim' })).status).toBe(400);
    expect(prismaMock.forecastSource.findUnique).not.toHaveBeenCalled();
  });

  it('PATCH /sources/:id: fonte inexistente -> 404; fornecedor inexistente -> 400', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.forecastSource.findUnique.mockResolvedValue(null);
    const naoAcha = await request(app)
      .patch('/api/v1/forecast/sources/9')
      .set('Cookie', cookies)
      .send({ isActive: false });
    expect(naoAcha.status).toBe(404);

    prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 9 });
    prismaMock.supplier.findFirst.mockResolvedValue(null);
    const semFornecedor = await request(app)
      .patch('/api/v1/forecast/sources/9')
      .set('Cookie', cookies)
      .send({ supplierId: 123 });
    expect(semFornecedor.status).toBe(400);
    expect(prismaMock.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 123, deletedAt: null } }),
    );
  });

  it('GET /snapshots/:id: id e hoje invalidos -> 400; inexistente -> 404', async () => {
    const cookies = await loginAs('viewer');
    expect((await request(app).get('/api/v1/forecast/snapshots/abc').set('Cookie', cookies)).status).toBe(400);
    expect(
      (await request(app).get('/api/v1/forecast/snapshots/1?hoje=2026-13-01').set('Cookie', cookies)).status,
    ).toBe(400);

    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const naoAcha = await request(app).get('/api/v1/forecast/snapshots/5').set('Cookie', cookies);
    expect(naoAcha.status).toBe(404);
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 5, deletedAt: null },
    });
  });

  it('GET /snapshots/:id/relatorio-compras: id e hoje invalidos -> 400; inexistente -> 404', async () => {
    const cookies = await loginAs('viewer');
    expect(
      (await request(app).get('/api/v1/forecast/snapshots/abc/relatorio-compras').set('Cookie', cookies)).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get('/api/v1/forecast/snapshots/1/relatorio-compras?hoje=2026-13-01')
          .set('Cookie', cookies)
      ).status,
    ).toBe(400);

    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const naoAcha = await request(app)
      .get('/api/v1/forecast/snapshots/5/relatorio-compras')
      .set('Cookie', cookies);
    expect(naoAcha.status).toBe(404);
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 5, deletedAt: null },
    });
  });

  it('GET /snapshots/:id/relatorio-compras/xlsx: id e hoje invalidos -> 400; inexistente -> 404', async () => {
    const cookies = await loginAs('viewer');
    expect(
      (await request(app).get('/api/v1/forecast/snapshots/abc/relatorio-compras/xlsx').set('Cookie', cookies))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get('/api/v1/forecast/snapshots/1/relatorio-compras/xlsx?hoje=2026-13-01')
          .set('Cookie', cookies)
      ).status,
    ).toBe(400);

    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const naoAcha = await request(app)
      .get('/api/v1/forecast/snapshots/5/relatorio-compras/xlsx')
      .set('Cookie', cookies);
    expect(naoAcha.status).toBe(404);
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 5, deletedAt: null },
    });
  });

  it('GET /snapshots: lista so nao deletadas e sem os Json grandes', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.forecastSnapshot.findMany.mockResolvedValue([]);
    await request(app).get('/api/v1/forecast/snapshots').set('Cookie', cookies);
    const args = prismaMock.forecastSnapshot.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null });
    expect(args.select).not.toHaveProperty('products');
    expect(args.select).not.toHaveProperty('inputs');
    expect(args.select).not.toHaveProperty('expected');
  });
});

describe('Forecast routes - quinzena calculada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Meses atipicos (PR 6c): sem marca por padrao.
    prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([]);
  });

  it('GET /snapshots/:id devolve as linhas do motor e a conferencia com o Excel', async () => {
    const cookies = await loginAs('viewer');
    const produtos = fixture.produtos.slice(0, 5);
    const linhasDe = new Set(produtos.map((p) => String(p.linha)));
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'planilha',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: produtos.map((p, i) => ({ ...p, productId: 100 + i })),
      inputs: fixture.entradas,
      expected: Object.fromEntries(Object.entries(fixture.esperado).filter(([linha]) => linhasDe.has(linha))),
      files: [{ kind: 'planilha', fileName: 'quinzena.xlsx', sha256: 'abc', rows: 5 }],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });

    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7?hoje=2026-10-20')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data.label).toBe('10-2');
    expect(data.baseDate).toBe('2026-10-15');
    expect(data.hoje).toBe('2026-10-20');
    expect(data.linhas).toHaveLength(5);
    expect(data.linhas[0]).toMatchObject({
      linha: produtos[0].linha,
      item: produtos[0].item,
      fonte: produtos[0].fonte,
      productId: 100,
    });
    // Campos que a grade do painel precisa (so existem no produto congelado).
    expect(data.linhas[0]).toMatchObject({
      n: produtos[0].n,
      historico: produtos[0].historico,
      obs: produtos[0].obs,
      precoFixo: produtos[0].precoFechado.trim().toUpperCase() === 'X',
    });
    expect(typeof data.linhas[0].Q).toBe('number');
    expect(data.conferencia.celulas).toBe(5 * 28);
    expect(data.conferencia.batem).toBe(data.conferencia.celulas);
    expect(data.conferencia.divergencias).toEqual([]);
  });

  it('mes atipico marcado: a linha usa a media sem o mes e a conferencia continua pela planilha (5 x 28)', async () => {
    const cookies = await loginAs('viewer');
    const produtos = fixture.produtos.slice(0, 5);
    const linhasDe = new Set(produtos.map((p) => String(p.linha)));
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'planilha',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: produtos.map((p, i) => ({ ...p, productId: 100 + i })),
      inputs: fixture.entradas,
      expected: Object.fromEntries(Object.entries(fixture.esperado).filter(([linha]) => linhasDe.has(linha))),
      files: [{ kind: 'planilha', fileName: 'quinzena.xlsx', sha256: 'abc', rows: 5 }],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    // 2026-08 = N (indice 4) na quinzena 10-2; 2025-01 esta fora da janela (a marca continua gravada, sem efeito aqui).
    prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([
      { productId: 100, yearMonth: '2025-01', reason: 'MOTIVO ANTIGO SINTETICO' },
      { productId: 100, yearMonth: '2026-08', reason: 'MOTIVO SINTETICO' },
    ]);

    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7?hoje=2026-10-20')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(prismaMock.forecastAtypicalMonth.findMany).toHaveBeenCalledTimes(1);
    const marcada = data.linhas[0];
    expect(marcada.mesesForaDaMedia).toEqual([{ anoMes: '2026-08', motivo: 'MOTIVO SINTETICO', indice: 4 }]);
    const [, , , M] = produtos[0].historico;
    expect(marcada.Q).toBeCloseTo((M + marcada.O) / 2, 9);
    expect(marcada.mediaAjustada).toMatchObject({ meses: [4], semMesValido: false });
    expect(marcada.mediaAjustada.Q).toBeCloseTo((M + produtos[0].historico[4] + marcada.O) / 3, 9);
    for (const outra of data.linhas.slice(1) as Array<{ mesesForaDaMedia: unknown[]; mediaAjustada?: unknown }>) {
      expect(outra.mesesForaDaMedia).toEqual([]);
      expect(outra.mediaAjustada).toBeUndefined();
    }
    // A conferencia compara com as medias da planilha: segue 100%, com marca no cadastro.
    expect(data.conferencia.celulas).toBe(5 * 28);
    expect(data.conferencia.batem).toBe(data.conferencia.celulas);
  });

  it('sem expected (origem dbcorp) a conferencia vem nula; 1a quinzena usa AG = Q', async () => {
    const cookies = await loginAs('gestor');
    const produtos = fixture.produtos.slice(0, 30);
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 8,
      label: '11-1',
      baseDate: new Date('2026-11-05T00:00:00.000Z'),
      half: 1,
      origin: 'dbcorp',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: produtos,
      inputs: fixture.entradas,
      expected: null,
      files: [],
      createdAt: new Date('2026-11-05T12:00:00.000Z'),
    });

    const response = await request(app).get('/api/v1/forecast/snapshots/8?hoje=2026-11-06').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.data.conferencia).toBeNull();
    expect(response.body.data.half).toBe(1);
    for (const linha of response.body.data.linhas as Array<{ AG: number; Q: number }>) {
      expect(linha.AG).toBe(linha.Q);
    }
    for (const linha of response.body.data.linhas as Array<{ precoFixo: unknown; historico: unknown }>) {
      expect(typeof linha.precoFixo).toBe('boolean');
      expect(Array.isArray(linha.historico)).toBe(true);
    }
  });

  it('precoFixo sai como sim/nao e o valor do preco fechado nunca vaza', async () => {
    const cookies = await loginAs('viewer');
    const [base, ...resto] = fixture.produtos;
    const produtos = [
      { ...base, precoFechado: ' x ', obs: 'Obs. de teste', n: 11 },
      { ...resto[0], precoFechado: '1,23', n: null },
      { ...resto[1], precoFechado: '', n: 13 },
    ];
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 9,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'dbcorp',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: produtos,
      inputs: fixture.entradas,
      expected: null,
      files: [],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });

    const response = await request(app).get('/api/v1/forecast/snapshots/9?hoje=2026-10-20').set('Cookie', cookies);

    expect(response.status).toBe(200);
    const linhas = response.body.data.linhas as Array<{ precoFixo: boolean; n: number | null; obs: string }>;
    expect(linhas.map((l) => l.precoFixo)).toEqual([true, false, false]);
    expect(linhas.map((l) => l.n)).toEqual([11, null, 13]);
    expect(linhas[0]?.obs).toBe('Obs. de teste');
    expect(JSON.stringify(response.body)).not.toContain('1,23');
    expect(JSON.stringify(response.body)).not.toContain('precoFechado');
  });
});

describe('Forecast routes - relatorio de compras', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([]);
    // Demanda do comercial (PR 6d): sem pedido aberto por padrao.
    prismaMock.forecastCommercialDemand.findMany.mockResolvedValue([]);
    // O relatorio le a embalagem do cadastro por codigo (PR 2C); aqui nenhum codigo tem embalagem.
    prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
    const produtos = fixture.produtos.slice(0, 5);
    const linhasDe = new Set(produtos.map((p) => String(p.linha)));
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'planilha',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: produtos,
      inputs: fixture.entradas,
      expected: Object.fromEntries(Object.entries(fixture.esperado).filter(([linha]) => linhasDe.has(linha))),
      files: [{ kind: 'planilha', fileName: 'quinzena.xlsx', sha256: 'abc', rows: 5 }],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
  });

  it('viewer recebe o relatorio montado so a partir da quinzena calculada', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7/relatorio-compras?hoje=2026-10-20')
      .set('Cookie', cookies);

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(Array.isArray(data.grupos)).toBe(true);
    expect(data.quinzena).toMatchObject({ id: 7, label: '10-2', baseDate: '2026-10-15', hoje: '2026-10-20' });
    const itens = (data.grupos as Array<{ itens: Array<{ embalagem: { usada: unknown } }> }>).flatMap(
      (g) => g.itens,
    );
    expect(itens.length).toBe(data.totais.itens);
    for (const item of itens) {
      expect(item.embalagem.usada).toBeNull();
    }
    expect(data.totais.semEmbalagem).toBe(data.totais.itens);
  });

  it('relatorio traz a secao Demanda do comercial com os pedidos abertos do cadastro (1 consulta)', async () => {
    const cookies = await loginAs('viewer');
    const [primeiro, ...resto] = fixture.produtos.slice(0, 5);
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'dbcorp',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: [{ ...primeiro, productId: 31 }, ...resto],
      inputs: fixture.entradas,
      expected: null,
      files: [],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    prismaMock.forecastCommercialDemand.findMany.mockResolvedValue([
      {
        id: 4,
        productId: 31,
        quantityKg: '1000',
        neededBy: new Date('2099-01-10T00:00:00.000Z'),
        reason: 'MOTIVO SINTETICO',
        customerName: 'CLIENTE SINTETICO',
        commercialRequestId: 12,
        product: { name: 'PRODUTO 001', source: { name: 'FONTE 001' } },
      },
    ]);
    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7/relatorio-compras?hoje=2026-10-20')
      .set('Cookie', cookies);
    expect(response.status).toBe(200);
    const { demandaComercial } = response.body.data;
    expect(demandaComercial.totais.abertas).toBe(1);
    expect(demandaComercial.itens[0]).toMatchObject({
      id: 4,
      productId: 31,
      kg: 1000,
      necessidade: '2099-01-10',
      situacao: 'alem-do-horizonte',
      motivo: 'MOTIVO SINTETICO',
      cliente: 'CLIENTE SINTETICO',
      solicitacaoId: 12,
    });
    expect(prismaMock.forecastCommercialDemand.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.forecastCommercialDemand.findMany.mock.calls[0][0].where).toEqual({ status: 'aberta' });
  });

  it('a flag "nao fraciona" (coluna AX) chega ao relatorio como booleano', async () => {
    const cookies = await loginAs('viewer');
    const [base, outro] = fixture.produtos;
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'dbcorp',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: [
        { ...base, naoFraciona: ' x ' },
        { ...outro, naoFraciona: '' },
      ],
      inputs: fixture.entradas,
      expected: null,
      files: [],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    const response = await request(app).get('/api/v1/forecast/snapshots/7?hoje=2026-10-20').set('Cookie', cookies);
    expect(response.status).toBe(200);
    const linhas = response.body.data.linhas as Array<{ naoFraciona: boolean }>;
    expect(linhas.map((l) => l.naoFraciona)).toEqual([true, false]);
  });

  it.each(READ_ROLES)('%s: relatorio de compras -> 200', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7/relatorio-compras?hoje=2026-10-20')
      .set('Cookie', cookies);
    expect(response.status).toBe(200);
  });

  it('viewer baixa o XLSX do mesmo relatorio da tela (mesmo metodo, mesma ordem)', async () => {
    const cookies = await loginAs('viewer');
    const spy = vi.spyOn(ForecastSnapshotService, 'getRelatorioCompras');
    try {
      const tela = await request(app)
        .get('/api/v1/forecast/snapshots/7/relatorio-compras?hoje=2026-10-20')
        .set('Cookie', cookies);
      expect(tela.status).toBe(200);
      spy.mockClear();

      const response = await request(app)
        .get('/api/v1/forecast/snapshots/7/relatorio-compras/xlsx?hoje=2026-10-20')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(7, '2026-10-20');
      const { data } = response.body as { data: { fileName: string; contentBase64: string } };
      expect(data.fileName).toBe('relatorio-compras-10-2-2026-10-20.xlsx');

      const wb = new exceljs.Workbook();
      await wb.xlsx.load(Buffer.from(data.contentBase64, 'base64') as unknown as ArrayBuffer);
      const ws = wb.getWorksheet('Relatório de compras');
      expect(ws).toBeDefined();

      // Linhas de item = as que seguem o cabecalho de colunas ('Item' na coluna A) ate a linha em branco.
      const nomesNoArquivo: string[] = [];
      let dentro = false;
      ws!.eachRow({ includeEmpty: true }, (row) => {
        const a = String(row.getCell(1).value ?? '');
        if (a === 'Item') {
          dentro = true;
        } else if (a === '') {
          dentro = false;
        } else if (dentro) {
          nomesNoArquivo.push(a);
        }
      });
      const nomesNaTela = (tela.body.data.grupos as Array<{ itens: Array<{ item: string }> }>)
        .flatMap((g) => g.itens)
        .map((i) => i.item);
      expect(nomesNoArquivo.length).toBeGreaterThan(0);
      expect(nomesNoArquivo).toEqual(nomesNaTela);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(READ_ROLES)('%s: XLSX do relatorio de compras -> 200', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7/relatorio-compras/xlsx?hoje=2026-10-20')
      .set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(typeof response.body.data.contentBase64).toBe('string');
  });
});

describe('Forecast routes - trava de vendas vazias (planilha)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.forecastSource.findMany.mockResolvedValue([]);
    prismaMock.forecastProduct.findMany.mockResolvedValue([]);
    prismaMock.forecastMonthlySale.findMany.mockResolvedValue([]);
    prismaMock.catalogItem.findMany.mockResolvedValue([]);
    prismaMock.supplier.findMany.mockResolvedValue([]);
  });

  const body = async () => ({
    contentBase64: await workbookSemVendasBase64(),
    fileName: 'sintetica.xlsx',
    label: '10-2',
    baseDate: '2026-10-15',
  });

  it('confirm com gravarHistorico e VENDAS MENSAL vazia -> 400 antes de abrir a transacao', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post('/api/v1/forecast/import/workbook/confirm')
      .set('Cookie', cookies)
      .send({
        ...(await body()),
        options: { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true },
      });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'O relatorio de vendas do mes (2026-09) nao tem linhas validas; o historico desse mes NAO foi alterado.',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('preview com a mesma planilha -> 200 com o aviso (cadastro/quinzena continuam possiveis)', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post('/api/v1/forecast/import/workbook/preview')
      .set('Cookie', cookies)
      .send(await body());
    expect(response.status).toBe(200);
    expect(response.body.data.erros).toEqual([]);
    expect(response.body.data.avisos).toContain(
      'VENDAS MENSAL sem linhas validas: "Gravar historico" sera recusado.',
    );
    expect(response.body.data.historico.linhas).toBe(0);
  });
});

describe('Forecast routes - 413', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corpo acima de 10MB em /forecast/import -> 413 em JSON com a mensagem', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post('/api/v1/forecast/import/workbook/preview')
      .set('Cookie', cookies)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...validPreviewBody, contentBase64: 'A'.repeat(11 * 1024 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ message: FORECAST_TOO_LARGE_MESSAGE });
  });

  it('corpo acima de 10MB em /forecast/import/dbcorp -> 413 em JSON com a mensagem', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post('/api/v1/forecast/import/dbcorp/preview')
      .set('Cookie', cookies)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...validDbcorpBody, ruido: 'A'.repeat(11 * 1024 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ message: FORECAST_TOO_LARGE_MESSAGE });
  });

  it('corpo grande sem login -> 401 (a autenticacao vem antes do parser)', async () => {
    const response = await request(app)
      .post('/api/v1/forecast/import/workbook/preview')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...validPreviewBody, contentBase64: 'A'.repeat(2 * 1024 * 1024) }));
    expect(response.status).toBe(401);
  });

  it('base64 acima do limite do validator (mas dentro do corpo de 10MB) -> 400 com a mesma mensagem', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post('/api/v1/forecast/import/workbook/preview')
      .set('Cookie', cookies)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...validPreviewBody, contentBase64: 'A'.repeat(10 * 1024 * 1024 - 1024) }));
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(FORECAST_TOO_LARGE_MESSAGE);
  });
});

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  });
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
