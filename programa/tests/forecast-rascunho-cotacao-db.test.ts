import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { rotulosDaQuinzena } from '../src/utils/forecastMonths';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `fq${Date.now()}`;

// Rascunho da cotacao do Forecast (E5) no banco real. Tudo SINTETICO (repo publico). Data longe do dado real e dos demais
// testes de forecast.
const BASE_DATE = '2036-06-15';
const rotulos = rotulosDaQuinzena(BASE_DATE);

const U = runId.toUpperCase();
const NAME_A = `PRODUTO ${U} A`;
const NAME_B = `PRODUTO ${U} B`;
const NAME_FORA = `PRODUTO ${U} FORA`;
const OBSERVACAO = `OBSERVACAO SINTETICA ${U}`;
const MIGRATION_SQL = 'prisma/migrations/20261110120000_forecast_quote_draft/migration.sql';

describe('Forecast - rascunho da cotacao (DB)', () => {
  let cookiesAdmin: string[] = [];
  let cookiesComprador: string[] = [];
  let adminId = 0;
  let compradorId = 0;
  let productA = 0;
  let productB = 0;
  let productFora = 0;
  let snapshotId = 0;

  const url = (snapshot: number) => `/api/v1/forecast/snapshots/${snapshot}/rascunho-cotacao`;
  const get = (cookies: string[], snapshot = snapshotId) => request(app).get(url(snapshot)).set('Cookie', cookies);
  const put = (cookies: string[], body: object, snapshot = snapshotId) =>
    request(app).put(url(snapshot)).set('Cookie', cookies).send(body);
  const apagar = (cookies: string[], snapshot = snapshotId) => request(app).delete(url(snapshot)).set('Cookie', cookies);
  const linhas = () => prisma.forecastQuoteDraft.findMany({ where: { snapshotId }, orderBy: { userId: 'asc' } });
  const logs = (draftId: number) =>
    prisma.auditLog.findMany({
      where: { entityType: 'forecast_quote_draft', entityId: String(draftId) },
      orderBy: { id: 'asc' },
    });

  const criarUsuario = async (role: 'admin' | 'comprador', sufixo: string) => {
    const roleRow = await prisma.role.upsert({ where: { name: role }, update: {}, create: { name: role } });
    const user = await prisma.user.create({
      data: {
        name: `Usuario Rascunho ${sufixo} ${runId}`,
        email: `${runId}-${sufixo}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: roleRow.id,
      },
    });
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Test1234!' });
    return { id: user.id, cookies: login.headers['set-cookie'] as unknown as string[] };
  };

  // Quinzena sintetica direto no banco: so os produtos A e B fazem parte dela; `FORA` existe no cadastro mas nao na quinzena.
  const criarQuinzena = async (label: string) =>
    (
      await prisma.forecastSnapshot.create({
        data: {
          label,
          baseDate: dateKeyToDbDate(BASE_DATE),
          half: 2,
          origin: 'planilha',
          months: { consumo: rotulos.consumo, chegada: rotulos.chegada, programacao: rotulos.programacao },
          products: [
            { linha: 3, n: 1, item: NAME_A, productId: productA },
            { linha: 4, n: 2, item: NAME_B, productId: productB },
          ],
          inputs: {},
          files: [],
          createdById: adminId,
        },
      })
    ).id;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const admin = await criarUsuario('admin', 'adm');
    adminId = admin.id;
    cookiesAdmin = admin.cookies;
    const comprador = await criarUsuario('comprador', 'cmp');
    compradorId = comprador.id;
    cookiesComprador = comprador.cookies;

    const criar = async (name: string) =>
      (await prisma.forecastProduct.create({ data: { name, normalizedName: normalizeProductName(name) } })).id;
    productA = await criar(NAME_A);
    productB = await criar(NAME_B);
    productFora = await criar(NAME_FORA);
    snapshotId = await criarQuinzena('06-2');
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    // Os rascunhos saem ANTES das quinzenas e dos usuarios (FKs Restrict).
    const donos = [adminId, compradorId].filter(Boolean);
    await prisma.forecastQuoteDraft.deleteMany({ where: { userId: { in: donos } } });
    await prisma.forecastSnapshot.deleteMany({ where: { createdById: adminId } });
    await prisma.forecastProduct.deleteMany({ where: { name: { contains: U } } });
    await prisma.auditLog.deleteMany({ where: { performedById: { in: donos } } });
    for (const id of donos) {
      await prisma.session.deleteMany({ where: { userId: id } });
      await prisma.user.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('schema: colunas, JSONB, indices e FKs Restrict', async () => {
    const cols: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'ForecastQuoteDraft'`;
    const col = (nome: string) => cols.find((c) => c.column_name === nome);
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['createdAt', 'id', 'items', 'snapshotId', 'updatedAt', 'userId'].sort(),
    );
    expect(col('items')?.data_type).toBe('jsonb');
    for (const nome of ['items', 'snapshotId', 'userId', 'createdAt', 'updatedAt']) {
      expect(col(nome)?.is_nullable, nome).toBe('NO');
    }

    const idx: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ForecastQuoteDraft'`;
    const unico = idx.find((i) => i.indexname === 'ForecastQuoteDraft_snapshotId_userId_key');
    expect(String(unico?.indexdef)).toMatch(/UNIQUE.*\("snapshotId", "userId"\)/);
    expect(idx.some((i) => i.indexname === 'ForecastQuoteDraft_userId_idx')).toBe(true);

    const fks: Array<Record<string, unknown>> = await prisma.$queryRaw`
      SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
      WHERE conrelid = '"ForecastQuoteDraft"'::regclass AND contype = 'f'`;
    expect(fks.map((f) => f.conname).sort()).toEqual([
      'ForecastQuoteDraft_snapshotId_fkey',
      'ForecastQuoteDraft_userId_fkey',
    ]);
    // 'r' = RESTRICT.
    expect(fks.every((f) => f.confdeltype === 'r')).toBe(true);
  });

  testDbSkip('drift: o diff do Prisma nao cita a tabela; a migration reaplicada e idempotente e preserva os dados', async () => {
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
      { encoding: 'utf-8' },
    );
    expect(diff.status, diff.stderr).toBe(0);
    // O diff global nao e vazio por indices parciais que o schema nao modela; so a tabela deste PR importa.
    expect(diff.stdout).not.toMatch(/ForecastQuoteDraft/);

    const antes = await prisma.forecastQuoteDraft.create({
      data: { snapshotId, userId: adminId, items: [{ productId: productA, quantidadeKg: 7, observacao: null }] },
    });
    // So no banco embutido do teste (DATABASE_URL local): reaplica o SQL da migration por cima da tabela ja criada.
    const reaplicar = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'execute', '--file', MIGRATION_SQL, '--url', process.env.DATABASE_URL!],
      { encoding: 'utf-8' },
    );
    expect(reaplicar.status, `${reaplicar.stdout}${reaplicar.stderr}`).toBe(0);
    const depois = await prisma.forecastQuoteDraft.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.items).toEqual([{ productId: productA, quantidadeKg: 7, observacao: null }]);
    await prisma.forecastQuoteDraft.delete({ where: { id: antes.id } });
  }, 120_000);

  testDbSkip('GET sem rascunho devolve data: null', async () => {
    const res = await get(cookiesAdmin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: null });
  });

  let draftAdmin = 0;
  let atualizadoEm = '';

  testDbSkip('create: grava, devolve o rascunho e o AuditLog nao guarda o texto da observacao', async () => {
    const res = await put(cookiesAdmin, {
      itens: [
        { productId: productA, quantidadeKg: 1234.567, observacao: OBSERVACAO },
        { productId: productB, quantidadeKg: 0 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.acao).toBe('create');
    expect(res.body.data.rascunho).toMatchObject({
      snapshotId,
      itens: [
        { productId: productA, quantidadeKg: 1234.567, observacao: OBSERVACAO },
        { productId: productB, quantidadeKg: 0, observacao: null },
      ],
    });
    atualizadoEm = res.body.data.rascunho.atualizadoEm;

    const rows = await linhas();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(adminId);
    draftAdmin = rows[0].id;

    const registros = await logs(draftAdmin);
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ action: 'create', performedById: adminId });
    expect(registros[0].metadata).toMatchObject({ snapshotId, label: '06-2', totalItens: 2, comObservacao: true });
    expect(JSON.stringify(registros[0])).not.toContain(OBSERVACAO);
  });

  testDbSkip('GET devolve o rascunho do proprio usuario', async () => {
    const res = await get(cookiesAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data.itens).toHaveLength(2);
    expect(res.body.data.atualizadoEm).toBe(atualizadoEm);
  });

  testDbSkip('rascunho de outro usuario e invisivel e independente', async () => {
    const outro = await get(cookiesComprador);
    expect(outro.status).toBe(200);
    expect(outro.body).toEqual({ data: null });

    const res = await put(cookiesComprador, { itens: [{ productId: productB, quantidadeKg: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.acao).toBe('create');
    expect(await linhas()).toHaveLength(2);

    // Cada um ve so o proprio.
    const doAdmin = await get(cookiesAdmin);
    expect(doAdmin.body.data.itens).toHaveLength(2);
    const doComprador = await get(cookiesComprador);
    expect(doComprador.body.data.itens).toEqual([{ productId: productB, quantidadeKg: 5, observacao: null }]);

    // Apagar o do comprador nao toca o do admin.
    const del = await apagar(cookiesComprador);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ acao: 'delete', rascunho: null });
    const restantes = await linhas();
    expect(restantes.map((r) => r.userId)).toEqual([adminId]);
  });

  testDbSkip('update: troca os itens, atualiza updatedAt e audita', async () => {
    const res = await put(cookiesAdmin, { itens: [{ productId: productA, quantidadeKg: 10 }], atualizadoEm });
    expect(res.status).toBe(200);
    expect(res.body.data.acao).toBe('update');
    expect(res.body.data.rascunho.itens).toEqual([{ productId: productA, quantidadeKg: 10, observacao: null }]);
    expect(res.body.data.rascunho.atualizadoEm).not.toBe(atualizadoEm);

    const registros = await logs(draftAdmin);
    expect(registros.map((r) => r.action)).toEqual(['create', 'update']);
    expect(registros[1].metadata).toMatchObject({ totalItens: 1, comObservacao: false, antes: { totalItens: 2 } });
  });

  testDbSkip('409: atualizadoEm desatualizado (outra aba) nao grava', async () => {
    const res = await put(cookiesAdmin, { itens: [{ productId: productA, quantidadeKg: 99 }], atualizadoEm });
    expect(res.status).toBe(409);
    const row = await prisma.forecastQuoteDraft.findUniqueOrThrow({ where: { id: draftAdmin } });
    expect(row.items).toEqual([{ productId: productA, quantidadeKg: 10, observacao: null }]);
    expect(await logs(draftAdmin)).toHaveLength(2);
  });

  testDbSkip('sem mudanca -> acao nenhuma, sem novo AuditLog', async () => {
    const res = await put(cookiesAdmin, { itens: [{ productId: productA, quantidadeKg: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.acao).toBe('nenhuma');
    expect(await logs(draftAdmin)).toHaveLength(2);
  });

  testDbSkip('produto de outra quinzena -> 400 e nada muda', async () => {
    const res = await put(cookiesAdmin, {
      itens: [{ productId: productA, quantidadeKg: 1 }, { productId: productFora, quantidadeKg: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Produto fora desta quinzena: ${productFora}.`);
    const row = await prisma.forecastQuoteDraft.findUniqueOrThrow({ where: { id: draftAdmin } });
    expect(row.items).toEqual([{ productId: productA, quantidadeKg: 10, observacao: null }]);
  });

  testDbSkip('produto duplicado -> 400', async () => {
    const res = await put(cookiesAdmin, {
      itens: [{ productId: productA, quantidadeKg: 1 }, { productId: productA, quantidadeKg: 2 }],
    });
    expect(res.status).toBe(400);
  });

  testDbSkip('lista vazia apaga o rascunho (delete) e audita', async () => {
    const res = await put(cookiesAdmin, { itens: [] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ acao: 'delete', rascunho: null });
    expect(await linhas()).toHaveLength(0);
    const registros = await logs(draftAdmin);
    expect(registros.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
    expect((await get(cookiesAdmin)).body).toEqual({ data: null });
  });

  testDbSkip('DELETE sem rascunho -> 200 acao nenhuma', async () => {
    const res = await apagar(cookiesAdmin);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ acao: 'nenhuma', rascunho: null });
  });

  testDbSkip('quinzena inexistente -> 404 em GET, PUT e DELETE', async () => {
    const inexistente = 2_147_483_000;
    expect((await get(cookiesAdmin, inexistente)).status).toBe(404);
    expect((await put(cookiesAdmin, { itens: [{ productId: productA, quantidadeKg: 1 }] }, inexistente)).status).toBe(404);
    expect((await apagar(cookiesAdmin, inexistente)).status).toBe(404);
  });

  testDbSkip('quinzena excluida (soft delete) -> 404 e o rascunho fica guardado, sem aparecer', async () => {
    const res = await put(cookiesAdmin, { itens: [{ productId: productA, quantidadeKg: 3 }] });
    expect(res.status).toBe(200);
    await prisma.forecastSnapshot.update({ where: { id: snapshotId }, data: { deletedAt: new Date() } });

    expect((await get(cookiesAdmin)).status).toBe(404);
    expect((await put(cookiesAdmin, { itens: [{ productId: productA, quantidadeKg: 4 }] })).status).toBe(404);
    expect((await apagar(cookiesAdmin)).status).toBe(404);
    expect(await linhas()).toHaveLength(1);
  });
});
