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
vi.mock('../src/services/ForecastCotacaoLoteService', () => ({
  ForecastCotacaoLoteService: { criar: vi.fn() },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastCotacaoLoteService } from '../src/services/ForecastCotacaoLoteService';
import { HttpError } from '../src/utils/http';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
};
const criarMock = ForecastCotacaoLoteService.criar as unknown as Mock;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const URL = '/api/v1/forecast/snapshots/7/cotacoes';
const OBSERVACAO = 'OBSERVACAO SINTETICA SECRETA';

const corpo = (over: Record<string, unknown> = {}) => ({
  itens: [
    { productId: 42, quantidadeKg: 1500.5 },
    { productId: 43, quantidadeKg: 20, observacao: OBSERVACAO, incluidoManualmente: true },
  ],
  ...over,
});

const resposta = {
  snapshotId: 7,
  label: '10-2',
  cotacoes: [
    {
      id: 90,
      requestCode: 'QR-20261110-ABC123',
      fonte: 'FONTE X',
      itens: [{ productId: 42, item: 'PRODUTO A', catalogItemId: 5, codigo: 'A1', quantidadeKg: 1501, quoteRequestItemId: 300 }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  criarMock.mockResolvedValue(resposta);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /forecast/snapshots/:id/cotacoes', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).post(URL).send(corpo())).status).toBe(401);
    expect(criarMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['viewer', 'gestor', 'comercial'])('%s -> 403 e nada e criado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).post(URL).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(403);
    expect(criarMock).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s cria o lote: 201 com { data } e o usuario logado', async (role) => {
    const cookies = await loginAs(role, 5);
    const response = await request(app).post(URL).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: resposta });
    expect(criarMock).toHaveBeenCalledTimes(1);
    const [snapshotId, input, userId] = criarMock.mock.calls[0];
    expect(snapshotId).toBe(7);
    expect(userId).toBe(5);
    // Cabecalho da cotacao e opcional: sem ele, o service aplica os padroes (FOB, Shanghai, USD).
    expect(input).toEqual({
      itens: [
        { productId: 42, quantidadeKg: 1500.5 },
        { productId: 43, quantidadeKg: 20, observacao: OBSERVACAO, incluidoManualmente: true },
      ],
    });
  });

  it('aceita o cabecalho da cotacao e normaliza moeda e porto', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(URL)
      .set('Cookie', cookies)
      .send(
        corpo({
          desiredIncoterm: ['CIF', 'FOB'],
          currency: ' eur ',
          destinationPort: ' Santos ',
          originPort: '',
          deadlineAt: '2099-01-31T00:00:00.000Z',
        }),
      );
    expect(response.status).toBe(201);
    const input = criarMock.mock.calls[0][1];
    expect(input).toMatchObject({
      desiredIncoterm: ['CIF', 'FOB'],
      currency: 'EUR',
      destinationPort: 'Santos',
      originPort: null,
      deadlineAt: '2099-01-31T00:00:00.000Z',
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['itens ausente', { itens: undefined }, 'Informe a lista de itens a cotar.'],
    ['lista vazia', { itens: [] }, 'Informe ao menos um item a cotar.'],
    ['produto repetido', { itens: [{ productId: 42, quantidadeKg: 1 }, { productId: 42, quantidadeKg: 2 }] }, 'O mesmo produto aparece mais de uma vez no lote.'],
    ['quantidade zero', { itens: [{ productId: 42, quantidadeKg: 0 }] }, 'A quantidade a cotar deve ser maior que zero.'],
    ['quantidade negativa', { itens: [{ productId: 42, quantidadeKg: -1 }] }, 'A quantidade não pode ser negativa.'],
    ['quantidade com 4 casas', { itens: [{ productId: 42, quantidadeKg: 1.2345 }] }, 'A quantidade aceita no máximo 3 casas decimais.'],
    ['quantidade acima do teto', { itens: [{ productId: 42, quantidadeKg: 10_000_001 }] }, 'A quantidade aceita no máximo 10.000.000 kg.'],
    ['produto invalido', { itens: [{ productId: 0, quantidadeKg: 1 }] }, 'O produto do item é inválido.'],
    ['observacao longa', { itens: [{ productId: 42, quantidadeKg: 1, observacao: 'x'.repeat(301) }] }, 'A observação aceita no máximo 300 caracteres.'],
    ['chave desconhecida no item', { itens: [{ productId: 42, quantidadeKg: 1, fonte: 'X' }] }, ''],
    ['chave desconhecida no corpo', { status: 'closed' }, ''],
    ['Incoterm invalido', { desiredIncoterm: ['XYZ'] }, 'Incoterm inválido.'],
    ['Incoterms vazio', { desiredIncoterm: [] }, 'Informe ao menos um Incoterm.'],
    ['moeda invalida', { currency: 'DOLAR' }, 'Informe um código de moeda válido.'],
    ['prazo invalido', { deadlineAt: 'amanha' }, 'deadlineAt deve ser uma data ISO 8601.'],
    ['atualizadoEm invalido', { itens: [{ productId: 42, quantidadeKg: 1, atualizadoEm: 'ontem' }] }, 'atualizadoEm deve ser uma data ISO 8601.'],
  ])('%s -> 400 sem criar nada', async (_nome, over, mensagem) => {
    const cookies = await loginAs('admin');
    const response = await request(app).post(URL).set('Cookie', cookies).send(corpo(over));
    expect(response.status).toBe(400);
    if (mensagem) expect(response.body.message).toBe(mensagem);
    expect(criarMock).not.toHaveBeenCalled();
  });

  it('lote com mais de 100 itens -> 400', async () => {
    const cookies = await loginAs('admin');
    const itens = Array.from({ length: 101 }, (_, i) => ({ productId: i + 1, quantidadeKg: 1 }));
    const response = await request(app).post(URL).set('Cookie', cookies).send({ itens });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('O lote aceita no máximo 100 itens.');
  });

  it.each(['abc', '0'])('id %s -> 400', async (id) => {
    const cookies = await loginAs('admin');
    const response = await request(app).post(`/api/v1/forecast/snapshots/${id}/cotacoes`).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Quinzena invalida.');
    expect(criarMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'o item não está na lista de compra'],
    [404, 'Quinzena nao encontrada.'],
    [409, 'Não foi possível gerar as cotações. Item X: Item sem fonte.'],
  ])('erro %i do service chega ao cliente com a mensagem', async (status, message) => {
    criarMock.mockRejectedValue(new HttpError(status, message));
    const cookies = await loginAs('comprador');
    const response = await request(app).post(URL).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(status);
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
