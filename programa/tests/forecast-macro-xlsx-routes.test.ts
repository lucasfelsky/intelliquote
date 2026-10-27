import exceljs from 'exceljs';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

// O arquivo faz dezenas de logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

// Rota so de leitura: nenhum create/update/upsert em model de forecast, e o modo macro nao consulta cadastro,
// codigos nem demanda (so as marcas de mes atipico).
vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSnapshot: { findFirst: vi.fn() },
    forecastAtypicalMonth: { findMany: vi.fn() },
    forecastPurchaseDecision: { findMany: vi.fn() },
    forecastProduct: { findMany: vi.fn() },
    forecastProductCode: { findMany: vi.fn() },
    forecastCommercialDemand: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock };
  auditLog: { create: Mock };
  forecastSnapshot: { findFirst: Mock };
  forecastAtypicalMonth: { findMany: Mock };
  forecastPurchaseDecision: { findMany: Mock };
  forecastProduct: { findMany: Mock };
  forecastProductCode: { findMany: Mock };
  forecastCommercialDemand: { findMany: Mock };
  $transaction: Mock;
};

type Role = 'admin' | 'comprador' | 'gestor' | 'viewer' | 'comercial';

const PATH = '/api/v1/forecast/snapshots/5/relatorio-compras/xlsx';

// Quinzena SINTETICA de 3 produtos (nenhum dado real). Ids de cadastro 11, 12 e 13.
const produto = (linha: number, productId: number, extra: Record<string, unknown> = {}) => ({
  linha,
  n: linha - 2,
  item: `PRODUTO ${900 + linha}`,
  codigos: [`C9${linha}01`, '', '', '', '', '', ''],
  historico: [100, 200, 300, 400, 500],
  analiseForecast: null,
  obs: '',
  fonte: 'FONTE 901',
  precoFechado: '',
  embalagem: '',
  naoFraciona: '',
  qtdAmostra: '',
  solicitarAmostra: '',
  status: 'nao',
  productId,
  ...extra,
});

const snapshot = () => ({
  id: 5,
  label: '10-2',
  baseDate: new Date('2026-10-15T00:00:00.000Z'),
  half: 2,
  origin: 'planilha',
  months: {
    consumo: ['04', '05', '06', '07', '08', '09', '10 (ATUAL)'],
    chegada: ['10', '11', '12', '01', '02'],
    programacao: ['10', '11', '12', '01'],
  },
  products: [
    produto(3, 11, { precoFechado: 'x' }),
    produto(4, 12, { precoFechado: 'R$ 10' }),
    produto(5, 13),
  ],
  inputs: {
    estoque: [{ codigo: 'C9301', qtd: 50 }],
    vendasMes: [{ codigo: 'C9301', qtd: 90 }],
    vendasAtual: [{ codigo: 'C9401', qtd: 10 }],
    vendasAnual: [{ codigo: 'C9501', qtd: 1200 }],
    programacoes: [{ codigo: 'C9301', qtd: 5, mes: '10' }],
    chegadas: [{ codigo: 'C9401', qtd: 30, mes: '11' }],
    leadtime: [{ fonte: 'FONTE 901', total: 40 }],
    margem: [
      { codigo: 'C9301', margem: 0.3 },
      { codigo: 'C9999', margem: 0.9 },
      { codigo: 'C9401', margem: 0.2 },
    ],
    clientesAtivos: ['C9301', 'C9401', 'C9888'],
  },
  expected: null,
  files: [{ kind: 'planilha', fileName: 'sintetico.xlsx', sha256: 'x', rows: 3 }],
  createdAt: new Date('2026-10-15T12:00:00.000Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.forecastSnapshot.findFirst.mockResolvedValue(snapshot());
  prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([]);
  prismaMock.forecastPurchaseDecision.findMany.mockResolvedValue([]);
});

async function abrir(base64: string): Promise<exceljs.Workbook> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

describe('GET /forecast/snapshots/:id/relatorio-compras/xlsx?layout=macro - papeis e validacao', () => {
  it('sem login -> 401', async () => {
    expect((await request(app).get(`${PATH}?layout=macro`)).status).toBe(401);
  });

  it('comercial -> 403 e nada e lido', async () => {
    const cookies = await loginAs('comercial');
    const response = await request(app).get(`${PATH}?layout=macro`).set('Cookie', cookies);
    expect(response.status).toBe(403);
    expect(prismaMock.forecastSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it.each<Role>(['admin', 'comprador', 'gestor', 'viewer'])('%s -> 200', async (role) => {
    const cookies = await loginAs(role);
    const response = await request(app).get(`${PATH}?layout=macro&hoje=2026-10-20`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.fileName).toBe('forecast-macro-10-2-2026-10-20.xlsx');
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('id e hoje invalidos -> 400; layout desconhecido -> 400 com a mensagem do Zod', async () => {
    const cookies = await loginAs('viewer');
    const idRuim = await request(app)
      .get('/api/v1/forecast/snapshots/abc/relatorio-compras/xlsx?layout=macro')
      .set('Cookie', cookies);
    expect(idRuim.status).toBe(400);
    const hojeRuim = await request(app).get(`${PATH}?layout=macro&hoje=2026-13-01`).set('Cookie', cookies);
    expect(hojeRuim.status).toBe(400);
    const layoutRuim = await request(app).get(`${PATH}?layout=pdf`).set('Cookie', cookies);
    expect(layoutRuim.status).toBe(400);
    expect(JSON.stringify(layoutRuim.body)).toContain('Layout invalido (use relatorio ou macro).');
    expect(prismaMock.forecastSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('quinzena inexistente -> 404 e a consulta filtra deletedAt', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${PATH}?layout=macro`).set('Cookie', cookies);
    expect(response.status).toBe(404);
    expect(prismaMock.forecastSnapshot.findFirst).toHaveBeenCalledWith({ where: { id: 5, deletedAt: null } });
  });
});

describe('GET /forecast/snapshots/:id/relatorio-compras/xlsx?layout=macro - conteudo', () => {
  it('arquivo com 3 linhas de produto, preco fechado so como X e MARGEM so com o que o AR usa', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${PATH}?layout=macro&hoje=2026-10-20`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    const wb = await abrir(response.body.data.contentBase64);
    const ws = wb.getWorksheet('FORECAST (MACRO)')!;
    expect(ws.getCell('I3').value).toBe('PRODUTO 903');
    expect(ws.getCell('I5').value).toBe('PRODUTO 905');
    expect(ws.getCell('I6').value).toBeNull();
    expect(ws.getCell('AV3').value).toBe('X');
    expect(ws.getCell('AV4').value).toBeNull();
    const margem = wb.getWorksheet('MARGEM')!;
    const codigos: string[] = [];
    margem.eachRow((row, r) => {
      if (r >= 2) codigos.push(String(row.getCell('A').value));
    });
    expect(codigos).toEqual(['C9301', 'C9401']);
    expect((ws.getCell('Q3').value as { formula: string }).formula).toBe('(M3+N3+O3)/3');
  });

  it('marca de mes atipico do cadastro atual entra na formula da media (2026-07 = coluna M)', async () => {
    prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([
      { productId: 11, yearMonth: '2026-07', reason: 'sintetico' },
    ]);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${PATH}?layout=macro&hoje=2026-10-20`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    const ws = (await abrir(response.body.data.contentBase64)).getWorksheet('FORECAST (MACRO)')!;
    expect((ws.getCell('Q3').value as { formula: string }).formula).toBe('(N3+O3)/2');
    expect((ws.getCell('Q4').value as { formula: string }).formula).toBe('(M4+N4+O4)/3');
    expect(prismaMock.forecastAtypicalMonth.findMany).toHaveBeenCalledTimes(1);
  });

  it('so le a quinzena e as marcas: nada de cadastro, codigos, demanda nem escrita', async () => {
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${PATH}?layout=macro&hoje=2026-10-20`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(prismaMock.forecastProduct.findMany).not.toHaveBeenCalled();
    expect(prismaMock.forecastProductCode.findMany).not.toHaveBeenCalled();
    expect(prismaMock.forecastCommercialDemand.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('GET /forecast/snapshots/:id/relatorio-compras/xlsx - caminho atual intacto', () => {
  it.each(['', '?layout=relatorio'])('sem layout ou layout=relatorio (%s) devolve o relatorio de compras', async (qs) => {
    prismaMock.forecastProduct.findMany.mockResolvedValue([]);
    prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
    prismaMock.forecastCommercialDemand.findMany.mockResolvedValue([]);
    const cookies = await loginAs('viewer');
    const response = await request(app).get(`${PATH}${qs}${qs ? '&' : '?'}hoje=2026-10-20`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(response.body.data.fileName.startsWith('relatorio-compras-')).toBe(true);
    const wb = await abrir(response.body.data.contentBase64);
    expect(wb.getWorksheet('FORECAST (MACRO)')).toBeUndefined();
  });
});

async function loginAs(role: Role) {
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
    .send({ email: `${role}@intelliquote.local`, password: 'ChangeMe123!' });

  return loginResponse.headers['set-cookie'];
}
