import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { PrismaClient } from '@prisma/client';
import exceljs from 'exceljs';

const prisma = new PrismaClient();

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;

describe('CatalogItemImportController (DB)', () => {
  let adminToken: string;
  let compradorToken: string;
  let testFamilyId: number;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    
    // Auth bypass mock token for tests
    adminToken = 'MOCK_ADMIN_TOKEN';
    compradorToken = 'MOCK_COMPRADOR_TOKEN';

    const fam = await prisma.itemFamily.create({
      data: { name: 'Teste Família Importação' }
    });
    testFamilyId = fam.id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    await prisma.catalogItem.deleteMany({
      where: { marketName: { startsWith: 'Market Import' } }
    });
    if (testFamilyId) {
      await prisma.itemFamily.delete({ where: { id: testFamilyId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('POST /api/v1/catalog-items/import - success and validation', async () => {
    const workbook = new exceljs.Workbook();
    const sheet = workbook.addWorksheet('Planilha1');
    sheet.addRow(['Comercial', 'Mercado', 'NCM', 'DB Code', 'Familia', 'DG', 'Notas']);
    
    // Row 2: Valid
    sheet.addRow(['Import C1', 'Market Import 1', '12345678', 'db1', 'Teste Família Importação', 'sim', 'nota1']);
    // Row 3: Missing marketName
    sheet.addRow(['Import C2', '', '12345678', 'db2', '', 'nao', '']);
    // Row 4: Invalid NCM format
    sheet.addRow(['Import C3', 'Market Import 3', '123', 'db3', '', 'nao', '']);
    // Row 5: Family not found
    sheet.addRow(['Import C4', 'Market Import 4', '12345678', 'db4', 'Família Inexistente 999', 'nao', '']);
    
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = buffer.toString('base64');

    const res = await request(app)
      .post('/api/v1/catalog-items/import')
      .set('Authorization', `Bearer ${adminToken}`)
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
      { commercialName: 'Import Confirm 1', marketName: 'Market Import Confirm 1', ncm: '11111111', isDangerousGood: false },
      { commercialName: 'Import Confirm 2', marketName: 'Market Import Confirm 1', ncm: '22222222', isDangerousGood: false } // Duplicate marketName
    ];

    const res = await request(app)
      .post('/api/v1/catalog-items/import/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items });

    expect(res.status).toBe(200);
    expect(res.body.data.successLines.length).toBe(1);
    expect(res.body.data.successLines[0].commercialName).toBe('Import Confirm 1');
    expect(res.body.data.errorLines.length).toBe(1);
    expect(res.body.data.errorLines[0].reason).toMatch(/Unique constraint/i);
  });
});
