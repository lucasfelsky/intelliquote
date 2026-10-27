import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    forecastLeadTimeEvent: { findMany: vi.fn() },
    forecastSource: { findUnique: vi.fn() },
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
  forecastLeadTimeEvent: { findMany: Mock };
  forecastSource: { findUnique: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const BASE = '/api/v1/forecast/lead-time-events';

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  forecastLeadTimeEvent: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  forecastSource: { findFirst: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
};

const NOME = 'OCASIAO 001';
const NOTA = 'NOTA SINTETICA PRIVADA';
const CHAVES_AUDITAVEIS = [
  'component',
  'countryCode',
  'effectKind',
  'effectValue',
  'endDate',
  'isActive',
  'recurrence',
  'scopeType',
  'sourceId',
  'startDate',
];

// Linha do banco (tudo sintetico). `effectValue` chega como Decimal no Prisma; aqui basta um numero.
const linha = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: NOME,
  scopeType: 'global',
  countryCode: null,
  sourceId: null,
  source: null,
  startDate: new Date('2030-01-10T00:00:00.000Z'),
  endDate: new Date('2030-01-15T00:00:00.000Z'),
  recurrence: 'nenhuma',
  component: 'total',
  effectKind: 'dias',
  effectValue: 7,
  coverWithStock: false,
  notes: NOTA,
  isActive: true,
  createdById: 1,
  createdAt: new Date('2099-01-01T12:00:00.000Z'),
  updatedAt: new Date('2099-01-01T12:00:00.000Z'),
  ...over,
});

const corpo = (over: Record<string, unknown> = {}) => ({
  name: NOME,
  scopeType: 'global',
  startDate: '2030-01-10',
  endDate: '2030-01-15',
  effectValue: 7,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  prismaMock.forecastLeadTimeEvent.findMany.mockResolvedValue([linha()]);
  tx.forecastLeadTimeEvent.findFirst.mockResolvedValue(null);
  tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(linha());
  tx.forecastLeadTimeEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    linha({ ...data, id: 7 }),
  );
  tx.forecastLeadTimeEvent.update.mockImplementation(
    async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) =>
      linha({ ...data, id: where.id }),
  );
  tx.forecastLeadTimeEvent.delete.mockResolvedValue({});
  tx.forecastSource.findFirst.mockResolvedValue({ id: 5 });
  tx.forecastSource.update.mockResolvedValue({ id: 5 });
  tx.auditLog.create.mockResolvedValue({});
  prismaMock.forecastSource.findUnique.mockResolvedValue({ id: 5 });
});

describe('GET /forecast/lead-time-events', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('comercial -> 403 e nada e consultado', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastLeadTimeEvent.findMany).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s le a lista (COMEX_ROLES), sem coverWithStock', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: 7,
      name: NOME,
      scopeType: 'global',
      countryCode: null,
      sourceId: null,
      source: null,
      startDate: '2030-01-10',
      endDate: '2030-01-15',
      recurrence: 'nenhuma',
      component: 'total',
      effectKind: 'dias',
      effectValue: 7,
      notes: NOTA,
      isActive: true,
      ocorrencias: null,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/coverWithStock|createdById/);
    expect(prismaMock.forecastLeadTimeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: 500 }),
    );
  });

  it('com janela expande a recorrencia anual e descarta quem nao tem ocorrencia nela', async () => {
    prismaMock.forecastLeadTimeEvent.findMany.mockResolvedValue([
      linha({
        id: 1,
        recurrence: 'anual',
        startDate: new Date('2029-12-20T00:00:00.000Z'),
        endDate: new Date('2030-01-05T00:00:00.000Z'),
      }),
      linha({ id: 2 }),
    ]);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${BASE}?de=2031-12-01&ate=2032-01-31`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: 1,
      ocorrencias: [{ inicio: '2031-12-20', fim: '2032-01-05' }],
    });
    const { where } = prismaMock.forecastLeadTimeEvent.findMany.mock.calls[0][0];
    expect(where.OR).toEqual([
      { recurrence: 'anual' },
      { startDate: { lte: new Date('2032-01-31T00:00:00.000Z') }, endDate: { gte: new Date('2031-12-01T00:00:00.000Z') } },
    ]);
  });

  it('filtros scopeType, countryCode, sourceId e ativa vao para a coluna', async () => {
    const cookies = await loginAs('viewer');
    await request(app).get(`${BASE}?scopeType=pais&countryCode=xa&sourceId=5&ativa=false`).set('Cookie', cookies);
    const { where } = prismaMock.forecastLeadTimeEvent.findMany.mock.calls[0][0];
    expect(where).toEqual({ scopeType: 'pais', countryCode: 'XA', sourceId: 5, isActive: false });
  });

  it('janela invalida -> 400: so de, ate < de, 732 dias (731 passa), data impossivel', async () => {
    const cookies = await loginAs('viewer');
    const get = (qs: string) => request(app).get(`${BASE}?${qs}`).set('Cookie', cookies);
    expect((await get('de=2030-01-01')).status).toBe(400);
    expect((await get('ate=2030-01-01')).status).toBe(400);
    expect((await get('de=2030-02-01&ate=2030-01-01')).status).toBe(400);
    expect((await get('de=2030-01-01&ate=2032-01-02')).status).toBe(400);
    expect((await get('de=2030-01-01&ate=2032-01-01')).status).toBe(200);
    expect((await get('de=2027-02-29&ate=2027-03-02')).status).toBe(400);
    expect((await get('ativa=talvez')).status).toBe(400);
    expect((await get('scopeType=rota')).status).toBe(400);
    expect((await get('sourceId=abc')).status).toBe(400);
  });
});

describe('POST /forecast/lead-time-events - papeis e gravacao', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).post(BASE).send(corpo())).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.forecastLeadTimeEvent.create).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s cria: 201 com os padroes e o autor', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ name: `  ${NOME}  `, notes: `  ${NOTA}  ` }));
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 7, name: NOME, notes: NOTA });
    expect(tx.forecastLeadTimeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: NOME,
          scopeType: 'global',
          countryCode: null,
          sourceId: null,
          startDate: new Date('2030-01-10T00:00:00.000Z'),
          endDate: new Date('2030-01-15T00:00:00.000Z'),
          recurrence: 'nenhuma',
          component: 'total',
          effectKind: 'dias',
          effectValue: 7,
          notes: NOTA,
          isActive: true,
          createdById: 1,
        },
      }),
    );
  });

  it('notes vazio vira null; countryCode minusculo vira maiusculo (escopo pais)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ scopeType: 'pais', countryCode: ' xa ', notes: '   ' }));
    expect(response.status).toBe(201);
    const { data } = tx.forecastLeadTimeEvent.create.mock.calls[0][0];
    expect(data).toMatchObject({ scopeType: 'pais', countryCode: 'XA', sourceId: null, notes: null });
  });

  it('escopo fonte: confere a fonte ativa no tx e grava o sourceId', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ scopeType: 'fonte', sourceId: 5, component: 'embarque', recurrence: 'anual' }));
    expect(response.status).toBe(201);
    expect(tx.forecastSource.findFirst).toHaveBeenCalledWith({ where: { id: 5, isActive: true }, select: { id: true } });
    expect(tx.forecastLeadTimeEvent.create.mock.calls[0][0].data).toMatchObject({
      scopeType: 'fonte',
      sourceId: 5,
      component: 'embarque',
      recurrence: 'anual',
    });
  });

  it('percentual com 2 casas e dias 0 sao aceitos; 120 dias de duracao e o limite', async () => {
    const cookies = await loginAs('admin');
    const post = (over: Record<string, unknown>) => request(app).post(BASE).set('Cookie', cookies).send(corpo(over));
    expect((await post({ effectKind: 'percentual', effectValue: 12.34 })).status).toBe(201);
    expect((await post({ effectValue: 0 })).status).toBe(201);
    expect((await post({ effectValue: 120 })).status).toBe(201);
    expect((await post({ startDate: '2030-01-01', endDate: '2030-04-30' })).status).toBe(201);
  });

  it.each<[string, Record<string, unknown>]>([
    ['global com countryCode', { countryCode: 'XA' }],
    ['global com sourceId', { sourceId: 5 }],
    ['pais sem countryCode', { scopeType: 'pais' }],
    ['pais com sourceId', { scopeType: 'pais', countryCode: 'XA', sourceId: 5 }],
    ['countryCode com 3 letras', { scopeType: 'pais', countryCode: 'XAA' }],
    ['countryCode com digito', { scopeType: 'pais', countryCode: 'X1' }],
    ['fonte sem sourceId', { scopeType: 'fonte' }],
    ['fonte com countryCode', { scopeType: 'fonte', sourceId: 5, countryCode: 'XA' }],
    ['fonte com sourceId 0', { scopeType: 'fonte', sourceId: 0 }],
    ['escopo desconhecido', { scopeType: 'rota' }],
    ['data inexistente', { startDate: '2027-02-29', endDate: '2027-03-02' }],
    ['fim antes do inicio', { startDate: '2030-01-15', endDate: '2030-01-10' }],
    ['121 dias de duracao', { startDate: '2030-01-01', endDate: '2030-05-01' }],
    ['component invalido', { component: 'porto' }],
    ['effectKind invalido', { effectKind: 'horas' }],
    ['recurrence invalida', { recurrence: 'mensal' }],
    ['dias 121', { effectValue: 121 }],
    ['dias fracionado', { effectValue: 2.5 }],
    ['dias negativo', { effectValue: -1 }],
    ['percentual 0.5', { effectKind: 'percentual', effectValue: 0.5 }],
    ['percentual 301', { effectKind: 'percentual', effectValue: 301 }],
    ['percentual com 3 casas', { effectKind: 'percentual', effectValue: 12.345 }],
    ['notes com 301 caracteres', { notes: 'x'.repeat(301) }],
    ['name vazio', { name: '   ' }],
    ['name com 121 caracteres', { name: 'x'.repeat(121) }],
    ['coverWithStock no corpo', { coverWithStock: true }],
    ['chave desconhecida', { extra: 1 }],
    ['effectValue ausente', { effectValue: undefined }],
  ])('400 sem tocar no banco: %s', async (_nome, over) => {
    const cookies = await loginAs('admin');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo(over));
    expect(response.status).toBe(400);
    expect(tx.forecastLeadTimeEvent.create).not.toHaveBeenCalled();
  });

  it('fonte inexistente ou inativa -> 400', async () => {
    tx.forecastSource.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('admin');
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ scopeType: 'fonte', sourceId: 99 }));
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Fonte nao encontrada ou inativa.');
    expect(tx.forecastLeadTimeEvent.create).not.toHaveBeenCalled();
  });

  it('duplicata ativa -> 409; duplicata so de inativa -> 201', async () => {
    const cookies = await loginAs('admin');
    tx.forecastLeadTimeEvent.findFirst.mockResolvedValue({ id: 3 });
    const duplicada = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(duplicada.status).toBe(409);
    expect(tx.forecastLeadTimeEvent.create).not.toHaveBeenCalled();
    expect(tx.forecastLeadTimeEvent.findFirst).toHaveBeenCalledWith({
      where: {
        isActive: true,
        scopeType: 'global',
        countryCode: null,
        sourceId: null,
        startDate: new Date('2030-01-10T00:00:00.000Z'),
        endDate: new Date('2030-01-15T00:00:00.000Z'),
        component: 'total',
      },
      select: { id: true },
    });

    // Banco sem outra ATIVA igual (a consulta filtra isActive): cria normalmente.
    tx.forecastLeadTimeEvent.findFirst.mockResolvedValue(null);
    const ok = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(ok.status).toBe(201);

    // Ocasiao criada inativa nao consulta duplicata.
    tx.forecastLeadTimeEvent.findFirst.mockClear();
    const inativa = await request(app).post(BASE).set('Cookie', cookies).send(corpo({ isActive: false }));
    expect(inativa.status).toBe(201);
    expect(tx.forecastLeadTimeEvent.findFirst).not.toHaveBeenCalled();
  });
});

describe('PATCH /forecast/lead-time-events/:id', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).patch(`${BASE}/7`).send({ effectValue: 3, effectKind: 'dias' })).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ isActive: false });
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s edita: 200 e grava so o que mudou no estado final', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .patch(`${BASE}/7`)
      .set('Cookie', cookies)
      .send({ effectKind: 'percentual', effectValue: 10 });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: 7, effectKind: 'percentual', effectValue: 10 });
    expect(tx.forecastLeadTimeEvent.update.mock.calls[0][0].data).toMatchObject({
      effectKind: 'percentual',
      effectValue: 10,
      scopeType: 'global',
    });
  });

  it('bloco de escopo: ausente vira null (trocar fonte por pais limpa o sourceId)', async () => {
    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(linha({ scopeType: 'fonte', sourceId: 5 }));
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(`${BASE}/7`)
      .set('Cookie', cookies)
      .send({ scopeType: 'pais', countryCode: 'xb' });
    expect(response.status).toBe(200);
    expect(tx.forecastLeadTimeEvent.update.mock.calls[0][0].data).toMatchObject({
      scopeType: 'pais',
      countryCode: 'XB',
      sourceId: null,
    });
    expect(tx.forecastSource.findFirst).not.toHaveBeenCalled();
  });

  it('trocar para fonte confere a fonte; reativar ocasiao de fonte tambem', async () => {
    const cookies = await loginAs('admin');
    await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ scopeType: 'fonte', sourceId: 5 });
    expect(tx.forecastSource.findFirst).toHaveBeenCalledTimes(1);

    tx.forecastSource.findFirst.mockClear();
    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(linha({ scopeType: 'fonte', sourceId: 5, isActive: false }));
    await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ isActive: true });
    expect(tx.forecastSource.findFirst).toHaveBeenCalledTimes(1);

    tx.forecastSource.findFirst.mockResolvedValue(null);
    const semFonte = await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ isActive: true });
    expect(semFonte.status).toBe(400);
  });

  it('editar so o periodo de ocasiao de fonte inativa nao confere a fonte', async () => {
    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(linha({ scopeType: 'fonte', sourceId: 5, isActive: false }));
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(`${BASE}/7`)
      .set('Cookie', cookies)
      .send({ startDate: '2030-02-01', endDate: '2030-02-03' });
    expect(response.status).toBe(200);
    expect(tx.forecastSource.findFirst).not.toHaveBeenCalled();
  });

  it('duplicata ao editar o periodo ou reativar -> 409 (ignora a propria linha)', async () => {
    tx.forecastLeadTimeEvent.findFirst.mockResolvedValue({ id: 3 });
    const cookies = await loginAs('admin');
    const periodo = await request(app)
      .patch(`${BASE}/7`)
      .set('Cookie', cookies)
      .send({ startDate: '2030-02-01', endDate: '2030-02-03' });
    expect(periodo.status).toBe(409);
    expect(tx.forecastLeadTimeEvent.findFirst.mock.calls[0][0].where.id).toEqual({ not: 7 });
    expect(tx.forecastLeadTimeEvent.update).not.toHaveBeenCalled();

    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(linha({ isActive: false }));
    const reativar = await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ isActive: true });
    expect(reativar.status).toBe(409);

    // Inativar nunca consulta duplicata.
    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(linha());
    tx.forecastLeadTimeEvent.findFirst.mockClear();
    const inativar = await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ isActive: false });
    expect(inativar.status).toBe(200);
    expect(tx.forecastLeadTimeEvent.findFirst).not.toHaveBeenCalled();
  });

  it('inexistente -> 404; id abc -> 400', async () => {
    const cookies = await loginAs('admin');
    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(null);
    const naoAcha = await request(app).patch(`${BASE}/9`).set('Cookie', cookies).send({ isActive: false });
    expect(naoAcha.status).toBe(404);
    expect(naoAcha.body.message).toBe('Ocasião não encontrada.');
    const invalido = await request(app).patch(`${BASE}/abc`).set('Cookie', cookies).send({ isActive: false });
    expect(invalido.status).toBe(400);
  });

  it.each<[string, Record<string, unknown>]>([
    ['corpo vazio', {}],
    ['so countryCode', { countryCode: 'XA' }],
    ['so sourceId', { sourceId: 5 }],
    ['so startDate', { startDate: '2030-01-10' }],
    ['so endDate', { endDate: '2030-01-10' }],
    ['so effectValue', { effectValue: 3 }],
    ['so effectKind', { effectKind: 'dias' }],
    ['escopo pais sem codigo', { scopeType: 'pais' }],
    ['escopo global com codigo', { scopeType: 'global', countryCode: 'XA' }],
    ['periodo com 121 dias', { startDate: '2030-01-01', endDate: '2030-05-01' }],
    ['percentual 301', { effectKind: 'percentual', effectValue: 301 }],
    ['coverWithStock', { coverWithStock: true }],
    ['notes com 301 caracteres', { notes: 'x'.repeat(301) }],
    ['name vazio', { name: '' }],
  ])('400 sem tocar no banco: %s', async (_nome, body) => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send(body);
    expect(response.status).toBe(400);
    expect(tx.forecastLeadTimeEvent.update).not.toHaveBeenCalled();
  });

  it('sem mudanca efetiva: devolve a ocasiao sem gravar nem auditar', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(`${BASE}/7`)
      .set('Cookie', cookies)
      .send({ name: NOME, isActive: true, effectKind: 'dias', effectValue: 7 });
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(7);
    expect(tx.forecastLeadTimeEvent.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('notes vazio limpa a observacao (null)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(`${BASE}/7`).set('Cookie', cookies).send({ notes: '  ' });
    expect(response.status).toBe(200);
    expect(tx.forecastLeadTimeEvent.update.mock.calls[0][0].data.notes).toBeNull();
  });
});

describe('DELETE /forecast/lead-time-events/:id', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).delete(`${BASE}/7`)).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e apagado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).delete(`${BASE}/7`).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(tx.forecastLeadTimeEvent.delete).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s apaga: 200 com o id', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).delete(`${BASE}/7`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 7 });
    expect(tx.forecastLeadTimeEvent.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('inexistente -> 404; id abc -> 400', async () => {
    const cookies = await loginAs('admin');
    tx.forecastLeadTimeEvent.findUnique.mockResolvedValue(null);
    expect((await request(app).delete(`${BASE}/9`).set('Cookie', cookies)).status).toBe(404);
    expect(tx.forecastLeadTimeEvent.delete).not.toHaveBeenCalled();
    expect((await request(app).delete(`${BASE}/abc`).set('Cookie', cookies)).status).toBe(400);
  });
});

describe('auditoria das ocasioes', () => {
  const logDoTx = () => tx.auditLog.create.mock.calls[0][0].data;

  it('auditoria: create grava so ids, enums, numeros e datas, no tx, sem name nem notes', async () => {
    const cookies = await loginAs('admin');
    await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ scopeType: 'pais', countryCode: 'XA', notes: NOTA }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    const log = logDoTx();
    expect(log).toMatchObject({ entityType: 'forecast_lead_time_event', entityId: '7', action: 'create' });
    expect(Object.keys(log.afterData).sort()).toEqual(CHAVES_AUDITAVEIS);
    expect(log.beforeData).toBeUndefined();
    expect(log.afterData).toMatchObject({
      scopeType: 'pais',
      countryCode: 'XA',
      startDate: '2030-01-10',
      endDate: '2030-01-15',
      effectValue: 7,
      isActive: true,
    });
    expect(log.metadata.source).toBe('manual');
    expect(log.metadata.camposAlterados).toEqual(expect.arrayContaining(['scopeType', 'effectValue']));
    expect(JSON.stringify(log)).not.toContain(NOME);
    expect(JSON.stringify(log)).not.toContain(NOTA);
  });

  it('auditoria: update tem before/after com as mesmas chaves e os campos alterados (nomes, nao valores)', async () => {
    const cookies = await loginAs('comprador');
    await request(app)
      .patch(`${BASE}/7`)
      .set('Cookie', cookies)
      .send({ name: 'OCASIAO 002', notes: 'OUTRA NOTA SINTETICA', effectKind: 'percentual', effectValue: 10 });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    const log = logDoTx();
    expect(log).toMatchObject({ entityType: 'forecast_lead_time_event', entityId: '7', action: 'update' });
    expect(Object.keys(log.beforeData).sort()).toEqual(CHAVES_AUDITAVEIS);
    expect(Object.keys(log.afterData).sort()).toEqual(CHAVES_AUDITAVEIS);
    expect(log.beforeData).toMatchObject({ effectKind: 'dias', effectValue: 7 });
    expect(log.afterData).toMatchObject({ effectKind: 'percentual', effectValue: 10 });
    expect(log.metadata).toEqual({
      source: 'manual',
      camposAlterados: ['name', 'effectKind', 'effectValue', 'notes'],
    });
    const serializado = JSON.stringify(log);
    for (const proibido of [NOME, NOTA, 'OCASIAO 002', 'OUTRA NOTA']) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it('auditoria: delete grava o estado anterior auditavel, no tx', async () => {
    const cookies = await loginAs('admin');
    await request(app).delete(`${BASE}/7`).set('Cookie', cookies);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    const log = logDoTx();
    expect(log).toMatchObject({ entityType: 'forecast_lead_time_event', entityId: '7', action: 'delete' });
    expect(Object.keys(log.beforeData).sort()).toEqual(CHAVES_AUDITAVEIS);
    expect(log.afterData).toBeUndefined();
    expect(log.metadata.source).toBe('manual');
    expect(JSON.stringify(log)).not.toContain(NOME);
    expect(JSON.stringify(log)).not.toContain(NOTA);
  });
});

describe('PATCH /forecast/sources/:id - countryCode', () => {
  const SOURCE = '/api/v1/forecast/sources/5';
  const fonteAtualizada = { id: 5, name: 'FONTE 001', supplier: null, _count: { products: 0 } };

  beforeEach(() => {
    tx.forecastSource.update.mockResolvedValue(fonteAtualizada);
  });

  it('grava o codigo em maiusculo', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).patch(SOURCE).set('Cookie', cookies).send({ countryCode: 'xa' });
    expect(response.status).toBe(200);
    expect(tx.forecastSource.update.mock.calls[0][0].data).toEqual({ countryCode: 'XA' });
  });

  it('null limpa o pais', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(SOURCE).set('Cookie', cookies).send({ countryCode: null });
    expect(response.status).toBe(200);
    expect(tx.forecastSource.update.mock.calls[0][0].data).toEqual({ countryCode: null });
  });

  it.each(['X1', 'XAA', 'X', ''])('codigo %j -> 400', async (countryCode) => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(SOURCE).set('Cookie', cookies).send({ countryCode });
    expect(response.status).toBe(400);
    expect(tx.forecastSource.update).not.toHaveBeenCalled();
  });

  it('gestor -> 403', async () => {
    const cookies = await loginAs('gestor');
    const response = await request(app).patch(SOURCE).set('Cookie', cookies).send({ countryCode: 'XA' });
    expect(response.status).toBe(403);
    expect(tx.forecastSource.update).not.toHaveBeenCalled();
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
