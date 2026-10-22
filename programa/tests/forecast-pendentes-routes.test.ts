import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';
import { hashPassword } from '../src/utils/password';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    // forecastSnapshot SEM update/upsert/updateMany de proposito: os pendentes sao so leitura.
    forecastSnapshot: { findFirst: vi.fn() },
    forecastProduct: { findUnique: vi.fn(), create: vi.fn() },
    forecastProductCode: { findMany: vi.fn(), create: vi.fn() },
    forecastSource: { findUnique: vi.fn() },
    itemFamily: { findUnique: vi.fn() },
    catalogItem: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastSnapshot: Record<string, Mock>;
  forecastProduct: { findUnique: Mock; create: Mock };
  forecastProductCode: { findMany: Mock; create: Mock };
  forecastSource: { findUnique: Mock };
  itemFamily: { findUnique: Mock };
  catalogItem: { findMany: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const GET_PATH = '/api/v1/forecast/snapshots/7/pendentes';
const CREATE_PATH = '/api/v1/forecast/products';
const ADD_PATH = '/api/v1/forecast/products/5/codigos';

// Dados SINTETICOS (repo publico).
const corpoValido = { nome: 'PRODUTO 901', codigos: ['TST0901', 'TST0902'], sourceId: 3, familyId: 4 };

const snapshotDbcorp = {
  id: 7,
  label: '10-2',
  origin: 'dbcorp',
  inputs: {
    estoque: [{ codigo: 'TST0001', qtd: 10 }, { codigo: 'TST0950', qtd: 3 }],
    vendasMes: [{ codigo: 'TST0001', qtd: 5 }, { codigo: 'TST0901', qtd: 20 }],
    vendasAtual: [],
    vendasAnual: [{ codigo: 'TST0901', qtd: 200 }],
    programacoes: [],
    chegadas: [{ codigo: 'TST0902', qtd: 80, mes: '11' }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshotDbcorp);
  prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 3, isActive: true, leadTimeDays: 45 });
  prismaMock.itemFamily.findUnique.mockResolvedValue({ id: 4, isActive: true });
  prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
  prismaMock.forecastProduct.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({
    id: 55,
    name: data.name,
  }));
  prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
  prismaMock.forecastProductCode.create.mockImplementation(
    async ({ data }: { data: { position: number; code: string } }) => ({
      id: 900 + data.position,
      position: data.position,
      code: data.code,
    }),
  );
  prismaMock.catalogItem.findMany.mockResolvedValue([]);
});

describe('Forecast pendentes - autenticacao e papeis', () => {
  it('sem login: as 3 rotas -> 401', async () => {
    expect((await request(app).get(GET_PATH)).status).toBe(401);
    expect((await request(app).post(CREATE_PATH).send(corpoValido)).status).toBe(401);
    expect((await request(app).post(ADD_PATH).send({ codigo: 'TST0903' })).status).toBe(401);
  });

  it('comercial: as 3 rotas -> 403', async () => {
    const cookies = await loginAs('comercial');
    expect((await request(app).get(GET_PATH).set('Cookie', cookies)).status).toBe(403);
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(403);
    expect((await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' })).status).toBe(403);
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it.each(['viewer', 'gestor'] as Role[])('%s: GET -> 200 e POSTs -> 403', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).get(GET_PATH).set('Cookie', cookies)).status).toBe(200);
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(403);
    expect((await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' })).status).toBe(403);
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s: POSTs passam do RBAC (criam)', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(201);
    prismaMock.forecastProduct.findUnique.mockResolvedValue({ id: 5, isActive: true, codes: [] });
    expect((await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' })).status).toBe(201);
  });
});

describe('Forecast pendentes - GET /forecast/snapshots/:id/pendentes', () => {
  it('quinzena DBCorp: lista o codigo fora do cadastro com o consumo do DBCorp e conta o so-saldo', async () => {
    prismaMock.forecastProductCode.findMany.mockResolvedValue([
      { code: 'TST0001', product: { id: 1, name: 'PRODUTO 001', isActive: true } },
    ]);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(GET_PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data).toMatchObject({ aplicavel: true, snapshotId: 7, label: '10-2', totalItens: 2, omitidos: 0 });
    expect(data.itens.map((i: { codigo: string }) => i.codigo)).toEqual(['TST0901', 'TST0902']);
    expect(data.itens[0]).toMatchObject({
      situacao: 'sem_cadastro',
      vendasMes: 20,
      vendasAnual: 200,
      chegadas: 0,
    });
    expect(data.itens[1]).toMatchObject({ chegadas: 80 });
    expect(data.soSaldo).toEqual({ codigos: 1, kg: 3 });
    expect(prismaMock.forecastSnapshot.findFirst.mock.calls[0][0].where).toEqual({ id: 7, deletedAt: null });
  });

  it('quinzena DBCorp: o codigo que entrou no cadastro ATIVO sai da lista', async () => {
    prismaMock.forecastProductCode.findMany.mockResolvedValue([
      { code: 'TST0001', product: { id: 1, name: 'PRODUTO 001', isActive: true } },
      { code: 'TST0901', product: { id: 55, name: 'PRODUTO 901', isActive: true } },
    ]);
    const cookies = await loginAs('viewer');
    const { data } = (await request(app).get(GET_PATH).set('Cookie', cookies)).body;
    expect(data.itens.map((i: { codigo: string }) => i.codigo)).toEqual(['TST0902']);
  });

  it('quinzena da planilha -> aplicavel: false, sem consultar o cadastro', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({ ...snapshotDbcorp, origin: 'planilha' });
    const cookies = await loginAs('viewer');
    const response = await request(app).get(GET_PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      aplicavel: false,
      snapshotId: 7,
      label: '10-2',
      itens: [],
      totalItens: 0,
      omitidos: 0,
      soSaldo: { codigos: 0, kg: 0 },
    });
    expect(prismaMock.forecastProductCode.findMany).not.toHaveBeenCalled();
  });

  it('quinzena inexistente -> 404; id invalido -> 400', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    expect((await request(app).get(GET_PATH).set('Cookie', cookies)).status).toBe(404);
    expect((await request(app).get('/api/v1/forecast/snapshots/abc/pendentes').set('Cookie', cookies)).status).toBe(400);
  });
});

describe('Forecast pendentes - POST /forecast/products', () => {
  it('cria com origin dbcorp, posicoes 1..n, advisory lock e AuditLog so com ids e contagens', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: 55,
      nome: 'PRODUTO 901',
      ativo: true,
      origem: 'dbcorp',
      fonteId: 3,
      familiaId: 4,
      codigos: [
        { id: 901, posicao: 1, codigo: 'TST0901' },
        { id: 902, posicao: 2, codigo: 'TST0902' },
      ],
    });
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.forecastProduct.create.mock.calls[0][0].data).toMatchObject({
      name: 'PRODUTO 901',
      normalizedName: 'PRODUTO 901',
      sheetOrder: null,
      sourceId: 3,
      familyId: 4,
      isActive: true,
      origin: 'dbcorp',
    });
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      entityType: 'forecast_product',
      entityId: '55',
      action: 'create',
      metadata: { source: 'dbcorp_pendente', sourceId: 3, familyId: 4, codigos: 2 },
    });
    expect(JSON.stringify(audit)).not.toMatch(/TST09|PRODUTO 901/);
  });

  it('normaliza nome (espacos) e codigos (caixa/trim) e vincula o catalogo so quando ha exatamente 1 item', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 31, dbcorpCode: 'tst0901' },
      { id: 32, dbcorpCode: 'TST0902' },
      { id: 33, dbcorpCode: ' tst0902 ' }, // 2 itens no mesmo codigo: nao vincula
    ]);
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post(CREATE_PATH)
      .set('Cookie', cookies)
      .send({ ...corpoValido, nome: '  produto   901 ', codigos: [' tst0901 ', 'Tst0902'] });
    expect(response.status).toBe(201);
    expect(prismaMock.forecastProduct.create.mock.calls[0][0].data).toMatchObject({
      name: 'produto 901',
      normalizedName: 'PRODUTO 901',
    });
    const codigos = prismaMock.forecastProductCode.create.mock.calls.map((c) => c[0].data);
    expect(codigos).toEqual([
      { productId: 55, position: 1, code: 'TST0901', catalogItemId: 31 },
      { productId: 55, position: 2, code: 'TST0902', catalogItemId: null },
    ]);
  });

  it.each([
    ['codigo repetido no corpo', { codigos: ['TST0901', 'tst0901'] }, 'Código repetido na lista.'],
    ['8 codigos', { codigos: Array.from({ length: 8 }, (_, i) => `TST090${i}`) }, 'Informe no máximo 7 códigos.'],
    ['sem codigos', { codigos: [] }, 'Informe ao menos um código.'],
    ['codigo vazio', { codigos: ['  '] }, 'Informe o código do produto.'],
    ['nome vazio', { nome: '   ' }, 'Informe o nome do produto.'],
    ['sourceId zero', { sourceId: 0 }, 'Fonte inválida.'],
    ['familyId texto', { familyId: 'x' }, 'Família inválida.'],
  ])('Zod 400 (%s)', async (_nome, parcial, mensagem) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post(CREATE_PATH)
      .set('Cookie', cookies)
      .send({ ...corpoValido, ...parcial });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(mensagem);
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('fonte sem lead time -> 400', async () => {
    prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 3, isActive: true, leadTimeDays: null });
    const cookies = await loginAs('admin');
    const response = await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('A fonte escolhida não tem lead time cadastrado.');
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('fonte inexistente ou inativa -> 400; familia inexistente ou inativa -> 400', async () => {
    const cookies = await loginAs('admin');
    prismaMock.forecastSource.findUnique.mockResolvedValue(null);
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(400);
    prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 3, isActive: false, leadTimeDays: 45 });
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(400);
    prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 3, isActive: true, leadTimeDays: 45 });
    prismaMock.itemFamily.findUnique.mockResolvedValue({ id: 4, isActive: false });
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(400);
    prismaMock.itemFamily.findUnique.mockResolvedValue(null);
    expect((await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido)).status).toBe(400);
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
  });

  it('nome ja existente -> 409', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue({ id: 9 });
    const cookies = await loginAs('admin');
    const response = await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido);
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Já existe um produto com esse nome.');
  });

  it('codigo ja usado por outro produto -> 409 com o nome do dono', async () => {
    prismaMock.forecastProductCode.findMany.mockResolvedValue([
      { code: 'TST0902', product: { name: 'PRODUTO 002' } },
    ]);
    const cookies = await loginAs('admin');
    const response = await request(app).post(CREATE_PATH).set('Cookie', cookies).send(corpoValido);
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('O código TST0902 já pertence ao produto PRODUTO 002.');
    expect(prismaMock.forecastProduct.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('Forecast pendentes - POST /forecast/products/:id/codigos', () => {
  const produtoComPosicoes = (posicoes: number[], isActive = true) => ({
    id: 5,
    isActive,
    codes: posicoes.map((position) => ({ position })),
  });

  it('grava na menor posicao livre, sem embalagem, e audita so ids e posicao', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoComPosicoes([1, 3, 4]));
    const cookies = await loginAs('comprador');
    const response = await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: ' tst0903 ' });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ produtoId: 5, codigo: { id: 902, posicao: 2, codigo: 'TST0903' } });
    expect(prismaMock.forecastProductCode.create.mock.calls[0][0].data).toEqual({
      productId: 5,
      position: 2,
      code: 'TST0903',
      catalogItemId: null,
    });
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({
      entityType: 'forecast_product',
      entityId: '5',
      action: 'code_add',
      metadata: { source: 'dbcorp_pendente', position: 2, codeId: 902 },
    });
    expect(JSON.stringify(audit)).not.toMatch(/TST09/);
  });

  it('produto inexistente -> 404; inativo -> 400; com 7 codigos -> 400', async () => {
    const cookies = await loginAs('admin');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const r404 = await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' });
    expect(r404.status).toBe(404);
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoComPosicoes([1], false));
    const r400 = await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' });
    expect(r400.status).toBe(400);
    expect(r400.body.message).toBe('Produto inativo.');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoComPosicoes([1, 2, 3, 4, 5, 6, 7]));
    const r7 = await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' });
    expect(r7.status).toBe(400);
    expect(r7.body.message).toBe('O produto já tem 7 códigos.');
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });

  it('codigo ja usado -> 409; Zod (codigo vazio) e id invalido -> 400', async () => {
    const cookies = await loginAs('admin');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produtoComPosicoes([1]));
    prismaMock.forecastProductCode.findMany.mockResolvedValue([{ code: 'TST0903', product: { name: 'PRODUTO 003' } }]);
    const r409 = await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: 'TST0903' });
    expect(r409.status).toBe(409);
    expect(r409.body.message).toBe('O código TST0903 já pertence ao produto PRODUTO 003.');
    expect((await request(app).post(ADD_PATH).set('Cookie', cookies).send({ codigo: ' ' })).status).toBe(400);
    expect(
      (await request(app).post('/api/v1/forecast/products/abc/codigos').set('Cookie', cookies).send({ codigo: 'TST0903' }))
        .status,
    ).toBe(400);
  });
});

// Guarda do import da planilha (sem banco): plan() com Db falso.
describe('Forecast pendentes - plan() do import da planilha respeita origin', () => {
  const produtoDb = (id: number, nome: string, origin: string | undefined, code: string) => ({
    id,
    name: nome,
    normalizedName: nome,
    sheetOrder: origin === 'dbcorp' ? null : id,
    notes: null,
    fixedPriceFlag: false,
    packaging: null,
    noFractioning: false,
    sampleQty: null,
    sampleRequestNote: null,
    familyId: null,
    isActive: true,
    ...(origin === undefined ? {} : { origin }),
    source: null,
    codes: [{ position: 1, code, catalogItemId: null }],
  });
  const draft = (nome: string, code: string): ProductDraft => ({
    name: nome,
    normalizedName: nome,
    sheetOrder: 1,
    sourceKey: null,
    notes: null,
    fixedPriceFlag: false,
    packaging: null,
    noFractioning: false,
    sampleQty: null,
    sampleRequestNote: null,
    codes: [{ position: 1, code }],
  });
  const dbFalso = (produtos: unknown[]) =>
    ({
      forecastProduct: { findMany: async () => produtos },
      catalogItem: { findMany: async () => [] },
    }) as never;

  it('produto dbcorp ausente da planilha nao e inativado (1 aviso agregado); o da planilha e', async () => {
    const plano = await ForecastProductService.plan(
      dbFalso([
        produtoDb(1, 'PRODUTO 001', 'planilha', 'TST0001'),
        produtoDb(2, 'PRODUTO 002', 'dbcorp', 'TST0002'),
        produtoDb(3, 'PRODUTO 003', 'dbcorp', 'TST0003'),
      ]),
      [],
      new Set(),
    );
    expect(plano.inativados.map((i) => i.id)).toEqual([1]);
    expect(plano.avisos).toEqual([
      '2 produtos cadastrados pela tela a partir do DBCorp não estão na planilha e continuam ativos.',
    ]);
  });

  it('produto dbcorp com o mesmo nome na planilha vira alterado (origin) com aviso; sem origin no banco = planilha', async () => {
    const plano = await ForecastProductService.plan(
      dbFalso([produtoDb(2, 'PRODUTO 002', 'dbcorp', 'TST0002'), produtoDb(4, 'PRODUTO 004', undefined, 'TST0004')]),
      [draft('PRODUTO 002', 'TST0002'), draft('PRODUTO 004', 'TST0004')],
      new Set(),
    );
    const [adotado, igual] = plano.items;
    expect(adotado).toMatchObject({ existingId: 2, fieldsChanged: true, codesChanged: false, change: 'alterado' });
    expect(adotado.desired.origin).toBe('planilha');
    expect(adotado.before?.origin).toBe('dbcorp');
    // Linha do banco sem a coluna (mock antigo): conta como 'planilha'.
    expect(igual.before?.origin).toBe('planilha');
    expect(plano.avisos).toEqual(['1 produtos cadastrados pela tela passam a vir da planilha.']);
    expect(plano.inativados).toEqual([]);
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
