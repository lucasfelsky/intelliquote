import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quinzena } from '../src/utils/forecastTypes';
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
    // forecastSnapshot SEM update/upsert/updateMany de proposito: o historico nunca e editado.
    forecastSnapshot: { findFirst: vi.fn() },
    forecastProduct: { findUnique: vi.fn(), findMany: vi.fn() },
    forecastProductCode: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
  forecastProduct: { findUnique: Mock; findMany: Mock };
  forecastProductCode: { findMany: Mock; update: Mock; updateMany: Mock };
  $transaction: Mock;
};

// Fixture ANONIMIZADA (repo publico).
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/products/5/embalagens';

interface CodigoMock {
  id: number;
  position: number;
  code: string;
  packagingQtyKg: Prisma.Decimal | null;
  packagingPalletKg: Prisma.Decimal | null;
  packagingLabel: string | null;
  packagingIsPrimary: boolean;
  packagingSource: string | null;
  packagingUpdatedAt: Date | null;
}

const codigo = (id: number, extra: Partial<CodigoMock> = {}): CodigoMock => ({
  id,
  position: id - 10,
  code: `C000${id - 10}`,
  packagingQtyKg: null,
  packagingPalletKg: null,
  packagingLabel: null,
  packagingIsPrimary: false,
  packagingSource: null,
  packagingUpdatedAt: null,
  ...extra,
});

// Produto 5 com 3 codigos (ids 11..13, EMB.1..EMB.3).
const produto = (codes: CodigoMock[] = [codigo(11), codigo(12), codigo(13)]) => ({
  id: 5,
  name: 'PRODUTO 001',
  isActive: true,
  packaging: null,
  noFractioning: false,
  codes,
});

const dec = (v: string) => new Prisma.Decimal(v);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.forecastProduct.findUnique.mockResolvedValue(produto());
  prismaMock.forecastProduct.findMany.mockResolvedValue([]);
  prismaMock.forecastProductCode.update.mockResolvedValue({});
  prismaMock.forecastProductCode.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe('Forecast embalagens - autenticacao e papeis', () => {
  it('sem login: GET e PATCH -> 401', async () => {
    expect((await request(app).get(PATH)).status).toBe(401);
    expect((await request(app).patch(PATH).send({ principalCodigoId: null })).status).toBe(401);
  });

  it('comercial: GET e PATCH -> 403', async () => {
    const cookies = await loginAs('comercial');
    expect((await request(app).get(PATH).set('Cookie', cookies)).status).toBe(403);
    expect((await request(app).patch(PATH).set('Cookie', cookies).send({ principalCodigoId: null })).status).toBe(
      403,
    );
  });

  it.each(['viewer', 'gestor'] as Role[])('%s: PATCH -> 403 e GET -> 200', async (role) => {
    const cookies = await loginAs(role);
    const patch = await request(app).patch(PATH).set('Cookie', cookies).send({ principalCodigoId: null });
    expect(patch.status).toBe(403);
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    const get = await request(app).get(PATH).set('Cookie', cookies);
    expect(get.status).toBe(200);
    expect(get.body.data.produto).toMatchObject({ id: 5, nome: 'PRODUTO 001', ativo: true });
  });

  it.each(['admin', 'comprador'] as Role[])('%s: PATCH com {} passa do RBAC e cai no Zod (400)', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({});
    expect(response.status).toBe(400);
  });
});

describe('Forecast embalagens - GET', () => {
  it('devolve os codigos por posicao, origem, data e a embalagem usada (principal vence)', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([
        codigo(11, { packagingQtyKg: dec('25'), packagingSource: 'manual', packagingUpdatedAt: new Date('2026-10-22T15:00:00.000Z') }),
        codigo(12, { packagingQtyKg: dec('22.68'), packagingLabel: 'Saco', packagingIsPrimary: true, packagingSource: 'dbcorp' }),
        codigo(13),
      ]),
    );
    const cookies = await loginAs('viewer');
    const response = await request(app).get(PATH).set('Cookie', cookies);
    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data.codigos.map((c: { id: number }) => c.id)).toEqual([11, 12, 13]);
    expect(data.codigos[0]).toMatchObject({
      posicao: 1,
      codigo: 'C0001',
      quantidadeKg: 25,
      rotulo: null,
      principal: false,
      origem: 'manual',
      atualizadoEm: '2026-10-22',
    });
    expect(data.codigos[1]).toMatchObject({ quantidadeKg: 22.68, rotulo: 'Saco', principal: true, origem: 'dbcorp' });
    expect(data.codigos[2]).toMatchObject({ quantidadeKg: null, origem: null, atualizadoEm: null });
    expect(data.usadaCodigoId).toBe(12);
  });

  it('sem principal, usa o primeiro codigo com quantidade; sem nenhuma, usadaCodigoId nulo', async () => {
    const cookies = await loginAs('viewer');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([codigo(11), codigo(12, { packagingQtyKg: dec('200') }), codigo(13, { packagingQtyKg: dec('25') })]),
    );
    const a = await request(app).get(PATH).set('Cookie', cookies);
    expect(a.body.data.usadaCodigoId).toBe(12);
    prismaMock.forecastProduct.findUnique.mockResolvedValue(produto());
    const b = await request(app).get(PATH).set('Cookie', cookies);
    expect(b.body.data.usadaCodigoId).toBeNull();
  });

  it('id nao numerico -> 400; produto inexistente -> 404', async () => {
    const cookies = await loginAs('viewer');
    const ruim = await request(app).get('/api/v1/forecast/products/abc/embalagens').set('Cookie', cookies);
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toBe('Produto invalido.');
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const nada = await request(app).get(PATH).set('Cookie', cookies);
    expect(nada.status).toBe(404);
    expect(nada.body.message).toBe('Produto nao encontrado.');
  });
});

describe('Forecast embalagens - PATCH (validacao Zod)', () => {
  const um = (quantidadeKg: unknown, extra: Record<string, unknown> = {}) => ({
    embalagens: [{ codigoId: 11, quantidadeKg, ...extra }],
  });
  const casos: Array<[string, unknown, string]> = [
    ['quantidade 0', um(0), 'A quantidade da embalagem deve ser maior que zero.'],
    ['quantidade negativa', um(-1), 'A quantidade da embalagem deve ser maior que zero.'],
    ['quantidade acima de 1.000.000', um(1000000.001), 'A quantidade da embalagem aceita no maximo 1.000.000 kg.'],
    ['4 casas decimais', um(25.1234), 'A quantidade da embalagem aceita no maximo 3 casas decimais.'],
    ['quantidade ausente', { embalagens: [{ codigoId: 11 }] }, 'Informe a quantidade da embalagem em kg (ou null).'],
    ['quantidade texto', um('25'), 'Informe a quantidade da embalagem em kg (ou null).'],
    ['rotulo com 61 caracteres', um(25, { rotulo: 'x'.repeat(61) }), 'O rotulo aceita no maximo 60 caracteres.'],
    [
      '8 embalagens',
      { embalagens: Array.from({ length: 8 }, (_, i) => ({ codigoId: i + 1, quantidadeKg: 1 })) },
      'Informe no maximo 7 embalagens.',
    ],
    [
      'codigoId repetido',
      {
        embalagens: [
          { codigoId: 11, quantidadeKg: 1 },
          { codigoId: 11, quantidadeKg: 2 },
        ],
      },
      'Codigo repetido na lista.',
    ],
    ['codigoId invalido', { embalagens: [{ codigoId: 0, quantidadeKg: 1 }] }, 'Codigo invalido.'],
    ['principalCodigoId invalido', { principalCodigoId: -3 }, 'Codigo invalido.'],
    ['corpo sem campos', {}, 'Informe ao menos uma embalagem ou a principal.'],
    ['lista vazia sem principal', { embalagens: [] }, 'Informe ao menos uma embalagem ou a principal.'],
  ];

  it.each(casos)('%s -> 400 com a mensagem do contrato', async (_nome, body, mensagem) => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(PATH).set('Cookie', cookies).send(body as object);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(mensagem);
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('id de produto "abc" -> 400 Produto invalido.', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch('/api/v1/forecast/products/abc/embalagens')
      .set('Cookie', cookies)
      .send(um(25));
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Produto invalido.');
  });

  it('rotulo vazio vira null e quantidade null e aceita', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([codigo(11, { packagingQtyKg: dec('25'), packagingLabel: 'Saco' }), codigo(12), codigo(13)]),
    );
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: null, rotulo: '   ' }] });
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ packagingQtyKg: null, packagingLabel: null, packagingIsPrimary: false }),
      }),
    );
  });
});

describe('Forecast embalagens - PATCH (regras de servico)', () => {
  it('produto inexistente -> 404', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(null);
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25 }] });
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Produto nao encontrado.');
  });

  it('codigoId (ou principal) de outro produto -> 400 e nenhuma gravacao', async () => {
    const cookies = await loginAs('admin');
    const a = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 999, quantidadeKg: 25 }] });
    expect(a.status).toBe(400);
    expect(a.body.message).toBe('O codigo informado nao pertence a este produto.');
    const b = await request(app).patch(PATH).set('Cookie', cookies).send({ principalCodigoId: 999 });
    expect(b.status).toBe(400);
    expect(b.body.message).toBe('O codigo informado nao pertence a este produto.');
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('principal sem quantidade -> 400 (codigo sem embalagem ou quantidade nula no mesmo pedido)', async () => {
    const cookies = await loginAs('admin');
    const a = await request(app).patch(PATH).set('Cookie', cookies).send({ principalCodigoId: 11 });
    expect(a.status).toBe(400);
    expect(a.body.message).toBe('A embalagem principal precisa de quantidade.');
    const b = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: null }], principalCodigoId: 11 });
    expect(b.status).toBe(400);
    expect(b.body.message).toBe('A embalagem principal precisa de quantidade.');
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('troca de principal: tira a antiga (updateMany) ANTES de marcar a nova (update)', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([
        codigo(11, { packagingQtyKg: dec('25'), packagingIsPrimary: true }),
        codigo(12, { packagingQtyKg: dec('200') }),
        codigo(13),
      ]),
    );
    const cookies = await loginAs('admin');
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ principalCodigoId: 12 });
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProductCode.updateMany).toHaveBeenCalledWith({
      where: { productId: 5, packagingIsPrimary: true },
      data: { packagingIsPrimary: false },
    });
    const ordemMany = prismaMock.forecastProductCode.updateMany.mock.invocationCallOrder[0];
    const ordensUpdate = prismaMock.forecastProductCode.update.mock.invocationCallOrder;
    expect(ordensUpdate.length).toBe(2);
    expect(Math.max(ordemMany)).toBeLessThan(Math.min(...ordensUpdate));
    const nova = prismaMock.forecastProductCode.update.mock.calls.find((c) => c[0].where.id === 12)?.[0];
    expect(nova.data).toMatchObject({ packagingIsPrimary: true, packagingSource: 'manual' });
    expect(nova.data.packagingUpdatedAt).toBeInstanceOf(Date);
  });

  it('quantidade passada para null no codigo principal -> perde a principal', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([codigo(11, { packagingQtyKg: dec('25'), packagingIsPrimary: true }), codigo(12), codigo(13)]),
    );
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: null }] });
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ packagingQtyKg: null, packagingIsPrimary: false }),
      }),
    );
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(audit.metadata).toMatchObject({ principalAntes: 11, principalDepois: null });
  });

  it('P2002 (corrida de duas principais) -> 409 com a mensagem propria', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([codigo(11, { packagingQtyKg: dec('25') }), codigo(12, { packagingQtyKg: dec('200') }), codigo(13)]),
    );
    prismaMock.forecastProductCode.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    const cookies = await loginAs('admin');
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ principalCodigoId: 12 });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe(
      'A embalagem principal foi alterada por outra pessoa. Recarregue e tente de novo.',
    );
  });

  it('nada mudou -> 200 sem update, sem updateMany e sem AuditLog', async () => {
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([codigo(11, { packagingQtyKg: dec('25'), packagingLabel: 'Saco', packagingIsPrimary: true }), codigo(12), codigo(13)]),
    );
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco' }], principalCodigoId: 11 });
    expect(response.status).toBe(200);
    expect(response.body.data.usadaCodigoId).toBe(11);
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('a resposta e o GET relido dentro da transacao', async () => {
    const depois = produto([
      codigo(11, { packagingQtyKg: dec('22.125'), packagingSource: 'manual', packagingUpdatedAt: new Date('2026-10-22T12:00:00.000Z') }),
      codigo(12),
      codigo(13),
    ]);
    prismaMock.forecastProduct.findUnique.mockResolvedValueOnce(produto()).mockResolvedValueOnce(depois);
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 22.125 }] });
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProduct.findUnique).toHaveBeenCalledTimes(2);
    expect(response.body.data.codigos[0]).toMatchObject({ quantidadeKg: 22.125, origem: 'manual' });
    expect(response.body.data.usadaCodigoId).toBe(11);
  });
});

describe('Forecast embalagens - pallet fechado (PR 6e)', () => {
  const um = (palletKg: unknown, extra: Record<string, unknown> = {}) => ({
    embalagens: [{ codigoId: 11, quantidadeKg: 25, palletKg, ...extra }],
  });
  const comCodigo11 = (extra: Partial<CodigoMock> = {}) =>
    prismaMock.forecastProduct.findUnique.mockResolvedValue(
      produto([codigo(11, { packagingQtyKg: dec('25'), ...extra }), codigo(12), codigo(13)]),
    );

  const invalidos: Array<[string, unknown, string]> = [
    ['pallet 0', um(0), 'O pallet deve ser maior que zero.'],
    ['pallet negativo', um(-600), 'O pallet deve ser maior que zero.'],
    ['pallet acima de 1.000.000', um(1000000.001), 'O pallet aceita no maximo 1.000.000 kg.'],
    ['pallet com 4 casas decimais', um(600.1234), 'O pallet aceita no maximo 3 casas decimais.'],
    ['pallet texto', um('600'), 'Informe os kg do pallet (ou null).'],
  ];

  it.each(invalidos)('%s -> 400 com a mensagem do contrato (nada gravado)', async (_nome, body, mensagem) => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(PATH).set('Cookie', cookies).send(body as object);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(mensagem);
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s grava o pallet (multiplo da embalagem) e o GET devolve palletKg', async (role) => {
    const antes = produto([codigo(11, { packagingQtyKg: dec('25') }), codigo(12), codigo(13)]);
    const depois = produto([codigo(11, { packagingQtyKg: dec('25'), packagingPalletKg: dec('600') }), codigo(12), codigo(13)]);
    prismaMock.forecastProduct.findUnique.mockResolvedValueOnce(antes).mockResolvedValueOnce(depois);
    const cookies = await loginAs(role);
    const response = await request(app).patch(PATH).set('Cookie', cookies).send(um(600));
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ packagingQtyKg: 25, packagingPalletKg: 600, packagingSource: 'manual' }),
      }),
    );
    expect(response.body.data.codigos[0]).toMatchObject({ quantidadeKg: 25, palletKg: 600 });
    expect(response.body.data.codigos[1]).toMatchObject({ quantidadeKg: null, palletKg: null });
    // 3 casas e aceito (multiplo de 0,125 kg).
    comCodigo11();
    const tresCasas = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 0.125, palletKg: 3.125 }] });
    expect(tresCasas.status).toBe(200);
  });

  it('viewer e gestor nao gravam pallet (403)', async () => {
    for (const role of ['viewer', 'gestor'] as Role[]) {
      const cookies = await loginAs(role);
      expect((await request(app).patch(PATH).set('Cookie', cookies).send(um(600))).status).toBe(403);
    }
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('pallet sem quantidade da embalagem -> 400 (quantidade nula no mesmo pedido)', async () => {
    const cookies = await loginAs('admin');
    const a = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: null, palletKg: 600 }] });
    expect(a.status).toBe(400);
    expect(a.body.message).toBe('O pallet precisa da quantidade da embalagem.');
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('pallet que nao e multiplo da embalagem (ou menor que ela) -> 400', async () => {
    const cookies = await loginAs('admin');
    for (const pallet of [610, 12.5, 600.001]) {
      const response = await request(app).patch(PATH).set('Cookie', cookies).send(um(pallet));
      expect(response.status, String(pallet)).toBe(400);
      expect(response.body.message).toBe('O pallet precisa ser multiplo da embalagem (25 kg).');
    }
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled();
  });

  it('trocar so a quantidade de um codigo com pallet que deixa de ser multiplo -> 400; multiplo continua valendo', async () => {
    comCodigo11({ packagingPalletKg: dec('600') });
    const cookies = await loginAs('admin');
    const ruim = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 7 }] });
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toBe('O pallet precisa ser multiplo da embalagem (7 kg).');
    const boa = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 20 }] });
    expect(boa.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ packagingQtyKg: 20, packagingPalletKg: 600 }) }),
    );
  });

  it('palletKg null apaga o pallet; quantidade apagada apaga o pallet junto; ausente mantem', async () => {
    comCodigo11({ packagingPalletKg: dec('600') });
    const cookies = await loginAs('admin');
    const apagar = await request(app).patch(PATH).set('Cookie', cookies).send(um(null));
    expect(apagar.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ packagingQtyKg: 25, packagingPalletKg: null }) }),
    );

    const semQuantidade = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: null }] });
    expect(semQuantidade.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ packagingQtyKg: null, packagingPalletKg: null }) }),
    );

    prismaMock.forecastProductCode.update.mockClear();
    const mantem = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25 }] });
    expect(mantem.status).toBe(200);
    expect(prismaMock.forecastProductCode.update).not.toHaveBeenCalled(); // nada mudou
  });

  it('o AuditLog ganha so a contagem comPallet (nunca os kg do pallet)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).patch(PATH).set('Cookie', cookies).send(um(612.5, { quantidadeKg: 12.5 }));
    expect(response.status).toBe(200);
    const arg = prismaMock.auditLog.create.mock.calls[0][0];
    expect(arg.data.metadata).toEqual({
      source: 'manual_patch',
      codigoIdsAlterados: [11],
      comEmbalagem: 1,
      semEmbalagem: 2,
      comPallet: 1,
      principalAntes: null,
      principalDepois: null,
    });
    expect(JSON.stringify(arg)).not.toContain('612');
  });
});

describe('Forecast embalagens - AuditLog e historico', () => {
  it('grava so ids e contagens: sem before/after e sem quantidade nem rotulo', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({
        embalagens: [
          { codigoId: 11, quantidadeKg: 22.125, rotulo: 'ROTULO-SECRETO' },
          { codigoId: 12, quantidadeKg: 200 },
        ],
        principalCodigoId: 12,
      });
    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const arg = prismaMock.auditLog.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ entityType: 'forecast_product', entityId: '5', action: 'packaging_update' });
    expect(arg.data.beforeData).toBeUndefined();
    expect(arg.data.afterData).toBeUndefined();
    expect(Object.keys(arg.data.metadata).sort()).toEqual(
      ['codigoIdsAlterados', 'comEmbalagem', 'comPallet', 'principalAntes', 'principalDepois', 'semEmbalagem', 'source'].sort(),
    );
    expect(arg.data.metadata).toEqual({
      source: 'manual_patch',
      codigoIdsAlterados: [11, 12],
      comEmbalagem: 2,
      semEmbalagem: 1,
      comPallet: 0,
      principalAntes: null,
      principalDepois: 12,
    });
    const texto = JSON.stringify(arg);
    expect(texto).not.toContain('ROTULO-SECRETO');
    expect(texto).not.toContain('22.125');
    expect(texto).not.toContain('PRODUTO 001');
    expect(texto).not.toContain('C0001');
  });

  it('o historico da quinzena nunca e escrito (nao ha update/upsert de forecastSnapshot)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ embalagens: [{ codigoId: 11, quantidadeKg: 25 }] });
    expect(response.status).toBe(200);
    // O mock so expoe a leitura (findFirst): qualquer escrita no historico estouraria com TypeError (500).
    expect(Object.keys(prismaMock.forecastSnapshot)).toEqual(['findFirst']);
    expect(prismaMock.forecastSnapshot.findFirst).not.toHaveBeenCalled();
  });
});

describe('Forecast embalagens - relatorio de compras usa o cadastro atual', () => {
  it('item com embalagem cadastrada arredonda pela embalagem e traz o productId da quinzena', async () => {
    // Linhas 4 (PRODUTO 002) e 7 (PRODUTO 005) entram no relatorio com hoje 2026-10-20; a 7 tem demanda
    // 181,11 e o codigo C0018 (EMB.2). Com 25 kg por embalagem: 8 embalagens = 200 kg.
    const produtos = fixture.produtos.slice(0, 5).map((p) => ({ ...p, productId: 700 + p.linha }));
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
      files: [],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    prismaMock.forecastProductCode.findMany.mockResolvedValue([
      {
        code: 'C0018',
        packagingQtyKg: new Prisma.Decimal('25'),
        packagingPalletKg: new Prisma.Decimal('200'),
        packagingLabel: null,
        packagingIsPrimary: false,
      },
    ]);

    const cookies = await loginAs('viewer');
    const response = await request(app)
      .get('/api/v1/forecast/snapshots/7/relatorio-compras?hoje=2026-10-20')
      .set('Cookie', cookies);
    expect(response.status).toBe(200);

    const where = prismaMock.forecastProductCode.findMany.mock.calls[0][0].where;
    expect(where.packagingQtyKg).toEqual({ not: null });
    expect(where.code.in).toContain('C0018');

    const { data } = response.body;
    type Item = {
      linha: number;
      productId: number | null;
      quantidadeFinal: number;
      embalagem: { usada: { quantidade: number } | null };
    };
    const itens = (data.grupos as Array<{ itens: Item[] }>).flatMap((g) => g.itens);
    const com = itens.find((i) => i.linha === 7)!;
    expect(com.embalagem.usada?.quantidade).toBe(25);
    expect(com.quantidadeFinal % 25).toBe(0);
    expect(com.quantidadeFinal).toBe(200);
    expect(com.productId).toBe(707);
    expect(itens.find((i) => i.linha === 4)!.productId).toBe(704);
    expect(data.totais.semEmbalagem).toBe(data.totais.itens - 1);
    // Pallet de 200 kg (PR 6e): demanda 181,11 -> nada abaixo de 1 pallet, 1 pallet (200 kg) acima; Qtd. final inalterada.
    expect(data.totais.comPallet).toBe(1);
    const opcao = (com as unknown as { porEmbalagem: Array<{ destaque: boolean; pallet: unknown }> }).porEmbalagem[0]!;
    expect(opcao.destaque).toBe(true);
    expect(opcao.pallet).toEqual({
      kgPorPallet: 200,
      abaixo: { pallets: 0, kg: 0 },
      acima: { pallets: 1, kg: 200 },
    });
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
