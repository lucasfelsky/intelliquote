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

vi.mock('../src/services/ForecastPoDiretaService', () => ({ ForecastPoDiretaService: { enviar: vi.fn(), destinatarios: vi.fn() } }));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastPoDiretaService } from '../src/services/ForecastPoDiretaService';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
};
const enviar = ForecastPoDiretaService.enviar as unknown as Mock;
const destinatarios = ForecastPoDiretaService.destinatarios as unknown as Mock;

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
  destinatarios.mockResolvedValue({
    fornecedor: 'FORNECEDOR SINTETICO',
    to: { name: 'Mei', email: 'mei@fornecedor.example' },
    contactCc: [],
    comexCc: [],
    cc: [],
  });
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
    // a forma antiga (productId + quantidadeKg) vira `itens` de 1
    expect(input).toMatchObject({ itens: [{ productId: 42, quantidadeKg: 25000 }], chaveEnvio: 'k-0123456789abcdef' });
    expect(input).not.toHaveProperty('productId');
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

describe('GET /forecast/snapshots/:id/po-preco-fechado/destinatarios', () => {
  const URL_DEST = `${PATH}/destinatarios?productId=42`;

  it('sem login -> 401', async () => {
    expect((await request(app).get(URL_DEST)).status).toBe(401);
    expect(destinatarios).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as Role[])('%s -> 403 (a lista expoe o fornecedor e seus contatos)', async (role) => {
    const cookies = await loginAs(role);
    expect((await request(app).get(URL_DEST).set('Cookie', cookies)).status).toBe(403);
    expect(destinatarios).not.toHaveBeenCalled();
  });

  it.each(['admin', 'comprador'] as Role[])('%s le os destinatarios', async (role) => {
    const cookies = await loginAs(role);
    const res = await request(app).get(URL_DEST).set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fornecedor: 'FORNECEDOR SINTETICO', to: { email: 'mei@fornecedor.example' } });
    expect(destinatarios).toHaveBeenCalledWith(7, [42]);
  });

  it.each([['', 400], ['?productId=abc', 400], ['?productId=0', 400]])('productId %j -> %s sem consultar', async (consulta, status) => {
    const cookies = await loginAs('comprador');
    const res = await request(app).get(`${PATH}/destinatarios${consulta}`).set('Cookie', cookies);
    expect(res.status).toBe(status);
    expect(destinatarios).not.toHaveBeenCalled();
  });

  it('bloqueio do servico (409) vira 409 com a mensagem', async () => {
    destinatarios.mockRejectedValue(new HttpError(409, 'A fonte deste item não está ligada a um fornecedor do IntelliQuote.'));
    const cookies = await loginAs('comprador');
    const res = await request(app).get(URL_DEST).set('Cookie', cookies);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/fornecedor/);
  });
});

describe('POST /forecast/snapshots/:id/po-preco-fechado - varios itens num envio', () => {
  const semItemSolto = () => {
    const c: Record<string, unknown> = corpo();
    delete c.productId;
    delete c.quantidadeKg;
    return c;
  };
  const comItens = (itens: unknown, over: Record<string, unknown> = {}) => ({ ...semItemSolto(), itens, ...over });

  it('aceita `itens` (varios produtos do mesmo envio) e entrega ao servico na ordem pedida', async () => {
    const cookies = await loginAs('comprador');
    const res = await request(app)
      .post(PATH)
      .set('Cookie', cookies)
      .send(comItens([{ productId: 42, quantidadeKg: 25000 }, { productId: 43, quantidadeKg: 1500.5 }]));
    expect(res.status).toBe(201);
    expect(enviar.mock.calls[0]![1]).toMatchObject({
      itens: [{ productId: 42, quantidadeKg: 25000 }, { productId: 43, quantidadeKg: 1500.5 }],
      chaveEnvio: 'k-0123456789abcdef',
    });
  });

  it.each([
    ['lista vazia', comItens([])],
    ['produto repetido', comItens([{ productId: 42, quantidadeKg: 1 }, { productId: 42, quantidadeKg: 2 }])],
    ['quantidade invalida num dos itens', comItens([{ productId: 42, quantidadeKg: 1 }, { productId: 43, quantidadeKg: 0 }])],
    ['produto invalido num dos itens', comItens([{ productId: 0, quantidadeKg: 1 }])],
    ['chave dos itens com preco no corpo', comItens([{ productId: 42, quantidadeKg: 1, preco: 3 }])],
    ['itens junto com productId solto', comItens([{ productId: 42, quantidadeKg: 1 }], { productId: 42, quantidadeKg: 1 })],
    ['sem nenhum item', semItemSolto()],
    ['so productId, sem quantidade', { ...semItemSolto(), productId: 42 }],
    ['chave com mais de 50 caracteres e varios itens', comItens([{ productId: 42, quantidadeKg: 1 }, { productId: 43, quantidadeKg: 1 }], { chaveEnvio: 'k'.repeat(51) })],
  ])('%s -> 400 sem enviar', async (_nome, body) => {
    const cookies = await loginAs('comprador');
    const res = await request(app).post(PATH).set('Cookie', cookies).send(body);
    expect(res.status).toBe(400);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('mais de 50 itens -> 400', async () => {
    const cookies = await loginAs('comprador');
    const itens = Array.from({ length: 51 }, (_, i) => ({ productId: i + 1, quantidadeKg: 1 }));
    expect((await request(app).post(PATH).set('Cookie', cookies).send(comItens(itens))).status).toBe(400);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('chave de 64 caracteres vale com UM item (a PO usa a chave como esta)', async () => {
    const cookies = await loginAs('comprador');
    expect((await request(app).post(PATH).set('Cookie', cookies).send(corpo({ chaveEnvio: 'k'.repeat(64) }))).status).toBe(201);
  });
});

describe('GET /forecast/snapshots/:id/po-preco-fechado/destinatarios - varios itens', () => {
  it('productIds=42,43,44 consulta os tres (sem repetidos) numa chamada so', async () => {
    const cookies = await loginAs('comprador');
    const res = await request(app).get(`${PATH}/destinatarios?productIds=42,43,43,44`).set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(destinatarios).toHaveBeenCalledWith(7, [42, 43, 44]);
  });

  it.each(['?productIds=42,abc', '?productIds=42,,43', '?productIds=0', `?productIds=${Array.from({ length: 51 }, (_, i) => i + 1).join(',')}`])('%s -> 400 sem consultar', async (consulta) => {
    const cookies = await loginAs('comprador');
    expect((await request(app).get(`${PATH}/destinatarios${consulta}`).set('Cookie', cookies)).status).toBe(400);
    expect(destinatarios).not.toHaveBeenCalled();
  });

  it('itens de fornecedores diferentes (409 do servico) viram 409 com a mensagem', async () => {
    destinatarios.mockRejectedValue(new HttpError(409, 'Os itens escolhidos são de fornecedores diferentes (A, B). A PO é por fornecedor: envie uma PO para cada um.'));
    const cookies = await loginAs('comprador');
    const res = await request(app).get(`${PATH}/destinatarios?productIds=42,43`).set('Cookie', cookies);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/fornecedores diferentes/);
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
