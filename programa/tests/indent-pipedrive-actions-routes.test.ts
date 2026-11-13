import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste

import {
  YEAR,
  YY,
  auditActions,
  auditCall,
  call,
  itemRow,
  loginAs,
  prismaMock,
  requestRow,
  resetRequestMocks,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

// Acoes sobre solicitacoes vindas do Pipedrive (PR 5a.3): digitar a referencia pendente e confirmar os itens lidos da nota.
// Dados ficticios; usuario logado: id 7, nome = papel.

const REFERENCE_MESSAGE = 'Informe a referência no formato NNN/AA (ex.: 274/26).';
const lockSql = () => tx.$executeRaw.mock.calls.map((entry) => (entry[0] as unknown as string[]).join('?'));
const lockValues = () => tx.$executeRaw.mock.calls.flatMap((entry) => (entry.slice(1) as unknown[]));

beforeEach(resetRequestMocks);

describe('PUT /requests/:id/reference', () => {
  const head = (overrides: Record<string, unknown> = {}) => ({ id: 11, processNumber: null as string | null, pipedriveDealId: 900001, ...overrides });

  // O mesmo `findUnique` serve a leitura da solicitacao (por id) e a checagem do numero (por processNumber).
  function requests(row: Record<string, unknown> | null, holder: { id: number; processNumber: string } | null = null) {
    tx.indentRequest.findUnique.mockImplementation(async ({ where }: { where: { id?: number; processNumber?: string } }) =>
      where.processNumber !== undefined ? holder : row,
    );
  }

  beforeEach(() => {
    requests(head());
    prismaMock.indentRequest.findUnique.mockResolvedValue(requestRow({ processNumber: `274/${YY}`, origin: 'PIPEDRIVE' }));
  });

  it('grava o numero normalizado, limpa o alerta, sobe a sequencia (GREATEST), audita e devolve o detalhe', async () => {
    const res = await call('put', '/requests/11/reference', await loginAs('comprador'), { processNumber: `  0274/${YY} ` });

    expect(res.status).toBe(200);
    expect(res.body.processNumber).toBe(`274/${YY}`);
    expect(tx.indentRequest.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { processNumber: `274/${YY}`, processYear: YEAR, processSeq: 274, referenceAlert: null },
    });
    expect(lockSql().some((text) => text.includes('INSERT INTO "IndentSequence"'))).toBe(true);
    expect(lockSql().some((text) => text.includes('GREATEST("lastNumber"'))).toBe(true);
    expect(auditActions()).toEqual(['indent_request.reference_set']);
    expect(auditCall('indent_request.reference_set')).toMatchObject({
      entityId: '11',
      performedById: 7,
      afterData: { processNumber: `274/${YY}` },
      metadata: { dealId: 900001 },
    });
  });

  it('ordem de travas: advisory do negocio -> linha da solicitacao -> sequencia do ano', async () => {
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      order.push(text.includes('pg_advisory_xact_lock') ? 'advisory' : text.includes('INSERT INTO "IndentSequence"') ? 'sequence' : 'other');
      return 1;
    });
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      order.push(strings.join('?').includes('"IndentRequest"') ? 'request-row' : 'sequence-read');
      return [{ lastNumber: 276 }];
    });
    await call('put', '/requests/11/reference', await loginAs('admin'), { processNumber: `274/${YY}` });

    expect(order.slice(0, 4)).toEqual(['advisory', 'request-row', 'sequence', 'sequence-read']);
    expect(lockValues()).toContain('indent_pipedrive_deal:900001');
  });

  it('solicitacao lancada a mao (sem negocio) nao toma a trava do negocio', async () => {
    requests(head({ pipedriveDealId: null }));
    await call('put', '/requests/11/reference', await loginAs('admin'), { processNumber: `274/${YY}` });

    expect(lockValues().some((value) => String(value).startsWith('indent_pipedrive_deal:'))).toBe(false);
    expect(auditCall('indent_request.reference_set')?.metadata ?? null).toBeNull();
  });

  it('numero usado por outra solicitacao -> 409 e nada e gravado (a sequencia ja garantida nao desce)', async () => {
    requests(head(), { id: 12, processNumber: `274/${YY}` });
    const res = await call('put', '/requests/11/reference', await loginAs('admin'), { processNumber: `274/${YY}` });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe uma solicitação com este número.');
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('corrida com a criacao do mesmo numero (P2002 no indice unico) -> 409', async () => {
    tx.indentRequest.update.mockRejectedValue(uniqueError(['processNumber']));
    const res = await call('put', '/requests/11/reference', await loginAs('admin'), { processNumber: `274/${YY}` });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe uma solicitação com este número.');
  });

  it('solicitacao que ja tem referencia -> 409 "A solicitacao ja tem referencia."', async () => {
    requests(head({ processNumber: `270/${YY}` }));
    const res = await call('put', '/requests/11/reference', await loginAs('admin'), { processNumber: `274/${YY}` });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A solicitação já tem referência.');
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('solicitacao inexistente -> 404; id invalido -> 400', async () => {
    const cookie = await loginAs('admin');
    requests(null);
    expect((await call('put', '/requests/11/reference', cookie, { processNumber: `274/${YY}` })).status).toBe(404);
    expect((await call('put', '/requests/abc/reference', cookie, { processNumber: `274/${YY}` })).status).toBe(400);
  });

  it.each([
    ['vazio', ''],
    ['sem barra', '27426'],
    ['2 digitos na sequencia', '27/26'],
    ['hifen no lugar da barra', '274-26'],
    ['texto', 'abc'],
    ['ano com 4 digitos', '274/2026'],
    ['sequencia zero', '000/26'],
    ['com sufixo', '274/26 INDENT'],
  ])('formato invalido (%s) -> 400 e nada e gravado', async (_name, processNumber) => {
    const res = await call('put', '/requests/11/reference', await loginAs('admin'), { processNumber });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(REFERENCE_MESSAGE);
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('ano fora da faixa (atual-1 a atual+1) -> 400; os 3 anos da faixa passam', async () => {
    const cookie = await loginAs('admin');
    const yy = (year: number) => String(year % 100).padStart(2, '0');

    for (const year of [YEAR - 2, YEAR + 2]) {
      const res = await call('put', '/requests/11/reference', cookie, { processNumber: `274/${yy(year)}` });
      expect(res.status, String(year)).toBe(400);
      expect(res.body.message).toBe('O ano da referência deve ser o atual, o anterior ou o próximo.');
    }
    for (const year of [YEAR - 1, YEAR, YEAR + 1]) {
      expect((await call('put', '/requests/11/reference', cookie, { processNumber: `274/${yy(year)}` })).status, String(year)).toBe(200);
    }
  });

  it('corpo sem processNumber, com tipo errado ou com campo extra -> 400', async () => {
    const cookie = await loginAs('admin');

    expect((await call('put', '/requests/11/reference', cookie, {})).status).toBe(400);
    expect((await call('put', '/requests/11/reference', cookie, { processNumber: 274 })).status).toBe(400);
    expect((await call('put', '/requests/11/reference', cookie, { processNumber: `274/${YY}`, referenceAlert: null })).status).toBe(400);
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
  });

  it('viewer e comercial: 403; admin, comprador e gestor: 200', async () => {
    for (const role of ['viewer', 'comercial']) {
      expect((await call('put', '/requests/11/reference', await loginAs(role), { processNumber: `274/${YY}` })).status, role).toBe(403);
    }
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    for (const role of ['admin', 'comprador', 'gestor']) {
      expect((await call('put', '/requests/11/reference', await loginAs(role), { processNumber: `274/${YY}` })).status, role).toBe(200);
    }
  });

  it('com a referencia digitada a geracao de cotacoes deixa de dar 409 "Digite a referencia"', async () => {
    tx.indentRequest.findUnique.mockResolvedValue(requestRow({ processNumber: `274/${YY}` }));
    const res = await call('post', '/requests/11/quotes', await loginAs('comprador'), { suppliers: [{ supplierId: 5 }] });

    expect(res.body.message).not.toBe('Digite a referência da solicitação antes de gerar cotações.');
  });
});

describe('PUT /requests/:id/note-items', () => {
  const noteItem = (id: number, overrides: Record<string, unknown> = {}) =>
    itemRow(id, null, { description: `RESINA EXEMPLO ${id}`, quantityKg: '0', confirmed: false, source: 'NOTE', noteLine: id - 20, position: id - 21, ...overrides });

  function request(overrides: Record<string, unknown> = {}) {
    return {
      id: 11,
      processNumber: null as string | null,
      status: 'NOVA',
      pipedriveDealId: 900001,
      items: [
        { id: 21, position: 0 },
        { id: 22, position: 1 },
      ],
      quotes: [] as unknown[],
      ...overrides,
    };
  }

  // `findUnique` com `include` devolve o detalhe; sem ele, a leitura enxuta da transacao.
  function setup(head: Record<string, unknown> = request()) {
    tx.indentRequest.findUnique.mockImplementation(async (args: { include?: unknown }) =>
      args.include ? requestRow({ processNumber: null, origin: 'PIPEDRIVE', items: [noteItem(21, { confirmed: true }), noteItem(22, { confirmed: true })] }) : head,
    );
    tx.indentProduct.findMany.mockImplementation(async ({ where }: { where: { id?: unknown; nameKey?: unknown } }) =>
      where.id ? [{ id: 2, isActive: true }] : [],
    );
    tx.indentRequestItem.create.mockResolvedValue({ id: 99 });
  }

  const BODY = {
    items: [
      { id: 21, productId: 2, description: 'Zinco', quantityKg: 2000 },
      { id: 22, description: '  Item   livre exemplo ', quantityKg: 1500.5 },
    ],
  };

  beforeEach(() => setup());

  it('confirma: edita item existente, cria produto LIVRE sem numero de origem, confirma tudo, limpa o alerta e audita', async () => {
    const res = await call('put', '/requests/11/note-items', await loginAs('comprador'), BODY);

    expect(res.status).toBe(200);
    expect(res.body.items.every((item: { confirmed: boolean }) => item.confirmed)).toBe(true);
    expect(tx.indentRequestItem.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { productId: 2, description: 'Zinco', quantityKg: 2000, confirmed: true },
    });
    // Item livre: produto LIVRE novo; referencia pendente -> sourceRequestNumber nulo.
    expect(tx.indentProduct.create.mock.calls[0]?.[0].data).toMatchObject({
      name: 'Item livre exemplo',
      nameKey: 'item livre exemplo',
      origin: 'LIVRE',
      sourceRequestNumber: null,
    });
    expect(tx.indentRequestItem.update).toHaveBeenCalledWith({
      where: { id: 22 },
      data: { productId: 31, description: 'Item livre exemplo', quantityKg: 1500.5, confirmed: true },
    });
    expect(tx.indentRequest.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { noteChangedAt: null } });
    expect(auditActions()).toEqual(['indent_product.created_from_request', 'indent_request.note_items_confirmed']);
    expect(auditCall('indent_request.note_items_confirmed')).toMatchObject({
      entityId: '11',
      performedById: 7,
      metadata: { processNumber: null, itemIds: [21, 22], added: 0, removed: 0 },
    });
    expect(lockValues()).toContain('indent_pipedrive_deal:900001');
  });

  it('com referencia, o produto livre guarda o numero da solicitacao', async () => {
    setup(request({ processNumber: `277/${YY}` }));
    await call('put', '/requests/11/note-items', await loginAs('admin'), BODY);

    expect(tx.indentProduct.create.mock.calls[0]?.[0].data.sourceRequestNumber).toBe(`277/${YY}`);
  });

  it('item livre com nome de produto ja existente reaproveita o produto (sem criar outro)', async () => {
    tx.indentProduct.findMany.mockImplementation(async ({ where }: { where: { id?: unknown } }) =>
      where.id ? [{ id: 2, isActive: true }] : [{ id: 8, nameKey: 'item livre exemplo' }],
    );
    await call('put', '/requests/11/note-items', await loginAs('admin'), BODY);

    expect(tx.indentProduct.create).not.toHaveBeenCalled();
    expect(tx.indentRequestItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 22 }, data: expect.objectContaining({ productId: 8 }) }));
    expect(auditActions()).toEqual(['indent_request.note_items_confirmed']);
  });

  it('remove com `remove: true` e inclui item novo (sem id): MANUAL, confirmado, no fim da lista', async () => {
    const res = await call('put', '/requests/11/note-items', await loginAs('admin'), {
      items: [
        { id: 21, productId: 2, description: 'Zinco', quantityKg: 2000 },
        { id: 22, remove: true },
        { productId: 2, description: 'Zinco', quantityKg: 10 },
      ],
    });

    expect(res.status).toBe(200);
    expect(tx.indentRequestItem.deleteMany).toHaveBeenCalledWith({ where: { requestId: 11, id: { in: [22] } } });
    expect(tx.indentRequestItem.create).toHaveBeenCalledWith({
      data: { requestId: 11, productId: 2, description: 'Zinco', quantityKg: 10, confirmed: true, source: 'MANUAL', position: 2 },
      select: { id: true },
    });
    expect(auditCall('indent_request.note_items_confirmed')).toMatchObject({ metadata: { itemIds: [21, 99], added: 1, removed: 1 } });
  });

  it('item da nota editado mantem a origem NOTE (so os itens novos sao MANUAL)', async () => {
    await call('put', '/requests/11/note-items', await loginAs('admin'), BODY);

    const data = tx.indentRequestItem.update.mock.calls.map((entry) => (entry[0] as { data: Record<string, unknown> }).data);
    expect(data.every((entry) => !('source' in entry))).toBe(true);
  });

  it('so NOVA e sem cotacao: COTACAO e NOVA com cotacao -> 409 e nada e gravado', async () => {
    const cookie = await loginAs('admin');

    for (const row of [request({ status: 'COTACAO' }), request({ quotes: [{ id: 5 }] })]) {
      setup(row);
      const res = await call('put', '/requests/11/note-items', cookie, BODY);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Os itens desta solicitação já foram cotados.');
    }
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
    expect(tx.indentRequestItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('solicitacao inexistente -> 404; id invalido -> 400', async () => {
    const cookie = await loginAs('admin');
    tx.indentRequest.findUnique.mockResolvedValue(null);

    expect((await call('put', '/requests/11/note-items', cookie, BODY)).status).toBe(404);
    expect((await call('put', '/requests/0/note-items', cookie, BODY)).status).toBe(400);
  });

  it('remover TODOS os itens -> 400 "Mantenha ao menos um item."', async () => {
    const res = await call('put', '/requests/11/note-items', await loginAs('admin'), { items: [{ id: 21, remove: true }, { id: 22, remove: true }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Mantenha ao menos um item.');
    expect(tx.indentRequestItem.deleteMany).not.toHaveBeenCalled();
  });

  it('a lista precisa cobrir TODOS os itens atuais (a nota pode ter sido relida enquanto a tela estava aberta)', async () => {
    const res = await call('put', '/requests/11/note-items', await loginAs('admin'), {
      items: [{ id: 21, productId: 2, description: 'Zinco', quantityKg: 5 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Os itens da solicitação mudaram. Recarregue e revise de novo.');
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
  });

  it('id de outra solicitacao -> 400; id repetido -> 400', async () => {
    const cookie = await loginAs('admin');
    const other = await call('put', '/requests/11/note-items', cookie, {
      items: [...BODY.items, { id: 77, productId: 2, description: 'Zinco', quantityKg: 5 }],
    });
    expect(other.status).toBe(400);
    expect(other.body.message).toBe('Item inexistente nesta solicitação.');

    const repeated = await call('put', '/requests/11/note-items', cookie, {
      items: [...BODY.items, { id: 21, productId: 2, description: 'Zinco', quantityKg: 5 }],
    });
    expect(repeated.status).toBe(400);
    expect(repeated.body.message).toBe('Item repetido na lista.');
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
  });

  it('produto informado inexistente ou inativo -> 400', async () => {
    const cookie = await loginAs('admin');

    tx.indentProduct.findMany.mockResolvedValue([]);
    const missing = await call('put', '/requests/11/note-items', cookie, BODY);
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('Produto inexistente.');

    tx.indentProduct.findMany.mockResolvedValue([{ id: 2, isActive: false }]);
    const inactive = await call('put', '/requests/11/note-items', cookie, BODY);
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toBe('Produto inativo no catálogo do Indent.');
    expect(tx.indentProduct.create).not.toHaveBeenCalled();
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
  });

  it.each([
    ['quantidade zero', { id: 21, description: 'Zinco', quantityKg: 0 }, 'Informe a quantidade em kg.'],
    ['quantidade negativa', { id: 21, description: 'Zinco', quantityKg: -5 }, 'Informe a quantidade em kg.'],
    ['quantidade em texto', { id: 21, description: 'Zinco', quantityKg: '10' }, 'Informe a quantidade em kg.'],
    ['4 casas decimais', { id: 21, description: 'Zinco', quantityKg: 1.2345 }, 'A quantidade aceita no máximo 3 casas decimais.'],
    ['acima de 1e9', { id: 21, description: 'Zinco', quantityKg: 1_000_000_001 }, 'A quantidade deve ser de no máximo 1.000.000.000 kg.'],
    ['sem quantidade', { id: 21, description: 'Zinco' }, 'Informe a quantidade em kg.'],
    ['sem produto/descricao', { id: 21, quantityKg: 5 }, 'Informe o produto.'],
    ['descricao em branco', { id: 21, description: '   ', quantityKg: 5 }, 'Informe o produto.'],
    ['descricao longa', { id: 21, description: 'x'.repeat(301), quantityKg: 5 }, 'O produto deve ter no máximo 300 caracteres.'],
    ['remove sem id', { remove: true }, 'Informe o item a remover.'],
    ['campo extra (confirmed)', { id: 21, description: 'Zinco', quantityKg: 5, confirmed: false }, null],
    ['campo extra (source)', { id: 21, description: 'Zinco', quantityKg: 5, source: 'NOTE' }, null],
    ['remove em texto', { id: 21, remove: 'sim' }, null],
  ])('validacao no backend: %s -> 400 e nada gravado', async (_name, item, message) => {
    const res = await call('put', '/requests/11/note-items', await loginAs('admin'), { items: [item, { id: 22, description: 'Zinco', quantityKg: 5 }] });

    expect(res.status).toBe(400);
    if (message) expect(res.body.message).toBe(message);
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
    expect(tx.indentRequestItem.create).not.toHaveBeenCalled();
    expect(tx.indentProduct.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('lista vazia, sem items, mais de 50 itens ou campo extra no corpo -> 400', async () => {
    const cookie = await loginAs('admin');
    const many = Array.from({ length: 51 }, () => ({ description: 'Zinco', quantityKg: 1 }));

    expect((await call('put', '/requests/11/note-items', cookie, { items: [] })).status).toBe(400);
    expect((await call('put', '/requests/11/note-items', cookie, {})).status).toBe(400);
    const tooMany = await call('put', '/requests/11/note-items', cookie, { items: many });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe('Informe no máximo 50 itens.');
    expect((await call('put', '/requests/11/note-items', cookie, { ...BODY, status: 'COTACAO' })).status).toBe(400);
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
  });

  it('viewer e comercial: 403; admin, comprador e gestor: 200', async () => {
    for (const role of ['viewer', 'comercial']) {
      expect((await call('put', '/requests/11/note-items', await loginAs(role), BODY)).status, role).toBe(403);
    }
    expect(tx.indentRequestItem.update).not.toHaveBeenCalled();
    for (const role of ['admin', 'comprador', 'gestor']) {
      expect((await call('put', '/requests/11/note-items', await loginAs(role), BODY)).status, role).toBe(200);
    }
  });

  it('o historico leva so ids e contadores: nada de descricao do item nem da nota', async () => {
    await call('put', '/requests/11/note-items', await loginAs('admin'), BODY);

    const metadata = JSON.stringify(auditCall('indent_request.note_items_confirmed')?.metadata);
    expect(metadata).not.toContain('Zinco');
    expect(metadata).not.toContain('livre exemplo');
  });
});
