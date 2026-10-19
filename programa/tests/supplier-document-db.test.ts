import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { todayKeyInSaoPaulo } from '../src/utils/supplierDocumentDates';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `supplier-document-db-${Date.now()}`;

const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x0a, 0x0d, 0x00]),
  Buffer.from('fim'),
]);
const PDF_B64 = PDF_BYTES.toString('base64');

// Chave YYYY-MM-DD de hoje (calendario de Sao Paulo) deslocada em `offsetDays`.
function keyFromToday(offsetDays: number): string {
  const [y, m, d] = todayKeyInSaoPaulo(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

describe('SupplierDocument (DB)', () => {
  let adminCookies: string[] = [];
  let adminId: number;
  let supplierId: number;
  let deletedSupplierId: number;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });

    const user = await prisma.user.create({
      data: {
        name: `Admin Supplier Document Test ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: user.email,
      password: 'Test1234!',
    });
    adminCookies = loginRes.headers['set-cookie'];

    const supplier = await prisma.supplier.create({
      data: { name: `Fornecedor ${runId} A`, acceptedIncoterms: ['FOB'], status: 'active' },
    });
    supplierId = supplier.id;

    const deletedSupplier = await prisma.supplier.create({
      data: {
        name: `Fornecedor ${runId} Excluido`,
        acceptedIncoterms: ['FOB'],
        status: 'active',
        deletedAt: new Date(),
      },
    });
    deletedSupplierId = deletedSupplier.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const supplierIds = [supplierId, deletedSupplierId].filter(Boolean);
    const documents = await prisma.supplierDocument.findMany({
      where: { supplierId: { in: supplierIds } },
      select: { id: true },
    });

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: 'supplier_document', entityId: { in: documents.map((d) => String(d.id)) } },
          { performedById: adminId },
        ],
      },
    });
    // SupplierDocumentFile cai em cascata com o documento; o documento cai com o fornecedor.
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  async function createDocument(expiresOn: string, name = 'Documento') {
    return request(app)
      .post('/api/v1/supplier-documents')
      .set('Cookie', adminCookies)
      .send({
        supplierId,
        name,
        expiresOn,
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF_B64,
      });
  }

  testDbSkip('cria com arquivo e le os bytes de volta integros', async () => {
    const created = await createDocument(keyFromToday(100), 'Licenca');
    expect(created.status).toBe(201);
    expect(created.body.fileSize).toBe(PDF_BYTES.length);
    expect(created.body).not.toHaveProperty('contentBase64');

    const stored = await prisma.supplierDocumentFile.findUnique({
      where: { documentId: created.body.id },
    });
    expect(Buffer.from(stored!.data).equals(PDF_BYTES)).toBe(true);

    const download = await request(app)
      .get(`/api/v1/supplier-documents/${created.body.id}/download`)
      .set('Cookie', adminCookies);
    expect(download.status).toBe(200);
    expect(download.body.contentBase64).toBe(PDF_B64);
    expect(Buffer.from(download.body.contentBase64, 'base64').equals(PDF_BYTES)).toBe(true);
  });

  testDbSkip('expiresOn 2028-02-29 faz round-trip pela coluna DATE', async () => {
    const created = await createDocument('2028-02-29', 'Bissexto');
    expect(created.status).toBe(201);
    expect(created.body.expiresOn).toBe('2028-02-29');

    const list = await request(app)
      .get(`/api/v1/supplier-documents?supplierId=${supplierId}`)
      .set('Cookie', adminCookies);
    expect(list.status).toBe(200);
    const found = list.body.find((d: { id: number }) => d.id === created.body.id);
    expect(found.expiresOn).toBe('2028-02-29');
  });

  testDbSkip('PATCH com data nova incrementa alertCycle; mesma data nao', async () => {
    const created = await createDocument(keyFromToday(200), 'Ciclo');
    const id = created.body.id as number;

    await request(app)
      .patch(`/api/v1/supplier-documents/${id}`)
      .set('Cookie', adminCookies)
      .send({ name: 'Ciclo renomeado', expiresOn: keyFromToday(200) });
    expect((await prisma.supplierDocument.findUnique({ where: { id } }))!.alertCycle).toBe(1);

    await request(app)
      .patch(`/api/v1/supplier-documents/${id}`)
      .set('Cookie', adminCookies)
      .send({ expiresOn: keyFromToday(300) });
    expect((await prisma.supplierDocument.findUnique({ where: { id } }))!.alertCycle).toBe(2);

    const replaced = await request(app)
      .put(`/api/v1/supplier-documents/${id}/file`)
      .set('Cookie', adminCookies)
      .send({
        fileName: 'novo.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF_B64,
        expiresOn: keyFromToday(400),
      });
    expect(replaced.status).toBe(200);
    const row = await prisma.supplierDocument.findUnique({ where: { id } });
    expect(row!.alertCycle).toBe(3);
    expect(row!.fileName).toBe('novo.pdf');
  });

  testDbSkip('soft delete some da lista e do summary, mas a linha e os bytes continuam', async () => {
    const created = await createDocument(keyFromToday(-3), 'Vai sumir');
    const id = created.body.id as number;

    const before = await request(app)
      .get('/api/v1/supplier-documents/summary')
      .set('Cookie', adminCookies);
    const expiredBefore = before.body.bySupplier[String(supplierId)].expired as number;

    const del = await request(app)
      .delete(`/api/v1/supplier-documents/${id}`)
      .set('Cookie', adminCookies);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get(`/api/v1/supplier-documents?supplierId=${supplierId}`)
      .set('Cookie', adminCookies);
    expect(list.body.some((d: { id: number }) => d.id === id)).toBe(false);

    const after = await request(app)
      .get('/api/v1/supplier-documents/summary')
      .set('Cookie', adminCookies);
    expect(after.body.bySupplier[String(supplierId)]?.expired ?? 0).toBe(expiredBefore - 1);

    const download = await request(app)
      .get(`/api/v1/supplier-documents/${id}/download`)
      .set('Cookie', adminCookies);
    expect(download.status).toBe(404);

    const row = await prisma.supplierDocument.findUnique({ where: { id } });
    expect(row!.deletedAt).not.toBeNull();
    expect(await prisma.supplierDocumentFile.findUnique({ where: { documentId: id } })).not.toBeNull();
  });

  testDbSkip('summary conta vencidos e a vencer e ignora fornecedor excluido', async () => {
    // Fornecedor isolado para contagem exata.
    const supplier = await prisma.supplier.create({
      data: { name: `Fornecedor ${runId} Resumo`, acceptedIncoterms: ['FOB'], status: 'active' },
    });

    try {
      const data = (name: string, offsetDays: number, extra: Record<string, unknown> = {}) => ({
        supplierId: supplier.id,
        name,
        expiresOn: new Date(`${keyFromToday(offsetDays)}T00:00:00.000Z`),
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSize: PDF_BYTES.length,
        ...extra,
      });

      await prisma.supplierDocument.createMany({
        data: [
          data('vencido ontem', -1),
          data('vencido ha 30 dias', -30),
          data('vence hoje', 0),
          data('vence em 30', 30),
          data('em dia (31)', 31),
          data('excluido', -10, { deletedAt: new Date() }),
        ],
      });
      // Documento ativo de fornecedor excluido nao entra.
      await prisma.supplierDocument.create({
        data: {
          supplierId: deletedSupplierId,
          name: 'de fornecedor excluido',
          expiresOn: new Date(`${keyFromToday(-5)}T00:00:00.000Z`),
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          fileSize: PDF_BYTES.length,
        },
      });

      const response = await request(app)
        .get('/api/v1/supplier-documents/summary')
        .set('Cookie', adminCookies);

      expect(response.status).toBe(200);
      expect(response.body.bySupplier[String(supplier.id)]).toEqual({
        expired: 2,
        expiring: 2,
        nextDaysLeft: 0,
      });
      expect(response.body.bySupplier).not.toHaveProperty(String(deletedSupplierId));
    } finally {
      await prisma.supplier.delete({ where: { id: supplier.id } });
    }
  });

  testDbSkip('documento de fornecedor excluido nao aparece na lista nem no download', async () => {
    const doc = await prisma.supplierDocument.create({
      data: {
        supplierId: deletedSupplierId,
        name: 'orfao logico',
        expiresOn: new Date(`${keyFromToday(10)}T00:00:00.000Z`),
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSize: PDF_BYTES.length,
        file: { create: { data: new Uint8Array(PDF_BYTES) } },
      },
    });

    const list = await request(app)
      .get(`/api/v1/supplier-documents?supplierId=${deletedSupplierId}`)
      .set('Cookie', adminCookies);
    expect(list.body).toEqual([]);

    const download = await request(app)
      .get(`/api/v1/supplier-documents/${doc.id}/download`)
      .set('Cookie', adminCookies);
    expect(download.status).toBe(404);
  });
});
