import fs from 'fs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTACHMENT_JSON_BODY_LIMIT_BYTES } from '../src/constants/attachments';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    attachment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  session: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  attachment: {
    create: ReturnType<typeof vi.fn>;
  };
};

const TEN_MB = 10 * 1024 * 1024;

describe('Autenticacao antes do parser de corpo grande', () => {
  // Evita gravar em uploads/ durante os testes.
  const mkdirSpy = vi.spyOn(fs.promises, 'mkdir');
  const writeFileSpy = vi.spyOn(fs.promises, 'writeFile');

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSpy.mockResolvedValue(undefined);
    writeFileSpy.mockResolvedValue(undefined);
  });

  const unauthenticatedCases: Array<[string, number]> = [
    ['/api/v1/attachments', ATTACHMENT_JSON_BODY_LIMIT_BYTES],
    ['/api/v1/catalog-items/import', TEN_MB],
    ['/api/v1/suppliers/import', TEN_MB],
    ['/api/v1/quote-responses', TEN_MB],
  ];

  it.each(unauthenticatedCases)(
    'POST %s sem login devolve 401 JSON mesmo com corpo acima do limite (sem 413)',
    async (path, limit) => {
      const response = await request(app)
        .post(path)
        .send({ contentBase64: 'A'.repeat(limit + 1) });

      expect(response.status).toBe(401);
      expect(response.type).toBe('application/json');
      expect(response.body.message).toBe('Token de acesso ausente.');
    },
  );

  it('token invalido em /attachments com corpo acima do limite devolve 401, nao 413', async () => {
    const response = await request(app)
      .post('/api/v1/attachments')
      .set('Authorization', 'Bearer invalido')
      .send({ contentBase64: 'A'.repeat(ATTACHMENT_JSON_BODY_LIMIT_BYTES + 1) });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Token invalido.');
  });

  it('GET /quote-responses sem login devolve 401', async () => {
    const response = await request(app).get('/api/v1/quote-responses');

    expect(response.status).toBe(401);
  });

  it('com login o parser continua valendo: corpo acima de 10MB em /catalog-items/import devolve 413', async () => {
    const cookies = await loginAs('admin');

    const response = await request(app)
      .post('/api/v1/catalog-items/import')
      .set('Cookie', cookies)
      .send({ contentBase64: 'A'.repeat(TEN_MB + 1) });

    expect(response.status).toBe(413);
  });

  it('com login a request segue para o requireAuth/allowRoles da rota (viewer recebe 403)', async () => {
    const cookies = await loginAs('viewer');

    const response = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', cookies)
      .send({
        fileName: 'a.pdf',
        contentBase64: Buffer.from('x').toString('base64'),
        fileType: 'application/pdf',
        fileSize: 1,
        entityType: 'quote_request',
        entityId: '1',
      });

    expect(response.status).toBe(403);
    expect(prismaMock.attachment.create).not.toHaveBeenCalled();
  });
});

async function loginAs(role: 'admin' | 'comprador' | 'gestor' | 'viewer') {
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
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}

// Review do #92: o descarte do corpo sem login tem teto de bytes e de tempo.
describe('requireAuthBeforeBody - descarte limitado', () => {
  async function startServer(options: { maxBytes: number; timeoutMs: number }) {
    const { default: expressLib } = await import('express');
    const { createRequireAuthBeforeBody } = await import('../src/middlewares/auth');
    const testApp = expressLib();
    testApp.use('/x', createRequireAuthBeforeBody(options), (_req, res) => {
      res.status(204).end();
    });
    const http = await import('http');
    const server = http.createServer(testApp);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as { port: number };
    return { server, port: address.port, http };
  }

  function send(
    http: typeof import('http'),
    port: number,
    { headers, chunks, end }: { headers: Record<string, string | number>; chunks: string[]; end: boolean },
  ) {
    return new Promise<{ status: number; connection: string | undefined; body: string; ms: number }>(
      (resolve, reject) => {
        const started = Date.now();
        const req = http.request(
          { host: '127.0.0.1', port, path: '/x', method: 'POST', headers },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (body += c));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                connection: res.headers.connection,
                body,
                ms: Date.now() - started,
              }),
            );
          },
        );
        req.on('error', reject);
        for (const chunk of chunks) req.write(chunk);
        if (end) req.end();
      },
    );
  }

  it('corpo declarado acima do teto: 401 na hora com Connection: close', async () => {
    const { server, port, http } = await startServer({ maxBytes: 1024, timeoutMs: 5_000 });
    try {
      const result = await send(http, port, {
        headers: { 'content-type': 'application/json', 'content-length': 50 * 1024 * 1024 },
        chunks: ['{"a":"'],
        end: false,
      });
      expect(result.status).toBe(401);
      expect(result.connection).toBe('close');
      expect(JSON.parse(result.body)).toEqual({ message: 'Token de acesso ausente.' });
      expect(result.ms).toBeLessThan(2_000);
    } finally {
      server.close();
    }
  });

  it('corpo lento que nao termina: 401 apos o prazo e conexao encerrada', async () => {
    const { server, port, http } = await startServer({ maxBytes: 1024 * 1024, timeoutMs: 200 });
    try {
      const result = await send(http, port, {
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        chunks: ['{"a":"'],
        end: false,
      });
      expect(result.status).toBe(401);
      expect(result.connection).toBe('close');
      expect(result.ms).toBeGreaterThanOrEqual(150);
      expect(result.ms).toBeLessThan(3_000);
    } finally {
      server.close();
    }
  });

  it('corpo chunked que passa do teto: 401 e conexao encerrada', async () => {
    const { server, port, http } = await startServer({ maxBytes: 1024, timeoutMs: 5_000 });
    try {
      const result = await send(http, port, {
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        chunks: ['{"a":"' + 'A'.repeat(4096)],
        end: false,
      });
      expect(result.status).toBe(401);
      expect(result.connection).toBe('close');
    } finally {
      server.close();
    }
  });

  it('corpo pequeno e completo: 401 normal, sem forcar o fechamento', async () => {
    const { server, port, http } = await startServer({ maxBytes: 1024, timeoutMs: 5_000 });
    try {
      const body = '{"a":"b"}';
      const result = await send(http, port, {
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        chunks: [body],
        end: true,
      });
      expect(result.status).toBe(401);
      expect(result.connection).not.toBe('close');
    } finally {
      server.close();
    }
  });
});
