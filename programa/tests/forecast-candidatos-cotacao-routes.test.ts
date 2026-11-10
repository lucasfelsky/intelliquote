import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastSnapshotService } from '../src/services/ForecastSnapshotService';
import type { CandidatoComFonte, CandidatosDaQuinzena } from '../src/utils/forecastCandidatosCotacao';
import { HttpError } from '../src/utils/http';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const URL_BASE = '/api/v1/forecast/snapshots/7/candidatos-cotacao';

const candidato = (over: Partial<CandidatoComFonte> = {}): CandidatoComFonte => ({
  productId: 2,
  item: 'PRODUTO 002',
  codigos: ['COD-002'],
  fonte: 'FONTE A',
  fonteChave: 'FONTE A',
  demandaKg: 360,
  quantidadeSugeridaKg: null,
  motivoForaDaLista: 'sem-falta',
  coberturaAteMes: '2027-03',
  coberturaAteOFimDaJanela: true,
  urgencia: null,
  grupoNome: null,
  anMotorKg: 500,
  ...over,
});

const resultado: CandidatosDaQuinzena = {
  candidatos: [
    candidato(),
    candidato({
      productId: 3,
      item: 'PRODUTO 003',
      demandaKg: 240,
      motivoForaDaLista: 'sob-demanda',
      quantidadeSugeridaKg: 50,
    }),
    candidato({ productId: 15, item: 'PRODUTO 015', fonte: 'Fonte B', fonteChave: 'FONTE B', demandaKg: 25 }),
  ],
  excluidos: [
    { motivo: 'sem-cadastro', fonte: 'FONTE A' },
    { motivo: 'sem-vinculo-catalogo', fonte: 'FONTE A' },
    { motivo: 'sem-lead-time', fonte: 'Fonte B' },
  ],
};

// Linhas do motor so para o 404 de fonte inexistente (a regra dos candidatos e testada no utilitario puro).
const calc = {
  id: 7,
  label: '10-2',
  linhas: [{ fonte: 'FONTE A' }, { fonte: ' Fonte B ' }, { fonte: '' }],
};

// Metodo privado do service: o teste troca so o acesso ao banco/motor; o agrupamento e o 404 sao os reais.
type ComPrivado = { candidatosDaQuinzena: () => Promise<unknown> };
const candidatosDaQuinzena = () => (ForecastSnapshotService as unknown as { candidatosDaQuinzena: Mock }).candidatosDaQuinzena;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(ForecastSnapshotService as unknown as ComPrivado, 'candidatosDaQuinzena').mockResolvedValue({
    calc,
    resultado,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /forecast/snapshots/:id/candidatos-cotacao', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(URL_BASE)).status).toBe(401);
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s le (COMEX_ROLES)', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(URL_BASE).set('Cookie', cookies);
    expect(response.status).toBe(200);
  });

  it('comercial -> 403 e nada e calculado', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(URL_BASE).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(candidatosDaQuinzena()).not.toHaveBeenCalled();
  });

  it('sem fonte: agrupado por fonte, no padrao { data }, sem campos internos', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(URL_BASE).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      snapshotId: 7,
      label: '10-2',
      fonte: null,
      fontes: [
        {
          fonte: 'FONTE A',
          itens: [
            {
              productId: 2,
              item: 'PRODUTO 002',
              codigos: ['COD-002'],
              fonte: 'FONTE A',
              demandaKg: 360,
              quantidadeSugeridaKg: null,
              motivoForaDaLista: 'sem-falta',
              coberturaAteMes: '2027-03',
              coberturaAteOFimDaJanela: true,
              urgencia: null,
              grupoNome: null,
            },
            expect.objectContaining({ productId: 3, motivoForaDaLista: 'sob-demanda', quantidadeSugeridaKg: 50 }),
          ],
        },
        { fonte: 'Fonte B', itens: [expect.objectContaining({ productId: 15 })] },
      ],
      excluidos: [
        { motivo: 'sem-cadastro', quantidade: 1 },
        { motivo: 'sem-vinculo-catalogo', quantidade: 1 },
        { motivo: 'sem-lead-time', quantidade: 1 },
      ],
    });
  });

  it('com fonte (sem diferenciar maiusculas): so os itens e os excluidos dela, com o nome canonico', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).get(`${URL_BASE}?fonte=fonte%20b`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.fonte).toBe('Fonte B');
    expect(response.body.data.fontes).toEqual([
      { fonte: 'Fonte B', itens: [expect.objectContaining({ productId: 15 })] },
    ]);
    expect(response.body.data.excluidos).toEqual([{ motivo: 'sem-lead-time', quantidade: 1 }]);
  });

  it('fonte inexistente na quinzena -> 404', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).get(`${URL_BASE}?fonte=FONTE%20Z`).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Fonte nao encontrada nesta quinzena.');
  });

  it.each(['abc', '0'])('quinzena %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .get(`/api/v1/forecast/snapshots/${id}/candidatos-cotacao`)
      .set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
  });

  it.each(['fonte=', `fonte=${'x'.repeat(201)}`, 'hoje=2026-13-40'])('query invalida (%s) -> 400', async (qs) => {
    const cookies = await loginAs('admin');
    const response = await request(app).get(`${URL_BASE}?${qs}`).set('Cookie', cookies);
    expect(response.status).toBe(400);
  });

  it.each(['fonte=a&fonte=b', 'hoje=2026-10-20&hoje=2026-10-21'])('parametro repetido (%s) -> 400, nao ignora em silencio', async (qs) => {
    const cookies = await loginAs('admin');
    const response = await request(app).get(`${URL_BASE}?${qs}`).set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(candidatosDaQuinzena()).not.toHaveBeenCalled();
  });

  it('quinzena inexistente -> 404 vindo do service', async () => {
    candidatosDaQuinzena().mockRejectedValue(new HttpError(404, 'Quinzena nao encontrada.'));
    const cookies = await loginAs('admin');
    const response = await request(app).get(URL_BASE).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Quinzena nao encontrada.');
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
