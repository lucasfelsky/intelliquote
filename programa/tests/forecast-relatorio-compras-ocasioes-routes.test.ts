import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceljs from 'exceljs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLUNAS_OCASIOES_XLSX } from '../src/utils/forecastRelatorioComprasOcasioesXlsx';
import { normalizeSourceName } from '../src/utils/forecastWorkbook';
import type { Quinzena } from '../src/utils/forecastTypes';
import { hashPassword } from '../src/utils/password';

// O arquivo faz varios logins: sobe o limite do rate limit de /auth/login.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    forecastSource: { findMany: vi.fn() },
    forecastLeadTimeEvent: { findMany: vi.fn() },
    forecastProduct: { findMany: vi.fn() },
    forecastAtypicalMonth: { findMany: vi.fn() },
    forecastCommercialDemand: { findMany: vi.fn() },
    forecastPurchaseDecision: { findMany: vi.fn() },
    forecastProductCode: { findMany: vi.fn() },
    forecastSnapshot: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});

import { app } from '../src/app';
import { logger } from '../src/lib/logger';
import { prisma } from '../src/lib/prisma';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  user: { findUnique: Mock; findFirst: Mock };
  session: { create: Mock };
  auditLog: { create: Mock };
  forecastSource: { findMany: Mock };
  forecastLeadTimeEvent: { findMany: Mock };
  forecastProduct: { findMany: Mock };
  forecastAtypicalMonth: { findMany: Mock };
  forecastCommercialDemand: { findMany: Mock };
  forecastPurchaseDecision: { findMany: Mock };
  forecastProductCode: { findMany: Mock };
  forecastSnapshot: { findFirst: Mock };
};

// Fixture ANONIMIZADA (repo publico): fontes FONTE 001..; ocasioes e cadastro de fontes 100% sinteticos.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const PATH = '/api/v1/forecast/snapshots/7';
const QUERY = '?hoje=2026-10-20';

const chavesDeFonte = [
  ...new Set(fixture.produtos.map((p) => normalizeSourceName(p.fonte)).filter((c) => c !== '')),
].sort();

// Linha do banco (formato do Prisma) da ocasiao: global, lead time inteiro, +5 dias, 01-05/11/2026.
const eventoDoBanco = {
  id: 1,
  name: 'OCASIAO 001',
  scopeType: 'global',
  countryCode: null,
  sourceId: null,
  startDate: new Date('2026-11-01T00:00:00.000Z'),
  endDate: new Date('2026-11-05T00:00:00.000Z'),
  recurrence: 'nenhuma',
  component: 'total',
  effectKind: 'dias',
  effectValue: 5,
  isActive: true,
};

// Cadastro de fontes sintetico (ids 1..N), etapas que somam 30.
const cadastroDeFontes = chavesDeFonte.map((normalizedName, i) => ({
  normalizedName,
  id: i + 1,
  countryCode: 'XA',
  isActive: true,
  readinessDays: 10,
  shippingDays: 5,
  transitDays: 10,
  clearanceDays: 5,
}));

function semChave<T>(valor: T, chaveRemovida: string): T {
  if (Array.isArray(valor)) return valor.map((v) => semChave(v, chaveRemovida)) as unknown as T;
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([chave]) => chave !== chaveRemovida)
        .map(([chave, v]) => [chave, semChave(v, chaveRemovida)]),
    ) as T;
  }
  return valor;
}

async function xlsxDe(response: request.Response): Promise<exceljs.Workbook> {
  const wb = new exceljs.Workbook();
  await wb.xlsx.load(Buffer.from(response.body.data.contentBase64, 'base64') as unknown as ArrayBuffer);
  return wb;
}

// Todas as celulas de texto da aba do relatorio (para achar cabecalhos e linhas do resumo).
function textosDaAba(ws: exceljs.Worksheet): string[] {
  const textos: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'string') textos.push(cell.value);
    });
  });
  return textos;
}

const chamadasDeFonteDoRelatorio = () =>
  prismaMock.forecastSource.findMany.mock.calls.filter(([args]) => args?.where?.normalizedName !== undefined);

describe('Forecast routes - ocasioes no relatorio de compras e na memoria (PR 3)', () => {
  let cookies: string[];
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    prismaMock.forecastAtypicalMonth.findMany.mockResolvedValue([]);
    prismaMock.forecastCommercialDemand.findMany.mockResolvedValue([]);
    prismaMock.forecastPurchaseDecision.findMany.mockResolvedValue([]);
    prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
    prismaMock.forecastProduct.findMany.mockResolvedValue([]);
    prismaMock.forecastLeadTimeEvent.findMany.mockResolvedValue([]);
    prismaMock.forecastSource.findMany.mockImplementation(
      async (args: { where?: { normalizedName?: { in: string[] } } }) =>
        cadastroDeFontes.filter((f) => args?.where?.normalizedName?.in.includes(f.normalizedName)),
    );
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue({
      id: 7,
      label: '10-2',
      baseDate: new Date('2026-10-15T00:00:00.000Z'),
      half: 2,
      origin: 'planilha',
      months: {
        consumo: fixture.mesesConsumo,
        chegada: fixture.mesesChegada,
        programacao: fixture.mesesProgramacao,
      },
      products: fixture.produtos,
      inputs: fixture.entradas,
      expected: null,
      files: [{ kind: 'planilha', fileName: 'quinzena.xlsx', sha256: 'abc', rows: 5 }],
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    cookies = await loginAsViewer();
    // O login nao entra na contagem: dai em diante nenhuma rota de leitura pode auditar.
    prismaMock.auditLog.create.mockClear();
    prismaMock.forecastLeadTimeEvent.findMany.mockClear();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('sem ocasiao ativa: 1 consulta de ocasioes, nenhuma de fontes e nenhuma chave nova (3 rotas)', async () => {
    for (const rota of ['', '/relatorio-compras', '/relatorio-compras/xlsx']) {
      prismaMock.forecastLeadTimeEvent.findMany.mockClear();
      const response = await request(app).get(`${PATH}${rota}${QUERY}`).set('Cookie', cookies);
      expect(response.status).toBe(200);
      const texto = JSON.stringify(response.body);
      expect(texto).not.toContain('"ocasioes"');
      expect(texto).not.toContain('"ocasioesHoje"');
      expect(prismaMock.forecastLeadTimeEvent.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.forecastLeadTimeEvent.findMany.mock.calls[0][0].where).toStrictEqual({ isActive: true });
      expect(chamadasDeFonteDoRelatorio()).toHaveLength(0);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('com ocasiao ativa: exatamente 1 consulta a cada model por requisicao e blocos so informativos', async () => {
    const semOcasioes = {
      snapshot: (await request(app).get(`${PATH}${QUERY}`).set('Cookie', cookies)).body.data,
      relatorio: (await request(app).get(`${PATH}/relatorio-compras${QUERY}`).set('Cookie', cookies)).body.data,
    };

    prismaMock.forecastLeadTimeEvent.findMany.mockResolvedValue([eventoDoBanco]);
    for (const rota of ['', '/relatorio-compras', '/relatorio-compras/xlsx']) {
      prismaMock.forecastLeadTimeEvent.findMany.mockClear();
      prismaMock.forecastSource.findMany.mockClear();
      const response = await request(app).get(`${PATH}${rota}${QUERY}`).set('Cookie', cookies);
      expect(response.status).toBe(200);
      expect(prismaMock.forecastLeadTimeEvent.findMany).toHaveBeenCalledTimes(1);
      const fontes = chamadasDeFonteDoRelatorio();
      expect(fontes).toHaveLength(1);
      expect([...fontes[0][0].where.normalizedName.in].sort()).toStrictEqual(chavesDeFonte);

      if (rota === '') {
        const linhas = response.body.data.linhas as Array<{ ocasioesHoje?: { ocasioes: Array<{ nome: string }> } }>;
        const afetadas = linhas.filter((l) => l.ocasioesHoje);
        expect(afetadas.length).toBeGreaterThan(0);
        expect(afetadas[0].ocasioesHoje?.ocasioes[0].nome).toBe('OCASIAO 001');
        // Campos existentes iguais aos da resposta sem ocasioes.
        expect(semChave(response.body.data, 'ocasioesHoje')).toStrictEqual(semOcasioes.snapshot);
      }
      if (rota === '/relatorio-compras') {
        const { data } = response.body;
        expect(data.ocasioes).toMatchObject({ estado: 'ok', ativas: 1 });
        const itens = data.grupos.flatMap((g: { itens: unknown[] }) => g.itens) as Array<{
          ocasioes?: { ocasioes: Array<{ nome: string }>; extraDias: number };
        }>;
        const afetados = itens.filter((i) => i.ocasioes);
        expect(afetados.length).toBeGreaterThan(0);
        expect(afetados[0].ocasioes?.ocasioes[0].nome).toBe('OCASIAO 001');
        expect(data.ocasioes.itensAfetados).toBe(afetados.length);
        expect(semChave(data, 'ocasioes')).toStrictEqual(semChave(semOcasioes.relatorio, 'ocasioes'));
      }
      if (rota === '/relatorio-compras/xlsx') {
        const wb = await xlsxDe(response);
        const textos = textosDaAba(wb.getWorksheet('Relatório de compras')!);
        for (const coluna of COLUNAS_OCASIOES_XLSX) {
          expect(textos).toContain(coluna);
        }
        expect(textosDaAba(wb.getWorksheet('Por urgência')!)).toContain('Lead time ajustado (dias)');
      }
    }
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('layout macro: nao consulta as ocasioes', async () => {
    prismaMock.forecastLeadTimeEvent.findMany.mockResolvedValue([eventoDoBanco]);
    const response = await request(app).get(`${PATH}/relatorio-compras/xlsx${QUERY}&layout=macro`).set('Cookie', cookies);
    expect(response.status).toBe(200);
    expect(prismaMock.forecastLeadTimeEvent.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['as ocasioes', () => prismaMock.forecastLeadTimeEvent.findMany.mockRejectedValue(new Error('falha OCASIAO 001 FONTE 001'))],
    [
      'as fontes',
      () => {
        prismaMock.forecastLeadTimeEvent.findMany.mockResolvedValue([eventoDoBanco]);
        prismaMock.forecastSource.findMany.mockRejectedValue(new Error('falha OCASIAO 001 FONTE 001'));
      },
    ],
  ])('falha na leitura de %s: 200 nas tres rotas, relatorio indisponivel e log sem texto livre', async (_nome, falhar) => {
    falhar();

    const snapshot = await request(app).get(`${PATH}${QUERY}`).set('Cookie', cookies);
    expect(snapshot.status).toBe(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('"ocasioesHoje"');

    const relatorio = await request(app).get(`${PATH}/relatorio-compras${QUERY}`).set('Cookie', cookies);
    expect(relatorio.status).toBe(200);
    expect(relatorio.body.data.ocasioes).toStrictEqual({ estado: 'indisponivel' });
    const itens = relatorio.body.data.grupos.flatMap((g: { itens: unknown[] }) => g.itens) as Array<Record<string, unknown>>;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => !('ocasioes' in i))).toBe(true);

    const xlsx = await request(app).get(`${PATH}/relatorio-compras/xlsx${QUERY}`).set('Cookie', cookies);
    expect(xlsx.status).toBe(200);
    const textos = textosDaAba((await xlsxDe(xlsx)).getWorksheet('Relatório de compras')!);
    expect(textos).toContain('Ocasiões do lead time indisponíveis agora: o relatório saiu sem elas.');
    expect(textos).not.toContain(COLUNAS_OCASIOES_XLSX[0]);

    expect(warn).toHaveBeenCalledTimes(3);
    for (const [objeto, mensagem] of warn.mock.calls as Array<[Record<string, unknown>, string]>) {
      expect(objeto).toStrictEqual({ snapshotId: 7, erro: 'Error' });
      expect(JSON.stringify([objeto, mensagem])).not.toMatch(/OCASIAO|FONTE|falha/);
    }
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('quinzena inexistente: 404 sem consultar as ocasioes', async () => {
    prismaMock.forecastSnapshot.findFirst.mockResolvedValue(null);
    for (const rota of ['', '/relatorio-compras', '/relatorio-compras/xlsx']) {
      const response = await request(app).get(`${PATH}${rota}${QUERY}`).set('Cookie', cookies);
      expect(response.status).toBe(404);
    }
    expect(prismaMock.forecastLeadTimeEvent.findMany).not.toHaveBeenCalled();
    expect(prismaMock.forecastSource.findMany).not.toHaveBeenCalled();
  });
});

async function loginAsViewer(): Promise<string[]> {
  const passwordHash = await hashPassword('ChangeMe123!');
  const usuario = {
    id: 1,
    name: 'viewer user',
    email: 'viewer@intelliquote.local',
    passwordHash,
    isActive: true,
    role: { name: 'viewer' },
  };
  prismaMock.user.findUnique.mockResolvedValue(usuario);
  prismaMock.user.findFirst.mockResolvedValue(usuario);
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: usuario.email, password: 'ChangeMe123!' });
  return login.headers['set-cookie'] as unknown as string[];
}
