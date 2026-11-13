import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import {
  auditActions,
  auditCall,
  call,
  loginAs,
  prismaMock,
  resetIndentMocks,
  supplierRow,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

beforeEach(resetIndentMocks);

describe('/api/v1/indent - fornecedores', () => {
  it('GET /suppliers traz products [{id, name, isActive}] (inclusive inativos, por nome) e os contadores de clientes', async () => {
    prismaMock.indentClientSupplierRule.findMany.mockResolvedValue([
      { supplierId: 5, client: { supplierRuleMode: 'APROVADOS' } },
      { supplierId: 5, client: { supplierRuleMode: 'APROVADOS' } },
      { supplierId: 5, client: { supplierRuleMode: 'BLOQUEIO' } },
    ]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/suppliers', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data[0].products).toEqual([
      { id: 1, name: 'Ácido cítrico', isActive: false },
      { id: 2, name: 'Zinco', isActive: true },
    ]);
    expect(res.body.data[0]).toMatchObject({ approvedBy: 2, blockedBy: 1 });
    expect(prismaMock.indentSupplier.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
    expect(prismaMock.indentClientSupplierRule.findMany.mock.calls[0][0].where).toMatchObject({
      client: { isActive: true, supplierRuleMode: { in: ['APROVADOS', 'BLOQUEIO'] } },
    });
  });

  it('GET /suppliers/options lista so ativos (id, name, country)', async () => {
    prismaMock.indentSupplier.findMany.mockResolvedValue([{ id: 5, name: 'Acme', country: 'China' }]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/suppliers/options', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 5, name: 'Acme', country: 'China' }]);
    expect(prismaMock.indentSupplier.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true },
      take: 1000,
    });
  });

  it('POST /suppliers calcula nameKey, usa os padroes do mock e audita', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/suppliers', cookie, { name: '  Acme   Chemicals ', country: 'China' });

    expect(res.status).toBe(201);
    expect(tx.indentSupplier.create.mock.calls[0][0].data).toMatchObject({
      name: 'Acme Chemicals',
      nameKey: 'acme chemicals',
      country: 'China',
      type: 'TRADING',
      defaultCurrency: 'USD',
      defaultIncoterm: 'CFR',
      hasPartnership: false,
    });
    expect(auditActions()).toEqual(['indent_supplier.created']);
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ['sem razao social', {}, 'Informe a razão social.'],
    ['razao social em branco', { name: '   ' }, 'Informe a razão social.'],
    ['moeda invalida', { name: 'X', defaultCurrency: 'BRL' }, 'Moeda inválida.'],
    ['incoterm invalido', { name: 'X', defaultIncoterm: 'EXW' }, 'Incoterm inválido.'],
    ['tipo invalido', { name: 'X', type: 'OUTRO' }, 'Tipo de fornecedor inválido.'],
  ])('POST /suppliers: %s -> 400', async (_motivo, body, message) => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/suppliers', cookie, body);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect(tx.indentSupplier.create).not.toHaveBeenCalled();
  });

  it('P2002 no fornecedor (nameKey) -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.create.mockRejectedValueOnce(uniqueError(['nameKey']));

    const res = await call('post', '/suppliers', cookie, { name: 'Acme Chemicals' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um fornecedor com este nome no Indent.');
  });

  it('PUT /suppliers/:id recalcula nameKey quando o nome muda e devolve 404 se nao existe', async () => {
    const cookie = await loginAs('gestor');

    const ok = await call('put', '/suppliers/5', cookie, { name: 'Ácido  Cítrico Trading' });
    expect(ok.status).toBe(200);
    expect(tx.indentSupplier.update.mock.calls[0][0].data).toMatchObject({
      name: 'Ácido Cítrico Trading',
      nameKey: 'acido citrico trading',
    });

    tx.indentSupplier.findUnique.mockResolvedValue(null);
    const missing = await call('put', '/suppliers/99', cookie, { country: 'X' });
    expect(missing.status).toBe(404);
  });

  it('parceria: log partnership_changed so quando o flag muda', async () => {
    const cookie = await loginAs('comprador');

    tx.indentSupplier.update.mockResolvedValue(supplierRow({ hasPartnership: true }));
    const muda = await call('put', '/suppliers/5', cookie, { hasPartnership: true });
    expect(muda.status).toBe(200);
    expect(auditActions()).toEqual(['indent_supplier.updated', 'indent_supplier.partnership_changed']);
    expect(auditCall('indent_supplier.partnership_changed')).toMatchObject({
      beforeData: { hasPartnership: false },
      afterData: { hasPartnership: true },
    });

    vi.clearAllMocks();
    tx.auditLog.create.mockResolvedValue({});
    tx.indentSupplier.findUnique.mockResolvedValue(supplierRow());
    tx.indentSupplier.update.mockResolvedValue(supplierRow());
    const igual = await call('put', '/suppliers/5', cookie, { hasPartnership: false, country: 'Índia' });
    expect(igual.status).toBe(200);
    expect(auditActions()).toEqual(['indent_supplier.updated']);
  });
});

describe('/api/v1/indent - vinculo fornecedor x produtos', () => {
  it('PUT /suppliers/:id/products substitui o conjunto na mesma transacao e loga before/after ordenados', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(2);
    tx.indentSupplierProduct.findMany.mockResolvedValue([{ productId: 1 }]);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [3, 1, 3] });

    expect(res.status).toBe(200);
    expect(tx.indentProduct.count.mock.calls[0][0].where).toEqual({ id: { in: [3, 1] } });
    expect(tx.indentSupplierProduct.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 5 } });
    expect(tx.indentSupplierProduct.createMany).toHaveBeenCalledWith({
      data: [
        { supplierId: 5, productId: 1 },
        { supplierId: 5, productId: 3 },
      ],
      skipDuplicates: true,
    });
    expect(
      tx.indentSupplierProduct.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.indentSupplierProduct.createMany.mock.invocationCallOrder[0] as number);
    expect(auditActions()).toEqual(['indent_supplier.products_updated']);
    expect(auditCall('indent_supplier.products_updated')).toMatchObject({
      entityType: 'indent_supplier',
      entityId: '5',
      performedById: 7,
      beforeData: { productIds: [1] },
      afterData: { productIds: [1, 3] },
    });
    expect(res.body.products).toEqual([
      { id: 1, name: 'Ácido cítrico', isActive: false },
      { id: 2, name: 'Zinco', isActive: true },
    ]);
  });

  it('conjunto igual ao atual: nenhuma escrita e nenhum log', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(2);
    tx.indentSupplierProduct.findMany.mockResolvedValue([{ productId: 3 }, { productId: 1 }]);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [1, 3] });

    expect(res.status).toBe(200);
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('lista vazia remove todos os vinculos (valido), sem createMany', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplierProduct.findMany.mockResolvedValue([{ productId: 1 }]);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [] });

    expect(res.status).toBe(200);
    expect(tx.indentProduct.count).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.deleteMany).toHaveBeenCalledWith({ where: { supplierId: 5 } });
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(auditCall('indent_supplier.products_updated')).toMatchObject({
      beforeData: { productIds: [1] },
      afterData: { productIds: [] },
    });
  });

  it('produto inexistente -> 400 e NADA e gravado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(1);

    const res = await call('put', '/suppliers/5/products', cookie, { productIds: [1, 999] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Produto inexistente na lista.');
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('1001 produtos -> 400; productIds obrigatorio na rota dedicada; fornecedor inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');

    const demais = await call('put', '/suppliers/5/products', cookie, {
      productIds: Array.from({ length: 1001 }, (_, i) => i + 1),
    });
    expect(demais.status).toBe(400);

    const semCampo = await call('put', '/suppliers/5/products', cookie, {});
    expect(semCampo.status).toBe(400);

    tx.indentSupplier.findUnique.mockResolvedValue(null);
    const missing = await call('put', '/suppliers/99/products', cookie, { productIds: [1] });
    expect(missing.status).toBe(404);
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
  });

  it('POST /suppliers com productIds cria fornecedor e vinculos na MESMA transacao', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(2);

    const res = await call('post', '/suppliers', cookie, { name: 'Acme Chemicals', productIds: [1, 2] });

    expect(res.status).toBe(201);
    expect(prismaMock.__tx).toBe(tx);
    expect(tx.indentSupplier.create).toHaveBeenCalledTimes(1);
    expect(tx.indentSupplierProduct.createMany).toHaveBeenCalledWith({
      data: [
        { supplierId: 5, productId: 1 },
        { supplierId: 5, productId: 2 },
      ],
      skipDuplicates: true,
    });
    expect(tx.indentSupplier.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.indentSupplierProduct.createMany.mock.invocationCallOrder[0] as number,
    );
    expect(auditActions()).toEqual(['indent_supplier.created', 'indent_supplier.products_updated']);
  });

  it('POST /suppliers com produto inexistente falha na mesma transacao (400, sem vinculo)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(0);

    const res = await call('post', '/suppliers', cookie, { name: 'Acme Chemicals', productIds: [999] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Produto inexistente na lista.');
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
  });

  it('PUT /suppliers/:id SEM productIds nao toca em indentSupplierProduct', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('put', '/suppliers/5', cookie, { country: 'Índia' });

    expect(res.status).toBe(200);
    expect(tx.indentSupplierProduct.findMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.deleteMany).not.toHaveBeenCalled();
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(tx.indentProduct.count).not.toHaveBeenCalled();
  });

  it('PUT /suppliers/:id COM productIds aplica o vinculo na mesma transacao', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.count.mockResolvedValue(1);

    const res = await call('put', '/suppliers/5', cookie, { country: 'Índia', productIds: [4] });

    expect(res.status).toBe(200);
    expect(tx.indentSupplierProduct.createMany).toHaveBeenCalledWith({
      data: [{ supplierId: 5, productId: 4 }],
      skipDuplicates: true,
    });
    expect(auditActions()).toEqual(['indent_supplier.updated', 'indent_supplier.products_updated']);
  });
});
