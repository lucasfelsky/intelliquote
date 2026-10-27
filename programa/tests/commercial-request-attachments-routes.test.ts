// Anexos tecnicos da solicitacao de desenvolvimento: guardas de papel, validacao do corpo e
// download (prisma mockado; autorizacao por objeto e bytes reais ficam no teste de banco).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';
import {
  CR_ATTACHMENT_BASE64_MAX_LENGTH,
  CR_ATTACHMENT_JSON_BODY_LIMIT_BYTES,
} from '../src/constants/commercialRequestAttachments';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    commercialRequestAttachment: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});

vi.mock('../src/services/AuditLogService', () => ({
  AuditLogService: { log: vi.fn() },
}));

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Role = 'comercial' | 'viewer' | 'comprador' | 'admin' | 'gestor';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  commercialRequestAttachment: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const SESSION_USER_ID = 42;
const cookieCache = new Map<Role, string[]>();

async function loginAs(role: Role) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const base = {
    id: SESSION_USER_ID,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue({ ...base, passwordHash });
  prismaMock.user.findFirst.mockResolvedValue(base);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const cached = cookieCache.get(role);
  if (cached) return cached;

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: base.email, password: 'ChangeMe123!' });
  const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
  cookieCache.set(role, cookies);
  return cookies;
}

// Fixtures sinteticas em memoria (nenhum arquivo real).
const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'TDS',
    fileName: 'tds.pdf',
    mimeType: 'application/pdf',
    contentBase64: PDF_BYTES.toString('base64'),
    ...overrides,
  };
}

const UPLOAD_URL = '/api/v1/commercial-requests/7/attachments';
const DOWNLOAD_URL = '/api/v1/commercial-requests/7/attachments/3/download';
const DELETE_URL = '/api/v1/commercial-requests/7/attachments/3';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockRejectedValue(new Error('nao deveria abrir transacao'));
});

describe('anexos da solicitacao: autenticacao e papeis', () => {
  it('sem login: 401 nas 3 rotas', async () => {
    expect((await request(app).post(UPLOAD_URL).send(validBody())).status).toBe(401);
    expect((await request(app).get(DOWNLOAD_URL)).status).toBe(401);
    expect((await request(app).delete(DELETE_URL)).status).toBe(401);
  });

  it.each<Role>(['viewer', 'comprador', 'admin', 'gestor'])(
    '%s no POST e no DELETE: 403 (so o comercial anexa e remove)',
    async (role) => {
      const cookies = await loginAs(role);

      const post = await request(app).post(UPLOAD_URL).set('Cookie', cookies).send(validBody());
      const del = await request(app).delete(DELETE_URL).set('Cookie', cookies);

      expect(post.status).toBe(403);
      expect(del.status).toBe(403);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each<Role>(['gestor', 'viewer', 'comprador', 'admin'])(
    '%s no GET download: passa pelo allowRoles e nao filtra por dono',
    async (role) => {
      const cookies = await loginAs(role);
      prismaMock.commercialRequestAttachment.findFirst.mockResolvedValue({
        fileName: 'tds.pdf',
        mimeType: 'application/pdf',
        file: { data: PDF_BYTES },
      });

      const response = await request(app).get(DOWNLOAD_URL).set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        fileName: 'tds.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF_BYTES.toString('base64'),
      });
      const where = prismaMock.commercialRequestAttachment.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ id: 3, commercialRequestId: 7 });
    },
  );

  it('comercial no GET download: a consulta filtra pelo dono da solicitacao; sem linha = 404', async () => {
    const cookies = await loginAs('comercial');
    prismaMock.commercialRequestAttachment.findFirst.mockResolvedValue(null);

    const response = await request(app).get(DOWNLOAD_URL).set('Cookie', cookies);

    expect(response.status).toBe(404);
    const where = prismaMock.commercialRequestAttachment.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      id: 3,
      commercialRequestId: 7,
      commercialRequest: { requestedById: SESSION_USER_ID },
    });
  });

  it('ids invalidos no path: 400 (acima de Int do Postgres e nao numerico)', async () => {
    const cookies = await loginAs('comercial');

    const tooBig = await request(app)
      .get('/api/v1/commercial-requests/99999999999/attachments/3/download')
      .set('Cookie', cookies);
    const nan = await request(app)
      .delete('/api/v1/commercial-requests/7/attachments/abc')
      .set('Cookie', cookies);

    expect(tooBig.status).toBe(400);
    expect(nan.status).toBe(400);
  });
});

describe('POST /commercial-requests/:id/attachments: validacao do corpo', () => {
  let cookies: string[];

  beforeEach(async () => {
    cookies = await loginAs('comercial');
  });

  function post(body: unknown) {
    return request(app).post(UPLOAD_URL).set('Cookie', cookies).send(body as object);
  }

  it('sem kind: 400', async () => {
    const { kind: _kind, ...withoutKind } = validBody();
    expect((await post(withoutKind)).status).toBe(400);
  });

  it("kind 'EXE': 400", async () => {
    expect((await post(validBody({ kind: 'EXE' }))).status).toBe(400);
  });

  it('mimeType fora da lista: 400', async () => {
    const response = await post(validBody({ mimeType: 'application/x-msdownload' }));
    expect(response.status).toBe(400);
  });

  it('campo extra: 400 (strict)', async () => {
    expect((await post(validBody({ uploadedById: 1 }))).status).toBe(400);
  });

  it('contentBase64 acima do teto do validator (e abaixo do limite do parser): 400 com mensagem de tamanho', async () => {
    const contentBase64 = 'A'.repeat(CR_ATTACHMENT_BASE64_MAX_LENGTH + 1);
    expect(contentBase64.length + 200).toBeLessThan(CR_ATTACHMENT_JSON_BODY_LIMIT_BYTES);

    const response = await post(validBody({ contentBase64 }));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/10MB/);
  });

  it('corpo acima do limite do parser: 413 em JSON', async () => {
    const contentBase64 = 'A'.repeat(CR_ATTACHMENT_JSON_BODY_LIMIT_BYTES + 10);

    const response = await post(validBody({ contentBase64 }));

    expect(response.status).toBe(413);
    expect(response.body.message).toMatch(/10MB/);
  });

  it('magic bytes PNG declarados como PDF: 400 antes de abrir transacao', async () => {
    const response = await post(validBody({ contentBase64: PNG_BYTES.toString('base64') }));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/nao corresponde/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('extensao dupla (tds.pdf.exe) com PDF real: 400 antes de abrir transacao', async () => {
    const response = await post(validBody({ fileName: 'tds.pdf.exe' }));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/extensao/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('base64 invalido e arquivo vazio: 400', async () => {
    expect((await post(validBody({ contentBase64: '@@@' }))).status).toBe(400);
    // "AAAA" decodifica para 3 bytes nulos (nao e PDF/PNG/JPEG): tipo nao permitido.
    expect((await post(validBody({ contentBase64: 'AAAA' }))).status).toBe(400);
  });
});
