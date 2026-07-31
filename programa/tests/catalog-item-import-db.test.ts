import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import exceljs from 'exceljs';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `import-db-${Date.now()}`;

describe('CatalogItemImportController (DB)', () => {
  let adminCookies: string[] = [];
  let testFamilyId: number;
  let adminId: number;

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
        name: `Admin Import Test ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash,
        roleId: adminRole.id,
      },
    });
    adminId = user.id;

    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: user.email,
      password: 'Test1234!'
    });
    adminCookies = loginRes.headers['set-cookie'];

    const fam = await prisma.itemFamily.create({
      data: { name: `Família Importação ${runId}` }
    });
    testFamilyId = fam.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    await prisma.catalogItem.deleteMany({
      where: { marketName: { startsWith: `Market Import ${runId}` } }
    });
    if (testFamilyId) {
      await prisma.itemFamily.delete({ where: { id: testFamilyId } });
    }
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('POST /api/v1/catalog-items/import - success and validation', async () => {
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Planilha1');
    sheet.addRow(['Comercial', 'Mercado', 'NCM', 'DB Code', 'Familia', 'DG', 'Notas']);
    
    // Row 2: Valid
    sheet.addRow(['Import C1', `Market Import ${runId} 1`, '12345678', 'db1', `Família Importação ${runId}`, 'sim', 'nota1']);
    // Row 3: Missing marketName
    sheet.addRow(['Import C2', '', '12345678', 'db2', '', 'nao', '']);
    // Row 4: Invalid NCM format
    sheet.addRow(['Import C3', `Market Import ${runId} 3`, '123', 'db3', '', 'nao', '']);
    // Row 5: Family not found
    sheet.addRow(['Import C4', `Market Import ${runId} 4`, '12345678', 'db4', 'Família Inexistente 999', 'nao', '']);
    // Row 6: Empty row should be skipped
    sheet.addRow([]);
    
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = buffer.toString('base64');

    const res = await request(app)
      .post('/api/v1/catalog-items/import')
      .set('Cookie', adminCookies)
      .send({ contentBase64: base64 });

    expect(res.status).toBe(200);
    expect(res.body.data.validLines.length).toBe(1);
    expect(res.body.data.validLines[0].commercialName).toBe('Import C1');
    expect(res.body.data.validLines[0].familyId).toBe(testFamilyId);
    expect(res.body.data.validLines[0].dbcorpCode).toBe('DB1'); // normalized to upper case
    
    expect(res.body.data.errorLines.length).toBe(3);
    expect(res.body.data.errorLines[0].row).toBe(3); // missing marketName
    expect(res.body.data.errorLines[1].row).toBe(4); // invalid NCM format
    expect(res.body.data.errorLines[1].reason).toMatch(/NCM deve ter 8/);
    expect(res.body.data.errorLines[2].row).toBe(5); // family not found
  });

  testDbSkip('POST /api/v1/catalog-items/import/confirm - success and duplicates', async () => {
    const items = [
      { commercialName: 'Import Confirm 1', marketName: `Market Import ${runId} Confirm 1`, ncm: '11111111', isDangerousGood: false },
      { commercialName: 'Import Confirm 2', marketName: `Market Import ${runId} Confirm 1`, ncm: '22222222', isDangerousGood: false } // Duplicate marketName
    ];

    const res = await request(app)
      .post('/api/v1/catalog-items/import/confirm')
      .set('Cookie', adminCookies)
      .send({ items });

    expect(res.status).toBe(200);
    expect(res.body.data.successLines.length).toBe(1);
    expect(res.body.data.successLines[0].commercialName).toBe('Import Confirm 1');
    expect(res.body.data.errorLines.length).toBe(1);
    expect(res.body.data.errorLines[0].reason).toMatch(/Já existe um item de catálogo com o Nome de Mercado fornecido/i);
  });
});
