import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/utils/http';
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
  };
  return { prisma };
});

vi.mock('../src/services/ForecastPoDiretaService', () => ({ ForecastPoDiretaService: { enviar: vi.fn() } }));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastPoDiretaService } from '../src/services/ForecastPoDiretaService';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
};
const enviar = ForecastPoDiretaService.enviar as unknown as Mock;

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/snapshots/7/po-preco-fechado';

// Dados SINTETICOS (repo publico). PDF minimo em base64 (so' passa pelo parser e pelo Zod; o servico esta mockado).
const corpo = (over: Record<string, unknown> = {}) => ({
  productId: 42,
  quantidadeKg: 25000,
  chaveEnvio: 'k-0123456789abcdef',
  subject: 'Purchase Order - PRODUTO A',
  message: 'Please confirm.',
  forwarderInfo: 'Forwarder Sintetico, contato@forwarder.example',
  fileName: 'PO-0001.pdf',
  contentBase64: Buffer.from('%PDF-1.4 sintetico').toString('base64'),
  fileType: 'application/pdf',
  fileSize: 18,
  ...over,
});

const resultado = (over: Record<string, unknown> = {}) => ({
  purchaseOrderId: 5,
  jaEnviada: false,
  registro: 'ok',
  qtdFinalKg: 25000,
  statusDaDecisao: 'po',
  fornecedor: 'FORNECEDOR SINTETICO',
  para: 'contato@fornecedor.example',
  copia: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  enviar.mockResolvedValue(resultado());
});

describe('POST /forecast/snapshots/:id/po-preco-fechado - papeis', () => {
  it('sem login -> 401 sem chamar o servico', async () => {
    const res = await request(app).post(PATH).send(corpo());
    expect(res.status).toBe(401);
    expect(enviar).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 sem enviar', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).post(PATH).set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(403);
    expect(enviar).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s envia e recebe 201 com o resultado', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).post(PATH).set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ purchaseOrderId: 5, registro: 'ok', qtdFinalKg: 25000 });
    expect(enviar).toHaveBeenCalledTimes(1);
    const [snapshotId, input, user] = enviar.mock.calls[0]!;
    expect(snapshotId).toBe(7);
    expect(input).toMatchObject({ productId: 42, quantidadeKg: 25000, chaveEnvio: 'k-0123456789abcdef' });
    expect(user).toMatchObject({ id: 1 });
  });
});

describe('POST /forecast/snapshots/:id/po-preco-fechado - corpo e respostas', () => {
  it('a mesma chave ja enviada devolve 200 (nada foi enviado de novo)', async () => {
    enviar.mockResolvedValue(resultado({ jaEnviada: true }));
    const cookies = await loginAs('comprador');
    const res = await request(app).post(PATH).set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(200);
    expect(res.body.data.jaEnviada).toBe(true);
  });

  it.each([
    ['quantidade zero', { quantidadeKg: 0 }],
    ['quantidade com 4 casas', { quantidadeKg: 1.2345 }],
    ['quantidade como texto', { quantidadeKg: '100' }],
    ['produto invalido', { productId: 0 }],
    ['chave curta', { chaveEnvio: 'curta' }],
    ['sem chave', { chaveEnvio: undefined }],
    ['PDF sem conteudo', { contentBase64: '' }],
    ['tipo que nao e PDF', { fileType: 'text/plain' }],
    ['preco no corpo (vem do cadastro)', { preco: 1.5 }],
    ['nonWinner (nao ha proposta)', { nonWinner: true }],
  ])('%s -> 400 sem enviar', async (_nome, over) => {
    const cookies = await loginAs('comprador');
    const res = await request(app).post(PATH).set('Cookie', cookies).send(corpo(over));
    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe('string');
    expect(enviar).not.toHaveBeenCalled();
  });

  it('quinzena invalida na URL -> 400', async () => {
    const cookies = await loginAs('comprador');
    const res = await request(app).post('/api/v1/forecast/snapshots/abc/po-preco-fechado').set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(400);
    expect(enviar).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'Quinzena não encontrada.'],
    [409, 'O item não é de preço fechado.'],
    [502, 'Falha ao enviar a Ordem de Compra.'],
  ])('erro %s do servico vira o mesmo status e a mensagem', async (status, message) => {
    enviar.mockRejectedValue(new HttpError(status, message));
    const cookies = await loginAs('comprador');
    const res = await request(app).post(PATH).set('Cookie', cookies).send(corpo());
    expect(res.status).toBe(status);
    expect(res.body.message).toBe(message);
  });

  it('aceita um PDF de ~5 MB em base64 (parser proprio da rota, acima do global de 1 MB)', async () => {
    const grande = Buffer.alloc(5 * 1024 * 1024, 1).toString('base64');
    const cookies = await loginAs('comprador');
    const res = await request(app)
      .post(PATH)
      .set('Cookie', cookies)
      .send(corpo({ contentBase64: grande, fileSize: 5 * 1024 * 1024 }));
    expect(res.status).toBe(201);
  });
});

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const usuario = { id: 1, name: `${role} user`, email: `${role}@intelliquote.local`, isActive: true, role: { name: role } };
  prismaMock.user.findUnique.mockResolvedValue({ ...usuario, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(usuario);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, password: 'ChangeMe123!' });
  return login.headers['set-cookie'];
}
