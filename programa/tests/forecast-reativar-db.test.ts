import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastProductService, type ProductDraft } from '../src/services/ForecastProductService';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fr${Date.now()}`;

// Datas longe do dado real e dos demais testes de forecast. Tudo SINTETICO (repo publico).
const BASE_DATE = '2036-05-15';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const U = runId.toUpperCase();
const CODE_X = `${U}X1`; // produto que o import inativa e a tela reativa
const CODE_Y = `${U}Y1`; // produto que fica na planilha
const NAME_X = `PRODUTO ${U} X`;
const NAME_Y = `PRODUTO ${U} Y`;
const MOTIVO = `MOTIVO SINTETICO ${U}`;
const FONTE = `FONTE ${U}`;

const draft = (name: string, codes: string[]): ProductDraft => ({
  name,
  normalizedName: normalizeProductName(name),
  sheetOrder: null,
  sourceKey: null,
  notes: null,
  fixedPriceFlag: false,
  packaging: null,
  noFractioning: false,
  sampleQty: null,
  sampleRequestNote: null,
  codes: codes.map((code, i) => ({ position: i + 1, code })),
});

describe('Forecast - reativar produto (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let productX = 0;
  let productY = 0;
  let snapshotId = 0;

  const reativar = (id: number) =>
    request(app).post(`/api/v1/forecast/products/${id}/reativar`).set('Cookie', cookies).send({});
  const pendentes = async () => {
    const res = await request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/pendentes`).set('Cookie', cookies);
    expect(res.status).toBe(200);
    return res.body.data.itens as Array<{ codigo: string; situacao: string; produtoInativo: { id: number } | null }>;
  };
  const logs = () =>
    prisma.auditLog.findMany({
      where: { entityType: 'forecast_product', entityId: String(productX), action: 'reactivate' },
      orderBy: { id: 'asc' },
    });
  // Reimportacao da planilha so com o produto Y: o X fica ausente e o import o inativa (como no uso real).
  const reimportarSemX = async () => {
    await prisma.$transaction(async (tx) => {
      const plan = await ForecastProductService.plan(tx, [draft(NAME_Y, [CODE_Y])], new Set());
      await ForecastProductService.apply(
        tx,
        { ...plan, inativados: plan.inativados.filter((p) => p.id === productX) },
        new Map(),
        adminId,
      );
    });
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Reativar ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    await prisma.forecastSource.create({ data: { name: FONTE, normalizedName: FONTE, leadTimeDays: 60 } });
    // Produto X ja com as duas marcas (sob demanda e mes atipico), gravadas com ele ATIVO.
    productX = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_X,
          normalizedName: normalizeProductName(NAME_X),
          purchaseOnDemand: true,
          purchaseOnDemandNote: MOTIVO,
          codes: { create: [{ position: 1, code: CODE_X }] },
          atypicalMonths: { create: [{ yearMonth: '2036-01', reason: MOTIVO, createdById: adminId }] },
        },
      })
    ).id;
    productY = (
      await prisma.forecastProduct.create({
        data: {
          name: NAME_Y,
          normalizedName: normalizeProductName(NAME_Y),
          codes: { create: [{ position: 1, code: CODE_Y }] },
        },
      })
    ).id;

    // Quinzena DBCorp so com o codigo X vendendo no mes anterior (qualifica como pendente quando o produto esta inativo).
    snapshotId = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '05-2',
          baseDate: dateKeyToDbDate(BASE_DATE),
          half: 2,
          origin: 'dbcorp',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: [],
          inputs: {
            estoque: [],
            vendasMes: [{ codigo: CODE_X, qtd: 40 }],
            vendasAtual: [],
            vendasAnual: [],
            programacoes: [],
            chegadas: [],
            leadtime: [],
            margem: [],
            clientesAtivos: [],
          },
          files: [],
          createdById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('com o produto ativo o codigo nao e pendente; a reimportacao sem o X o inativa e ele vira produto_inativo', async () => {
    expect((await pendentes()).map((i) => i.codigo)).not.toContain(CODE_X);

    await reimportarSemX();
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productX } })).isActive).toBe(false);
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productY } })).isActive).toBe(true);
    const itens = await pendentes();
    expect(itens.find((i) => i.codigo === CODE_X)).toMatchObject({
      situacao: 'produto_inativo',
      produtoInativo: { id: productX },
    });
  });

  testDbSkip('POST reativar: 200, isActive true, marcas intactas, codigo sai dos pendentes e 1 AuditLog sem texto', async () => {
    const res = await reativar(productX);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: productX, nome: NAME_X, ativo: true, origem: 'planilha', alterado: true });

    const x = await prisma.forecastProduct.findUniqueOrThrow({
      where: { id: productX },
      include: { atypicalMonths: true, codes: true },
    });
    expect(x.isActive).toBe(true);
    expect(x.origin).toBe('planilha');
    expect(x.codes.map((c) => c.code)).toEqual([CODE_X]);
    // As duas marcas gravadas ANTES da inativacao voltam intactas.
    expect(x.purchaseOnDemand).toBe(true);
    expect(x.purchaseOnDemandNote).toBe(MOTIVO);
    expect(x.atypicalMonths.map((m) => [m.yearMonth, m.reason])).toEqual([['2036-01', MOTIVO]]);

    expect((await pendentes()).map((i) => i.codigo)).not.toContain(CODE_X);

    const registros = await logs();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ performedById: adminId, action: 'reactivate', entityType: 'forecast_product' });
    expect(registros[0].metadata).toEqual({ source: 'manual', origem: 'planilha', antes: false, depois: true });
    expect(registros[0].beforeData).toBeNull();
    expect(registros[0].afterData).toBeNull();
    expect(JSON.stringify(registros[0])).not.toContain(U);
  });

  testDbSkip('segunda chamada: 200 alterado:false e nenhum AuditLog novo', async () => {
    const res = await reativar(productX);
    expect(res.status).toBe(200);
    expect(res.body.data.alterado).toBe(false);
    expect(await logs()).toHaveLength(1);
  });

  testDbSkip('duas chamadas simultaneas: 2x 200 e so 1 AuditLog novo', async () => {
    await prisma.forecastProduct.update({ where: { id: productX }, data: { isActive: false } });
    const antes = (await logs()).length;
    const [r1, r2] = await Promise.all([reativar(productX), reativar(productX)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.data.alterado, r2.body.data.alterado].sort()).toEqual([false, true]);
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: productX } })).isActive).toBe(true);
    expect(await logs()).toHaveLength(antes + 1);
  });

  testDbSkip('produto inexistente -> 404 sem AuditLog', async () => {
    const antes = await prisma.auditLog.count({ where: { performedById: adminId, action: 'reactivate' } });
    expect((await reativar(2147483000)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { performedById: adminId, action: 'reactivate' } })).toBe(antes);
  });
});
