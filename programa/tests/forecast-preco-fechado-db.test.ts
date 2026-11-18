import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { dateKeyToDbDate } from '../src/utils/supplierDocumentDates';
import { normalizeProductName } from '../src/utils/forecastWorkbook';
import { hashPassword } from '../src/utils/password';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `pr${Date.now()}`;
const U = runId.toUpperCase();
const nome = (letra: string) => `PRODUTO ${U} ${letra}`;

// Preco fechado do Forecast (cadastro do valor, moeda, incoterm e validade) de ponta a ponta. Tudo SINTETICO (repo publico).
describe('Forecast - preco fechado (DB)', () => {
  let adminCookies: string[] = [];
  let viewerCookies: string[] = [];
  let adminId = 0;
  let viewerId = 0;
  let snapshotId = 0;
  const ids: Record<string, number> = {};

  const lista = (cookies = adminCookies) => request(app).get(`/api/v1/forecast/snapshots/${snapshotId}/precos-fechados`).set('Cookie', cookies);
  const gravar = (productId: number, body: object, cookies = adminCookies) =>
    request(app).put(`/api/v1/forecast/products/${productId}/preco-fechado`).set('Cookie', cookies).send(body);
  const doItem = async (productId: number) => (await lista()).body.data.itens.find((i: { productId: number }) => i.productId === productId);
  const logs = (productId: number) =>
    prisma.auditLog.findMany({ where: { entityType: 'forecast_product', entityId: String(productId), performedById: adminId }, orderBy: { id: 'asc' } });

  const login = async (role: string, email: string) => {
    const r = await prisma.role.upsert({ where: { name: role }, update: {}, create: { name: role } });
    const user = await prisma.user.create({
      data: { name: `${role} ${runId}`, email, passwordHash: await hashPassword('Test1234!'), roleId: r.id },
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    return { id: user.id, cookies: res.headers['set-cookie'] as string[] };
  };

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    const admin = await login('admin', `${runId}-admin@intelliquote.local`);
    adminId = admin.id;
    adminCookies = admin.cookies;
    const viewer = await login('viewer', `${runId}-viewer@intelliquote.local`);
    viewerId = viewer.id;
    viewerCookies = viewer.cookies;

    const criar = async (letra: string, fixedPriceFlag: boolean) =>
      (await prisma.forecastProduct.create({ data: { name: nome(letra), normalizedName: normalizeProductName(nome(letra)), fixedPriceFlag } })).id;
    ids.A = await criar('A', true); // selo, sem preco
    ids.B = await criar('B', false); // sem selo
    ids.C = await criar('C', true); // selo, preco ja cadastrado
    await prisma.forecastProduct.update({
      where: { id: ids.C },
      data: { fixedPrice: 0.412, fixedPriceCurrency: 'EUR', fixedPriceIncoterm: 'FOB', fixedPriceValidUntil: dateKeyToDbDate('2099-01-31') },
    });
    ids.D = await criar('D', true); // selo, fora da quinzena

    const congelado = (linha: number, letra: string) => ({ linha, n: linha - 2, item: nome(letra), codigos: [`${U}${letra}1`, '', '', '', '', '', ''], historico: [], analiseForecast: null, obs: '', fonte: 'F', precoFechado: '', embalagem: '', naoFraciona: '', qtdAmostra: '', solicitarAmostra: '', status: 'nao', productId: ids[letra] });
    snapshotId = (
      await prisma.forecastSnapshot.create({
        data: {
          label: '04-1',
          baseDate: dateKeyToDbDate('2038-04-15'),
          half: 1,
          origin: 'planilha',
          months: {},
          products: [congelado(3, 'A'), congelado(4, 'B'), congelado(5, 'C')],
          inputs: {},
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
    await prisma.auditLog.deleteMany({ where: { performedById: { in: [adminId, viewerId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [adminId, viewerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, viewerId] } } });
    await prisma.$disconnect();
  });

  testDbSkip('lista so os itens DESTA quinzena com o selo no cadastro, com o estado de cada um', async () => {
    const res = await lista();
    expect(res.status).toBe(200);
    expect(res.body.data.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const idsDaLista = res.body.data.itens.map((i: { productId: number }) => i.productId);
    expect(idsDaLista).toEqual([ids.A, ids.C]); // B sem selo; D fora da quinzena
    expect(await doItem(ids.A!)).toMatchObject({ estado: 'sem_valor', valorPorKg: null, moeda: null, incoterm: null, validoAte: null });
    expect(await doItem(ids.C!)).toMatchObject({ estado: 'ok', valorPorKg: 0.412, moeda: 'EUR', incoterm: 'FOB', validoAte: '2099-01-31' });
  });

  testDbSkip('viewer nao le a lista nem grava (403); a lista aberta de produtos nunca traz o valor nem os termos', async () => {
    expect((await lista(viewerCookies)).status).toBe(403);
    expect((await gravar(ids.A!, { valorPorKg: 1, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-01-01' }, viewerCookies)).status).toBe(403);
    for (const cookies of [viewerCookies, adminCookies]) {
      const res = await request(app).get('/api/v1/forecast/products').set('Cookie', cookies);
      expect(res.status).toBe(200);
      const c = (res.body.data as Array<Record<string, unknown>>).find((p) => p.id === ids.C)!;
      expect(c.fixedPriceFlag).toBe(true);
      expect(Object.keys(c).filter((k) => /^fixedPrice(?!Flag)/.test(k))).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('0.412');
    }
  });

  testDbSkip('define o preco: estado ok, colunas gravadas e AuditLog sem o valor', async () => {
    const res = await gravar(ids.A!, { valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ productId: ids.A, estado: 'ok', valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-12-31' });
    const p = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: ids.A! } });
    expect(Number(p.fixedPrice)).toBeCloseTo(1.8425, 4);
    expect(p).toMatchObject({ fixedPriceCurrency: 'USD', fixedPriceIncoterm: 'CFR' });
    expect(await doItem(ids.A!)).toMatchObject({ estado: 'ok' });
    const auditoria = await logs(ids.A!);
    expect(auditoria).toHaveLength(1);
    expect(JSON.stringify(auditoria)).not.toContain('1.8425');
    expect(auditoria[0]!.metadata).toMatchObject({ via: 'preco-fechado', acao: 'definido', depois: { comValor: true, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-12-31' } });
  });

  testDbSkip('alterar registra "alterado"; validade passada e aceita e o item fica vencido', async () => {
    const res = await gravar(ids.A!, { valorPorKg: 2, moeda: 'BRL', incoterm: 'FCA', validoAte: '2020-01-31' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'vencido', moeda: 'BRL', incoterm: 'FCA', validoAte: '2020-01-31' });
    const auditoria = await logs(ids.A!);
    expect(auditoria.at(-1)!.metadata).toMatchObject({ acao: 'alterado', antes: { comValor: true, moeda: 'USD' }, depois: { moeda: 'BRL' } });
    expect(JSON.stringify(auditoria)).not.toMatch(/"valor|1\.8425|"2"/);
  });

  testDbSkip('item sem o selo da planilha: 409; produto inexistente: 404; corpo invalido: 400', async () => {
    expect((await gravar(ids.B!, { valorPorKg: 1, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-01-01' })).status).toBe(409);
    expect((await gravar(2_000_000_000, { valorPorKg: 1, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-01-01' })).status).toBe(404);
    expect((await gravar(ids.A!, { valorPorKg: 0, moeda: 'USD', incoterm: 'CFR', validoAte: '2099-01-01' })).status).toBe(400);
    expect((await prisma.forecastProduct.findUniqueOrThrow({ where: { id: ids.B! } })).fixedPrice).toBeNull();
  });

  testDbSkip('limpar remove o preco: volta a sem_valor e as quatro colunas ficam nulas', async () => {
    const res = await gravar(ids.A!, { limpar: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ estado: 'sem_valor', valorPorKg: null, moeda: null, incoterm: null, validoAte: null });
    const p = await prisma.forecastProduct.findUniqueOrThrow({ where: { id: ids.A! } });
    expect([p.fixedPrice, p.fixedPriceCurrency, p.fixedPriceIncoterm, p.fixedPriceValidUntil]).toEqual([null, null, null, null]);
    expect((await logs(ids.A!)).at(-1)!.metadata).toMatchObject({ acao: 'removido', depois: { comValor: false } });
  });

  testDbSkip('quinzena inexistente na lista: 404', async () => {
    expect((await request(app).get('/api/v1/forecast/snapshots/2000000000/precos-fechados').set('Cookie', adminCookies)).status).toBe(404);
  });
});
