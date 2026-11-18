import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ForecastPurchaseOrderService } from '../src/services/ForecastPurchaseOrderService';

const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `po${Date.now()}`;

// PO direta do Forecast (item de preco fechado): reserva idempotente, soma na Qtd. final e status. Dados sinteticos.
describe('ForecastPurchaseOrderService (banco)', () => {
  let snapshotId = 0;
  let otherSnapshotId = 0;
  let produtoA = 0;
  let produtoB = 0;
  let produtoC = 0;
  let userId = 0;
  let seq = 0;
  const chave = () => `${runId}-k${(seq += 1)}-abcdefgh`;

  const base = (productId: number, over: Record<string, unknown> = {}) => ({
    snapshotId,
    productId,
    supplierId: null,
    supplierName: 'FORNECEDOR SINTETICO',
    quantityKg: 25000,
    unitPrice: 1.8425,
    currency: 'USD',
    incoterm: 'CFR',
    requestKey: chave(),
    userId,
    ...over,
  });
  const referencia = { sugeridaKg: 24000, demandaKg: 31000, manual: false };
  const decisaoDe = (productId: number, snapshot = snapshotId) =>
    prisma.forecastPurchaseDecision.findUnique({ where: { snapshotId_productId: { snapshotId: snapshot, productId } } });
  const logs = (entityType: string, id: number) =>
    prisma.auditLog.findMany({ where: { entityType, entityId: String(id) }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    const role = await prisma.role.upsert({ where: { name: 'admin' }, update: {}, create: { name: 'admin' } });
    const user = await prisma.user.create({
      data: { name: `Admin PO ${runId}`, email: `${runId}@intelliquote.local`, passwordHash: 'x', roleId: role.id },
    });
    userId = user.id;
    const quinzena = (label: string) =>
      prisma.forecastSnapshot.create({
        data: { label, baseDate: new Date('2031-04-15'), half: 1, origin: 'planilha', months: {}, products: [], inputs: {}, files: [] },
      });
    snapshotId = (await quinzena(`PO ${runId} A`)).id;
    otherSnapshotId = (await quinzena(`PO ${runId} B`)).id;
    const produto = async (n: string) =>
      (await prisma.forecastProduct.create({ data: { name: `PRODUTO ${runId} ${n}`, normalizedName: `PRODUTO ${runId} ${n}` } })).id;
    produtoA = await produto('A');
    produtoB = await produto('B');
    produtoC = await produto('C');
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;
    await prisma.forecastPurchaseOrder.deleteMany({ where: { snapshotId: { in: [snapshotId, otherSnapshotId] } } });
    await prisma.forecastPurchaseDecision.deleteMany({ where: { snapshotId: { in: [snapshotId, otherSnapshotId] } } });
    await prisma.forecastProduct.deleteMany({ where: { id: { in: [produtoA, produtoB, produtoC] } } });
    await prisma.forecastSnapshot.deleteMany({ where: { id: { in: [snapshotId, otherSnapshotId] } } });
    await prisma.auditLog.deleteMany({ where: { performedById: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  testDbSkip('reserva a PO como enviando, sem preco nem fornecedor em texto no AuditLog', async () => {
    const r = await ForecastPurchaseOrderService.reservar(base(produtoA));
    expect(r).toMatchObject({ status: 'enviando', jaExistia: false });
    const po = await prisma.forecastPurchaseOrder.findUniqueOrThrow({ where: { id: r.id } });
    expect(Number(po.unitPrice)).toBeCloseTo(1.8425, 4);
    expect(po.sentAt).toBeNull();
    const auditoria = JSON.stringify(await logs('forecast_purchase_order', r.id));
    expect(auditoria).not.toContain('1.8425');
    expect(auditoria).not.toContain('FORNECEDOR SINTETICO');
    expect(auditoria).toContain('"comPreco":true');
  });

  testDbSkip('a mesma chave nao reserva outra PO (duplo clique) e devolve a existente', async () => {
    const k = chave();
    const a = await ForecastPurchaseOrderService.reservar(base(produtoA, { requestKey: k }));
    const b = await ForecastPurchaseOrderService.reservar(base(produtoA, { requestKey: k }));
    expect(b).toMatchObject({ id: a.id, jaExistia: true });
    expect(await prisma.forecastPurchaseOrder.count({ where: { requestKey: k } })).toBe(1);
  });

  testDbSkip('a mesma chave em outro item da quinzena e recusada (409)', async () => {
    const k = chave();
    await ForecastPurchaseOrderService.reservar(base(produtoA, { requestKey: k }));
    await expect(ForecastPurchaseOrderService.reservar(base(produtoB, { requestKey: k }))).rejects.toMatchObject({ status: 409 });
  });

  testDbSkip('recusa quantidade invalida, chave invalida, quinzena inexistente e produto inexistente', async () => {
    await expect(ForecastPurchaseOrderService.reservar(base(produtoA, { quantityKg: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(ForecastPurchaseOrderService.reservar(base(produtoA, { requestKey: 'curta' }))).rejects.toMatchObject({ status: 400 });
    await expect(ForecastPurchaseOrderService.reservar(base(produtoA, { snapshotId: 2_000_000_000 }))).rejects.toMatchObject({ status: 404 });
    await expect(ForecastPurchaseOrderService.reservar(base(2_000_000_000))).rejects.toMatchObject({ status: 400 });
  });

  testDbSkip('concluir SEM decisao cria a decisao com a quantidade da PO (status po, Qtd. final e data)', async () => {
    const r = await ForecastPurchaseOrderService.reservar(base(produtoA, { quantityKg: 20000 }));
    const c = await ForecastPurchaseOrderService.concluir(r.id, userId, referencia);
    expect(c).toMatchObject({ jaConcluida: false, decisao: 'criada', finalKg: 20000, status: 'po' });
    const d = await decisaoDe(produtoA);
    expect(d).toMatchObject({ status: 'po', suggestedKg: expect.anything(), manuallyIncluded: false });
    expect(Number(d?.quantityKg)).toBe(20000);
    expect(Number(d?.finalKg)).toBe(20000);
    expect(d?.finalAt).not.toBeNull();
    const po = await prisma.forecastPurchaseOrder.findUniqueOrThrow({ where: { id: r.id } });
    expect(po.status).toBe('enviada');
    expect(po.sentAt).not.toBeNull();
    const auditoria = await logs('forecast_purchase_decision', d!.id);
    expect(JSON.stringify(auditoria)).toContain('"via":"po-direta"');
  });

  testDbSkip('a segunda PO do mesmo item SOMA na Qtd. final e mantem finalAt e a quantidade decidida', async () => {
    const antes = await decisaoDe(produtoA);
    const r = await ForecastPurchaseOrderService.reservar(base(produtoA, { quantityKg: 5000.5 }));
    const c = await ForecastPurchaseOrderService.concluir(r.id, userId, referencia);
    expect(c).toMatchObject({ decisao: 'atualizada', finalKg: 25000.5, status: 'po' });
    const depois = await decisaoDe(produtoA);
    expect(Number(depois?.finalKg)).toBe(25000.5);
    expect(Number(depois?.quantityKg)).toBe(20000);
    expect(depois?.finalAt?.getTime()).toBe(antes?.finalAt?.getTime());
  });

  testDbSkip('concluir repetido nao soma de novo', async () => {
    const r = await ForecastPurchaseOrderService.reservar(base(produtoB, { quantityKg: 1000 }));
    await ForecastPurchaseOrderService.concluir(r.id, userId, referencia);
    const de = await ForecastPurchaseOrderService.concluir(r.id, userId, referencia);
    expect(de).toMatchObject({ jaConcluida: true, decisao: 'inalterada' });
    expect(Number((await decisaoDe(produtoB))?.finalKg)).toBe(1000);
  });

  testDbSkip('decisao existente soma sobre a Qtd. final de cotacao e nunca regride o status preco', async () => {
    await prisma.forecastPurchaseDecision.create({
      data: { snapshotId, productId: produtoC, quantityKg: 8000, status: 'preco', suggestedKg: 8000, demandKg: 9000, finalKg: 3000, finalAt: new Date('2031-04-10') },
    });
    const r = await ForecastPurchaseOrderService.reservar(base(produtoC, { quantityKg: 2000 }));
    const c = await ForecastPurchaseOrderService.concluir(r.id, userId, null);
    expect(c).toMatchObject({ decisao: 'atualizada', finalKg: 5000, status: 'preco' });
  });

  testDbSkip('sem decisao e sem referencia: conclui a PO e nao inventa decisao', async () => {
    const r = await ForecastPurchaseOrderService.reservar({ ...base(produtoA), snapshotId: otherSnapshotId });
    const c = await ForecastPurchaseOrderService.concluir(r.id, userId, null);
    expect(c).toMatchObject({ decisao: 'sem_decisao', finalKg: null });
    expect(await decisaoDe(produtoA, otherSnapshotId)).toBeNull();
    expect((await prisma.forecastPurchaseOrder.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('enviada');
  });

  testDbSkip('duas conclusoes concorrentes do mesmo item somam as duas (sem perder quantidade)', async () => {
    const [a, b] = await Promise.all([
      ForecastPurchaseOrderService.reservar({ ...base(produtoA, { quantityKg: 100 }), snapshotId: otherSnapshotId }),
      ForecastPurchaseOrderService.reservar({ ...base(produtoA, { quantityKg: 200 }), snapshotId: otherSnapshotId }),
    ]);
    await prisma.forecastPurchaseDecision.create({
      data: { snapshotId: otherSnapshotId, productId: produtoA, quantityKg: 1, status: 'nao', suggestedKg: 1, demandKg: 1 },
    });
    await Promise.all([
      ForecastPurchaseOrderService.concluir(a.id, userId, referencia),
      ForecastPurchaseOrderService.concluir(b.id, userId, referencia),
    ]);
    expect(Number((await decisaoDe(produtoA, otherSnapshotId))?.finalKg)).toBe(300);
  });

  testDbSkip('falhar so sai de enviando, nao soma nada e nao deixa concluir depois', async () => {
    const r = await ForecastPurchaseOrderService.reservar(base(produtoB, { quantityKg: 777 }));
    expect(await ForecastPurchaseOrderService.falhar(r.id, userId, 'SMTP: conexão recusada')).toBe(true);
    const po = await prisma.forecastPurchaseOrder.findUniqueOrThrow({ where: { id: r.id } });
    expect(po).toMatchObject({ status: 'falhou', failureCode: 'smtp_conexao_recusada' });
    expect(await ForecastPurchaseOrderService.falhar(r.id, userId, 'de novo')).toBe(false);
    await expect(ForecastPurchaseOrderService.concluir(r.id, userId, referencia)).rejects.toMatchObject({ status: 409 });
    expect(Number((await decisaoDe(produtoB))?.finalKg)).toBe(1000);
  });
});
