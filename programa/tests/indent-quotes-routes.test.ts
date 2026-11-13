import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import {
  QUOTE_ROUTES,
  acceptedRow,
  auditActions,
  auditCall,
  call,
  dayKey,
  expectNoQuoteWrites,
  getApp,
  loginAs,
  prismaMock,
  productRow,
  quoteItemRow,
  quoteRow,
  resetQuoteMocks,
  tx,
} from './helpers/indentRoutesMock';

// Cotacoes do IQ Indent (PR 3): papeis, lista, detalhe, marcar como enviada e item livre. Usuario logado: id 7, nome = papel.

beforeEach(resetQuoteMocks);

function lockSql(): string[] {
  return tx.$queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?').replace(/\s+/g, ' '));
}

describe('/api/v1/indent/quotes - autenticacao e papeis', () => {
  it('sem login retorna 401 nas 8 rotas', async () => {
    const app = await getApp();

    for (const route of QUOTE_ROUTES) {
      const req = request(app)[route.method](`/api/v1/indent${route.path}`);
      const res = route.method === 'get' ? await req : await req.send((route.body ?? {}) as object);
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  describe('comercial recebe 403 nas 8 rotas', () => {
    it.each(QUOTE_ROUTES)('comercial: $method $path -> 403', async ({ method, path, body }) => {
      const cookie = await loginAs('comercial');
      const res = await call(method, path, cookie, body);
      expect(res.status).toBe(403);
      expectNoQuoteWrites();
    });
  });

  it('viewer le a lista e o detalhe (200) e nao age (403 nos 6 POSTs); o detalhe vem sem acoes', async () => {
    const cookie = await loginAs('viewer');

    for (const route of QUOTE_ROUTES) {
      const res = await call(route.method, route.path, cookie, route.body);
      expect(res.status, `${route.method} ${route.path}`).toBe(route.leitura ? 200 : 403);
    }

    const detail = await call('get', '/quotes/100', cookie);
    expect(detail.body.allowedActions).toEqual([]);
    expectNoQuoteWrites();
  });

  it.each(['admin', 'comprador', 'gestor'])('%s age na cotacao (marcar como enviada = 200)', async (role) => {
    const cookie = await loginAs(role);
    const res = await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0) });
    expect(res.status).toBe(200);
  });

  it('id invalido -> 400', async () => {
    const cookie = await loginAs('comprador');
    for (const path of ['/quotes/abc', '/quotes/0']) {
      const res = await call('get', path, cookie);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('ID da cotação inválido.');
    }
    expect((await call('post', '/quotes/abc/accept', cookie)).status).toBe(400);
  });
});

describe('/api/v1/indent/quotes - lista', () => {
  it('devolve a linha com ref, total, validade, excecao e resumo de itens; inclui REVISADA', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findMany.mockResolvedValue([
      quoteRow({
        id: 101,
        status: 'RESPONDIDA',
        revision: 2,
        validUntil: new Date('2026-11-26T00:00:00.000Z'),
        exceptionReason: 'Cliente pediu',
        items: [quoteItemRow(201, 21, { cfrPricePerKg: '0.7950' }), quoteItemRow(202, 22)],
      }),
      quoteRow({ id: 100, status: 'REVISADA' }),
    ]);

    const res = await call('get', '/quotes', cookie);

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      id: 101,
      ref: expect.stringMatching(/^R2 - 277\//),
      revision: 2,
      status: 'RESPONDIDA',
      requestId: 11,
      requestStatus: 'COTACAO',
      client: { id: 3, name: 'Cliente Exemplo Ltda', city: 'Itajaí' },
      supplier: { id: 5, name: 'Acme Chemicals', country: 'China', contactName: null, hasPartnership: false },
      itemsSummary: { firstName: 'Zinco', count: 2 },
      currency: 'USD',
      total: '19875.00',
      validUntil: '2026-11-26',
      exception: { reason: 'Cliente pediu' },
    });
    expect(res.body.data[1]).toMatchObject({ id: 100, status: 'REVISADA', total: null, validUntil: null, exception: null });
    expect(prismaMock.indentQuote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 501 }),
    );
  });

  it('501 cotacoes -> 500 + truncated: true', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findMany.mockResolvedValue(Array.from({ length: 501 }, (_, index) => quoteRow({ id: 1000 - index })));

    const res = await call('get', '/quotes', cookie);

    expect(res.body.data).toHaveLength(500);
    expect(res.body.truncated).toBe(true);
  });

  it('filtros: status aceita lista; status FOO e q acima de 100 -> 400; parametro extra -> 400', async () => {
    const cookie = await loginAs('comprador');

    const ok = await call('get', '/quotes?status=RESPONDIDA,ACEITA&q=acme', cookie);
    expect(ok.status).toBe(200);
    const where = (prismaMock.indentQuote.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where.status).toEqual({ in: ['RESPONDIDA', 'ACEITA'] });
    expect(where.OR).toHaveLength(3);

    expect((await call('get', '/quotes?status=FOO', cookie)).status).toBe(400);
    expect((await call('get', `/quotes?q=${'x'.repeat(101)}`, cookie)).status).toBe(400);
    expect((await call('get', '/quotes?foo=1', cookie)).status).toBe(400);
  });
});

describe('/api/v1/indent/quotes/:id - detalhe', () => {
  it('404 quando a cotacao nao existe', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findUnique.mockResolvedValue(null);

    const res = await call('get', '/quotes/999', cookie);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Cotação não encontrada.');
  });

  it('formato completo: precos como string, isFree, base, allowedActions e aviso de aceite unico', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findUnique.mockResolvedValue(
      quoteRow({
        id: 101,
        status: 'RESPONDIDA',
        revision: 2,
        baseQuoteId: 100,
        destination: 'Itajaí',
        productionLeadTimeDays: 20,
        paymentTerms: 'T/T',
        manufacturer: 'Fab X',
        exceptionReason: 'Motivo',
        exceptionByName: 'Ana',
        items: [
          quoteItemRow(201, 21, { packaging: 'tambor', fobPricePerKg: '0.7', cfrPricePerKg: '0.7950' }),
          quoteItemRow(202, 22, { requestItem: { ...quoteItemRow(202, 22).requestItem, productId: null, product: null } }),
        ],
      }),
    );
    prismaMock.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('get', '/quotes/101', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 101,
      ref: expect.stringMatching(/^R2 - /),
      incoterm: 'CFR',
      destination: 'Itajaí',
      base: { id: 100, ref: expect.stringMatching(/^277\//) },
      acceptedQuote: { id: 150, ref: expect.stringMatching(/^277\//), supplierName: 'Beta Corp' },
      client: { supplierRuleMode: 'LIVRE' },
      supplier: { type: 'TRADING' },
      exception: { reason: 'Motivo', byName: 'Ana' },
      total: '19875.00',
      allowedActions: ['refuse'],
    });
    expect(res.body.items[0]).toMatchObject({
      requestItemId: 21,
      name: 'Zinco',
      cas: '7440-66-6',
      isFree: false,
      quantityKg: '25000.000',
      packaging: 'tambor',
      fobPricePerKg: '0.7000',
      cfrPricePerKg: '0.7950',
    });
    expect(res.body.items[1]).toMatchObject({ name: 'Ácido cítrico', cas: null, isFree: true, packaging: null, cfrPricePerKg: null });
    expect(prismaMock.indentQuote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 11, status: 'ACEITA' } }),
    );
  });

  it('a propria cotacao ACEITA nao mostra aviso de aceite unico e nao tem acoes', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findUnique.mockResolvedValue(quoteRow({ id: 150, status: 'ACEITA' }));
    prismaMock.indentQuote.findFirst.mockResolvedValue(acceptedRow({ id: 150 }));

    const res = await call('get', '/quotes/150', cookie);

    expect(res.body.acceptedQuote).toBeNull();
    expect(res.body.allowedActions).toEqual([]);
  });

  it('RASCUNHO com escrita oferece marcar como enviada e item livre; solicitacao PERDIDA, nada', async () => {
    const cookie = await loginAs('comprador');
    expect((await call('get', '/quotes/100', cookie)).body.allowedActions).toEqual(['mark-sent', 'items']);

    prismaMock.indentQuote.findUnique.mockResolvedValue(
      quoteRow({ request: { ...quoteRow().request, status: 'PERDIDA' } }),
    );
    expect((await call('get', '/quotes/100', cookie)).body.allowedActions).toEqual([]);
  });
});

describe('/api/v1/indent/quotes/:id/mark-sent - marcar como enviada', () => {
  it('RASCUNHO -> ENVIADA com sentAt, log e trava na ordem solicitacao -> cotacao', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(-1) });

    expect(res.status).toBe(200);
    const update = tx.indentQuote.update.mock.calls[0]?.[0] as { where: { id: number }; data: { status: string; sentAt: Date } };
    expect(update.where).toEqual({ id: 100 });
    expect(update.data.status).toBe('ENVIADA');
    expect(update.data.sentAt.toISOString()).toBe(`${dayKey(-1)}T15:00:00.000Z`);
    expect(auditActions()).toEqual(['indent_quote.marked_sent']);
    expect(auditCall('indent_quote.marked_sent')).toMatchObject({
      entityType: 'indent_quote',
      entityId: '100',
      performedById: 7,
      metadata: { ref: expect.stringMatching(/^277\//), sentOn: dayKey(-1), via: 'manual' },
    });

    const sql = lockSql();
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain('FROM "IndentQuote" WHERE id');
    expect(sql[1]).toContain('"IndentRequest"');
    expect(sql[1]).toContain('FOR NO KEY UPDATE');
    expect(sql[2]).toContain('"IndentQuote"');
    expect(sql[2]).toContain('FOR NO KEY UPDATE');
  });

  it('enviada hoje grava o instante real', async () => {
    const cookie = await loginAs('comprador');
    const before = Date.now();

    await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0) });

    const sentAt = (tx.indentQuote.update.mock.calls[0]?.[0] as { data: { sentAt: Date } }).data.sentAt.getTime();
    expect(sentAt).toBeGreaterThanOrEqual(before);
  });

  it.each([
    ['futura', dayKey(1), 'A data de envio não pode ser futura.'],
    ['antes da criacao', dayKey(-10), 'A data de envio não pode ser anterior à criação da cotação.'],
    ['invalida', '2026-02-30', 'Informe a data do envio.'],
  ])('data %s -> 400 sem gravar', async (_nome, sentOn, message) => {
    const cookie = await loginAs('comprador');
    const res = await call('post', '/quotes/100/mark-sent', cookie, { sentOn });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    // o `path` leva o campo para o erro inline da tela (regra de negocio de data e erro do Zod)
    expect(res.body.path).toBe('sentOn');
    expectNoQuoteWrites();
  });

  it('corpo sem data ou com campo extra (status) -> 400', async () => {
    const cookie = await loginAs('comprador');
    expect((await call('post', '/quotes/100/mark-sent', cookie, {})).status).toBe(400);
    const forged = await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0), status: 'ACEITA' });
    expect(forged.status).toBe(400);
    expectNoQuoteWrites();
  });

  it('cotacao ENVIADA -> 409 com a mensagem do estado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ status: 'ENVIADA' }));

    const res = await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0) });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Esta cotação está Enviada e não permite marcar como enviada.');
    expectNoQuoteWrites();
  });

  it('com cotacao ACEITA na solicitacao -> 409 (aceite unico)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0) });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Esta solicitação já tem uma cotação aceita (${acceptedRow().request.processNumber} · Beta Corp).`);
    expectNoQuoteWrites();
  });

  it('solicitacao perdida -> 409; cotacao inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ request: { ...quoteRow().request, status: 'PERDIDA' } }));
    const lost = await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0) });
    expect(lost.status).toBe(409);
    expect(lost.body.message).toMatch(/^A solicitação 277\/\d{2} foi marcada como perdida\.$/);

    tx.$queryRaw.mockResolvedValue([]);
    expect((await call('post', '/quotes/100/mark-sent', cookie, { sentOn: dayKey(0) })).status).toBe(404);
    expectNoQuoteWrites();
  });
});

describe('/api/v1/indent/quotes/:id/items - item livre no rascunho', () => {
  it('reaproveita o produto de mesmo nameKey e cria o item da solicitacao e o da cotacao (so nesta)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.findMany.mockResolvedValue([{ id: 9, nameKey: 'item livre x' }]);

    const res = await call('post', '/quotes/100/items', cookie, { description: '  Item livre X ', quantityKg: 1000.5 });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create).not.toHaveBeenCalled();
    expect(tx.indentRequestItem.create).toHaveBeenCalledWith({
      data: { requestId: 11, productId: 9, description: 'Item livre X', quantityKg: 1000.5, confirmed: true, position: 2 },
      select: { id: true },
    });
    expect(tx.indentQuoteItem.create).toHaveBeenCalledWith({ data: { quoteId: 100, requestItemId: 23 }, select: { id: true } });
    expect(tx.indentQuoteItem.create).toHaveBeenCalledTimes(1);
    expect(auditActions()).toEqual(['indent_quote.item_added']);
  });

  it('cria produto LIVRE quando nao existe, com log do produto', async () => {
    const cookie = await loginAs('comprador');
    tx.indentProduct.create.mockResolvedValue(productRow({ id: 31, origin: 'LIVRE' }));

    const res = await call('post', '/quotes/100/items', cookie, { description: 'Produto novo Y', quantityKg: 10 });

    expect(res.status).toBe(201);
    expect(tx.indentProduct.create).toHaveBeenCalledWith({
      data: { name: 'Produto novo Y', nameKey: 'produto novo y', unit: 'kg', origin: 'LIVRE', sourceRequestNumber: expect.stringMatching(/^277\//) },
    });
    expect(tx.indentRequestItem.create.mock.calls[0]?.[0]).toMatchObject({ data: { productId: 31 } });
    expect(auditActions()).toEqual(['indent_product.created_from_request', 'indent_quote.item_added']);
  });

  it('cotacao ENVIADA -> 409; com ACEITA na solicitacao -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ status: 'ENVIADA' }));
    const sent = await call('post', '/quotes/100/items', cookie, { description: 'X', quantityKg: 1 });
    expect(sent.status).toBe(409);
    expect(sent.body.message).toBe('Esta cotação está Enviada e não permite incluir itens.');

    tx.indentQuote.findUnique.mockResolvedValue(quoteRow());
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());
    const accepted = await call('post', '/quotes/100/items', cookie, { description: 'X', quantityKg: 1 });
    expect(accepted.status).toBe(409);
    expect(accepted.body.message).toContain('já tem uma cotação aceita');
    expectNoQuoteWrites();
  });

  it.each([
    ['sem descricao', { description: '  ', quantityKg: 1 }],
    ['quantidade zero', { description: 'X', quantityKg: 0 }],
    ['4 casas', { description: 'X', quantityKg: 1.2345 }],
    ['campo extra', { description: 'X', quantityKg: 1, productId: 2 }],
    ['acima de 1e9', { description: 'X', quantityKg: 1_000_000_001 }],
  ])('corpo invalido (%s) -> 400 sem gravar', async (_nome, body) => {
    const cookie = await loginAs('comprador');
    const res = await call('post', '/quotes/100/items', cookie, body);
    expect(res.status).toBe(400);
    expectNoQuoteWrites();
  });
});
