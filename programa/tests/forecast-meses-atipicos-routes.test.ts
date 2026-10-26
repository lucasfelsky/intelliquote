import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    forecastProduct: { findUnique: vi.fn() },
    forecastAtypicalMonth: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), createMany: vi.fn() },
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
  forecastProduct: { findUnique: Mock };
  forecastAtypicalMonth: { findMany: Mock; deleteMany: Mock; update: Mock; createMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/products/5/meses-atipicos';

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  // Trava FOR NO KEY UPDATE da linha do produto (1a instrucao da transacao): devolve id/isActive.
  $queryRaw: vi.fn(),
  forecastAtypicalMonth: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), createMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

// Estado "no banco" simulado: findMany devolve o que esta aqui (antes e depois da gravacao).
let banco: Array<{ id: number; yearMonth: string; reason: string }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  banco = [];
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  tx.$queryRaw.mockResolvedValue([{ id: 5, isActive: true }]);
  tx.forecastAtypicalMonth.findMany.mockImplementation(async () => banco.map((b) => ({ ...b })));
  tx.forecastAtypicalMonth.deleteMany.mockImplementation(async ({ where }: { where: { id: { in: number[] } } }) => {
    banco = banco.filter((b) => !where.id.in.includes(b.id));
    return { count: 0 };
  });
  tx.forecastAtypicalMonth.update.mockImplementation(
    async ({ where, data }: { where: { id: number }; data: { reason: string } }) => {
      banco = banco.map((b) => (b.id === where.id ? { ...b, reason: data.reason } : b));
      return {};
    },
  );
  tx.forecastAtypicalMonth.createMany.mockImplementation(
    async ({ data }: { data: Array<{ yearMonth: string; reason: string }> }) => {
      banco = [...banco, ...data.map((d, i) => ({ id: 100 + i, yearMonth: d.yearMonth, reason: d.reason }))];
      return { count: data.length };
    },
  );
  tx.auditLog.create.mockResolvedValue({});
});

const corpo = (...meses: Array<[string, string]>) => ({ meses: meses.map(([anoMes, motivo]) => ({ anoMes, motivo })) });

describe('PUT /forecast/products/:id/meses-atipicos - papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).put(PATH).send(corpo())).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.forecastAtypicalMonth.createMany).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s marca: 200 com a lista dos meses', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .put(PATH)
      .set('Cookie', cookies)
      .send(corpo(['2024-09', '  VENDA ATIPICA SINTETICA  '], ['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      productId: 5,
      meses: [
        { anoMes: '2024-08', motivo: 'MOTIVO SINTETICO' },
        { anoMes: '2024-09', motivo: 'VENDA ATIPICA SINTETICA' },
      ],
    });
    expect(tx.forecastAtypicalMonth.createMany).toHaveBeenCalledWith({
      data: [
        { productId: 5, yearMonth: '2024-09', reason: 'VENDA ATIPICA SINTETICA', createdById: 1 },
        { productId: 5, yearMonth: '2024-08', reason: 'MOTIVO SINTETICO', createdById: 1 },
      ],
    });
  });
});

describe('PUT /forecast/products/:id/meses-atipicos - validacao e erros', () => {
  it('Zod: corpo, mes, motivo, duplicado, futuro e excesso -> 400 em portugues, sem gravar', async () => {
    const cookies = await loginAs('admin');
    const muitos = Array.from({ length: 25 }, (_, i) => ({
      anoMes: `${2000 + i}-01`,
      motivo: 'MOTIVO SINTETICO',
    }));
    const casos: Array<[unknown, string]> = [
      [{}, 'Informe a lista de meses atípicos.'],
      [{ meses: 'x' }, 'Informe a lista de meses atípicos.'],
      [corpo(['2024-13', 'MOTIVO SINTETICO']), 'Informe o mês no formato AAAA-MM (ex.: 2026-08).'],
      [corpo(['24-08', 'MOTIVO SINTETICO']), 'Informe o mês no formato AAAA-MM (ex.: 2026-08).'],
      [{ meses: [{ anoMes: '2024-08' }] }, 'Informe o motivo de cada mês atípico.'],
      [corpo(['2024-08', 'ab']), 'O motivo precisa ter ao menos 3 caracteres.'],
      [corpo(['2024-08', '   ']), 'O motivo precisa ter ao menos 3 caracteres.'],
      [corpo(['2024-08', 'x'.repeat(301)]), 'O motivo aceita no máximo 300 caracteres.'],
      [corpo(['2024-08', 'MOTIVO UM'], ['2024-08', 'MOTIVO DOIS']), 'foi informado mais de uma vez'],
      [corpo(['2099-01', 'MOTIVO SINTETICO']), 'é futuro: marque só meses que já tiveram venda.'],
      [{ meses: muitos }, 'Informe no máximo 24 meses atípicos.'],
      [{ ...corpo(['2024-08', 'MOTIVO SINTETICO']), janela: ['2024-09'] }, 'está fora da janela informada.'],
      [{ ...corpo(), janela: ['2024-9'] }, 'Informe o mês no formato AAAA-MM (ex.: 2026-08).'],
    ];
    for (const [body, mensagem] of casos) {
      const response = await request(app).put(PATH).set('Cookie', cookies).send(body as object);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(JSON.stringify(response.body)).toContain(mensagem);
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('o mes atual (calendario de Sao Paulo) e aceito; motivo com 300 caracteres e 24 meses tambem', async () => {
    const cookies = await loginAs('comprador');
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    const atual = await request(app).put(PATH).set('Cookie', cookies).send(corpo([hoje, 'x'.repeat(300)]));
    expect(atual.status).toBe(200);
    banco = [];
    const vinteEQuatro = Array.from({ length: 24 }, (_, i) => ({
      anoMes: `${2000 + i}-02`,
      motivo: 'MOTIVO SINTETICO',
    }));
    const lista = await request(app).put(PATH).set('Cookie', cookies).send({ meses: vinteEQuatro });
    expect(lista.status).toBe(200);
    expect(lista.body.data.meses).toHaveLength(24);
  });

  it('produto INATIVO -> 400 com o caminho (reativar), sem gravar nem auditar', async () => {
    const cookies = await loginAs('admin');
    tx.$queryRaw.mockResolvedValue([{ id: 5, isActive: false }]);
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'Produto inativo: reative o produto no cadastro do Forecast antes de marcar meses atípicos.',
    );
    expect(tx.forecastAtypicalMonth.createMany).not.toHaveBeenCalled();
    expect(tx.forecastAtypicalMonth.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('a 1a instrucao da transacao e a trava FOR NO KEY UPDATE do produto, antes de ler as marcas', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(200);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR NO KEY UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.forecastAtypicalMonth.findMany.mock.invocationCallOrder[0],
    );
    // E as opcoes de transacao de cadastro (30 s / 10 s): a trava pode esperar o import.
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000, maxWait: 10_000 });
  });

  it('corrida no unique (productId, yearMonth): P2002 -> 409 com a mensagem, nunca 500', async () => {
    const cookies = await loginAs('admin');
    tx.forecastAtypicalMonth.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'Os meses atípicos deste produto foram alterados por outra pessoa. Recarregue e tente de novo.',
    );
  });

  it('P2028 (esperando o import da planilha) -> 503 com a mensagem de ocupado', async () => {
    const cookies = await loginAs('admin');
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('timeout', { code: 'P2028', clientVersion: 'test' }),
    );
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(503);
    expect(response.body.message).toBe('O cadastro está ocupado por uma importação. Tente novamente em instantes.');
  });

  it('id invalido -> 400; produto inexistente -> 404 sem gravar', async () => {
    const cookies = await loginAs('admin');
    const ruim = await request(app)
      .put('/api/v1/forecast/products/abc/meses-atipicos')
      .set('Cookie', cookies)
      .send(corpo());
    expect(ruim.status).toBe(400);

    tx.$queryRaw.mockResolvedValue([]);
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Produto nao encontrado.');
    expect(tx.forecastAtypicalMonth.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/products/:id/meses-atipicos - gravacao e auditoria', () => {
  it('AuditLog vai pelo tx, so com ano-mes e contagem: sem o texto do motivo e sem nome', async () => {
    banco = [{ id: 1, yearMonth: '2024-07', reason: 'MOTIVO ANTIGO SINTETICO' }];
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PATH)
      .set('Cookie', cookies)
      .send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(200);
    // O 2024-07 saiu do conjunto (substituicao): apagado; o 2024-08 entrou.
    expect(tx.forecastAtypicalMonth.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const data = tx.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      entityType: 'forecast_product',
      entityId: '5',
      action: 'atypical_months_update',
      performedById: 1,
      metadata: { antes: ['2024-07'], depois: ['2024-08'], motivosAlterados: 0 },
    });
    expect(JSON.stringify(data)).not.toContain('MOTIVO');
    expect(JSON.stringify(data)).not.toContain('PRODUTO');
  });

  it('so o motivo muda: atualiza a linha existente (sem apagar nem criar) e conta o motivo alterado', async () => {
    banco = [{ id: 1, yearMonth: '2024-08', reason: 'MOTIVO ANTIGO SINTETICO' }];
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .put(PATH)
      .set('Cookie', cookies)
      .send(corpo(['2024-08', 'MOTIVO NOVO SINTETICO']));
    expect(response.status).toBe(200);
    expect(tx.forecastAtypicalMonth.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { reason: 'MOTIVO NOVO SINTETICO' },
    });
    expect(tx.forecastAtypicalMonth.deleteMany).not.toHaveBeenCalled();
    expect(tx.forecastAtypicalMonth.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({
      antes: ['2024-08'],
      depois: ['2024-08'],
      motivosAlterados: 1,
    });
  });

  it('lista vazia desmarca tudo', async () => {
    banco = [
      { id: 1, yearMonth: '2024-07', reason: 'MOTIVO UM' },
      { id: 2, yearMonth: '2024-08', reason: 'MOTIVO DOIS' },
    ];
    const cookies = await loginAs('admin');
    const response = await request(app).put(PATH).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ productId: 5, meses: [] });
    expect(tx.forecastAtypicalMonth.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
  });

  it('com janela: so os meses da janela sao substituidos; marcas de outros meses ficam como estao', async () => {
    banco = [
      { id: 1, yearMonth: '2023-01', reason: 'FORA DA JANELA SINTETICO' },
      { id: 2, yearMonth: '2024-07', reason: 'MOTIVO UM' },
    ];
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PATH)
      .set('Cookie', cookies)
      .send({ ...corpo(['2024-08', 'MOTIVO DOIS']), janela: ['2024-07', '2024-08', '2024-09'] });
    expect(response.status).toBe(200);
    expect(tx.forecastAtypicalMonth.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
    expect(response.body.data.meses).toEqual([
      { anoMes: '2023-01', motivo: 'FORA DA JANELA SINTETICO' },
      { anoMes: '2024-08', motivo: 'MOTIVO DOIS' },
    ]);
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      antes: ['2023-01', '2024-07'],
      depois: ['2023-01', '2024-08'],
    });
  });

  it('sem alteracao: 200, nao grava e nao audita', async () => {
    banco = [{ id: 1, yearMonth: '2024-08', reason: 'MOTIVO SINTETICO' }];
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(PATH)
      .set('Cookie', cookies)
      .send(corpo(['2024-08', 'MOTIVO SINTETICO']));
    expect(response.status).toBe(200);
    expect(response.body.data.meses).toEqual([{ anoMes: '2024-08', motivo: 'MOTIVO SINTETICO' }]);
    expect(tx.forecastAtypicalMonth.deleteMany).not.toHaveBeenCalled();
    expect(tx.forecastAtypicalMonth.update).not.toHaveBeenCalled();
    expect(tx.forecastAtypicalMonth.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PUT /forecast/products/:id/meses-atipicos - virada de mes em Sao Paulo (relogio simulado)', () => {
  // So o Date e simulado (supertest/sockets seguem com timers reais). O login e feito DEPOIS de fixar o relogio.
  afterEach(() => {
    vi.useRealTimers();
  });

  const comRelogio = async (instante: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instante));
    return loginAs('admin');
  };
  const marcar = (cookies: string[], anoMes: string) =>
    request(app).put(PATH).set('Cookie', cookies).send(corpo([anoMes, 'MOTIVO SINTETICO']));

  it('23:30 de 28/02 em Sao Paulo (ja e 01/03 em UTC): marco ainda e futuro (400) e fevereiro e aceito', async () => {
    const cookies = await comRelogio('2026-03-01T02:30:00Z');
    const futuro = await marcar(cookies, '2026-03');
    expect(futuro.status).toBe(400);
    expect(JSON.stringify(futuro.body)).toContain('O mês 2026-03 é futuro: marque só meses que já tiveram venda.');
    expect(tx.forecastAtypicalMonth.createMany).not.toHaveBeenCalled();
    expect((await marcar(cookies, '2026-02')).status).toBe(200);
  });

  it('00:30 de 01/03 em Sao Paulo: marco vira o mes atual e passa a ser aceito', async () => {
    const cookies = await comRelogio('2026-03-01T03:30:00Z');
    expect((await marcar(cookies, '2026-03')).status).toBe(200);
    banco = [];
    const abril = await marcar(cookies, '2026-04');
    expect(abril.status).toBe(400);
    expect(JSON.stringify(abril.body)).toContain('é futuro');
  });

  it('virada de ano: 23:30 de 31/12 em Sao Paulo ainda recusa janeiro e aceita dezembro', async () => {
    const cookies = await comRelogio('2027-01-01T02:30:00Z');
    expect((await marcar(cookies, '2027-01')).status).toBe(400);
    expect((await marcar(cookies, '2026-12')).status).toBe(200);
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
