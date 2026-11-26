// Codigo da cotacao: helpers do tombstone, erro 409 especifico (POST/PUT) e endpoint de
// disponibilidade. Prisma mockado.
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

const { txMock, auditLogMock } = vi.hoisted(() => ({
  txMock: {
    quoteRequest: { update: vi.fn() },
    supplierPortalToken: { updateMany: vi.fn() },
  },
  auditLogMock: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    quoteRequest: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});

vi.mock('../src/services/AuditLogService', () => ({
  AuditLogService: { log: auditLogMock },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  buildRequestCodeTombstone,
  isRequestCodeUniqueViolation,
  requestCodeTakenError,
} from '../src/utils/requestCode';

type Fn = ReturnType<typeof vi.fn>;
type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const prismaMock = prisma as unknown as {
  user: { findUnique: Fn; findFirst: Fn };
  session: { create: Fn };
  quoteRequest: { create: Fn; findUnique: Fn; findFirst: Fn };
  $transaction: Fn;
};

function p2002(target?: unknown) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: target === undefined ? undefined : { target },
  });
}

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const base = {
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue({ ...base, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(base);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: base.email, password: 'ChangeMe123!' });
  return loginResponse.headers['set-cookie'] as unknown as string[];
}

const CREATE_BODY = { desiredIncoterm: ['FOB'], currency: 'USD' };
const GENERIC_409 = 'Ja existe um registro com esses dados unicos (requestCode).';

describe('helpers do codigo da cotacao', () => {
  it('buildRequestCodeTombstone acrescenta #del<id> e e idempotente', () => {
    expect(buildRequestCodeTombstone('QR-5', 5)).toBe('QR-5#del5');
    expect(buildRequestCodeTombstone('QR-5#del5', 5)).toBe('QR-5#del5');
    // Mesmo sufixo de outro id nao conta como ja marcado.
    expect(buildRequestCodeTombstone('QR-5#del15', 5)).toBe('QR-5#del15#del5');
  });

  it('isRequestCodeUniqueViolation aceita target em array ou string', () => {
    expect(isRequestCodeUniqueViolation(p2002(['requestCode']))).toBe(true);
    expect(isRequestCodeUniqueViolation(p2002('QuoteRequest_requestCode_key'))).toBe(true);
  });

  it('isRequestCodeUniqueViolation recusa outro campo, outro codigo de erro e erro comum', () => {
    expect(isRequestCodeUniqueViolation(p2002(['email']))).toBe(false);
    expect(isRequestCodeUniqueViolation(p2002())).toBe(false);
    expect(
      isRequestCodeUniqueViolation(
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2025',
          clientVersion: 'test',
          meta: { target: ['requestCode'] },
        }),
      ),
    ).toBe(false);
    expect(isRequestCodeUniqueViolation(new Error('requestCode'))).toBe(false);
  });

  it('requestCodeTakenError gera 409 com a mensagem e o path', () => {
    const error = requestCodeTakenError('ABC-1');
    expect(error.status).toBe(409);
    expect(error.message).toBe('O código ABC-1 já está em uso por outra cotação.');
    expect(error.code).toBe('requestCode');
  });
});

describe('POST /api/v1/quote-requests - codigo duplicado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditLogMock.mockResolvedValue(undefined);
  });

  it('codigo informado ja em uso -> 409 especifico com path', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.create.mockRejectedValue(p2002(['requestCode']));

    const response = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', cookies)
      .send({ ...CREATE_BODY, requestCode: 'abc-1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'O código ABC-1 já está em uso por outra cotação.',
      path: 'requestCode',
    });
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('sem codigo informado, P2002 segue a mensagem generica', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.create.mockRejectedValue(p2002(['requestCode']));

    const response = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', cookies)
      .send(CREATE_BODY);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ message: GENERIC_409 });
  });

  it('P2002 de outro campo, mesmo com codigo informado, segue a mensagem generica', async () => {
    const cookies = await loginAs('comprador');
    prismaMock.quoteRequest.create.mockRejectedValue(p2002(['outroCampo']));

    const response = await request(app)
      .post('/api/v1/quote-requests')
      .set('Cookie', cookies)
      .send({ ...CREATE_BODY, requestCode: 'ABC-1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Ja existe um registro com esses dados unicos (outroCampo).',
    });
  });
});

describe('PUT /api/v1/quote-requests/:id - codigo duplicado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditLogMock.mockResolvedValue(undefined);
    prismaMock.quoteRequest.findUnique.mockResolvedValue({
      id: 8,
      requestCode: 'QR-8',
      status: 'open',
      deadlineAt: null,
    });
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
  });

  it('codigo informado ja em uso -> 409 especifico com path', async () => {
    const cookies = await loginAs('comprador');
    txMock.quoteRequest.update.mockRejectedValue(p2002(['requestCode']));

    const response = await request(app)
      .put('/api/v1/quote-requests/8')
      .set('Cookie', cookies)
      .send({ requestCode: 'abc-1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'O código ABC-1 já está em uso por outra cotação.',
      path: 'requestCode',
    });
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('P2002 sem requestCode no corpo segue a mensagem generica', async () => {
    const cookies = await loginAs('comprador');
    txMock.quoteRequest.update.mockRejectedValue(p2002(['requestCode']));

    const response = await request(app)
      .put('/api/v1/quote-requests/8')
      .set('Cookie', cookies)
      .send({ description: 'novo texto' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ message: GENERIC_409 });
  });
});

describe('GET /api/v1/quote-requests/code-availability', () => {
  const URL = '/api/v1/quote-requests/code-availability';

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.quoteRequest.findUnique.mockResolvedValue(null);
  });

  it('codigo livre -> available true; consulta normalizada em maiusculas e sem filtro de deletedAt', async () => {
    const cookies = await loginAs('comprador');

    const response = await request(app).get(URL).query({ requestCode: '  abc-1 ' }).set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ requestCode: 'ABC-1', available: true });
    expect(prismaMock.quoteRequest.findUnique).toHaveBeenCalledWith({
      where: { requestCode: 'ABC-1' },
      select: { id: true },
    });
  });

  it('codigo ocupado -> available false', async () => {
    const cookies = await loginAs('admin');
    prismaMock.quoteRequest.findUnique.mockResolvedValue({ id: 3 });

    const response = await request(app).get(URL).query({ requestCode: 'ABC-1' }).set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ requestCode: 'ABC-1', available: false });
  });

  it('nao cai no getById (rota registrada antes de /:id)', async () => {
    const cookies = await loginAs('comprador');

    await request(app).get(URL).query({ requestCode: 'ABC-1' }).set('Cookie', cookies);

    expect(prismaMock.quoteRequest.findFirst).not.toHaveBeenCalled();
  });

  it('requestCode vazio ou ausente -> 400', async () => {
    const cookies = await loginAs('comprador');

    const empty = await request(app).get(URL).query({ requestCode: '   ' }).set('Cookie', cookies);
    const missing = await request(app).get(URL).set('Cookie', cookies);

    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe('Informe o código.');
    expect(missing.status).toBe(400);
    expect(prismaMock.quoteRequest.findUnique).not.toHaveBeenCalled();
  });

  it.each(['gestor', 'viewer', 'comercial'] as const)('%s -> 403', async (role) => {
    const cookies = await loginAs(role);

    const response = await request(app).get(URL).query({ requestCode: 'ABC-1' }).set('Cookie', cookies);

    expect(response.status).toBe(403);
    expect(prismaMock.quoteRequest.findUnique).not.toHaveBeenCalled();
  });
});
