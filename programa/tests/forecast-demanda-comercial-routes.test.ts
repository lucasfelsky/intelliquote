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
    forecastProduct: { findUnique: vi.fn() },
    forecastCommercialDemand: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
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
  forecastCommercialDemand: { findMany: Mock; findUnique: Mock; create: Mock; updateMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const BASE = '/api/v1/forecast/commercial-demands';

// Cliente transacional distinto do `prisma`: prova que a gravacao e o AuditLog usam o `tx`.
const tx = {
  forecastProduct: { findUnique: vi.fn() },
  forecastCommercialDemand: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

const hojeSp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Linha do banco (com o include do produto), tudo sintetico.
const linhaDoBanco = (over: Record<string, unknown> = {}) => ({
  id: 9,
  productId: 5,
  quantityKg: '1600',
  neededBy: new Date('2099-02-10T00:00:00.000Z'),
  reason: 'MOTIVO SINTETICO',
  customerName: 'CLIENTE SINTETICO',
  commercialRequestId: null,
  status: 'aberta',
  closeNote: null,
  closedAt: null,
  closedById: null,
  createdById: 1,
  createdAt: new Date('2099-01-01T12:00:00.000Z'),
  updatedAt: new Date('2099-01-01T12:00:00.000Z'),
  product: { name: 'PRODUTO 001', isActive: true, source: { name: 'FONTE 001' } },
  ...over,
});

const corpo = (over: Record<string, unknown> = {}) => ({
  productId: 5,
  quantidadeKg: 1600,
  necessidade: '2099-02-10',
  motivo: 'MOTIVO SINTETICO',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
  tx.forecastProduct.findUnique.mockResolvedValue({ id: 5, isActive: true });
  tx.forecastCommercialDemand.create.mockImplementation(async () => linhaDoBanco());
  tx.forecastCommercialDemand.findUnique.mockResolvedValue(linhaDoBanco());
  tx.forecastCommercialDemand.updateMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({});
  prismaMock.forecastCommercialDemand.findMany.mockResolvedValue([linhaDoBanco()]);
});

describe('GET /forecast/commercial-demands - papeis e filtros', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s le a lista (COMEX_ROLES)', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      {
        id: 9,
        productId: 5,
        produto: 'PRODUTO 001',
        fonte: 'FONTE 001',
        produtoAtivo: true,
        quantidadeKg: 1600,
        necessidade: '2099-02-10',
        motivo: 'MOTIVO SINTETICO',
        cliente: 'CLIENTE SINTETICO',
        solicitacaoId: null,
        status: 'aberta',
        notaFechamento: null,
        fechadaEm: null,
        criadaEm: '2099-01-01',
      },
    ]);
  });

  it('comercial -> 403 e nada e consultado', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(BASE).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastCommercialDemand.findMany).not.toHaveBeenCalled();
  });

  it('filtros status e productId vao para o WHERE; ordena por necessidade e limita a lista', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${BASE}?status=comprada&productId=5`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(prismaMock.forecastCommercialDemand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'comprada', productId: 5 },
        orderBy: [{ neededBy: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
    );
  });

  it('status ou produto invalidos -> 400 em portugues, sem consultar', async () => {
    const cookies = await loginAs('admin');
    const status = await request(app).get(`${BASE}?status=lixo`).set('Cookie', cookies);
    expect(status.status).toBe(400);
    expect(JSON.stringify(status.body)).toContain('Status inválido.');
    const produto = await request(app).get(`${BASE}?productId=abc`).set('Cookie', cookies);
    expect(produto.status).toBe(400);
    expect(JSON.stringify(produto.body)).toContain('Informe o produto do Forecast.');
    expect(prismaMock.forecastCommercialDemand.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /forecast/commercial-demands - papeis e gravacao', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).post(BASE).send(corpo())).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.forecastCommercialDemand.create).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s lanca: 201 com os dados, data sem fuso e AuditLog com o tx', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ cliente: '  CLIENTE SINTETICO  ', solicitacaoId: 12, motivo: '  MOTIVO SINTETICO  ' }));
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 9, productId: 5, quantidadeKg: 1600, necessidade: '2099-02-10', status: 'aberta' });

    expect(tx.forecastCommercialDemand.create).toHaveBeenCalledTimes(1);
    const { data } = tx.forecastCommercialDemand.create.mock.calls[0][0];
    expect(data).toEqual({
      productId: 5,
      quantityKg: 1600,
      neededBy: new Date('2099-02-10T00:00:00.000Z'),
      reason: 'MOTIVO SINTETICO',
      customerName: 'CLIENTE SINTETICO',
      commercialRequestId: 12,
      status: 'aberta',
      createdById: 1,
    });

    // AuditLog no `tx`, so ids/kg/data/status: nunca motivo nem cliente.
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ entityType: 'forecast_commercial_demand', entityId: '9', action: 'create' });
    expect(log.metadata).toEqual({
      productId: 5,
      quantidadeKg: 1600,
      necessidade: '2099-02-10',
      status: 'aberta',
      solicitacaoId: 12,
    });
    expect(JSON.stringify(log)).not.toMatch(/MOTIVO|CLIENTE/);
  });

  it('cliente e solicitacao sao opcionais (vazio e null viram null)', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo({ cliente: '   ', solicitacaoId: null }));
    expect(response.status).toBe(201);
    const { data } = tx.forecastCommercialDemand.create.mock.calls[0][0];
    expect(data.customerName).toBeNull();
    expect(data.commercialRequestId).toBeNull();
  });

  it('a data de necessidade de hoje (calendario de Sao Paulo) e aceita', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo({ necessidade: hojeSp() }));
    expect(response.status).toBe(201);
  });

  it('Zod: produto, kg (> 0, ate 3 casas), data, motivo (3-300), cliente e solicitacao -> 400 em portugues, sem gravar', async () => {
    const cookies = await loginAs('admin');
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ productId: undefined }, 'Informe o produto do Forecast.'],
      [{ productId: 0 }, 'Produto inválido.'],
      [{ productId: 1.5 }, 'Produto inválido.'],
      [{ quantidadeKg: undefined }, 'Informe a quantidade em kg.'],
      [{ quantidadeKg: 0 }, 'A quantidade precisa ser maior que zero.'],
      [{ quantidadeKg: -5 }, 'A quantidade precisa ser maior que zero.'],
      [{ quantidadeKg: '1600' }, 'Informe a quantidade em kg.'],
      [{ quantidadeKg: 10_000_001 }, 'A quantidade aceita no máximo 10.000.000 kg.'],
      [{ quantidadeKg: 1.2345 }, 'A quantidade aceita no máximo 3 casas decimais.'],
      [{ necessidade: undefined }, 'Informe a data de necessidade (AAAA-MM-DD).'],
      [{ necessidade: '2099-02-30' }, 'Informe a data de necessidade (AAAA-MM-DD).'],
      [{ necessidade: '10/02/2099' }, 'Informe a data de necessidade (AAAA-MM-DD).'],
      [{ necessidade: '2000-01-01' }, 'A data de necessidade não pode ser anterior a hoje.'],
      [{ motivo: undefined }, 'Informe o motivo do pedido.'],
      [{ motivo: 'ab' }, 'O motivo precisa ter ao menos 3 caracteres.'],
      [{ motivo: '   ' }, 'O motivo precisa ter ao menos 3 caracteres.'],
      [{ motivo: 'x'.repeat(301) }, 'O motivo aceita no máximo 300 caracteres.'],
      [{ cliente: 'x'.repeat(201) }, 'O cliente aceita no máximo 200 caracteres.'],
      [{ solicitacaoId: 0 }, 'O número da solicitação deve ser um inteiro positivo (ou null).'],
      [{ solicitacaoId: 1.5 }, 'O número da solicitação deve ser um inteiro positivo (ou null).'],
      [{ solicitacaoId: 3_000_000_000 }, 'O número da solicitação é inválido.'],
    ];
    for (const [parcial, mensagem] of casos) {
      const response = await request(app).post(BASE).set('Cookie', cookies).send(corpo(parcial));
      expect(response.status, JSON.stringify(parcial)).toBe(400);
      expect(JSON.stringify(response.body), JSON.stringify(parcial)).toContain(mensagem);
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('o limite de motivo (300), de kg (10.000.000) e de 3 casas e aceito', async () => {
    const cookies = await loginAs('comprador');
    const response = await request(app)
      .post(BASE)
      .set('Cookie', cookies)
      .send(corpo({ motivo: 'x'.repeat(300), quantidadeKg: 10_000_000 }));
    expect(response.status).toBe(201);
    const casas = await request(app).post(BASE).set('Cookie', cookies).send(corpo({ quantidadeKg: 0.125 }));
    expect(casas.status).toBe(201);
  });

  it('produto inexistente -> 404; produto inativo -> 400; nada e gravado', async () => {
    const cookies = await loginAs('admin');
    tx.forecastProduct.findUnique.mockResolvedValue(null);
    const inexistente = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.message).toBe('Produto nao encontrado.');

    tx.forecastProduct.findUnique.mockResolvedValue({ id: 5, isActive: false });
    const inativo = await request(app).post(BASE).set('Cookie', cookies).send(corpo());
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toContain('Produto inativo');
    expect(tx.forecastCommercialDemand.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /forecast/commercial-demands/:id - papeis, edicao e fechamento', () => {
  const PATH = `${BASE}/9`;

  it('sem login -> 401', async () => {
    expect((await request(app).patch(PATH).send({ motivo: 'NOVO MOTIVO' })).status).toBe(401);
  });

  it.each<Role>(['gestor', 'viewer', 'comercial'])('%s -> 403 e nada e gravado', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ status: 'comprada' });
    expect(response.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.forecastCommercialDemand.updateMany).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador'])('%s edita kg, data, motivo, cliente e solicitacao: grava so o que mudou', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({
        quantidadeKg: 1800,
        necessidade: '2099-03-01',
        motivo: '  NOVO MOTIVO  ',
        cliente: 'OUTRO CLIENTE',
        solicitacaoId: 44,
      });
    expect(response.status).toBe(200);
    expect(tx.forecastCommercialDemand.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'aberta' },
      data: {
        quantityKg: 1800,
        neededBy: new Date('2099-03-01T00:00:00.000Z'),
        reason: 'NOVO MOTIVO',
        customerName: 'OUTRO CLIENTE',
        commercialRequestId: 44,
      },
    });
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ entityType: 'forecast_commercial_demand', entityId: '9', action: 'update' });
    expect(log.metadata).toEqual({
      productId: 5,
      quantidadeKg: 1800,
      necessidade: '2099-03-01',
      status: 'aberta',
      solicitacaoId: 44,
      camposAlterados: ['quantidadeKg', 'necessidade', 'motivo', 'cliente', 'solicitacaoId'],
    });
    expect(JSON.stringify(log)).not.toMatch(/MOTIVO|CLIENTE/);
  });

  it('sem alteracao real nao grava nem audita (200 com os dados atuais)', async () => {
    const cookies = await loginAs('admin');
    const response = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ quantidadeKg: 1600, motivo: 'MOTIVO SINTETICO', necessidade: '2099-02-10' });
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(9);
    expect(tx.forecastCommercialDemand.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('limpar cliente e solicitacao com null/vazio', async () => {
    const cookies = await loginAs('admin');
    tx.forecastCommercialDemand.findUnique.mockResolvedValue(linhaDoBanco({ commercialRequestId: 44 }));
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ cliente: '', solicitacaoId: null });
    expect(response.status).toBe(200);
    expect(tx.forecastCommercialDemand.updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'aberta' },
      data: { customerName: null, commercialRequestId: null },
    });
  });

  it('mudar a necessidade para o passado -> 400; manter a data antiga ao editar o motivo e permitido', async () => {
    const cookies = await loginAs('admin');
    const passado = await request(app).patch(PATH).set('Cookie', cookies).send({ necessidade: '2000-01-01' });
    expect(passado.status).toBe(400);
    expect(passado.body.message).toContain('não pode ser anterior a hoje');
    expect(tx.forecastCommercialDemand.updateMany).not.toHaveBeenCalled();

    // Pedido antigo (data ja passada) segue editavel enquanto a data nao muda.
    tx.forecastCommercialDemand.findUnique.mockResolvedValue(linhaDoBanco({ neededBy: new Date('2000-01-01T00:00:00.000Z') }));
    const motivo = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ necessidade: '2000-01-01', motivo: 'MOTIVO ATUALIZADO' });
    expect(motivo.status).toBe(200);
    expect(tx.forecastCommercialDemand.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(['comprada', 'virou_programacao'] as const)('fechar como %s: grava status, data e quem fechou; AuditLog close sem nota', async (status) => {
    const cookies = await loginAs('comprador');
    const response = await request(app).patch(PATH).set('Cookie', cookies).send({ status });
    expect(response.status).toBe(200);
    const chamada = tx.forecastCommercialDemand.updateMany.mock.calls[0][0];
    expect(chamada.where).toEqual({ id: 9, status: 'aberta' });
    expect(chamada.data).toMatchObject({ status, closeNote: null, closedById: 1 });
    expect(chamada.data.closedAt).toBeInstanceOf(Date);
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ action: 'close', entityId: '9' });
    expect(log.metadata).toEqual({
      productId: 5,
      quantidadeKg: 1600,
      necessidade: '2099-02-10',
      status,
      solicitacaoId: null,
      comNota: false,
    });
  });

  it('cancelar exige a nota; com nota grava e o AuditLog so marca comNota (sem o texto)', async () => {
    const cookies = await loginAs('admin');
    const sem = await request(app).patch(PATH).set('Cookie', cookies).send({ status: 'cancelada' });
    expect(sem.status).toBe(400);
    expect(JSON.stringify(sem.body)).toContain('Informe o motivo do cancelamento na nota.');
    const curta = await request(app).patch(PATH).set('Cookie', cookies).send({ status: 'cancelada', nota: 'ab' });
    expect(curta.status).toBe(400);
    expect(tx.forecastCommercialDemand.updateMany).not.toHaveBeenCalled();

    const ok = await request(app)
      .patch(PATH)
      .set('Cookie', cookies)
      .send({ status: 'cancelada', nota: '  CLIENTE DESISTIU SINTETICO  ' });
    expect(ok.status).toBe(200);
    expect(tx.forecastCommercialDemand.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'cancelada',
      closeNote: 'CLIENTE DESISTIU SINTETICO',
    });
    const log = tx.auditLog.create.mock.calls[0][0].data;
    expect(log.metadata).toMatchObject({ status: 'cancelada', comNota: true });
    expect(JSON.stringify(log)).not.toMatch(/DESISTIU|MOTIVO|CLIENTE/);
  });

  it('Zod do PATCH: corpo vazio, status invalido, "aberta" nao e fechamento, mistura de modos e nota solta -> 400', async () => {
    const cookies = await loginAs('admin');
    const casos: Array<[Record<string, unknown>, string]> = [
      [{}, 'Informe o que alterar ou o status para fechar a demanda.'],
      [{ status: 'aberta' }, 'Status inválido: use comprada, cancelada ou virou_programacao.'],
      [{ status: 'lixo' }, 'Status inválido: use comprada, cancelada ou virou_programacao.'],
      [{ status: 'comprada', motivo: 'MOTIVO NOVO' }, 'Para fechar a demanda, envie só o status e a nota.'],
      [{ nota: 'NOTA SOLTA' }, 'A nota só vale ao fechar a demanda (envie também o status).'],
      [{ status: 'comprada', nota: 'x'.repeat(301) }, 'A nota aceita no máximo 300 caracteres.'],
      [{ quantidadeKg: 0 }, 'A quantidade precisa ser maior que zero.'],
      [{ quantidadeKg: 0.1234 }, 'A quantidade aceita no máximo 3 casas decimais.'],
      [{ motivo: 'ab' }, 'O motivo precisa ter ao menos 3 caracteres.'],
      [{ necessidade: '2099-13-01' }, 'Informe a data de necessidade (AAAA-MM-DD).'],
      [{ productId: 7 }, 'Informe o que alterar ou o status para fechar a demanda.'],
    ];
    for (const [body, mensagem] of casos) {
      const response = await request(app).patch(PATH).set('Cookie', cookies).send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(response.body), JSON.stringify(body)).toContain(mensagem);
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('id invalido -> 400; demanda inexistente -> 404', async () => {
    const cookies = await loginAs('admin');
    const ruim = await request(app).patch(`${BASE}/abc`).set('Cookie', cookies).send({ status: 'comprada' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toBe('Demanda invalida.');
    tx.forecastCommercialDemand.findUnique.mockResolvedValue(null);
    const nenhuma = await request(app).patch(PATH).set('Cookie', cookies).send({ status: 'comprada' });
    expect(nenhuma.status).toBe(404);
    expect(nenhuma.body.message).toBe('Demanda nao encontrada.');
  });

  it.each(['comprada', 'cancelada', 'virou_programacao'] as const)(
    'demanda %s nao reabre nem edita: 409 e nada e gravado',
    async (status) => {
      const cookies = await loginAs('admin');
      tx.forecastCommercialDemand.findUnique.mockResolvedValue(linhaDoBanco({ status }));
      const edicao = await request(app).patch(PATH).set('Cookie', cookies).send({ motivo: 'NOVO MOTIVO' });
      expect(edicao.status).toBe(409);
      expect(edicao.body.message).toBe('Demanda ja fechada: nao pode ser alterada nem reaberta.');
      const fechar = await request(app).patch(PATH).set('Cookie', cookies).send({ status: 'comprada' });
      expect(fechar.status).toBe(409);
      expect(tx.forecastCommercialDemand.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('corrida: outra pessoa fechou entre a leitura e a gravacao (updateMany count 0) -> 409 sem auditar', async () => {
    const cookies = await loginAs('admin');
    tx.forecastCommercialDemand.updateMany.mockResolvedValue({ count: 0 });
    const fechar = await request(app).patch(PATH).set('Cookie', cookies).send({ status: 'comprada' });
    expect(fechar.status).toBe(409);
    expect(fechar.body.message).toContain('outra pessoa');
    const editar = await request(app).patch(PATH).set('Cookie', cookies).send({ motivo: 'NOVO MOTIVO' });
    expect(editar.status).toBe(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
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
