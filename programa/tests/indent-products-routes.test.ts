import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import {
  auditActions,
  auditCall,
  call,
  loginAs,
  prismaMock,
  productRow,
  resetIndentMocks,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

beforeEach(resetIndentMocks);

describe('/api/v1/indent - produtos do catalogo', () => {
  it('GET /products traz supplierCount (so fornecedores ativos) e counts sobre os ativos', async () => {
    prismaMock.indentProduct.findMany.mockResolvedValue([{ ...productRow(), _count: { suppliers: 2 } }]);
    prismaMock.indentProduct.count.mockImplementation(({ where }: { where: { origin?: string } }) =>
      Promise.resolve(where.origin === 'LIVRE' ? 1 : where.origin === 'CADASTRADO' ? 4 : 5),
    );
    const cookie = await loginAs('viewer');

    const res = await call('get', '/products?origin=LIVRE&q=zin', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data[0].supplierCount).toBe(2);
    expect(res.body.data[0]).not.toHaveProperty('_count');
    expect(res.body.counts).toEqual({ total: 5, cadastrado: 4, livre: 1 });
    const args = prismaMock.indentProduct.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ isActive: true, origin: 'LIVRE' });
    const countWheres = prismaMock.indentProduct.count.mock.calls.map((c) => c[0].where);
    expect(countWheres).toContainEqual({ isActive: true, origin: 'CADASTRADO' });
    expect(countWheres).toContainEqual({ isActive: true, origin: 'LIVRE' });
    expect(args.select._count).toEqual({
      select: { suppliers: { where: { supplier: { isActive: true } } } },
    });

    const bad = await call('get', '/products?origin=OUTRO', cookie);
    expect(bad.status).toBe(400);
  });

  it('GET /products/options traz so ativos com id, name, cas e isActive', async () => {
    prismaMock.indentProduct.findMany.mockResolvedValue([{ id: 1, name: 'Zinco', cas: null, isActive: true }]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/products/options', cookie);

    expect(res.status).toBe(200);
    expect(prismaMock.indentProduct.findMany.mock.calls[0][0]).toMatchObject({
      where: { isActive: true },
      take: 2000,
    });
  });

  it('POST /products cria CADASTRADO com nameKey, valida CAS e audita', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/products', cookie, {
      name: 'Ácido  Cítrico',
      cas: '77-92-9',
      synonyms: [' citric acid '],
    });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create.mock.calls[0][0].data).toMatchObject({
      name: 'Ácido Cítrico',
      nameKey: 'acido citrico',
      cas: '77-92-9',
      unit: 'kg',
      synonyms: ['citric acid'],
      origin: 'CADASTRADO',
    });
    expect(auditActions()).toEqual(['indent_product.created']);

    const origem = await call('post', '/products', cookie, { name: 'Outro', origin: 'LIVRE' });
    expect(origem.status).toBe(201);
    expect(tx.indentProduct.create.mock.calls[1][0].data.origin).toBe('CADASTRADO');

    const cas = await call('post', '/products', cookie, { name: 'X', cas: '7792-9' });
    expect(cas.status).toBe(400);
    expect(cas.body.message).toBe('CAS inválido.');
  });

  it('P2002 no produto (nameKey) -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.create.mockRejectedValueOnce(uniqueError(['nameKey']));

    const res = await call('post', '/products', cookie, { name: 'Zinco' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um produto com este nome no Indent.');
  });

  it('PUT /products/:id atualiza e audita; inexistente -> 404', async () => {
    const cookie = await loginAs('gestor');
    tx.indentProduct.update.mockResolvedValue(productRow({ cas: '7440-66-6' }));

    const ok = await call('put', '/products/2', cookie, { cas: '7440-66-6', isActive: true });
    expect(ok.status).toBe(200);
    expect(auditCall('indent_product.updated')).toMatchObject({
      beforeData: expect.objectContaining({ cas: null }),
      afterData: expect.objectContaining({ cas: '7440-66-6' }),
    });

    tx.indentProduct.findUnique.mockResolvedValue(null);
    expect((await call('put', '/products/99', cookie, { notes: 'x' })).status).toBe(404);
  });

  it('POST /products/:id/promote: LIVRE -> CADASTRADO com a nota padrao so se notes era null', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.update.mockResolvedValue(productRow({ origin: 'CADASTRADO' }));

    const semNota = await call('post', '/products/2/promote', cookie);
    expect(semNota.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[0][0].data).toEqual({
      origin: 'CADASTRADO',
      notes: 'Promovido do item livre. Completar CAS e sinônimos',
    });
    expect(auditActions()).toEqual(['indent_product.promoted']);

    tx.indentProduct.findUnique.mockResolvedValue(productRow({ notes: 'Nota existente' }));
    const comNota = await call('post', '/products/2/promote', cookie);
    expect(comNota.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[1][0].data).toEqual({ origin: 'CADASTRADO' });
  });

  it('promover produto ja CADASTRADO -> 409; inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.findUnique.mockResolvedValue(productRow({ origin: 'CADASTRADO' }));

    const jaCadastrado = await call('post', '/products/2/promote', cookie);
    expect(jaCadastrado.status).toBe(409);
    expect(jaCadastrado.body.message).toBe('O produto já está no catálogo.');
    expect(tx.indentProduct.update).not.toHaveBeenCalled();

    tx.indentProduct.findUnique.mockResolvedValue(null);
    expect((await call('post', '/products/99/promote', cookie)).status).toBe(404);
  });

  it('GET /products?inativos=1 inclui inativos no where e nas contagens dos chips', async () => {
    prismaMock.indentProduct.findMany.mockResolvedValue([]);
    prismaMock.indentProduct.count.mockResolvedValue(0);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/products?inativos=1', cookie);

    expect(res.status).toBe(200);
    const where = prismaMock.indentProduct.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('isActive');
    const countWheres = prismaMock.indentProduct.count.mock.calls.map((c) => c[0].where);
    expect(countWheres).toContainEqual({ origin: 'CADASTRADO' });
    expect(countWheres).toContainEqual({ origin: 'LIVRE' });
    expect(countWheres.some((w) => 'isActive' in w)).toBe(false);
  });

  it('PUT /products/:id mantendo o mesmo nome -> 200 com name e nameKey', async () => {
    const cookie = await loginAs('gestor');

    const res = await call('put', '/products/2', cookie, { name: 'Zinco' });

    expect(res.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[0][0].data).toMatchObject({ name: 'Zinco', nameKey: 'zinco' });
    expect(res.body).toMatchObject({ name: 'Zinco', nameKey: 'zinco' });
  });

  it('PUT /products/:id com o nome de outro produto (P2002) -> 409', async () => {
    const cookie = await loginAs('gestor');
    tx.indentProduct.update.mockRejectedValueOnce(uniqueError(['nameKey']));

    const res = await call('put', '/products/2', cookie, { name: 'Ureia técnica' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um produto com este nome no Indent.');
  });

  it('PUT /products/:id inativa e reativa so com isActive e audita', async () => {
    const cookie = await loginAs('comprador');

    tx.indentProduct.update.mockResolvedValueOnce(productRow({ isActive: false }));
    const inativa = await call('put', '/products/2', cookie, { isActive: false });
    expect(inativa.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[0][0].data).toEqual({ isActive: false });

    tx.indentProduct.update.mockResolvedValueOnce(productRow({ isActive: true }));
    const reativa = await call('put', '/products/2', cookie, { isActive: true });
    expect(reativa.status).toBe(200);
    expect(tx.indentProduct.update.mock.calls[1][0].data).toEqual({ isActive: true });

    expect(auditActions()).toEqual(['indent_product.updated', 'indent_product.updated']);
  });
});

describe('/api/v1/indent - exclusao de produto (so sem vinculo)', () => {
  const FIM = 'Inative o produto para tirá-lo das listas de escolha.';
  const MSG_CORRIDA = `Não é possível excluir: o produto passou a ser usado por um fornecedor ou item de solicitação. ${FIM}`;

  function expectNotDeleted() {
    expect(tx.indentProduct.delete).not.toHaveBeenCalled();
    expect(auditActions()).toEqual([]);
  }

  it('DELETE /products/:id sem vinculo -> 204, apaga e audita com beforeData', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('delete', '/products/2', cookie);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(tx.indentProduct.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    expect(tx.indentSupplierProduct.count).toHaveBeenCalledWith({ where: { productId: 2 } });
    expect(tx.indentRequestItem.count).toHaveBeenCalledWith({ where: { productId: 2 } });
    expect(auditActions()).toEqual(['indent_product.deleted']);
    const audit = auditCall('indent_product.deleted');
    expect(audit).toMatchObject({
      entityType: 'indent_product',
      entityId: '2',
      performedById: 7,
      beforeData: expect.objectContaining({ name: 'Zinco', origin: 'LIVRE' }),
    });
    expect(audit?.afterData).toBeUndefined();
  });

  it('DELETE inexistente -> 404, sem delete e sem audit', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.findUnique.mockResolvedValue(null);

    const res = await call('delete', '/products/99', cookie);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Produto não encontrado.');
    expectNotDeleted();
  });

  it('DELETE com vinculo de fornecedor -> 409 com a contagem', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplierProduct.count.mockResolvedValue(2);

    const res = await call('delete', '/products/2', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Não é possível excluir: o produto está vinculado a 2 fornecedores. ${FIM}`);
    expectNotDeleted();
  });

  it('DELETE com vinculo de item de solicitacao -> 409 no singular', async () => {
    const cookie = await loginAs('comprador');
    tx.indentRequestItem.count.mockResolvedValue(1);

    const res = await call('delete', '/products/2', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Não é possível excluir: o produto está vinculado a 1 item de solicitação. ${FIM}`);
    expectNotDeleted();
  });

  it('DELETE com os dois vinculos -> 409 juntando as partes', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplierProduct.count.mockResolvedValue(1);
    tx.indentRequestItem.count.mockResolvedValue(3);

    const res = await call('delete', '/products/2', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      `Não é possível excluir: o produto está vinculado a 1 fornecedor e 3 itens de solicitação. ${FIM}`,
    );
    expectNotDeleted();
  });

  it.each(['P2003', 'P2014'] as const)('DELETE com corrida barrada pela FK (%s) -> 409 e nenhum audit', async (code) => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code, clientVersion: 'test' }),
    );

    const res = await call('delete', '/products/2', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(MSG_CORRIDA);
    expect(auditActions()).toEqual([]);
  });

  it('DELETE com erro inesperado (nao Prisma, nao HttpError) -> 500, sem 409 e sem audit', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.delete.mockRejectedValueOnce(new Error('falha qualquer'));

    const res = await call('delete', '/products/2', cookie);

    expect(res.status).toBe(500);
    expect(auditActions()).toEqual([]);
  });

  it('DELETE com id invalido -> 400', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('delete', '/products/abc', cookie);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ID do produto inválido.');
    expect(tx.indentProduct.findUnique).not.toHaveBeenCalled();
  });
});

describe('/api/v1/indent - importacao do IntelliQuote (somente leitura)', () => {
  function expectSourcesUntouched() {
    for (const source of [
      prismaMock.supplier,
      prismaMock.supplierContact,
      prismaMock.catalogItem,
      tx.supplier,
      tx.supplierContact,
      tx.catalogItem,
    ]) {
      expect(source.create).not.toHaveBeenCalled();
      expect(source.createMany).not.toHaveBeenCalled();
      expect(source.update).not.toHaveBeenCalled();
      expect(source.updateMany).not.toHaveBeenCalled();
      expect(source.delete).not.toHaveBeenCalled();
      expect(source.deleteMany).not.toHaveBeenCalled();
      expect(source.upsert).not.toHaveBeenCalled();
    }
  }

  it('GET /import/suppliers filtra deletedAt null e marca alreadyInIndent pelo nameKey', async () => {
    prismaMock.supplier.findMany.mockResolvedValue([
      { id: 1, name: 'Acme Chemicals', country: 'China' },
      { id: 2, name: 'Nordic Solvents AB', country: 'Suécia' },
    ]);
    prismaMock.supplier.count.mockResolvedValue(2);
    prismaMock.indentSupplier.findMany.mockResolvedValue([{ nameKey: 'acme chemicals' }]);
    const cookie = await loginAs('comprador');

    const res = await call('get', '/import/suppliers?q=ac', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 1, name: 'Acme Chemicals', country: 'China', alreadyInIndent: true },
      { id: 2, name: 'Nordic Solvents AB', country: 'Suécia', alreadyInIndent: false },
    ]);
    expect(prismaMock.supplier.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
    expectSourcesUntouched();
  });

  it('GET /import/products le so itens ativos do catalogo e marca os que ja estao no Indent', async () => {
    prismaMock.catalogItem.findMany.mockResolvedValue([
      { id: 1, commercialName: 'Ácido cítrico', marketName: 'Citric acid' },
    ]);
    prismaMock.catalogItem.count.mockResolvedValue(1);
    prismaMock.indentProduct.findMany.mockResolvedValue([{ nameKey: 'acido citrico' }]);
    const cookie = await loginAs('comprador');

    const res = await call('get', '/import/products', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 1, name: 'Ácido cítrico', marketName: 'Citric acid', alreadyInIndent: true },
    ]);
    expect(prismaMock.catalogItem.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true });
    expectSourcesUntouched();
  });

  it('POST /import/suppliers copia (importedFromIq, IMPORTADO, USD, CFR), deduplica por nameKey e audita', async () => {
    tx.supplier.findMany.mockResolvedValue([
      { id: 1, name: 'Acme Chemicals', country: 'China', contacts: [{ name: 'Wei Zhang' }] },
      { id: 2, name: 'ACME  chemicals', country: null, contacts: [] },
    ]);
    tx.indentSupplier.createManyAndReturn.mockResolvedValue([{ id: 10, nameKey: 'acme chemicals' }]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/import/suppliers', cookie, { ids: [1, 2, 3, 1] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      created: 1,
      skipped: [
        { sourceId: 2, reason: 'duplicado' },
        { sourceId: 3, reason: 'nao_encontrado' },
      ],
    });
    expect(tx.supplier.findMany.mock.calls[0][0].where).toEqual({ id: { in: [1, 2, 3] }, deletedAt: null });
    expect(tx.indentSupplier.createManyAndReturn.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [
        {
          name: 'Acme Chemicals',
          nameKey: 'acme chemicals',
          country: 'China',
          contactName: 'Wei Zhang',
          type: 'IMPORTADO',
          defaultCurrency: 'USD',
          defaultIncoterm: 'CFR',
          importedFromIq: true,
        },
      ],
    });
    expect(auditCall('indent_import.suppliers')).toMatchObject({
      entityType: 'indent_import',
      performedById: 7,
      metadata: {
        sourceIds: [1, 2, 3],
        createdIds: [10],
        skipped: [
          { sourceId: 2, reason: 'duplicado' },
          { sourceId: 3, reason: 'nao_encontrado' },
        ],
      },
    });
    expectSourcesUntouched();
  });

  it('POST /import/suppliers: ja existente no Indent -> duplicado; corrida (skipDuplicates) -> duplicado', async () => {
    tx.supplier.findMany.mockResolvedValue([
      { id: 1, name: 'Acme Chemicals', country: 'China', contacts: [] },
      { id: 2, name: 'Nordic Solvents AB', country: null, contacts: [] },
    ]);
    tx.indentSupplier.findMany.mockResolvedValue([{ nameKey: 'acme chemicals' }]);
    tx.indentSupplier.createManyAndReturn.mockResolvedValue([]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/import/suppliers', cookie, { ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      created: 0,
      skipped: [
        { sourceId: 1, reason: 'duplicado' },
        { sourceId: 2, reason: 'duplicado' },
      ],
    });
  });

  it('POST /import/products copia o nome comercial; nome de mercado diferente vira sinonimo; sem vinculo', async () => {
    tx.catalogItem.findMany.mockResolvedValue([
      { id: 1, commercialName: 'Ácido cítrico', marketName: 'Citric Acid' },
      { id: 2, commercialName: 'Soda cáustica', marketName: 'SODA CAUSTICA' },
    ]);
    tx.indentProduct.createManyAndReturn.mockResolvedValue([
      { id: 20, nameKey: 'acido citrico' },
      { id: 21, nameKey: 'soda caustica' },
    ]);
    const cookie = await loginAs('gestor');

    const res = await call('post', '/import/products', cookie, { ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 2, skipped: [] });
    expect(tx.catalogItem.findMany.mock.calls[0][0].where).toEqual({ id: { in: [1, 2] }, isActive: true });
    expect(tx.indentProduct.createManyAndReturn.mock.calls[0][0].data).toEqual([
      {
        name: 'Ácido cítrico',
        nameKey: 'acido citrico',
        synonyms: ['Citric Acid'],
        notes: 'Copiado do IntelliQuote, sem vínculo',
        origin: 'CADASTRADO',
        importedFromIq: true,
      },
      {
        name: 'Soda cáustica',
        nameKey: 'soda caustica',
        synonyms: [],
        notes: 'Copiado do IntelliQuote, sem vínculo',
        origin: 'CADASTRADO',
        importedFromIq: true,
      },
    ]);
    expect(tx.indentSupplierProduct.createMany).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(['indent_import.products']);
    expectSourcesUntouched();
  });

  it('ids vazio ou com 101 itens -> 400 e nada e lido ou gravado', async () => {
    const cookie = await loginAs('comprador');

    const vazio = await call('post', '/import/suppliers', cookie, { ids: [] });
    expect(vazio.status).toBe(400);

    const demais = await call('post', '/import/products', cookie, {
      ids: Array.from({ length: 101 }, (_, i) => i + 1),
    });
    expect(demais.status).toBe(400);

    const cem = await call('post', '/import/products', cookie, {
      ids: Array.from({ length: 100 }, (_, i) => i + 1),
    });
    expect(cem.status).toBe(200);

    expect(tx.supplier.findMany).not.toHaveBeenCalled();
  });
});
