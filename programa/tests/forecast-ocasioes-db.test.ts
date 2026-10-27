import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { ForecastSourceService } from '../src/services/ForecastSourceService';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fo${Date.now()}`;

// Ocasioes que afetam o lead time (PR 1) no banco real. Tudo SINTETICO (repo publico): codigos de pais de uso privado
// (XA..XZ), datas longe do dado real e dos demais testes de forecast.
const U = runId.toUpperCase();
const FONTE_A = `FONTE ${U} A`;
const FONTE_B = `FONTE ${U} B`;
const OBS = `OBSERVACAO SINTETICA ${U}`;
const BASE = '/api/v1/forecast/lead-time-events';

const corpo = (n: number, over: Record<string, unknown> = {}) => ({
  name: `OCASIAO ${U} ${n}`,
  scopeType: 'global',
  startDate: '2037-03-10',
  endDate: '2037-03-15',
  effectValue: 4,
  notes: OBS,
  ...over,
});

describe('Forecast - ocasioes que afetam o lead time (DB)', () => {
  let cookies: string[] = [];
  let adminId = 0;
  let fonteA = 0;
  let fonteB = 0;
  const criadas: number[] = [];

  const post = (body: object) => request(app).post(BASE).set('Cookie', cookies).send(body);
  const logsDe = (id: number) =>
    prisma.auditLog.findMany({
      where: { entityType: 'forecast_lead_time_event', entityId: String(id) },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: {
        name: `Admin Forecast Ocasiao ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    adminId = user.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];

    fonteA = (
      await prisma.forecastSource.create({
        data: { name: FONTE_A, normalizedName: FONTE_A, leadTimeDays: 60, readinessDays: 10 },
      })
    ).id;
    fonteB = (
      await prisma.forecastSource.create({
        data: { name: FONTE_B, normalizedName: FONTE_B, leadTimeDays: 60, isActive: false },
      })
    ).id;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // As ocasioes da fonte saem por cascade ao apagar a fonte; as globais/de pais saem pelo nome.
    await prisma.forecastLeadTimeEvent.deleteMany({ where: { name: { contains: U } } });
    await prisma.forecastSource.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: adminId } });
    if (adminId) {
      await prisma.session.deleteMany({ where: { userId: adminId } });
      await prisma.user.delete({ where: { id: adminId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('migration: registrada como aplicada, coluna, FK em cascade e sem drift nos objetos novos', async () => {
    const aplicadas: Array<{ migration_name: string; finished_at: Date | null }> = await prisma.$queryRaw`
      SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '%forecast_lead_time_event'`;
    expect(aplicadas).toHaveLength(1);
    expect(aplicadas[0].finished_at).not.toBeNull();

    const coluna: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT is_nullable, data_type FROM information_schema.columns
      WHERE table_name = 'ForecastSource' AND column_name = 'countryCode'`;
    expect(coluna).toHaveLength(1);
    expect(coluna[0].is_nullable).toBe('YES');

    const fks: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
      WHERE conrelid = '"ForecastLeadTimeEvent"'::regclass AND contype = 'f'`;
    expect(fks.map((f) => f.conname)).toEqual(['ForecastLeadTimeEvent_sourceId_fkey']);
    // 'c' = CASCADE.
    expect(fks[0].confdeltype).toBe('c');

    const diff = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'diff',
        '--from-url',
        process.env.DATABASE_URL!,
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--script',
      ],
      { encoding: 'utf-8', timeout: 120_000 },
    );
    expect(diff.status, diff.stderr).toBe(0);
    // O diff global nao e vazio por indice parcial antigo (ForecastProductCode); so os objetos deste PR importam.
    expect(diff.stdout).not.toMatch(/ForecastLeadTimeEvent/);
    expect(diff.stdout).not.toMatch(/countryCode/);
  }, 120_000);

  testDbSkip('pais da fonte: PATCH grava em maiusculo e o GET /forecast/sources devolve', async () => {
    const res = await request(app)
      .patch(`/api/v1/forecast/sources/${fonteA}`)
      .set('Cookie', cookies)
      .send({ countryCode: 'xa' });
    expect(res.status).toBe(200);

    const lista = await request(app).get('/api/v1/forecast/sources').set('Cookie', cookies);
    expect(lista.status).toBe(200);
    const fonte = (lista.body.data as Array<{ id: number; countryCode: string | null }>).find((f) => f.id === fonteA);
    expect(fonte?.countryCode).toBe('XA');

    const invalido = await request(app)
      .patch(`/api/v1/forecast/sources/${fonteA}`)
      .set('Cookie', cookies)
      .send({ countryCode: 'X1' });
    expect(invalido.status).toBe(400);
  });

  testDbSkip('ciclo: cria global, pais e fonte; lista com janela; edita; duplicata 409; apaga', async () => {
    const global = await post(corpo(1));
    const pais = await post(corpo(2, { scopeType: 'pais', countryCode: 'xa', component: 'transito' }));
    const fonte = await post(
      corpo(3, { scopeType: 'fonte', sourceId: fonteA, recurrence: 'anual', component: 'prontidao', effectKind: 'percentual', effectValue: 12.5 }),
    );
    for (const res of [global, pais, fonte]) {
      expect(res.status).toBe(201);
      criadas.push(res.body.data.id);
    }
    expect(pais.body.data).toMatchObject({ scopeType: 'pais', countryCode: 'XA', sourceId: null, effectValue: 4 });
    expect(fonte.body.data).toMatchObject({
      sourceId: fonteA,
      source: { id: fonteA, name: FONTE_A, isActive: true },
      effectKind: 'percentual',
      effectValue: 12.5,
      startDate: '2037-03-10',
    });
    expect(JSON.stringify(fonte.body)).not.toMatch(/coverWithStock/);

    // Duplicata ativa (mesmo alcance, periodo e etapa) = 409.
    expect((await post(corpo(1))).status).toBe(409);

    // Sem janela: ocorrencias null. Com janela: a anual aparece em outro ano; a unica de 2037 nao.
    const semJanela = await request(app).get(`${BASE}?scopeType=fonte&sourceId=${fonteA}`).set('Cookie', cookies);
    expect(semJanela.status).toBe(200);
    expect(semJanela.body.data).toHaveLength(1);
    expect(semJanela.body.data[0].ocorrencias).toBeNull();

    const janela2039 = await request(app).get(`${BASE}?de=2039-03-01&ate=2039-03-31`).set('Cookie', cookies);
    const nomes = (janela2039.body.data as Array<{ name: string }>).filter((o) => o.name.includes(U)).map((o) => o.name);
    expect(nomes).toEqual([`OCASIAO ${U} 3`]);
    expect(janela2039.body.data.find((o: { id: number }) => o.id === fonte.body.data.id).ocorrencias).toEqual([
      { inicio: '2039-03-10', fim: '2039-03-15' },
    ]);

    const janela2037 = await request(app).get(`${BASE}?de=2037-03-01&ate=2037-03-31&ativa=true`).set('Cookie', cookies);
    expect((janela2037.body.data as Array<{ name: string }>).filter((o) => o.name.includes(U))).toHaveLength(3);

    // Edita (efeito) e confere o log real do banco: so ids, enums, numeros e datas.
    const id = global.body.data.id as number;
    const editada = await request(app)
      .patch(`${BASE}/${id}`)
      .set('Cookie', cookies)
      .send({ effectKind: 'percentual', effectValue: 10, notes: `${OBS} EDITADA` });
    expect(editada.status).toBe(200);
    expect(editada.body.data).toMatchObject({ effectKind: 'percentual', effectValue: 10 });

    const logs = await logsDe(id);
    expect(logs.map((l) => l.action)).toEqual(['create', 'update']);
    expect(logs[0].performedById).toBe(adminId);
    expect(JSON.stringify(logs)).not.toContain(U);
  });

  testDbSkip('auditoria real: update e delete sem name nem notes', async () => {
    const criada = await post(corpo(4, { startDate: '2037-05-01', endDate: '2037-05-02' }));
    expect(criada.status).toBe(201);
    const id = criada.body.data.id as number;

    const editada = await request(app)
      .patch(`${BASE}/${id}`)
      .set('Cookie', cookies)
      .send({ name: `OCASIAO ${U} 4 EDITADA`, effectKind: 'dias', effectValue: 9 });
    expect(editada.status).toBe(200);
    expect((await request(app).delete(`${BASE}/${id}`).set('Cookie', cookies)).status).toBe(200);

    const logs = await logsDe(id);
    expect(logs.map((l) => l.action)).toEqual(['create', 'update', 'delete']);
    const todos = JSON.stringify(logs);
    expect(todos).not.toContain(U);
    expect(logs[1].beforeData).toMatchObject({ effectValue: 4 });
    expect(logs[1].afterData).toMatchObject({ effectValue: 9 });
    expect(logs[1].metadata).toEqual({ source: 'manual', camposAlterados: ['name', 'effectValue'] });
    expect(logs[2].beforeData).toMatchObject({ effectValue: 9, scopeType: 'global' });

    expect((await request(app).get(`${BASE}?de=2037-05-01&ate=2037-05-31`).set('Cookie', cookies)).body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id })]),
    );
    expect((await request(app).delete(`${BASE}/${id}`).set('Cookie', cookies)).status).toBe(404);
  });

  testDbSkip('fonte inativa ou inexistente -> 400', async () => {
    const inativa = await post(corpo(5, { scopeType: 'fonte', sourceId: fonteB }));
    expect(inativa.status).toBe(400);
    const inexistente = await post(corpo(6, { scopeType: 'fonte', sourceId: 2_000_000_000 }));
    expect(inexistente.status).toBe(400);
  });

  testDbSkip('duplicata de ocasiao inativa nao bloqueia; reativar a duplicada -> 409', async () => {
    const original = await post(corpo(7, { startDate: '2037-07-01', endDate: '2037-07-03' }));
    expect(original.status).toBe(201);
    const copiaInativa = await post(corpo(7, { startDate: '2037-07-01', endDate: '2037-07-03', isActive: false }));
    expect(copiaInativa.status).toBe(201);
    const reativar = await request(app)
      .patch(`${BASE}/${copiaInativa.body.data.id}`)
      .set('Cookie', cookies)
      .send({ isActive: true });
    expect(reativar.status).toBe(409);
  });

  testDbSkip('reimportar a planilha (ForecastSourceService.plan/apply) preserva o countryCode', async () => {
    const draft = {
      name: FONTE_A,
      normalizedName: FONTE_A,
      readinessDays: 20,
      holidaysDays: 0,
      shippingDays: 5,
      transitDays: 30,
      clearanceDays: 5,
      total: 70,
    };
    const plano = await ForecastSourceService.plan(prisma, [draft]);
    expect(plano.items[0].change).toBe('alterada');
    await prisma.$transaction((tx) => ForecastSourceService.apply(tx, plano, adminId));
    const fonte = await prisma.forecastSource.findUniqueOrThrow({ where: { id: fonteA } });
    expect(fonte).toMatchObject({ leadTimeDays: 70, readinessDays: 20, countryCode: 'XA' });
  });

  testDbSkip('apagar a fonte apaga as ocasioes dela (cascade) e preserva as demais', async () => {
    const extra = await prisma.forecastSource.create({
      data: { name: `FONTE ${U} C`, normalizedName: `FONTE ${U} C`, leadTimeDays: 30 },
    });
    const daFonte = await post(corpo(8, { scopeType: 'fonte', sourceId: extra.id, startDate: '2037-09-01', endDate: '2037-09-02' }));
    const global = await post(corpo(9, { startDate: '2037-09-01', endDate: '2037-09-02' }));
    expect(daFonte.status).toBe(201);
    expect(global.status).toBe(201);

    await prisma.forecastSource.delete({ where: { id: extra.id } });
    expect(await prisma.forecastLeadTimeEvent.count({ where: { id: daFonte.body.data.id } })).toBe(0);
    expect(await prisma.forecastLeadTimeEvent.count({ where: { id: global.body.data.id } })).toBe(1);
  });
});
