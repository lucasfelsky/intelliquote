import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import {
  ENDPOINTS,
  NUMBER_277,
  VALID_BODY,
  YEAR,
  YY,
  auditActions,
  auditCall,
  call,
  clientRow,
  expectNoRequestWrites,
  getApp,
  itemRow,
  listRow,
  loginAs,
  now,
  prismaMock,
  requestRow,
  resetRequestMocks,
  restrictedClient,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

// Solicitacoes do IQ Indent (PR 2): papeis, criar (numeracao, item livre), listar, detalhar e confirmar itens. Usuario logado: id 7, nome = papel.

beforeEach(resetRequestMocks);

describe('/api/v1/indent/requests - autenticacao e papeis', () => {
  it('sem login retorna 401 nos 8 endpoints', async () => {
    const app = await getApp();

    for (const endpoint of ENDPOINTS) {
      const req = request(app)[endpoint.method](`/api/v1/indent${endpoint.path}`);
      const res = endpoint.method === 'get' ? await req : await req.send((endpoint.body ?? {}) as object);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
    }
  });

  describe('comercial recebe 403 nos 8 endpoints de solicitacao', () => {
    it.each(ENDPOINTS)('comercial: $method $path -> 403', async ({ method, path, body }) => {
      const cookie = await loginAs('comercial');
      const res = await call(method, path, cookie, body);
      expect(res.status).toBe(403);
      expectNoRequestWrites();
    });
  });

  it('viewer le (200 nos 5 GETs) e nao escreve (403 nos 3 POSTs)', async () => {
    const cookie = await loginAs('viewer');

    for (const endpoint of ENDPOINTS) {
      const res = await call(endpoint.method, endpoint.path, cookie, endpoint.body);
      expect(res.status, `${endpoint.method} ${endpoint.path}`).toBe(endpoint.leitura ? 200 : 403);
    }

    expectNoRequestWrites();
  });

  it.each(['admin', 'comprador', 'gestor'])('%s cria solicitacao (201)', async (role) => {
    const cookie = await loginAs(role);
    expect((await call('post', '/requests', cookie, VALID_BODY)).status).toBe(201);
  });
});

describe('/api/v1/indent/requests - criar', () => {
  it('grava autoria do usuario logado, origem IQ_INDENT, itens confirmados e o proximo numero da sequencia', async () => {
    const cookie = await loginAs('comprador');
    const res = await call('post', '/requests', cookie, VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.processNumber).toBe(NUMBER_277);
    expect(tx.indentRequest.create).toHaveBeenCalledTimes(1);

    const { data } = tx.indentRequest.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      processNumber: NUMBER_277,
      processYear: YEAR,
      processSeq: 277,
      origin: 'IQ_INDENT',
      clientId: 3,
      ownerName: 'comprador',
      createdById: 7,
      createdByName: 'comprador',
    });
    expect(data.items).toEqual({
      create: [{ productId: 2, description: 'Zinco', quantityKg: 25000, confirmed: true, position: 0 }],
    });

    // Sequencia: INSERT ... ON CONFLICT, SELECT ... FOR UPDATE e UPDATE do lastNumber.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const update = tx.$executeRaw.mock.calls[1] as unknown[];
    expect(update.slice(1)).toEqual([277, YEAR]);

    expect(auditActions()).toEqual(['indent_request.created']);
    expect(auditCall('indent_request.created')).toMatchObject({
      entityType: 'indent_request',
      entityId: '11',
      performedById: 7,
    });
  });

  it('o proximo numero parte do maior entre a sequencia e o maior numero ja gravado', async () => {
    tx.$queryRaw.mockResolvedValue([{ lastNumber: 10 }]);
    tx.indentRequest.aggregate.mockResolvedValue({ _max: { processSeq: 50 } });
    const cookie = await loginAs('comprador');

    expect((await call('post', '/requests', cookie, VALID_BODY)).status).toBe(201);

    const { data } = tx.indentRequest.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ processNumber: `051/${YY}`, processSeq: 51 });
  });

  it('corpo com ownerName ou createdById e recusado (400) e nada e gravado', async () => {
    const cookie = await loginAs('comprador');

    for (const extra of [{ ownerName: 'Outro' }, { createdById: 99 }]) {
      const res = await call('post', '/requests', cookie, { ...VALID_BODY, ...extra });
      expect(res.status).toBe(400);
    }

    expectNoRequestWrites();
  });

  it('item digitado reaproveita o produto de mesmo nameKey, sem criar produto', async () => {
    tx.indentProduct.findMany.mockResolvedValue([{ id: 9, nameKey: 'acido citrico anidro' }]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests', cookie, {
      clientId: 3,
      items: [{ description: '  Ácido   Cítrico  Anidro ', quantityKg: 1500 }],
    });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create).not.toHaveBeenCalled();
    const { data } = tx.indentRequest.create.mock.calls[0][0] as {
      data: { items: { create: Array<Record<string, unknown>> } };
    };
    expect(data.items.create[0]).toMatchObject({ productId: 9, description: 'Ácido Cítrico Anidro' });
  });

  it('item digitado novo vira produto LIVRE com sourceRequestNumber e loga a criacao', async () => {
    tx.indentProduct.findMany.mockResolvedValue([]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests', cookie, {
      clientId: 3,
      items: [{ description: '  Produto   Novo X ', quantityKg: 100 }],
    });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create).toHaveBeenCalledWith({
      data: {
        name: 'Produto Novo X',
        nameKey: 'produto novo x',
        unit: 'kg',
        origin: 'LIVRE',
        sourceRequestNumber: NUMBER_277,
      },
    });
    const { data } = tx.indentRequest.create.mock.calls[0][0] as {
      data: { items: { create: Array<Record<string, unknown>> } };
    };
    expect(data.items.create[0]).toMatchObject({ productId: 31, confirmed: true });
    expect(auditActions()).toEqual(['indent_product.created_from_request', 'indent_request.created']);
    expect(auditCall('indent_product.created_from_request')).toMatchObject({
      entityType: 'indent_product',
      entityId: '31',
      metadata: { processNumber: NUMBER_277 },
    });
  });

  it('duas linhas iguais e novas criam 1 produto e 2 itens', async () => {
    tx.indentProduct.findMany.mockResolvedValue([]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests', cookie, {
      clientId: 3,
      items: [
        { description: 'Produto Novo X', quantityKg: 100 },
        { description: 'produto  novo x', quantityKg: 200 },
      ],
    });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create).toHaveBeenCalledTimes(1);
    const { data } = tx.indentRequest.create.mock.calls[0][0] as {
      data: { items: { create: Array<Record<string, unknown>> } };
    };
    expect(data.items.create).toHaveLength(2);
    expect(data.items.create.map((item) => item.productId)).toEqual([31, 31]);
  });

  it('colisao de numero repete a transacao; a 4a falha vira 409', async () => {
    const cookie = await loginAs('comprador');

    tx.indentRequest.create.mockRejectedValueOnce(uniqueError(['processNumber']));
    expect((await call('post', '/requests', cookie, VALID_BODY)).status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);

    prismaMock.$transaction.mockClear();
    tx.indentRequest.create.mockRejectedValue(uniqueError(['processYear', 'processSeq']));
    const res = await call('post', '/requests', cookie, VALID_BODY);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Não foi possível reservar o número da solicitação. Tente de novo.');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(4);
  });

  it('colisao do nameKey de item livre repete a transacao e passa a reaproveitar o produto', async () => {
    tx.indentProduct.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, nameKey: 'produto novo x' }]);
    tx.indentProduct.create.mockRejectedValueOnce(uniqueError(['nameKey']));
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests', cookie, {
      clientId: 3,
      items: [{ description: 'Produto Novo X', quantityKg: 100 }],
    });

    expect(res.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    const { data } = tx.indentRequest.create.mock.calls[0][0] as {
      data: { items: { create: Array<Record<string, unknown>> } };
    };
    expect(data.items.create[0]).toMatchObject({ productId: 9 });
  });

  it('cliente inexistente ou inativo -> 400', async () => {
    const cookie = await loginAs('comprador');

    tx.indentClient.findUnique.mockResolvedValue(clientRow({ isActive: false }));
    const inativo = await call('post', '/requests', cookie, VALID_BODY);
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toBe('Cliente inexistente ou inativo.');

    tx.indentClient.findUnique.mockResolvedValue(null);
    expect((await call('post', '/requests', cookie, VALID_BODY)).status).toBe(400);
    expectNoRequestWrites();
  });

  it('produto informado inexistente ou inativo -> 400', async () => {
    const cookie = await loginAs('comprador');

    tx.indentProduct.findMany.mockResolvedValue([]);
    const inexistente = await call('post', '/requests', cookie, VALID_BODY);
    expect(inexistente.status).toBe(400);
    expect(inexistente.body.message).toBe('Produto inexistente.');

    tx.indentProduct.findMany.mockResolvedValue([{ id: 2, isActive: false }]);
    const inativo = await call('post', '/requests', cookie, VALID_BODY);
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toBe('Produto inativo no catálogo do Indent.');
    expectNoRequestWrites();
  });

  it('sem itens -> 400 "Inclua ao menos um item."', async () => {
    const cookie = await loginAs('comprador');
    const res = await call('post', '/requests', cookie, { clientId: 3, items: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Inclua ao menos um item.');

    const semDescricao = await call('post', '/requests', cookie, { clientId: 3, items: [{ description: '   ', quantityKg: 10 }] });
    expect(semDescricao.status).toBe(400);
    expect(semDescricao.body.message).toBe('Informe o produto.');
    expectNoRequestWrites();
  });

  it.each([0, -5, 'abc', 1_000_000_001, 1.2345, null])('quantidade %s -> 400', async (quantityKg) => {
    const cookie = await loginAs('comprador');
    const res = await call('post', '/requests', cookie, {
      clientId: 3,
      items: [{ productId: 2, description: 'Zinco', quantityKg }],
    });

    expect(res.status).toBe(400);
    expectNoRequestWrites();
  });

});

describe('/api/v1/indent/requests - listar, detalhar e contar', () => {
  it('GET /requests devolve linhas, counts e kpis', async () => {
    prismaMock.indentRequest.findMany.mockResolvedValue([
      listRow(),
      listRow({
        id: 12,
        status: 'RESPONDIDA',
        quotes: [{ status: 'RESPONDIDA' }, { status: 'ACEITA' }, { status: 'RASCUNHO' }],
      }),
    ]);
    prismaMock.indentRequest.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.status === 'COTACAO') return 4;
      if (where.status === 'RESPONDIDA') return 2;
      if (where.status === 'CONVERTIDA') return 6;
      if (where.origin === 'PIPEDRIVE') return 7;
      if (where.origin === 'IQ_INDENT') return 3;
      if (where.status === 'NOVA') return 5;
      if ('clientId' in where) return 1;
      return 10;
    });
    const cookie = await loginAs('viewer');

    const res = await call('get', '/requests', cookie);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ todas: 10, pipedrive: 7, iq: 3, nova: 5, pendente: 1 });
    expect(res.body.kpis).toEqual({ novas: 5, emCotacao: 4, respondidas: 2, convertidasNoMes: 6 });
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 20, totalItems: 10 });
    expect(res.body.data[0]).toMatchObject({
      id: 11,
      processNumber: NUMBER_277,
      origin: 'IQ_INDENT',
      ownerName: 'comprador',
      status: 'NOVA',
      clientPending: false,
      client: { id: 3, name: 'Cliente Exemplo Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
      itemsSummary: { firstName: 'Zinco', count: 2, totalKg: 25500.5 },
      quotes: { total: 0, answered: 0 },
    });
    expect(res.body.data[1].quotes).toEqual({ total: 3, answered: 2 });

    const convertidas = prismaMock.indentRequest.count.mock.calls.find(
      (c) => (c[0] as { where: { status?: string } }).where.status === 'CONVERTIDA',
    );
    const gte = (convertidas?.[0] as { where: { statusChangedAt: { gte: Date } } }).where.statusChangedAt.gte;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('queueBusinessDays so existe em NOVA, pendente e COTACAO; os demais status devolvem null', async () => {
    prismaMock.indentRequest.findMany.mockResolvedValue([
      listRow({ id: 1, status: 'NOVA' }),
      listRow({ id: 2, status: 'NOVA', clientId: null, client: null }),
      listRow({ id: 3, status: 'COTACAO' }),
      listRow({ id: 4, status: 'RESPONDIDA' }),
      listRow({ id: 5, status: 'CONVERTIDA' }),
      listRow({ id: 6, status: 'PERDIDA' }),
    ]);
    const cookie = await loginAs('comprador');

    const res = await call('get', '/requests', cookie);
    const days = (res.body.data as Array<{ id: number; queueBusinessDays: number | null }>).map((row) => [
      row.id,
      row.queueBusinessDays === null ? null : typeof row.queueBusinessDays,
    ]);

    expect(days).toEqual([
      [1, 'number'],
      [2, 'number'],
      [3, 'number'],
      [4, null],
      [5, null],
      [6, null],
    ]);
    expect(res.body.data[1]).toMatchObject({ clientPending: true, client: null });
  });

  it('filtros e busca viram where no banco', async () => {
    const cookie = await loginAs('comprador');
    const whereOfList = () =>
      (prismaMock.indentRequest.findMany.mock.calls.at(-1)?.[0] as { where: Record<string, unknown> }).where;

    await call('get', '/requests?filter=iq', cookie);
    expect(whereOfList()).toEqual({ origin: 'IQ_INDENT' });

    await call('get', '/requests?filter=pipedrive', cookie);
    expect(whereOfList()).toEqual({ origin: 'PIPEDRIVE' });

    await call('get', '/requests?filter=nova', cookie);
    expect(whereOfList()).toEqual({ status: 'NOVA', clientId: { not: null } });

    await call('get', '/requests?filter=pendente', cookie);
    expect(whereOfList()).toEqual({ clientId: null });

    await call('get', '/requests?q=zinco', cookie);
    const or = whereOfList().OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(4);
    expect(JSON.stringify(or)).toContain('processNumber');
    expect(JSON.stringify(or)).toContain('zinco');
  });

  it('page acima de 10000, pageSize acima de 100 e filter invalido -> 400', async () => {
    const cookie = await loginAs('comprador');

    for (const query of ['page=10001', 'page=0', 'pageSize=101', 'filter=x']) {
      const res = await call('get', `/requests?${query}`, cookie);
      expect(res.status, query).toBe(400);
    }
    expect(prismaMock.indentRequest.findMany).not.toHaveBeenCalled();
  });

  it('GET /requests/new-count ignora cliente pendente', async () => {
    prismaMock.indentRequest.count.mockResolvedValue(3);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/requests/new-count', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 3 });
    expect(prismaMock.indentRequest.count).toHaveBeenCalledWith({
      where: { status: 'NOVA', clientId: { not: null } },
    });
  });

  it('GET /requests/client-options lista so clientes ativos', async () => {
    prismaMock.indentClient.findMany.mockResolvedValue([{ id: 3, name: 'Cliente Exemplo Ltda', city: 'Itajaí' }]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/requests/client-options', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 3, name: 'Cliente Exemplo Ltda', city: 'Itajaí' }]);
    expect(prismaMock.indentClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('GET /requests/:id devolve cliente, itens (com item livre), cotacoes e excecao', async () => {
    prismaMock.indentRequest.findUnique.mockResolvedValue(
      requestRow({
        status: 'COTACAO',
        client: restrictedClient('APROVADOS', [5]),
        items: [itemRow(21, 2), itemRow(22, 4, { product: { id: 4, name: 'Novo', cas: null, origin: 'LIVRE' } })],
        quotes: [
          {
            id: 100,
            status: 'RASCUNHO',
            revision: 1,
            exceptionReason: 'Cliente autorizou',
            exceptionByName: 'comprador',
            exceptionAt: now,
            supplier: { id: 6, name: 'Beta Corp' },
          },
          {
            id: 101,
            status: 'RASCUNHO',
            revision: 1,
            exceptionReason: null,
            exceptionByName: null,
            exceptionAt: null,
            supplier: { id: 5, name: 'Acme Chemicals' },
          },
        ],
      }),
    );
    const cookie = await loginAs('viewer');

    const res = await call('get', '/requests/11', cookie);

    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({
      supplierRuleMode: 'APROVADOS',
      ruleReason: 'Política interna',
      supplierRules: [{ supplierId: 5, name: 'Fornecedor 5' }],
    });
    expect(res.body.items[0]).toMatchObject({ quantityKg: 25000, isFree: false, confirmed: true });
    expect(res.body.items[1]).toMatchObject({ isFree: true, name: 'Novo' });
    expect(res.body.quotes[0].exception).toMatchObject({ reason: 'Cliente autorizou', byName: 'comprador' });
    expect(res.body.quotes[1].exception).toBeNull();
    expect(res.body.queueBusinessDays).toEqual(expect.any(Number));
  });

  it('GET /requests/:id inexistente -> 404 e id invalido -> 400', async () => {
    prismaMock.indentRequest.findUnique.mockResolvedValue(null);
    const cookie = await loginAs('comprador');

    const inexistente = await call('get', '/requests/999', cookie);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.message).toBe('Solicitação não encontrada.');

    const invalido = await call('get', '/requests/abc', cookie);
    expect(invalido.status).toBe(400);
    expect(invalido.body.message).toBe('ID da solicitação inválido.');
  });
});

describe('/api/v1/indent/requests - confirmar itens', () => {
  function confirmRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 11,
      processNumber: NUMBER_277,
      status: 'NOVA',
      items: [
        { id: 21, productId: 2, confirmed: false },
        { id: 22, productId: 4, confirmed: true },
        { id: 23, productId: null, confirmed: false },
      ],
      ...overrides,
    };
  }

  it('confirma so os itens pendentes e loga', async () => {
    tx.indentRequest.findUnique.mockResolvedValueOnce(confirmRow()).mockResolvedValue(requestRow());
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/items/confirm', cookie, { itemIds: [21, 22, 21] });

    expect(res.status).toBe(200);
    expect(tx.indentRequestItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [21] }, requestId: 11 },
      data: { confirmed: true },
    });
    expect(auditActions()).toEqual(['indent_request.items_confirmed']);
    expect(auditCall('indent_request.items_confirmed')).toMatchObject({
      entityId: '11',
      performedById: 7,
      metadata: { processNumber: NUMBER_277, itemIds: [21] },
    });
  });

  it('nada mudou -> sem escrita e sem log', async () => {
    tx.indentRequest.findUnique.mockResolvedValueOnce(confirmRow()).mockResolvedValue(requestRow());
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/items/confirm', cookie, { itemIds: [22] });

    expect(res.status).toBe(200);
    expect(tx.indentRequestItem.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('erros: 404, nao NOVA 409, item de outra solicitacao 400, item sem produto 400', async () => {
    const cookie = await loginAs('comprador');

    tx.indentRequest.findUnique.mockResolvedValueOnce(null);
    expect((await call('post', '/requests/11/items/confirm', cookie, { itemIds: [21] })).status).toBe(404);

    tx.indentRequest.findUnique.mockResolvedValueOnce(confirmRow({ status: 'COTACAO' }));
    const cotada = await call('post', '/requests/11/items/confirm', cookie, { itemIds: [21] });
    expect(cotada.status).toBe(409);
    expect(cotada.body.message).toBe('Os itens desta solicitação já foram cotados.');

    tx.indentRequest.findUnique.mockResolvedValueOnce(confirmRow());
    const fora = await call('post', '/requests/11/items/confirm', cookie, { itemIds: [99] });
    expect(fora.status).toBe(400);
    expect(fora.body.message).toBe('Item inexistente nesta solicitação.');

    tx.indentRequest.findUnique.mockResolvedValueOnce(confirmRow());
    const semProduto = await call('post', '/requests/11/items/confirm', cookie, { itemIds: [23] });
    expect(semProduto.status).toBe(400);
    expect(semProduto.body.message).toBe('Escolha o produto do item antes de confirmar.');

    expect(tx.indentRequestItem.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
