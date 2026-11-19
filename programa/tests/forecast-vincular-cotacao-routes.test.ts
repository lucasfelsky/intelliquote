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
  };
  return { prisma };
});

// O service tem testes de banco proprios; aqui so a borda HTTP (papeis, validacao, formato da resposta).
vi.mock('../src/services/ForecastCotacaoVinculoService', () => ({
  ForecastCotacaoVinculoService: {
    cotacoesAbertasDoProduto: vi.fn(),
    vincular: vi.fn(),
    desvincular: vi.fn(),
    // Usado por outros controllers carregados junto com o app.
    registrarEnvio: vi.fn(),
    registrarFechamento: vi.fn(),
    registrarPoEnviada: vi.fn(),
    cotacoesDosItens: vi.fn(),
  },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastCotacaoVinculoService } from '../src/services/ForecastCotacaoVinculoService';
import { HttpError } from '../src/utils/http';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
};
const listarMock = ForecastCotacaoVinculoService.cotacoesAbertasDoProduto as unknown as Mock;
const vincularMock = ForecastCotacaoVinculoService.vincular as unknown as Mock;
const desvincularMock = ForecastCotacaoVinculoService.desvincular as unknown as Mock;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const URL_LISTA = '/api/v1/forecast/snapshots/7/cotacoes-abertas/42';
const URL_VINCULO = '/api/v1/forecast/snapshots/7/vinculo-cotacao/42';

const decisao = {
  productId: 42,
  quantidadeKg: 1500,
  status: 'nao',
  observacao: null,
  sugeridaKg: 1500,
  demandaKg: 1400,
  incluidoManualmente: false,
  decididaPorId: 5,
  criadaEm: '2026-11-18T12:00:00.000Z',
  atualizadaEm: '2026-11-18T12:00:00.000Z',
};
const respostaLista = { snapshotId: 7, productId: 42, cotacoes: [] };
const respostaVincular = {
  acao: 'vincular',
  quoteRequestId: 90,
  requestCode: 'QR-20261118-ABC123',
  itensVinculados: 1,
  movidosDeOutraQuinzena: 0,
  decisao,
};
const respostaDesvincular = { acao: 'desvincular', decisao };

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue(respostaLista);
  vincularMock.mockResolvedValue(respostaVincular);
  desvincularMock.mockResolvedValue(respostaDesvincular);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /forecast/snapshots/:id/cotacoes-abertas/:productId', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(URL_LISTA)).status).toBe(401);
    expect(listarMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).get(URL_LISTA).set('Cookie', cookies)).status).toBe(403);
    expect(listarMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s lista: 200 com { data } e os ids numericos', async (role) => {
    const cookies = await loginAs(role, 5);
    const response = await request(app).get(URL_LISTA).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: respostaLista });
    expect(listarMock).toHaveBeenCalledWith(7, 42);
  });

  it.each(['abc', '0', '-1'])(':productId %s -> 400', async (productId) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .get(`/api/v1/forecast/snapshots/7/cotacoes-abertas/${productId}`)
      .set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto inválido.');
    expect(listarMock).not.toHaveBeenCalled();
  });

  it('erro 404 do service chega ao cliente com a mensagem', async () => {
    listarMock.mockRejectedValue(new HttpError(404, 'Quinzena nao encontrada.'));
    const cookies = await loginAs('comprador');
    const response = await request(app).get(URL_LISTA).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Quinzena nao encontrada.' });
  });
});

describe('PUT /forecast/snapshots/:id/vinculo-cotacao/:productId', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).put(URL_VINCULO).send({ quoteRequestId: 90 })).status).toBe(401);
    expect(vincularMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).put(URL_VINCULO).set('Cookie', cookies).send({ quoteRequestId: 90 });
    expect(response.status).toBe(403);
    expect(vincularMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s vincula: 200 com { data } e repassa os argumentos', async (role) => {
    const cookies = await loginAs(role, 5);
    const response = await request(app).put(URL_VINCULO).set('Cookie', cookies).send({ quoteRequestId: 90 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: respostaVincular });
    expect(vincularMock).toHaveBeenCalledTimes(1);
    expect(vincularMock).toHaveBeenCalledWith(7, 42, { quoteRequestId: 90 }, 5);
  });

  it('repassa `substituir` (Trocar)', async () => {
    const cookies = await loginAs('comprador', 6);
    const response = await request(app)
      .put(URL_VINCULO)
      .set('Cookie', cookies)
      .send({ quoteRequestId: 91, substituir: true });
    expect(response.status).toBe(200);
    expect(vincularMock).toHaveBeenCalledWith(7, 42, { quoteRequestId: 91, substituir: true }, 6);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['quoteRequestId ausente', {}, 'Informe a cotação.'],
    ['quoteRequestId zero', { quoteRequestId: 0 }, 'Informe a cotação.'],
    ['quoteRequestId negativo', { quoteRequestId: -3 }, 'Informe a cotação.'],
    ['quoteRequestId texto', { quoteRequestId: '90' }, 'Informe a cotação.'],
    ['quoteRequestId fracionado', { quoteRequestId: 1.5 }, 'Informe a cotação.'],
    ['substituir nao booleano', { quoteRequestId: 90, substituir: 'sim' }, 'substituir deve ser verdadeiro ou falso.'],
    ['chave desconhecida', { quoteRequestId: 90, status: 'closed' }, ''],
  ])('%s -> 400 sem gravar', async (_nome, corpo, mensagem) => {
    const cookies = await loginAs('admin');
    const response = await request(app).put(URL_VINCULO).set('Cookie', cookies).send(corpo);
    expect(response.status).toBe(400);
    if (mensagem) expect(response.body.message).toBe(mensagem);
    expect(vincularMock).not.toHaveBeenCalled();
  });

  it.each([
    ['abc', 'Produto inválido.'],
    ['0', 'Produto inválido.'],
  ])(':productId %s -> 400', async (productId, mensagem) => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put(`/api/v1/forecast/snapshots/7/vinculo-cotacao/${productId}`)
      .set('Cookie', cookies)
      .send({ quoteRequestId: 90 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(mensagem);
    expect(vincularMock).not.toHaveBeenCalled();
  });

  it(':id invalido -> 400 "Quinzena invalida."', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .put('/api/v1/forecast/snapshots/abc/vinculo-cotacao/42')
      .set('Cookie', cookies)
      .send({ quoteRequestId: 90 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
  });

  it.each([
    [409, 'O item já está na cotação aberta QR-Y. Use Trocar.'],
    [400, 'O item está em UN; só itens em KG entram no Forecast.'],
    [404, 'Cotação não encontrada.'],
  ])('erro %i do service chega ao cliente com a mensagem', async (status, message) => {
    vincularMock.mockRejectedValue(new HttpError(status, message));
    const cookies = await loginAs('comprador');
    const response = await request(app).put(URL_VINCULO).set('Cookie', cookies).send({ quoteRequestId: 90 });
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ message });
  });
});

describe('DELETE /forecast/snapshots/:id/vinculo-cotacao/:productId', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).delete(URL_VINCULO)).status).toBe(401);
    expect(desvincularMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e desfeito', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).delete(URL_VINCULO).set('Cookie', cookies)).status).toBe(403);
    expect(desvincularMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s desvincula: 200 com { data } e repassa os argumentos', async (role) => {
    const cookies = await loginAs(role, 5);
    const response = await request(app).delete(URL_VINCULO).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: respostaDesvincular });
    expect(desvincularMock).toHaveBeenCalledWith(7, 42, 5);
  });

  it(':productId nao numerico -> 400', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).delete('/api/v1/forecast/snapshots/7/vinculo-cotacao/xyz').set('Cookie', cookies);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto inválido.');
    expect(desvincularMock).not.toHaveBeenCalled();
  });

  it('cotacao fechada: 409 do service chega ao cliente com a mensagem', async () => {
    const message = 'A cotação QR-X está fechada; o vínculo não pode ser desfeito.';
    desvincularMock.mockRejectedValue(new HttpError(409, message));
    const cookies = await loginAs('admin');
    const response = await request(app).delete(URL_VINCULO).set('Cookie', cookies);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ message });
  });
});

async function loginAs(role: Role, id = 1) {
  const passwordHash = await hashPassword('ChangeMe123!');

  prismaMock.user.findUnique.mockResolvedValue({
    id,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  });
  prismaMock.user.findFirst.mockResolvedValue({
    id,
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
