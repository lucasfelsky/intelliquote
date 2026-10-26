import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quinzena } from '../src/utils/forecastTypes';
import { hashPassword } from '../src/utils/password';

// O arquivo faz varios logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSnapshot: { findFirst: vi.fn() },
    forecastProduct: { findUnique: vi.fn(), findMany: vi.fn() },
    forecastAtypicalMonth: { findMany: vi.fn() },
    forecastCommercialDemand: { findMany: vi.fn() },
    forecastProductCode: { findMany: vi.fn() },
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
  forecastProduct: { findUnique: Mock; findMany: Mock };
  forecastAtypicalMonth: { findMany: Mock };
  forecastCommercialDemand: { findMany: Mock };
  forecastProductCode: { findMany: Mock };
  $transaction: Mock;
};

// Fixture ANONIMIZADA (repo publico): os 338 produtos tem AY/AZ vazios.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';
type ProdutoCongelado = Quinzena['produtos'][number] & { productId?: number | null };

function snapshotCom(produtos: ProdutoCongelado[]) {
  return {
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
  };
}

type LinhaApi = { qtdAmostra: string | null; solicitarAmostra: string | null; precoFixo: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.forecastProduct.findMany.mockResolvedValue([]);
  prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([]);
  prismaMock.forecastCommercialDemand.findMany.mockResolvedValue([]);
  prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
});

describe('Forecast detalhe da quinzena - amostra (AY/AZ)', () => {
  it('devolve o texto congelado com trim; vazio, so espacos ou ausente -> null', async () => {
    const [base, ...resto] = fixture.produtos;
    const semChaves = { ...resto[2] } as Record<string, unknown>;
    delete semChaves.qtdAmostra;
    delete semChaves.solicitarAmostra;
    const produtos = [
      { ...base, qtdAmostra: ' 2 PACOTES SINT ', solicitarAmostra: 'SIM' },
      { ...resto[0], qtdAmostra: '', solicitarAmostra: '' },
      { ...resto[1], qtdAmostra: '   ', solicitarAmostra: '\t ' },
      semChaves as unknown as ProdutoCongelado,
    ];
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshotCom(produtos));

    const cookies = await loginAs('viewer');
    const response = await request(app).get('/api/v1/forecast/snapshots/9?hoje=2026-10-20').set('Cookie', cookies);

    expect(response.status).toBe(200);
    const linhas = response.body.data.linhas as LinhaApi[];
    expect(linhas).toHaveLength(4);
    expect(linhas[0]).toMatchObject({ qtdAmostra: '2 PACOTES SINT', solicitarAmostra: 'SIM' });
    expect(linhas[1]).toMatchObject({ qtdAmostra: null, solicitarAmostra: null });
    expect(linhas[2]).toMatchObject({ qtdAmostra: null, solicitarAmostra: null });
    expect(linhas[3]).toMatchObject({ qtdAmostra: null, solicitarAmostra: null });
  });

  it('as duas colunas sao independentes', async () => {
    const [base, outro] = fixture.produtos;
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(
      snapshotCom([
        { ...base, qtdAmostra: '1 PACOTE SINT', solicitarAmostra: '' },
        { ...outro, qtdAmostra: '', solicitarAmostra: 'NAO' },
      ]),
    );
    const cookies = await loginAs('gestor');
    const response = await request(app).get('/api/v1/forecast/snapshots/9?hoje=2026-10-20').set('Cookie', cookies);
    const linhas = response.body.data.linhas as LinhaApi[];
    expect(linhas[0]).toMatchObject({ qtdAmostra: '1 PACOTE SINT', solicitarAmostra: null });
    expect(linhas[1]).toMatchObject({ qtdAmostra: null, solicitarAmostra: 'NAO' });
  });

  it('precoFixo continua so o selo e o valor do preco fechado nunca vaza', async () => {
    const [base, ...resto] = fixture.produtos;
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(
      snapshotCom([
        { ...base, precoFechado: ' x ', qtdAmostra: 'AMOSTRA SINT' },
        { ...resto[0], precoFechado: '1,23' },
        { ...resto[1], precoFechado: '' },
      ]),
    );
    const cookies = await loginAs('viewer');
    const response = await request(app).get('/api/v1/forecast/snapshots/9?hoje=2026-10-20').set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect((response.body.data.linhas as LinhaApi[]).map((l) => l.precoFixo)).toEqual([true, false, false]);
    const texto = JSON.stringify(response.body);
    expect(texto).not.toContain('1,23');
    expect(texto).not.toContain('precoFechado');
  });

  it('o relatorio de compras nao carrega os campos novos', async () => {
    const produtos = fixture.produtos
      .slice(0, 5)
      .map((p, i) => ({ ...p, productId: 700 + i, qtdAmostra: 'AMOSTRA SINT', solicitarAmostra: 'SIM' }));
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshotCom(produtos));
    const cookies = await loginAs('viewer');
    const response = await request(app)
      .get('/api/v1/forecast/snapshots/9/relatorio-compras?hoje=2026-10-20')
      .set('Cookie', cookies);
    expect(response.status).toBe(200);
    const texto = JSON.stringify(response.body);
    expect(texto).not.toContain('qtdAmostra');
    expect(texto).not.toContain('solicitarAmostra');
    expect(texto).not.toContain('AMOSTRA SINT');
  });

  it('comercial -> 403 no detalhe (inalterado)', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get('/api/v1/forecast/snapshots/9?hoje=2026-10-20').set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastSnapshot.findFirst).not.toHaveBeenCalled();
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
