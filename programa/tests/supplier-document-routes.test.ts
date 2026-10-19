import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH,
  SUPPLIER_DOCUMENT_JSON_BODY_LIMIT_BYTES,
  SUPPLIER_DOCUMENT_MAX_FILE_BYTES,
} from '../src/constants/supplierDocuments';
import { hashPassword } from '../src/utils/password';
import { addDaysToKey, todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

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
    supplier: {
      findFirst: vi.fn(),
    },
    supplierDocument: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  supplier: { findFirst: ReturnType<typeof vi.fn> };
  supplierDocument: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  auditLog: { create: ReturnType<typeof vi.fn> };
};

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('documento de teste')]);
const PDF_B64 = PDF_BYTES.toString('base64');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    supplierId: 10,
    name: 'Licenca ambiental',
    expiresOn: new Date('2099-12-01T00:00:00.000Z'),
    notes: null,
    fileName: 'licenca.pdf',
    mimeType: 'application/pdf',
    fileSize: PDF_BYTES.length,
    alertCycle: 1,
    createdById: 1,
    createdAt: new Date('2026-10-19T12:00:00.000Z'),
    updatedAt: new Date('2026-10-19T12:00:00.000Z'),
    deletedAt: null,
    createdBy: { id: 1, name: 'admin user' },
    ...overrides,
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: 10,
    name: 'Licenca ambiental',
    expiresOn: '2099-12-01',
    notes: 'Renovar com antecedencia',
    fileName: 'licenca.pdf',
    mimeType: 'application/pdf',
    contentBase64: PDF_B64,
    ...overrides,
  };
}

describe('Supplier document routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.supplier.findFirst.mockResolvedValue({ id: 10 });
    prismaMock.supplierDocument.findFirst.mockResolvedValue(documentRow());
    prismaMock.supplierDocument.findMany.mockResolvedValue([documentRow()]);
    prismaMock.supplierDocument.create.mockResolvedValue(documentRow());
    prismaMock.supplierDocument.update.mockResolvedValue(documentRow());
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  describe('autenticacao e papeis', () => {
    it('sem login responde 401', async () => {
      const response = await request(app).get('/api/v1/supplier-documents?supplierId=10');
      expect(response.status).toBe(401);
    });

    it('viewer e gestor listam, veem o resumo e baixam, mas nao escrevem', async () => {
      for (const role of ['viewer', 'gestor'] as const) {
        const cookies = await loginAs(role);

        prismaMock.supplierDocument.findFirst.mockResolvedValue({
          fileName: 'licenca.pdf',
          mimeType: 'application/pdf',
          file: { data: PDF_BYTES },
        });

        const list = await request(app)
          .get('/api/v1/supplier-documents?supplierId=10')
          .set('Cookie', cookies);
        const summary = await request(app)
          .get('/api/v1/supplier-documents/summary')
          .set('Cookie', cookies);
        const download = await request(app)
          .get('/api/v1/supplier-documents/5/download')
          .set('Cookie', cookies);

        expect([list.status, summary.status, download.status]).toEqual([200, 200, 200]);

        const post = await request(app)
          .post('/api/v1/supplier-documents')
          .set('Cookie', cookies)
          .send(createPayload());
        const patch = await request(app)
          .patch('/api/v1/supplier-documents/5')
          .set('Cookie', cookies)
          .send({ name: 'Novo nome' });
        const put = await request(app)
          .put('/api/v1/supplier-documents/5/file')
          .set('Cookie', cookies)
          .send({
            fileName: 'x.pdf',
            mimeType: 'application/pdf',
            contentBase64: PDF_B64,
            expiresOn: '2099-12-31',
          });
        const del = await request(app)
          .delete('/api/v1/supplier-documents/5')
          .set('Cookie', cookies);

        expect([post.status, patch.status, put.status, del.status]).toEqual([403, 403, 403, 403]);
      }
      expect(prismaMock.supplierDocument.create).not.toHaveBeenCalled();
      expect(prismaMock.supplierDocument.update).not.toHaveBeenCalled();
    });

    it('admin e comprador criam (201), editam (200), substituem (200) e excluem (200)', async () => {
      for (const role of ['admin', 'comprador'] as const) {
        const cookies = await loginAs(role);

        const post = await request(app)
          .post('/api/v1/supplier-documents')
          .set('Cookie', cookies)
          .send(createPayload());
        const patch = await request(app)
          .patch('/api/v1/supplier-documents/5')
          .set('Cookie', cookies)
          .send({ name: 'Novo nome' });
        const put = await request(app)
          .put('/api/v1/supplier-documents/5/file')
          .set('Cookie', cookies)
          .send({
            fileName: 'x.pdf',
            mimeType: 'application/pdf',
            contentBase64: PDF_B64,
            expiresOn: '2099-12-31',
          });
        const del = await request(app)
          .delete('/api/v1/supplier-documents/5')
          .set('Cookie', cookies);

        expect([post.status, patch.status, put.status, del.status]).toEqual([201, 200, 200, 200]);
        expect(del.body).toEqual({ ok: true });
      }
    });
  });

  describe('listagem e resumo', () => {
    it('lista com deletedAt null no documento e no fornecedor, sem carregar o arquivo', async () => {
      const cookies = await loginAs('viewer');

      const response = await request(app)
        .get('/api/v1/supplier-documents?supplierId=10')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.body[0]).toMatchObject({
        id: 5,
        supplierId: 10,
        expiresOn: '2099-12-01',
        status: 'ok',
        createdBy: { id: 1, name: 'admin user' },
      });
      expect(response.body[0].daysLeft).toBeGreaterThan(30);
      expect(response.body[0]).not.toHaveProperty('file');
      expect(response.body[0]).not.toHaveProperty('contentBase64');

      const args = prismaMock.supplierDocument.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        supplierId: 10,
        deletedAt: null,
        supplier: { deletedAt: null },
      });
      expect(args.include).not.toHaveProperty('file');
    });

    it('lista sem supplierId responde 400', async () => {
      const cookies = await loginAs('viewer');
      const response = await request(app).get('/api/v1/supplier-documents').set('Cookie', cookies);
      expect(response.status).toBe(400);
    });

    it('resumo agrupa vencidos e a vencer por fornecedor e filtra excluidos', async () => {
      const cookies = await loginAs('viewer');
      const day = 24 * 60 * 60 * 1000;
      const base = Date.now();
      const key = (offsetDays: number) =>
        new Date(base + offsetDays * day).toISOString().slice(0, 10);

      prismaMock.supplierDocument.findMany.mockResolvedValue([
        { supplierId: 10, expiresOn: new Date(`${key(-5)}T00:00:00.000Z`) },
        { supplierId: 10, expiresOn: new Date(`${key(10)}T00:00:00.000Z`) },
        { supplierId: 10, expiresOn: new Date(`${key(400)}T00:00:00.000Z`) },
        { supplierId: 11, expiresOn: new Date(`${key(400)}T00:00:00.000Z`) },
      ]);

      const response = await request(app)
        .get('/api/v1/supplier-documents/summary')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body.bySupplier)).toEqual(['10']);
      expect(response.body.bySupplier['10']).toMatchObject({ expired: 1, expiring: 1 });
      // Filtra no banco: so vencidos e a vencer (expiresOn <= hoje+30 em BRT).
      const limit = new Date(`${addDaysToKey(todayKeyInSaoPaulo(new Date()), 30)}T00:00:00.000Z`);
      expect(prismaMock.supplierDocument.findMany.mock.calls[0][0].where).toEqual({
        expiresOn: { lte: limit },
        deletedAt: null,
        supplier: { deletedAt: null },
      });
    });
  });

  describe('validacao do upload', () => {
    it('MIME text/plain responde 400', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ mimeType: 'text/plain' }));
      expect(response.status).toBe(400);
      expect(prismaMock.supplierDocument.create).not.toHaveBeenCalled();
    });

    it('magic bytes divergentes do tipo declarado respondem 400', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: PNG_BYTES.toString('base64') }));
      expect(response.status).toBe(400);
      expect(prismaMock.supplierDocument.create).not.toHaveBeenCalled();
    });

    it('conteudo sem assinatura conhecida responde 400', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: Buffer.from('texto puro').toString('base64') }));
      expect(response.status).toBe(400);
    });

    it('arquivo vazio responde 400', async () => {
      const cookies = await loginAs('admin');
      const empty = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: '' }));
      const emptyDataUrl = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: 'data:application/pdf;base64,' }));
      expect(empty.status).toBe(400);
      expect(emptyDataUrl.status).toBe(400);
    });

    it('base64 invalido responde 400', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: 'JVBERi0x$$$' }));
      expect(response.status).toBe(400);
    });

    it('arquivo acima de 10MB (dentro do parser) responde 400', async () => {
      const cookies = await loginAs('admin');
      const big = Buffer.concat([
        Buffer.from('%PDF-'),
        Buffer.alloc(SUPPLIER_DOCUMENT_MAX_FILE_BYTES),
      ]);
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: big.toString('base64') }));
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('10MB');
      expect(prismaMock.supplierDocument.create).not.toHaveBeenCalled();
    });

    it('base64 acima do maximo do validator responde 400 sem decodificar nem gravar', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: 'A'.repeat(SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH + 1) }));
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('10MB');
      expect(prismaMock.supplier.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.supplierDocument.create).not.toHaveBeenCalled();
    });

    it('corpo acima do limite do parser responde 413 em JSON', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ contentBase64: 'A'.repeat(SUPPLIER_DOCUMENT_JSON_BODY_LIMIT_BYTES + 1024) }));
      expect(response.status).toBe(413);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.message).toContain('10MB');
    });

    it('data de vencimento inexistente (2027-02-29) responde 400', async () => {
      const cookies = await loginAs('admin');
      const create = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ expiresOn: '2027-02-29' }));
      const patch = await request(app)
        .patch('/api/v1/supplier-documents/5')
        .set('Cookie', cookies)
        .send({ expiresOn: '2027-02-29' });
      expect([create.status, patch.status]).toEqual([400, 400]);
    });

    it('fornecedor inexistente ou excluido responde 404 no POST', async () => {
      const cookies = await loginAs('admin');
      prismaMock.supplier.findFirst.mockResolvedValue(null);
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload());
      expect(response.status).toBe(404);
      expect(prismaMock.supplier.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10, deletedAt: null } }),
      );
      expect(prismaMock.supplierDocument.create).not.toHaveBeenCalled();
    });

    it('PUT sem expiresOn responde 400', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .put('/api/v1/supplier-documents/5/file')
        .set('Cookie', cookies)
        .send({ fileName: 'x.pdf', mimeType: 'application/pdf', contentBase64: PDF_B64 });
      expect(response.status).toBe(400);
      expect(prismaMock.supplierDocument.update).not.toHaveBeenCalled();
    });

    it('PATCH sem nenhum campo responde 400', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .patch('/api/v1/supplier-documents/5')
        .set('Cookie', cookies)
        .send({});
      expect(response.status).toBe(400);
    });
  });

  describe('criacao', () => {
    it('grava arquivo em tabela filha, nao devolve bytes e audita', async () => {
      const cookies = await loginAs('comprador');
      const response = await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload());

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty('file');
      const data = prismaMock.supplierDocument.create.mock.calls[0][0].data;
      expect(data.expiresOn).toEqual(new Date('2099-12-01T00:00:00.000Z'));
      expect(data.fileSize).toBe(PDF_BYTES.length);
      expect(Buffer.from(data.file.create.data).equals(PDF_BYTES)).toBe(true);
      expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        entityType: 'supplier_document',
        action: 'create',
      });
    });
  });

  describe('nome do arquivo', () => {
    it('grava so o basename, sem separadores, .. nem caracteres de controle', async () => {
      const cookies = await loginAs('admin');
      await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ fileName: '..\\..\\secreto/../relatorio\u0000\n.pdf' }));
      expect(prismaMock.supplierDocument.create.mock.calls[0][0].data.fileName).toBe('relatorio.pdf');
    });

    it('nome so de separadores cai no fallback documento.<ext> pelo tipo detectado', async () => {
      const cookies = await loginAs('admin');
      await request(app)
        .post('/api/v1/supplier-documents')
        .set('Cookie', cookies)
        .send(createPayload({ fileName: '../../' }));
      expect(prismaMock.supplierDocument.create.mock.calls[0][0].data.fileName).toBe('documento.pdf');
    });
  });

  describe('alertCycle (reset de marcos)', () => {
    it('PATCH com data nova incrementa alertCycle', async () => {
      const cookies = await loginAs('admin');
      await request(app)
        .patch('/api/v1/supplier-documents/5')
        .set('Cookie', cookies)
        .send({ expiresOn: '2100-01-15' });

      const data = prismaMock.supplierDocument.update.mock.calls[0][0].data;
      expect(data.alertCycle).toEqual({ increment: 1 });
      expect(data.expiresOn).toEqual(new Date('2100-01-15T00:00:00.000Z'));
    });

    it('PATCH com a mesma data (ou so nome) nao incrementa', async () => {
      const cookies = await loginAs('admin');
      await request(app)
        .patch('/api/v1/supplier-documents/5')
        .set('Cookie', cookies)
        .send({ expiresOn: '2099-12-01', name: 'Outro nome' });
      await request(app)
        .patch('/api/v1/supplier-documents/5')
        .set('Cookie', cookies)
        .send({ name: 'So o nome' });

      for (const call of prismaMock.supplierDocument.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('alertCycle');
      }
    });

    it('PUT do arquivo incrementa so quando a data muda e sobrescreve os bytes', async () => {
      const cookies = await loginAs('admin');
      const body = {
        fileName: 'nova.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF_B64,
      };

      await request(app)
        .put('/api/v1/supplier-documents/5/file')
        .set('Cookie', cookies)
        .send({ ...body, expiresOn: '2100-06-30' });
      await request(app)
        .put('/api/v1/supplier-documents/5/file')
        .set('Cookie', cookies)
        .send({ ...body, expiresOn: '2099-12-01' });

      const [changed, same] = prismaMock.supplierDocument.update.mock.calls.map((c) => c[0].data);
      expect(changed.alertCycle).toEqual({ increment: 1 });
      expect(same).not.toHaveProperty('alertCycle');
      expect(Buffer.from(changed.file.upsert.update.data).equals(PDF_BYTES)).toBe(true);
    });
  });

  describe('exclusao e download', () => {
    it('DELETE grava deletedAt (soft delete) e audita', async () => {
      const cookies = await loginAs('admin');
      const response = await request(app)
        .delete('/api/v1/supplier-documents/5')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      const call = prismaMock.supplierDocument.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 5 });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
        entityType: 'supplier_document',
        action: 'delete',
      });
    });

    it('documento excluido responde 404 no download, PATCH e DELETE', async () => {
      const cookies = await loginAs('admin');
      prismaMock.supplierDocument.findFirst.mockResolvedValue(null);

      const download = await request(app)
        .get('/api/v1/supplier-documents/5/download')
        .set('Cookie', cookies);
      const patch = await request(app)
        .patch('/api/v1/supplier-documents/5')
        .set('Cookie', cookies)
        .send({ name: 'x' });
      const del = await request(app)
        .delete('/api/v1/supplier-documents/5')
        .set('Cookie', cookies);

      expect([download.status, patch.status, del.status]).toEqual([404, 404, 404]);
      expect(prismaMock.supplierDocument.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        deletedAt: null,
        supplier: { deletedAt: null },
      });
    });

    it('download devolve JSON com nome, tipo e base64 integro', async () => {
      const cookies = await loginAs('viewer');
      prismaMock.supplierDocument.findFirst.mockResolvedValue({
        fileName: 'licenca.pdf',
        mimeType: 'application/pdf',
        file: { data: PDF_BYTES },
      });

      const response = await request(app)
        .get('/api/v1/supplier-documents/5/download')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        fileName: 'licenca.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF_B64,
      });
    });
  });

  it('toda mutation chama o AuditLog dentro da transacao', async () => {
    const cookies = await loginAs('admin');
    await request(app).post('/api/v1/supplier-documents').set('Cookie', cookies).send(createPayload());
    await request(app)
      .patch('/api/v1/supplier-documents/5')
      .set('Cookie', cookies)
      .send({ name: 'x' });
    await request(app)
      .put('/api/v1/supplier-documents/5/file')
      .set('Cookie', cookies)
      .send({
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF_B64,
        expiresOn: '2099-12-31',
      });
    await request(app).delete('/api/v1/supplier-documents/5').set('Cookie', cookies);

    const actions = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(['create', 'update', 'replace_file', 'delete']);
    expect((prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).toHaveBeenCalledTimes(4);
  });
});

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer';

// O login tem rate limit: faz 1 login real por papel e reaplica so o mock do usuario nas
// demais chamadas (o papel e lido do banco a cada request autenticada).
const cookieCache = new Map<Role, string[]>();

function mockUser(role: Role, passwordHash?: string) {
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
}

async function loginAs(role: Role) {
  const cached = cookieCache.get(role);
  if (cached) {
    mockUser(role);
    return cached;
  }

  mockUser(role, await hashPassword('ChangeMe123!'));
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });

  const loginResponse = await request(app).post('/api/v1/auth/login').send({
    email: `${role}@intelliquote.local`,
    password: 'ChangeMe123!',
  });

  const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
  cookieCache.set(role, cookies);
  return cookies;
}
