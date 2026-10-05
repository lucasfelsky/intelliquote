import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import exceljs from 'exceljs';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import { SUPPLIER_IMPORT_COLUMNS } from '../src/utils/supplierImport';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `supplier-import-db-${Date.now()}`;

function supplierName(suffix: string): string {
  return `Fornecedor ${runId} ${suffix}`;
}

describe('SupplierImportController (DB)', () => {
  let adminCookies: string[] = [];
  let adminId: number;
  let familyId: number;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });

    const passwordHash = await hashPassword('Test1234!');
    const user = await prisma.user.create({
      data: {
        name: `Admin Supplier Import Test ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash,
        roleId: adminRole.id,
      },
    });
    adminId = user.id;

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: user.email,
      password: 'Test1234!',
    });
    adminCookies = loginRes.headers['set-cookie'];

    const family = await prisma.itemFamily.create({
      data: { name: `Família ${runId}` },
    });
    familyId = family.id;

    await prisma.supplier.create({
      data: {
        name: supplierName('Existente'),
        acceptedIncoterms: ['FOB'],
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const suppliers = await prisma.supplier.findMany({
      where: { name: { startsWith: `Fornecedor ${runId}` } },
      select: { id: true },
    });
    const supplierIds = suppliers.map((s) => s.id);

    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityType: 'supplier', entityId: { in: supplierIds.map(String) } },
          { performedById: adminId },
        ],
      },
    });
    await prisma.supplierContact.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    if (familyId) {
      await prisma.itemFamily.delete({ where: { id: familyId } });
    }
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('GET /api/v1/suppliers/import/template - devolve contentBase64', async () => {
    const res = await request(app)
      .get('/api/v1/suppliers/import/template')
      .set('Cookie', adminCookies);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.contentBase64).toBe('string');
    expect(res.body.data.contentBase64.length).toBeGreaterThan(0);
  });

  testDbSkip('POST /api/v1/suppliers/import - preview cobre os cenarios de erro e 1 linha valida', async () => {
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Fornecedores');
    sheet.addRow([...SUPPLIER_IMPORT_COLUMNS]);

    // Row 2: nome faltando
    sheet.addRow(['', 'CN', '', 'FOB', '30', '', '', '', '', '', '', '']);
    // Row 3: incoterm ruim
    sheet.addRow([supplierName('Incoterm Ruim'), 'CN', '', 'XYZ', '30', '', '', '', '', '', '', '']);
    // Row 4: familia desconhecida
    sheet.addRow([
      supplierName('Familia Desconhecida'),
      'CN',
      '',
      'FOB',
      '30',
      'Familia Inexistente 999',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    // Row 5: duplicado com existente
    sheet.addRow([supplierName('Existente'), 'CN', '', 'FOB', '30', '', '', '', '', '', '', '']);
    // Row 6: duplicado na planilha (repete o nome da linha 7)
    sheet.addRow([supplierName('Duplicado'), 'CN', '', 'FOB', '30', '', '', '', '', '', '', '']);
    sheet.addRow([supplierName('Duplicado'), 'CN', '', 'FOB', '30', '', '', '', '', '', '', '']);
    // Row 8: e-mail de contato ruim
    sheet.addRow([
      supplierName('Email Ruim'),
      'CN',
      '',
      'FOB',
      '30',
      '',
      '',
      '',
      'Fulano',
      'nao-e-email',
      '',
      '',
    ]);
    // Row 9: linha valida
    sheet.addRow([
      supplierName('Valido'),
      'CN',
      'https://exemplo.com',
      'FOB',
      '30',
      `Família ${runId}`,
      'confiavel',
      'observacao',
      'Fulano',
      'fulano@exemplo.com',
      '11999999999',
      'Comprador',
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    const contentBase64 = buffer.toString('base64');

    const res = await request(app)
      .post('/api/v1/suppliers/import')
      .set('Cookie', adminCookies)
      .send({ contentBase64 });

    expect(res.status).toBe(200);
    // Linha 6 ("Duplicado", 1a ocorrencia) e valida por si so (Decisao 4 do
    // PLAN.md: a 1a ocorrencia fica "reservada" e so as posteriores sao
    // rejeitadas) - so a linha 7 (2a ocorrencia) vira erro. validLines tem
    // portanto 2 entradas: linha 6 (Duplicado) e linha 9 (Valido).
    expect(res.body.data.validLines.length).toBe(2);
    expect(res.body.data.validLines[0].name).toBe(supplierName('Duplicado'));
    expect(res.body.data.validLines[1].name).toBe(supplierName('Valido'));
    expect(res.body.data.validLines[1].familyIds).toEqual([familyId]);

    expect(res.body.data.errorLines.length).toBe(6);
    const reasons = res.body.data.errorLines.map((e: { reason: string }) => e.reason).join(' | ');
    expect(reasons).toMatch(/Nome é obrigatório/);
    expect(reasons).toMatch(/Incoterm inválido: XYZ/);
    expect(reasons).toMatch(/Família não encontrada: Familia Inexistente 999/);
    expect(reasons).toMatch(/Fornecedor já cadastrado/);
    expect(reasons).toMatch(/Fornecedor duplicado na planilha/);
    expect(reasons).toMatch(/E-mail do contato inválido/);
  });

  testDbSkip('POST /api/v1/suppliers/import - cabecalho trocado responde 400', async () => {
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Fornecedores');
    const swapped = [...SUPPLIER_IMPORT_COLUMNS];
    const tmp = swapped[0];
    swapped[0] = swapped[1] as string;
    swapped[1] = tmp as string;
    sheet.addRow(swapped);
    sheet.addRow([supplierName('Nao Importa'), 'CN', '', 'FOB', '30', '', '', '', '', '', '', '']);

    const buffer = await workbook.xlsx.writeBuffer();
    const contentBase64 = buffer.toString('base64');

    const res = await request(app)
      .post('/api/v1/suppliers/import')
      .set('Cookie', adminCookies)
      .send({ contentBase64 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cabeçalho da planilha não corresponde ao modelo/);
  });

  testDbSkip('POST /api/v1/suppliers/import - arquivo corrompido responde 400', async () => {
    const res = await request(app)
      .post('/api/v1/suppliers/import')
      .set('Cookie', adminCookies)
      .send({ contentBase64: Buffer.from('isto nao e um xlsx').toString('base64') });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Arquivo inválido/);
  });

  testDbSkip('POST /api/v1/suppliers/import/confirm - cria fornecedor active + contato principal + familias + auditoria', async () => {
    const name = supplierName('Confirm Sucesso');
    const rows = [
      {
        row: 2,
        data: {
          name,
          country: 'CN',
          website: null,
          acceptedIncoterms: ['FOB'],
          paymentTermsDays: 30,
          familyIds: [familyId],
          tags: ['confiavel'],
          notes: null,
          contacts: [
            {
              name: 'Fulano',
              email: 'fulano.confirm@exemplo.com',
              phone: null,
              position: null,
            },
          ],
        },
      },
    ];

    const res = await request(app)
      .post('/api/v1/suppliers/import/confirm')
      .set('Cookie', adminCookies)
      .send({ rows });

    expect(res.status).toBe(200);
    expect(res.body.data.successLines.length).toBe(1);
    expect(res.body.data.errorLines.length).toBe(0);

    const created = await prisma.supplier.findFirst({
      where: { name },
      include: { families: true, contacts: true },
    });
    expect(created).not.toBeNull();
    expect(created?.status).toBe('active');
    expect(created?.families.map((f) => f.id)).toEqual([familyId]);
    expect(created?.contacts.length).toBe(1);
    expect(created?.contacts[0]?.isPrimary).toBe(true);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: String(created!.id), entityType: 'supplier' },
    });
    expect(auditLogs.length).toBeGreaterThan(0);

    const contactAuditLogs = await prisma.auditLog.findMany({
      where: { entityType: 'supplier_contact', entityId: String(created!.contacts[0]!.id) },
    });
    expect(contactAuditLogs.length).toBeGreaterThan(0);
  });

  testDbSkip('POST /api/v1/suppliers/import/confirm - 3 contatos: so o 1o e principal + auditoria por contato', async () => {
    const name = supplierName('Confirm Multi Contato');
    const emails = [
      `ana.${runId}@exemplo.com`,
      `beto.${runId}@exemplo.com`,
      `carla.${runId}@exemplo.com`,
    ];
    const rows = [
      {
        row: 2,
        data: {
          name,
          country: 'CN',
          website: null,
          acceptedIncoterms: ['FOB'],
          paymentTermsDays: 30,
          familyIds: [],
          tags: [],
          notes: null,
          contacts: [
            { name: 'Ana', email: emails[0], phone: '111', position: 'Compras' },
            { name: 'Beto', email: emails[1], phone: null, position: null },
            { name: 'Carla', email: emails[2], phone: '333', position: 'Diretora' },
          ],
        },
      },
    ];

    const res = await request(app)
      .post('/api/v1/suppliers/import/confirm')
      .set('Cookie', adminCookies)
      .send({ rows });

    expect(res.status).toBe(200);
    expect(res.body.data.successLines.length).toBe(1);
    expect(res.body.data.errorLines.length).toBe(0);

    const created = await prisma.supplier.findFirst({
      where: { name },
      include: { contacts: true },
    });
    expect(created).not.toBeNull();
    expect(created?.contacts.length).toBe(3);

    const primaries = created!.contacts.filter((c) => c.isPrimary);
    expect(primaries.length).toBe(1);
    expect(primaries[0]?.email).toBe(emails[0]);

    const contactAuditLogs = await prisma.auditLog.findMany({
      where: {
        entityType: 'supplier_contact',
        entityId: { in: created!.contacts.map((c) => String(c.id)) },
      },
    });
    expect(contactAuditLogs.length).toBe(3);
  });

  testDbSkip('POST /api/v1/suppliers/import/confirm - body legado com "contact" responde 400', async () => {
    const rows = [
      {
        row: 2,
        data: {
          name: supplierName('Confirm Legado'),
          country: null,
          website: null,
          acceptedIncoterms: ['FOB'],
          paymentTermsDays: 30,
          familyIds: [],
          tags: [],
          notes: null,
          contact: {
            name: 'Fulano',
            email: 'fulano.legado@exemplo.com',
            phone: null,
            position: null,
          },
        },
      },
    ];

    const res = await request(app)
      .post('/api/v1/suppliers/import/confirm')
      .set('Cookie', adminCookies)
      .send({ rows });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Envie ao menos uma linha válida/);
  });

  testDbSkip('POST /api/v1/suppliers/import/confirm - race: fornecedor criado entre preview e confirm nao sobrescreve', async () => {
    const name = supplierName('Race');

    const existing = await prisma.supplier.create({
      data: { name, acceptedIncoterms: ['FOB'], status: 'active' },
    });
    const updatedAtBefore = existing.updatedAt;

    const rows = [
      {
        row: 2,
        data: {
          name,
          country: null,
          website: null,
          acceptedIncoterms: ['FOB'],
          paymentTermsDays: 30,
          familyIds: [],
          tags: [],
          notes: null,
          contacts: [],
        },
      },
    ];

    const res = await request(app)
      .post('/api/v1/suppliers/import/confirm')
      .set('Cookie', adminCookies)
      .send({ rows });

    expect(res.status).toBe(200);
    expect(res.body.data.successLines.length).toBe(0);
    expect(res.body.data.errorLines.length).toBe(1);
    expect(res.body.data.errorLines[0].reason).toMatch(/Fornecedor já cadastrado/);

    const count = await prisma.supplier.count({ where: { name } });
    expect(count).toBe(1);

    const stillExisting = await prisma.supplier.findUnique({ where: { id: existing.id } });
    expect(stillExisting?.updatedAt.getTime()).toBe(updatedAtBefore.getTime());
  });
});
