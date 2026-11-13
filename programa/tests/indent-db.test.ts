import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

// Banco real descartavel (scripts/test-critical-local.mjs aplica as migrations, inclusive
// 20261112120000_indent_cadastros e 20261113140000_indent_cliente_cnpj_opcional). Sem RUN_DB_TESTS=true os testes sao pulados.
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `indent-db-${Date.now()}`;

function cnpjFrom(base12: string): string {
  const calc = (digits: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + Number(digits[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(base12 + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${first}${second}`;
}

describe('IQ Indent - cadastros (DB)', () => {
  let cookies: string[] = [];
  let userId = 0;
  const clientIds: number[] = [];
  const supplierIds: number[] = [];
  const productIds: number[] = [];
  const iqSupplierIds: number[] = [];
  const iqCatalogIds: number[] = [];

  async function api(method: 'get' | 'post' | 'put', path: string, body?: object) {
    const req = request(app)[method](`/api/v1/indent${path}`).set('Cookie', cookies);
    return method === 'get' ? req : req.send(body ?? {});
  }

  async function createSupplier(name: string, extra: Record<string, unknown> = {}) {
    const res = await api('post', '/suppliers', { name, ...extra });
    if (res.status === 201) supplierIds.push(res.body.id);
    return res;
  }

  async function createProduct(name: string, extra: Record<string, unknown> = {}) {
    const res = await api('post', '/products', { name, ...extra });
    if (res.status === 201) productIds.push(res.body.id);
    return res;
  }

  async function ruleRows(clientId: number) {
    const rows = await prisma.indentClientSupplierRule.findMany({
      where: { clientId },
      select: { supplierId: true },
    });
    return rows.map((row) => row.supplierId).sort((a, b) => a - b);
  }

  async function linkRows(supplierId: number) {
    const rows = await prisma.indentSupplierProduct.findMany({
      where: { supplierId },
      select: { productId: true },
    });
    return rows.map((row) => row.productId).sort((a, b) => a - b);
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const adminRole = await prisma.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin' },
    });
    const user = await prisma.user.create({
      data: {
        name: `Admin Indent Test ${runId}`,
        email: `${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: adminRole.id,
      },
    });
    userId = user.id;

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test1234!' });
    cookies = login.headers['set-cookie'];
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.auditLog.deleteMany({ where: { performedById: userId } });
    await prisma.indentClientSupplierRule.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.indentSupplierProduct.deleteMany({
      where: { OR: [{ supplierId: { in: supplierIds } }, { productId: { in: productIds } }] },
    });
    await prisma.indentClient.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.indentSupplier.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.indentProduct.deleteMany({ where: { nameKey: { contains: runId } } });
    await prisma.supplier.deleteMany({ where: { id: { in: iqSupplierIds } } });
    await prisma.catalogItem.deleteMany({ where: { id: { in: iqCatalogIds } } });
    if (userId) {
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  testDbSkip('cliente: CNPJ normalizado e unico (409); regra APROVADOS persiste, troca substitui e LIVRE limpa', async () => {
    const cnpj = cnpjFrom('123456780001');
    const masked = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;

    const created = await api('post', '/clients', { name: `Cliente ${runId}`, cnpj: masked, city: 'Itajaí' });
    expect(created.status).toBe(201);
    clientIds.push(created.body.id);
    expect(created.body.cnpj).toBe(cnpj);

    const duplicate = await api('post', '/clients', { name: 'Outro', cnpj });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe('Já existe um cliente com este CNPJ.');

    const invalid = await api('post', '/clients', { name: 'Invalido', cnpj: '11.222.333/0001-82' });
    expect(invalid.status).toBe(400);

    const a = await createSupplier(`Forn A ${runId}`);
    const b = await createSupplier(`Forn B ${runId}`);
    const c = await createSupplier(`Forn C ${runId}`);
    const clientId = created.body.id as number;

    const aprovados = await api('put', `/clients/${clientId}/supplier-rule`, {
      mode: 'APROVADOS',
      supplierIds: [a.body.id, b.body.id, a.body.id],
      reason: 'Auditoria do cliente',
    });
    expect(aprovados.status).toBe(200);
    expect(await ruleRows(clientId)).toEqual([a.body.id, b.body.id].sort((x, y) => x - y));
    const afterAprovados = await prisma.indentClient.findUnique({ where: { id: clientId } });
    expect(afterAprovados).toMatchObject({ supplierRuleMode: 'APROVADOS', ruleReason: 'Auditoria do cliente' });

    const bloqueio = await api('put', `/clients/${clientId}/supplier-rule`, {
      mode: 'BLOQUEIO',
      supplierIds: [c.body.id],
      reason: 'Lote reprovado',
    });
    expect(bloqueio.status).toBe(200);
    expect(await ruleRows(clientId)).toEqual([c.body.id]);

    const inexistente = await api('put', `/clients/${clientId}/supplier-rule`, {
      mode: 'APROVADOS',
      supplierIds: [c.body.id, 987654321],
      reason: 'x',
    });
    expect(inexistente.status).toBe(400);
    expect(await ruleRows(clientId)).toEqual([c.body.id]);

    const livre = await api('put', `/clients/${clientId}/supplier-rule`, { mode: 'LIVRE', supplierIds: [] });
    expect(livre.status).toBe(200);
    expect(await ruleRows(clientId)).toEqual([]);
    const afterLivre = await prisma.indentClient.findUnique({ where: { id: clientId } });
    expect(afterLivre).toMatchObject({ supplierRuleMode: 'LIVRE', ruleReason: null });

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'indent_client', entityId: String(clientId), action: 'indent_client.rule_updated' },
    });
    expect(logs).toHaveLength(3);

    // A lista de clientes traz as regras e o contador de "Aprovado por / Bloqueado por" sai do banco.
    await api('put', `/clients/${clientId}/supplier-rule`, {
      mode: 'BLOQUEIO',
      supplierIds: [c.body.id],
      reason: 'Lote reprovado',
    });
    const suppliers = await api('get', `/suppliers?q=${encodeURIComponent(`Forn C ${runId}`)}`);
    expect(suppliers.status).toBe(200);
    expect(suppliers.body.data[0]).toMatchObject({ id: c.body.id, approvedBy: 0, blockedBy: 1 });
  });

  testDbSkip('cliente sem CNPJ (H0): varios cnpj null convivem, nome repetido entre eles -> 409, CNPJ preenchido segue unico e completar tira do chip', async () => {
    const a = await api('post', '/clients', { name: `Pendente A ${runId}` });
    const b = await api('post', '/clients', { name: `Pendente B ${runId}`, cnpj: '' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    clientIds.push(a.body.id, b.body.id);
    expect(a.body.cnpj).toBeNull();
    expect(b.body.cnpj).toBeNull();
    expect(await prisma.indentClient.count({ where: { id: { in: [a.body.id, b.body.id] }, cnpj: null } })).toBe(2);

    const repetido = await api('post', '/clients', { name: `PENDENTE   a ${runId}` });
    expect(repetido.status).toBe(409);
    expect(repetido.body.message).toBe('Já existe um cliente sem CNPJ com este nome.');

    const lista = await api('get', '/clients?semCnpj=1&pageSize=100');
    expect(lista.status).toBe(200);
    const ids = (lista.body.data as Array<{ id: number; cnpj: string | null }>).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([a.body.id, b.body.id]));
    expect((lista.body.data as Array<{ cnpj: string | null }>).every((row) => row.cnpj === null)).toBe(true);
    expect(lista.body.counts.semCnpj).toBeGreaterThanOrEqual(2);
    expect(lista.body.counts.todos).toBeGreaterThanOrEqual(lista.body.counts.semCnpj);

    const removido = await api('put', `/clients/${a.body.id}`, { cnpj: null });
    expect(removido.status).toBe(200);

    const cnpj = cnpjFrom('987654320001');
    const completo = await api('put', `/clients/${a.body.id}`, { cnpj });
    expect(completo.status).toBe(200);
    expect(completo.body.cnpj).toBe(cnpj);

    const semRemover = await api('put', `/clients/${a.body.id}`, { cnpj: null });
    expect(semRemover.status).toBe(400);
    expect(semRemover.body.message).toBe('O CNPJ não pode ser removido.');

    const duplicado = await api('put', `/clients/${b.body.id}`, { cnpj });
    expect(duplicado.status).toBe(409);
    expect(duplicado.body.message).toBe('Já existe um cliente com este CNPJ.');

    const depois = await api('get', '/clients?semCnpj=1&pageSize=100');
    expect((depois.body.data as Array<{ id: number }>).map((row) => row.id)).not.toContain(a.body.id);
  });

  testDbSkip('nome repetido so por acento/caixa/espaco -> 409 (fornecedor e produto)', async () => {
    const first = await createProduct(`Ácido  Cítrico ${runId}`);
    expect(first.status).toBe(201);
    const dup = await createProduct(`acido citrico ${runId}`);
    expect(dup.status).toBe(409);

    const s = await createSupplier(`Fornecedor Único ${runId}`);
    expect(s.status).toBe(201);
    const sDup = await createSupplier(`fornecedor  unico ${runId}`);
    expect(sDup.status).toBe(409);
  });

  testDbSkip('vinculo fornecedor x produto: substitui o conjunto, @unique, supplierCount so ativos, inativo continua listado', async () => {
    const supplierA = await createSupplier(`Vinc A ${runId}`);
    const supplierB = await createSupplier(`Vinc B ${runId}`);
    const p1 = await createProduct(`Vinc P1 ${runId}`);
    const p2 = await createProduct(`Vinc P2 ${runId}`);
    const p3 = await createProduct(`Vinc P3 ${runId}`);
    const sA = supplierA.body.id as number;
    const sB = supplierB.body.id as number;
    const ids = { p1: p1.body.id as number, p2: p2.body.id as number, p3: p3.body.id as number };

    const first = await api('put', `/suppliers/${sA}/products`, { productIds: [ids.p1, ids.p2] });
    expect(first.status).toBe(200);
    expect(await linkRows(sA)).toEqual([ids.p1, ids.p2].sort((x, y) => x - y));

    const second = await api('put', `/suppliers/${sA}/products`, { productIds: [ids.p2, ids.p3] });
    expect(second.status).toBe(200);
    expect(await linkRows(sA)).toEqual([ids.p2, ids.p3].sort((x, y) => x - y));

    // @@unique([supplierId, productId]) impede duplicata direta.
    await expect(
      prisma.indentSupplierProduct.create({ data: { supplierId: sA, productId: ids.p2 } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Criar fornecedor ja com produtos (mesma transacao) e conjunto igual (idempotente: nenhum log novo).
    await api('put', `/suppliers/${sB}/products`, { productIds: [ids.p2] });
    const logsBefore = await prisma.auditLog.count({
      where: { entityType: 'indent_supplier', entityId: String(sB), action: 'indent_supplier.products_updated' },
    });
    const same = await api('put', `/suppliers/${sB}/products`, { productIds: [ids.p2] });
    expect(same.status).toBe(200);
    const logsAfter = await prisma.auditLog.count({
      where: { entityType: 'indent_supplier', entityId: String(sB), action: 'indent_supplier.products_updated' },
    });
    expect(logsAfter).toBe(logsBefore);

    const withProducts = await createSupplier(`Vinc C ${runId}`, { productIds: [ids.p1] });
    expect(withProducts.status).toBe(201);
    expect(await linkRows(withProducts.body.id)).toEqual([ids.p1]);

    const missing = await createSupplier(`Vinc D ${runId}`, { productIds: [ids.p1, 987654321] });
    expect(missing.status).toBe(400);
    expect(await prisma.indentSupplier.count({ where: { nameKey: { contains: `vinc d ${runId}` } } })).toBe(0);

    // supplierCount: P2 esta ligado a A e B (ativos) -> 2; inativa B -> 1.
    const list = await api('get', `/products?q=${encodeURIComponent(`Vinc P2 ${runId}`)}`);
    expect(list.body.data[0]).toMatchObject({ id: ids.p2, supplierCount: 2 });
    await api('put', `/suppliers/${sB}`, { isActive: false });
    const afterInactive = await api('get', `/products?q=${encodeURIComponent(`Vinc P2 ${runId}`)}`);
    expect(afterInactive.body.data[0]).toMatchObject({ id: ids.p2, supplierCount: 1 });

    // Produto inativado continua vinculado e listado em products do fornecedor.
    const inactivate = await api('put', `/products/${ids.p3}`, { isActive: false });
    expect(inactivate.status).toBe(200);
    expect(await linkRows(sA)).toEqual([ids.p2, ids.p3].sort((x, y) => x - y));
    const suppliers = await api('get', `/suppliers?q=${encodeURIComponent(`Vinc A ${runId}`)}`);
    const products = suppliers.body.data[0].products as Array<{ id: number; isActive: boolean }>;
    expect(products.find((p) => p.id === ids.p3)).toMatchObject({ isActive: false });
    // ... e salvar sem desmarca-lo mantem o vinculo (nao e 400).
    const keep = await api('put', `/suppliers/${sA}/products`, { productIds: [ids.p2, ids.p3] });
    expect(keep.status).toBe(200);
    expect(await linkRows(sA)).toEqual([ids.p2, ids.p3].sort((x, y) => x - y));

    // Restrict no produto: nao da para apagar produto ligado; Cascade no fornecedor: apagar leva o vinculo.
    // (o Postgres responde 23001 restrict_violation; o Prisma nao o traduz para P2003)
    await expect(prisma.indentProduct.delete({ where: { id: ids.p2 } })).rejects.toThrow(/RESTRICT/);
    await prisma.indentSupplier.delete({ where: { id: withProducts.body.id } });
    expect(await linkRows(withProducts.body.id)).toEqual([]);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'indent_supplier', entityId: String(sA), action: 'indent_supplier.products_updated' },
      orderBy: { id: 'asc' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]?.afterData).toEqual({ productIds: [ids.p1, ids.p2].sort((x, y) => x - y) });
  });

  testDbSkip('parceria: partnership_changed so quando o flag muda; promote de item livre', async () => {
    const supplier = await createSupplier(`Parc ${runId}`);
    const id = supplier.body.id as number;

    await api('put', `/suppliers/${id}`, { hasPartnership: true });
    await api('put', `/suppliers/${id}`, { hasPartnership: true, country: 'Índia' });
    const changed = await prisma.auditLog.count({
      where: { entityType: 'indent_supplier', entityId: String(id), action: 'indent_supplier.partnership_changed' },
    });
    expect(changed).toBe(1);

    const livre = await prisma.indentProduct.create({
      data: {
        name: `Livre ${runId}`,
        nameKey: `livre ${runId}`,
        origin: 'LIVRE',
        sourceRequestNumber: '270/26',
      },
    });
    productIds.push(livre.id);
    const promoted = await api('post', `/products/${livre.id}/promote`);
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({
      origin: 'CADASTRADO',
      notes: 'Promovido do item livre. Completar CAS e sinônimos',
    });
    const again = await api('post', `/products/${livre.id}/promote`);
    expect(again.status).toBe(409);
  });

  testDbSkip('importacao: copia, deduplica, ignora soft-deleted/inativos e nao altera Supplier/CatalogItem', async () => {
    const source = await prisma.supplier.create({
      data: {
        name: `Imp Fornecedor ${runId}`,
        country: 'Suécia',
        contacts: { create: [{ name: 'Contato Principal', email: `${runId}@fornecedor.test`, isPrimary: true }] },
      },
    });
    const deleted = await prisma.supplier.create({
      data: { name: `Imp Apagado ${runId}`, deletedAt: new Date() },
    });
    iqSupplierIds.push(source.id, deleted.id);
    const item = await prisma.catalogItem.create({
      data: { commercialName: `Imp Produto ${runId}`, marketName: `Imp Mercado ${runId}` },
    });
    const inactiveItem = await prisma.catalogItem.create({
      data: { commercialName: `Imp Inativo ${runId}`, marketName: `Imp Inativo Mercado ${runId}`, isActive: false },
    });
    iqCatalogIds.push(item.id, inactiveItem.id);

    const candidates = await api('get', `/import/suppliers?q=${encodeURIComponent(runId)}`);
    expect(candidates.status).toBe(200);
    const names = (candidates.body.data as Array<{ name: string }>).map((row) => row.name);
    expect(names).toContain(`Imp Fornecedor ${runId}`);
    expect(names).not.toContain(`Imp Apagado ${runId}`);

    const res = await api('post', '/import/suppliers', { ids: [source.id, deleted.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 1, skipped: [{ sourceId: deleted.id, reason: 'nao_encontrado' }] });
    const imported = await prisma.indentSupplier.findUnique({ where: { nameKey: `imp fornecedor ${runId}` } });
    expect(imported).toMatchObject({
      country: 'Suécia',
      contactName: 'Contato Principal',
      type: 'IMPORTADO',
      defaultCurrency: 'USD',
      defaultIncoterm: 'CFR',
      importedFromIq: true,
    });
    expect(await linkRows(imported?.id ?? 0)).toEqual([]);

    const again = await api('post', '/import/suppliers', { ids: [source.id] });
    expect(again.body).toEqual({ created: 0, skipped: [{ sourceId: source.id, reason: 'duplicado' }] });

    const prod = await api('post', '/import/products', { ids: [item.id, inactiveItem.id] });
    expect(prod.status).toBe(200);
    expect(prod.body).toEqual({ created: 1, skipped: [{ sourceId: inactiveItem.id, reason: 'nao_encontrado' }] });
    const importedProduct = await prisma.indentProduct.findUnique({ where: { nameKey: `imp produto ${runId}` } });
    expect(importedProduct).toMatchObject({
      origin: 'CADASTRADO',
      importedFromIq: true,
      synonyms: [`Imp Mercado ${runId}`],
      notes: 'Copiado do IntelliQuote, sem vínculo',
    });

    // Origem intacta (updatedAt e dados).
    const sourceAfter = await prisma.supplier.findUnique({ where: { id: source.id } });
    const itemAfter = await prisma.catalogItem.findUnique({ where: { id: item.id } });
    expect(sourceAfter?.updatedAt.getTime()).toBe(source.updatedAt.getTime());
    expect(sourceAfter?.name).toBe(source.name);
    expect(itemAfter?.updatedAt.getTime()).toBe(item.updatedAt.getTime());

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'indent_import', performedById: userId },
      select: { action: true },
    });
    expect(logs.map((log) => log.action)).toEqual(
      expect.arrayContaining(['indent_import.suppliers', 'indent_import.products']),
    );
  });
});
