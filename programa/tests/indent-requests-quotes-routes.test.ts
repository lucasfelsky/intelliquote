import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import {
  NUMBER_277,
  auditActions,
  auditCall,
  call,
  genSupplier,
  itemRow,
  loginAs,
  optionSupplier,
  prismaMock,
  requestRow,
  resetRequestMocks,
  restrictedClient,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

// Solicitacoes do IQ Indent (PR 2): cobertura/restricao no seletor, gerar cotacoes e excecao. Usuario logado: id 7, nome = papel.

beforeEach(resetRequestMocks);

describe('/api/v1/indent/requests - cobertura e restricao no seletor de fornecedores', () => {
  it('calcula cobertura, allowed, blockedReason, approvedByClient e ordena permitido > cobertura > nome', async () => {
    prismaMock.indentRequest.findUnique.mockResolvedValue(requestRow({ client: restrictedClient('APROVADOS', [5, 8]) }));
    prismaMock.indentSupplier.findMany.mockResolvedValue([
      optionSupplier(5, 'Acme Chemicals', [2]),
      optionSupplier(6, 'Beta Corp', [2, 4]),
      optionSupplier(7, 'Gama Ltd', []),
      optionSupplier(8, 'Aaa Trading', []),
    ]);
    const cookie = await loginAs('viewer');

    const res = await call('get', '/requests/11/supplier-options', cookie);

    expect(res.status).toBe(200);
    expect(res.body.clientRuleMode).toBe('APROVADOS');
    const rows = res.body.suppliers as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.id)).toEqual([5, 8, 6, 7]);
    expect(rows[0]).toMatchObject({
      id: 5,
      name: 'Acme Chemicals',
      allowed: true,
      blockedReason: null,
      approvedByClient: true,
      coverage: { covered: 1, total: 2 },
    });
    expect(rows[1]).toMatchObject({ id: 8, allowed: true, coverage: { covered: 0, total: 2 } });
    expect(rows[2]).toMatchObject({
      id: 6,
      allowed: false,
      blockedReason: 'Fora da lista de fornecedores aprovados do cliente',
      approvedByClient: false,
      coverage: { covered: 2, total: 2 },
    });
    expect(prismaMock.indentSupplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, take: 500 }),
    );
    // so os vinculos dos produtos do pedido (itens 21 e 22 -> produtos 2 e 4) vem do banco
    const { select } = prismaMock.indentSupplier.findMany.mock.calls[0][0] as { select: { products: unknown } };
    expect(select.products).toEqual({ where: { productId: { in: [2, 4] } }, select: { productId: true } });
  });

  it('BLOQUEIO trava quem esta na lista; LIVRE libera todos', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentSupplier.findMany.mockResolvedValue([
      optionSupplier(5, 'Acme Chemicals', [2]),
      optionSupplier(6, 'Beta Corp', [2]),
    ]);

    prismaMock.indentRequest.findUnique.mockResolvedValue(requestRow({ client: restrictedClient('BLOQUEIO', [6]) }));
    const bloqueio = await call('get', '/requests/11/supplier-options', cookie);
    const byId = new Map((bloqueio.body.suppliers as Array<{ id: number }>).map((row) => [row.id, row]));
    expect(byId.get(6)).toMatchObject({
      allowed: false,
      blockedReason: 'Fornecedor bloqueado por este cliente',
      approvedByClient: false,
    });
    expect(byId.get(5)).toMatchObject({ allowed: true, blockedReason: null });

    prismaMock.indentRequest.findUnique.mockResolvedValue(requestRow());
    const livre = await call('get', '/requests/11/supplier-options', cookie);
    expect((livre.body.suppliers as Array<{ allowed: boolean }>).every((row) => row.allowed)).toBe(true);
  });

  it('hasPartnership nao altera a restricao e item sem produto conta no total sem ser coberto', async () => {
    prismaMock.indentRequest.findUnique.mockResolvedValue(
      requestRow({ client: restrictedClient('APROVADOS', []), items: [itemRow(21, 2), itemRow(22, null)] }),
    );
    prismaMock.indentSupplier.findMany.mockResolvedValue([
      optionSupplier(6, 'Beta Corp', [2], { hasPartnership: true }),
    ]);
    const cookie = await loginAs('comprador');

    const res = await call('get', '/requests/11/supplier-options', cookie);

    expect(res.body.suppliers[0]).toMatchObject({
      hasPartnership: true,
      allowed: false,
      coverage: { covered: 1, total: 2 },
    });
  });

  it('cliente pendente -> 409 e solicitacao inexistente -> 404', async () => {
    const cookie = await loginAs('comprador');

    prismaMock.indentRequest.findUnique.mockResolvedValue(requestRow({ clientId: null, client: null }));
    const pendente = await call('get', '/requests/11/supplier-options', cookie);
    expect(pendente.status).toBe(409);
    expect(pendente.body.message).toBe('Vincule o cliente antes de escolher fornecedores.');

    prismaMock.indentRequest.findUnique.mockResolvedValue(null);
    expect((await call('get', '/requests/11/supplier-options', cookie)).status).toBe(404);
  });
});

describe('/api/v1/indent/requests - gerar cotacoes', () => {
  const BODY = { suppliers: [{ supplierId: 5 }, { supplierId: 6 }] };

  it('cria uma cotacao RASCUNHO por fornecedor com todos os itens e passa a solicitacao para COTACAO', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      processNumber: NUMBER_277,
      quotes: [
        { id: 105, supplierId: 5, supplierName: 'Acme Chemicals', exception: null },
        { id: 106, supplierId: 6, supplierName: 'Beta Corp', exception: null },
      ],
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.indentQuote.create).toHaveBeenCalledTimes(2);
    expect(tx.indentQuote.create.mock.calls[0][0]).toMatchObject({
      data: {
        requestId: 11,
        supplierId: 5,
        status: 'RASCUNHO',
        currency: 'USD',
        incoterm: 'CFR',
        destination: null,
        createdById: 7,
        items: { create: [{ requestItemId: 21 }, { requestItemId: 22 }] },
      },
    });
    expect((tx.indentQuote.create.mock.calls[0][0] as { data: Record<string, unknown> }).data).not.toHaveProperty(
      'exceptionReason',
    );
    expect(tx.indentRequest.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: 'COTACAO', statusChangedAt: expect.any(Date) },
    });
    expect(auditActions()).toEqual(['indent_request.quotes_generated']);
    expect(auditCall('indent_request.quotes_generated')).toMatchObject({
      entityType: 'indent_request',
      entityId: '11',
      performedById: 7,
      metadata: { quoteIds: [105, 106], supplierIds: [5, 6], exceptionSupplierIds: [] },
    });
  });

  it('cliente sem CNPJ (H0): gerar cotacoes funciona normalmente (a restricao e por clientId, nao por CNPJ)', async () => {
    tx.indentRequest.findUnique.mockResolvedValue(
      requestRow({ client: { ...restrictedClient('APROVADOS', [5, 6]), id: 8, name: 'Cliente Pendente Ltda', cnpj: null } }),
    );
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, BODY);

    expect(res.status).toBe(201);
    expect(res.body.quotes).toHaveLength(2);
    expect(tx.indentQuote.create).toHaveBeenCalledTimes(2);
    expect(tx.indentRequest.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: 'COTACAO', statusChangedAt: expect.any(Date) },
    });
  });

  it('fornecedores repetidos no corpo viram uma cotacao so (o 1o vence) e 51 fornecedores -> 400', async () => {
    tx.indentSupplier.findMany.mockResolvedValue([genSupplier(5, 'Acme Chemicals')]);
    const cookie = await loginAs('comprador');

    const dedup = await call('post', '/requests/11/quotes', cookie, { suppliers: [{ supplierId: 5 }, { supplierId: 5 }] });
    expect(dedup.status).toBe(201);
    expect(tx.indentQuote.create).toHaveBeenCalledTimes(1);

    tx.indentQuote.create.mockClear();
    const muitos = await call('post', '/requests/11/quotes', cookie, {
      suppliers: Array.from({ length: 51 }, (_, index) => ({ supplierId: index + 1 })),
    });
    expect(muitos.status).toBe(400);
    expect(tx.indentQuote.create).not.toHaveBeenCalled();

    const vazio = await call('post', '/requests/11/quotes', cookie, { suppliers: [] });
    expect(vazio.status).toBe(400);
    expect(vazio.body.message).toBe('Escolha ao menos um fornecedor.');
  });

  it('solicitacao inexistente 404, cliente pendente 409, ja cotada 409', async () => {
    const cookie = await loginAs('comprador');

    tx.indentRequest.findUnique.mockResolvedValue(null);
    expect((await call('post', '/requests/11/quotes', cookie, BODY)).status).toBe(404);

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ clientId: null, client: null }));
    const pendente = await call('post', '/requests/11/quotes', cookie, BODY);
    expect(pendente.status).toBe(409);
    expect(pendente.body.message).toBe('Vincule o cliente antes de gerar cotações.');

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ status: 'COTACAO' }));
    const cotada = await call('post', '/requests/11/quotes', cookie, BODY);
    expect(cotada.status).toBe(409);
    expect(cotada.body.message).toBe('As cotações desta solicitação já foram geradas.');

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ quotes: [{ id: 1 }] }));
    expect((await call('post', '/requests/11/quotes', cookie, BODY)).status).toBe(409);

    expect(tx.indentQuote.create).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('sem itens 400; item nao confirmado ou sem produto 400', async () => {
    const cookie = await loginAs('comprador');

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ items: [] }));
    const vazio = await call('post', '/requests/11/quotes', cookie, BODY);
    expect(vazio.status).toBe(400);
    expect(vazio.body.message).toBe('A solicitação não tem itens.');

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ items: [itemRow(21, 2, { confirmed: false })] }));
    const naoConfirmado = await call('post', '/requests/11/quotes', cookie, BODY);
    expect(naoConfirmado.status).toBe(400);
    expect(naoConfirmado.body.message).toBe('Confirme os itens antes de gerar cotações.');

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ items: [itemRow(21, null)] }));
    expect((await call('post', '/requests/11/quotes', cookie, BODY)).status).toBe(400);

    expect(tx.indentQuote.create).not.toHaveBeenCalled();
  });

  it('fornecedor inativo ou inexistente -> 400 e nada gravado', async () => {
    const cookie = await loginAs('comprador');

    tx.indentSupplier.findMany.mockResolvedValue([genSupplier(5, 'Acme Chemicals', { isActive: false }), genSupplier(6, 'Beta Corp')]);
    const inativo = await call('post', '/requests/11/quotes', cookie, BODY);
    expect(inativo.status).toBe(400);
    expect(inativo.body.message).toBe('Fornecedor inexistente ou inativo.');

    tx.indentSupplier.findMany.mockResolvedValue([genSupplier(5, 'Acme Chemicals')]);
    expect((await call('post', '/requests/11/quotes', cookie, BODY)).status).toBe(400);

    expect(tx.indentQuote.create).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('conflito do @@unique (gerar em paralelo) vira 409', async () => {
    tx.indentQuote.create.mockRejectedValue(uniqueError(['requestId', 'supplierId', 'revision']));
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, BODY);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('As cotações desta solicitação já foram geradas.');
  });
});

describe('/api/v1/indent/requests - excecao a restricao do cliente', () => {
  // Cliente APROVADOS so com o fornecedor 5: o 6 (Beta Corp) fica travado.
  beforeEach(() => {
    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ client: restrictedClient('APROVADOS', [5]) }));
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['so espacos', '   '],
  ])('fornecedor travado sem motivo (%s) -> 400 e nenhuma cotacao, nem a do fornecedor permitido', async (_label, reason) => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, {
      suppliers: [{ supplierId: 5 }, { supplierId: 6, ...(reason === undefined ? {} : { exceptionReason: reason }) }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Informe o motivo da exceção para Beta Corp.');
    expect(tx.indentQuote.create).not.toHaveBeenCalled();
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('travado com motivo grava os 4 campos da excecao e loga indent_quote.exception_granted', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, {
      suppliers: [{ supplierId: 5 }, { supplierId: 6, exceptionReason: '  Cliente autorizou por e-mail  ' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.quotes[0].exception).toBeNull();
    expect(res.body.quotes[1].exception).toMatchObject({ reason: 'Cliente autorizou por e-mail', byName: 'comprador' });

    const permitida = (tx.indentQuote.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(permitida).not.toHaveProperty('exceptionReason');

    const travada = (tx.indentQuote.create.mock.calls[1][0] as { data: Record<string, unknown> }).data;
    expect(travada).toMatchObject({
      supplierId: 6,
      exceptionReason: 'Cliente autorizou por e-mail',
      exceptionById: 7,
      exceptionByName: 'comprador',
      exceptionAt: expect.any(Date),
    });

    expect(auditActions()).toEqual(['indent_quote.exception_granted', 'indent_request.quotes_generated']);
    expect(auditCall('indent_quote.exception_granted')).toMatchObject({
      entityType: 'indent_quote',
      entityId: '106',
      performedById: 7,
      afterData: {
        requestId: 11,
        processNumber: NUMBER_277,
        supplierId: 6,
        reason: 'Cliente autorizou por e-mail',
        clientRuleMode: 'APROVADOS',
      },
    });
    expect(auditCall('indent_request.quotes_generated')).toMatchObject({
      metadata: { quoteIds: [105, 106], supplierIds: [5, 6], exceptionSupplierIds: [6] },
    });
  });

  it('fornecedor permitido com motivo: o motivo e ignorado (sem excecao e sem log)', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, {
      suppliers: [{ supplierId: 5, exceptionReason: 'Nao precisava' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.quotes[0].exception).toBeNull();
    const data = (tx.indentQuote.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('exceptionReason');
    expect(data).not.toHaveProperty('exceptionById');
    expect(auditActions()).toEqual(['indent_request.quotes_generated']);
  });

  it('BLOQUEIO: quem esta na lista tambem exige motivo e a regra e recalculada a cada geracao', async () => {
    const cookie = await loginAs('comprador');

    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ client: restrictedClient('BLOQUEIO', [6]) }));
    const semMotivo = await call('post', '/requests/11/quotes', cookie, { suppliers: [{ supplierId: 6 }] });
    expect(semMotivo.status).toBe(400);

    const comMotivo = await call('post', '/requests/11/quotes', cookie, {
      suppliers: [{ supplierId: 6, exceptionReason: 'Urgente' }],
    });
    expect(comMotivo.status).toBe(201);
    expect(auditCall('indent_quote.exception_granted')).toMatchObject({ afterData: { clientRuleMode: 'BLOQUEIO' } });

    // A regra mudou entre abrir a tela e gerar: agora o cliente e LIVRE e o mesmo corpo gera sem excecao.
    tx.indentQuote.create.mockClear();
    tx.auditLog.create.mockClear();
    tx.indentRequest.findUnique.mockResolvedValue(requestRow());
    const livre = await call('post', '/requests/11/quotes', cookie, { suppliers: [{ supplierId: 6 }] });
    expect(livre.status).toBe(201);
    expect(livre.body.quotes[0].exception).toBeNull();
    expect(auditActions()).toEqual(['indent_request.quotes_generated']);
  });

  it('hasPartnership nao libera fornecedor travado', async () => {
    tx.indentSupplier.findMany.mockResolvedValue([genSupplier(6, 'Beta Corp', { hasPartnership: true })]);
    const cookie = await loginAs('comprador');

    const res = await call('post', '/requests/11/quotes', cookie, { suppliers: [{ supplierId: 6 }] });

    expect(res.status).toBe(400);
    expect(tx.indentQuote.create).not.toHaveBeenCalled();
  });
});
