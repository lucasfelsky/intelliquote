import request from 'supertest';
import exceljs from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    catalogItem: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    itemFamily: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
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
  catalogItem: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  itemFamily: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
  $executeRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

const EXISTING_SL5005 = {
  id: 10,
  commercialName: 'HL-200',
  marketName: 'FUMED SILICA HL-200 (@10KG BAG)',
  dbcorpCode: 'SL5005',
};

async function buildSheetBase64(rows: (string | null)[][]): Promise<string> {
  const workbook = new exceljs.Workbook();
  const sheet = workbook.addWorksheet('Planilha1');
  sheet.addRow(['Comercial', 'Mercado', 'NCM', 'DB Code', 'Familia', 'DG', 'Notas']);
  for (const r of rows) sheet.addRow(r);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer).toString('base64');
}

describe('Import de catalogo - codigo DBCorp duplicado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.itemFamily.findMany.mockResolvedValue([]);
    prismaMock.itemFamily.findFirst.mockResolvedValue(null);
    prismaMock.itemFamily.create.mockResolvedValue({ id: 500, name: 'Fam' });
    prismaMock.catalogItem.findMany.mockResolvedValue([]);
    prismaMock.catalogItem.create.mockResolvedValue({ id: 900 });
  });

  describe('preview (POST /catalog-items/import)', () => {
    it('barra linha cujo codigo ja existe em item ativo (normalizado) e cita o item existente', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.findMany.mockResolvedValue([EXISTING_SL5005]);
      const contentBase64 = await buildSheetBase64([
        ['Novo HL', 'MERCADO NOVO 1', '12345678', 'sl5005 ', null, null, null], // linha 2: duplicado
        ['Outro', 'MERCADO NOVO 2', '12345678', 'ZZ9999', null, null, null], // linha 3: ok
      ]);

      const response = await request(app)
        .post('/api/v1/catalog-items/import')
        .set('Cookie', cookies)
        .send({ contentBase64 });

      expect(response.status).toBe(200);
      const { validLines, errorLines } = response.body.data;
      expect(errorLines).toHaveLength(1);
      expect(errorLines[0].row).toBe(2);
      expect(errorLines[0].reason).toContain('SL5005');
      expect(errorLines[0].reason).toContain('#10');
      expect(errorLines[0].reason).toContain('HL-200');
      expect(errorLines[0].reason).toContain('FUMED SILICA HL-200 (@10KG BAG)');
      expect(validLines).toHaveLength(1);
      expect(validLines[0].dbcorpCode).toBe('ZZ9999');
      expect(validLines[0]).not.toHaveProperty('row');
    });

    it('consulta so itens ativos, em uma unica query, com os codigos normalizados', async () => {
      const cookies = await loginAs('comprador');
      const contentBase64 = await buildSheetBase64([
        ['A', 'MERCADO A', null, ' ab1 ', null, null, null],
        ['B', 'MERCADO B', null, 'CD2', null, null, null],
        ['C', 'MERCADO C', null, 'cd2', null, null, null],
      ]);

      const response = await request(app)
        .post('/api/v1/catalog-items/import')
        .set('Cookie', cookies)
        .send({ contentBase64 });

      expect(response.status).toBe(200);
      expect(prismaMock.catalogItem.findMany).toHaveBeenCalledTimes(1);
      const arg = prismaMock.catalogItem.findMany.mock.calls[0][0];
      expect(arg.where.isActive).toBe(true);
      expect(arg.where.dbcorpCode.in.slice().sort()).toEqual(['AB1', 'CD2']);
      expect(arg.where.dbcorpCode.mode).toBe('insensitive');
    });

    it('codigo repetido na planilha: primeira valida, segunda errorLine citando a linha da primeira', async () => {
      const cookies = await loginAs('comprador');
      const contentBase64 = await buildSheetBase64([
        ['Primeira', 'MERCADO P1', null, 'RE5121', null, null, null], // linha 2
        ['Segunda', 'MERCADO P2', null, 're5121', null, null, null], // linha 3
      ]);

      const response = await request(app)
        .post('/api/v1/catalog-items/import')
        .set('Cookie', cookies)
        .send({ contentBase64 });

      expect(response.status).toBe(200);
      const { validLines, errorLines } = response.body.data;
      expect(validLines).toHaveLength(1);
      expect(validLines[0].commercialName).toBe('Primeira');
      expect(errorLines).toHaveLength(1);
      expect(errorLines[0].row).toBe(3);
      expect(errorLines[0].reason).toContain('RE5121');
      expect(errorLines[0].reason).toContain('linha 2');
    });

    it('linha sem codigo e valida; sem nenhum codigo, catalogItem.findMany nao e chamado', async () => {
      const cookies = await loginAs('comprador');
      const contentBase64 = await buildSheetBase64([
        ['Sem codigo 1', 'MERCADO S1', null, null, null, null, null],
        ['Sem codigo 2', 'MERCADO S2', null, '   ', null, null, null],
      ]);

      const response = await request(app)
        .post('/api/v1/catalog-items/import')
        .set('Cookie', cookies)
        .send({ contentBase64 });

      expect(response.status).toBe(200);
      expect(response.body.data.validLines).toHaveLength(2);
      expect(response.body.data.validLines[0].dbcorpCode).toBeNull();
      expect(response.body.data.errorLines).toHaveLength(0);
      expect(prismaMock.catalogItem.findMany).not.toHaveBeenCalled();
    });

    it('errorLines saem ordenadas por linha (validacao e duplicidade misturadas)', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.findMany.mockResolvedValue([EXISTING_SL5005]);
      const contentBase64 = await buildSheetBase64([
        ['Dup', 'MERCADO D', null, 'SL5005', null, null, null], // linha 2: duplicado
        ['', 'MERCADO E', null, null, null, null, null], // linha 3: nome comercial vazio
      ]);

      const response = await request(app)
        .post('/api/v1/catalog-items/import')
        .set('Cookie', cookies)
        .send({ contentBase64 });

      expect(response.status).toBe(200);
      expect(response.body.data.errorLines.map((e: { row: number }) => e.row)).toEqual([2, 3]);
    });
  });

  describe('confirm (POST /catalog-items/import/confirm)', () => {
    it('barra item com codigo existente ativo sem criar item nem familia; item valido do lote e criado', async () => {
      const cookies = await loginAs('comprador');
      prismaMock.catalogItem.findMany.mockResolvedValue([EXISTING_SL5005]);

      const response = await request(app)
        .post('/api/v1/catalog-items/import/confirm')
        .set('Cookie', cookies)
        .send({
          items: [
            {
              commercialName: 'Duplicado',
              marketName: 'MERCADO DUP',
              dbcorpCode: 'sl5005',
              familyName: 'Familia que nao pode nascer',
            },
            { commercialName: 'Valido', marketName: 'MERCADO VAL', dbcorpCode: 'NV1234' },
          ],
        });

      expect(response.status).toBe(200);
      const { successLines, errorLines } = response.body.data;
      expect(errorLines).toHaveLength(1);
      expect(errorLines[0].row).toBe(2);
      expect(errorLines[0].reason).toContain('SL5005');
      expect(errorLines[0].reason).toContain('#10');
      expect(errorLines[0].reason).toContain('HL-200');
      expect(successLines).toHaveLength(1);
      expect(successLines[0].commercialName).toBe('Valido');
      expect(prismaMock.catalogItem.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.catalogItem.create.mock.calls[0][0].data).toMatchObject({
        commercialName: 'Valido',
        dbcorpCode: 'NV1234',
      });
      expect(prismaMock.itemFamily.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.itemFamily.create).not.toHaveBeenCalled();
      const arg = prismaMock.catalogItem.findMany.mock.calls[0][0];
      expect(arg.where.isActive).toBe(true);
    });

    it('dois itens com o mesmo codigo no lote: 1 sucesso + 1 errorLine', async () => {
      const cookies = await loginAs('comprador');

      const response = await request(app)
        .post('/api/v1/catalog-items/import/confirm')
        .set('Cookie', cookies)
        .send({
          items: [
            { commercialName: 'Primeiro', marketName: 'MERCADO 1', dbcorpCode: 'RE5121' },
            { commercialName: 'Segundo', marketName: 'MERCADO 2', dbcorpCode: ' re5121 ' },
          ],
        });

      expect(response.status).toBe(200);
      const { successLines, errorLines } = response.body.data;
      expect(successLines).toHaveLength(1);
      expect(successLines[0].commercialName).toBe('Primeiro');
      expect(errorLines).toHaveLength(1);
      expect(errorLines[0].row).toBe(3);
      expect(errorLines[0].reason).toContain('RE5121');
      expect(errorLines[0].reason).toContain('linha 2');
      expect(prismaMock.catalogItem.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.catalogItem.create.mock.calls[0][0].data.dbcorpCode).toBe('RE5121');
    });

    it('item sem dbcorpCode e criado normalmente, sem consultar duplicidade', async () => {
      const cookies = await loginAs('comprador');

      const response = await request(app)
        .post('/api/v1/catalog-items/import/confirm')
        .set('Cookie', cookies)
        .send({ items: [{ commercialName: 'Sem codigo', marketName: 'MERCADO SC' }] });

      expect(response.status).toBe(200);
      expect(response.body.data.successLines).toHaveLength(1);
      expect(response.body.data.errorLines).toHaveLength(0);
      expect(prismaMock.catalogItem.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.catalogItem.findMany).not.toHaveBeenCalled();
    });
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
    role: {
      name: role,
    },
  });

  prismaMock.user.findFirst.mockResolvedValue({
    id: 1,
    name: `${role} user`,
    email: `${role}@intelliquote.local`,
    isActive: true,
    role: {
      name: role,
    },
  });

  prismaMock.session.create.mockResolvedValue({
    id: 'session-1',
  });

  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: `${role}@intelliquote.local`,
      password: 'ChangeMe123!',
    });

  return loginResponse.headers['set-cookie'];
}
