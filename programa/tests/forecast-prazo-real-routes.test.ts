import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

// Sem update/upsert/updateMany/create em nenhum model de forecast: a rota e so leitura.
vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSnapshot: { findFirst: vi.fn() },
    forecastSource: { findMany: vi.fn() },
    forecastProduct: { findMany: vi.fn() },
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
  forecastSnapshot: { findFirst: Mock };
  forecastSource: { findMany: Mock };
  forecastProduct: { findMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/sources/prazo-real';

const fonte = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  leadTimeDays: 90,
  clearanceDays: 7,
  arrivalFromEtdDays: null,
  ...extra,
});

// Fontes e produtos sinteticos (codigos TST...). Fonte 1 = TST0001/TST0002; fonte 2 = TST0003.
const fontes = () => [fonte(1, 'FONTE A', { arrivalFromEtdDays: 28 }), fonte(2, 'FONTE B', { leadTimeDays: null })];
const produtos = () => [
  { sourceId: 1, codes: [{ code: 'TST0001' }, { code: 'tst0002' }] },
  { sourceId: 2, codes: [{ code: 'TST0003' }] },
];

const amostra = (codigo: string, poDias: number | null, etdDias: number | null) => ({
  codigo,
  etaFinal: '2033-04-10',
  poDias,
  etdDias,
});

const snapshot = (inputs: Record<string, unknown>) => ({
  id: 77,
  label: '2033-06-2',
  baseDate: new Date('2033-06-30T00:00:00.000Z'),
  inputs,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
  prismaMock.forecastSource.findMany.mockResolvedValue(fontes());
  prismaMock.forecastProduct.findMany.mockResolvedValue(produtos());
});

describe('GET /forecast/sources/prazo-real - papeis', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  it('comercial -> 403 e nada e lido', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s -> 200', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('GET /forecast/sources/prazo-real - conteudo', () => {
  it('sem quinzena DBCorp: indisponivel, fontes listadas com real null', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      quinzena: null,
      disponivel: false,
      motivo: 'sem_quinzena_dbcorp',
      janelaDias: 365,
      minChegadas: 3,
      padraoEtdDias: 35,
      fontes: [
        { sourceId: 1, nome: 'FONTE A', leadTimeDays: 90, clearanceDays: 7, etdDiasUsado: 28, real: null },
        { sourceId: 2, nome: 'FONTE B', leadTimeDays: null, clearanceDays: 7, etdDiasUsado: 35, real: null },
      ],
      semFonte: { chegadas: 0 },
    });
  });

  it('snapshot sem prazosFup (gravado antes do 3C): quinzena_sem_historico', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshot({ estoque: [] }));
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.disponivel).toBe(false);
    expect(response.body.data.motivo).toBe('quinzena_sem_historico');
    expect(response.body.data.quinzena).toEqual({ id: 77, label: '2033-06-2', baseDate: '2033-06-30' });
    expect(response.body.data.fontes.map((f: { real: unknown }) => f.real)).toEqual([null, null]);
  });

  it('snapshot com amostras: numeros por fonte, etdDiasUsado e codigo sem produto em semFonte', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(
      snapshot({
        prazosFup: [
          amostra('TST0001', 60, 30),
          amostra('TST0002', 80, 40),
          amostra('TST0001', 100, null),
          amostra('TST0003', 50, 20),
          amostra('TST0999', 10, 10),
        ],
      }),
    );
    const cookies = await loginAs('gestor');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.disponivel).toBe(true);
    expect(data.motivo).toBeNull();
    expect(data.semFonte).toEqual({ chegadas: 1 });

    const [a, b] = data.fontes;
    expect(a.etdDiasUsado).toBe(28);
    expect(a.real.po).toEqual({ chegadas: 3, media: 80, mediana: 80, min: 60, max: 100, poucasChegadas: false });
    expect(a.real.etd).toEqual({ chegadas: 2, media: 35, mediana: 35, min: 30, max: 40, poucasChegadas: true });
    expect(b.etdDiasUsado).toBe(35);
    expect(b.real.po).toEqual({ chegadas: 1, media: 50, mediana: 50, min: 50, max: 50, poucasChegadas: true });
  });

  it('fonte ativa sem amostra: real com po e etd null', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshot({ prazosFup: [amostra('TST0001', 60, 30)] }));
    const cookies = await loginAs('admin');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.body.data.fontes[1].real).toEqual({ po: null, etd: null });
  });

  it('prazosFup vazio e historico valido (disponivel, tudo null)', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshot({ prazosFup: [] }));
    const cookies = await loginAs('admin');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.body.data.disponivel).toBe(true);
    expect(response.body.data.motivo).toBeNull();
  });

  it('busca a ultima quinzena DBCorp nao apagada e so fontes/produtos ativos', async () => {
    const cookies = await loginAs('comprador');
    await request(app).get(`${PATH}?qualquer=coisa`).set('Cookie', cookies);
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { origin: 'dbcorp', deletedAt: null },
        orderBy: [{ baseDate: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(prismaMock.forecastSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(prismaMock.forecastProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, sourceId: { not: null } } }),
    );
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('erro de banco -> 500 padronizado', async () => {
    prismaMock.forecastSnapshot.findFirst.mockRejectedValue(new Error('falha sintetica'));
    const cookies = await loginAs('admin');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(500);
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
