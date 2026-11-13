import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import { QUOTE_TRANSITIONS, type IndentQuoteAction } from '../src/utils/indentQuote';
import {
  acceptedRow,
  auditActions,
  auditCall,
  call,
  dayKey,
  expectNoQuoteWrites,
  loginAs,
  quoteItemRow,
  quoteRow,
  resetQuoteMocks,
  sentQuote,
  tx,
  uniqueError,
} from './helpers/indentRoutesMock';

// Acoes sobre a cotacao do IQ Indent (PR 3): registrar resposta, aceite unico, recusa, revisao e transicoes invalidas. Usuario logado: id 7.

beforeEach(resetQuoteMocks);

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    respondedOn: dayKey(-1),
    currency: 'EUR',
    validUntil: dayKey(14),
    productionLeadTimeDays: 20,
    paymentTerms: 'T/T 60 dias após B/L',
    manufacturer: 'Fabricante X',
    notes: 'Embarque em 20 dias',
    destination: 'Itajaí',
    items: [
      { quoteItemId: 201, packaging: 'Tambor 200 kg', fobPricePerKg: '0.7000', cfrPricePerKg: '0.795' },
      { quoteItemId: 202, packaging: 'Saco 25 kg', fobPricePerKg: '1.1', cfrPricePerKg: '1.1' },
    ],
    ...overrides,
  };
}

function bodyOf(action: IndentQuoteAction): Record<string, unknown> {
  if (action === 'mark-sent') return { sentOn: dayKey(0) };
  if (action === 'items') return { description: 'Item X', quantityKg: 10 };
  if (action === 'response') return responseBody();
  return {};
}

const respondedQuote = (overrides: Record<string, unknown> = {}) => quoteRow({ status: 'RESPONDIDA', ...overrides });

describe('/api/v1/indent/quotes/:id/response - registro manual da resposta', () => {
  it('grava a oferta, a moeda, a validade e os precos em Decimal; COTACAO -> RESPONDIDA com log', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote());

    const res = await call('post', '/quotes/100/response', cookie, responseBody());

    expect(res.status).toBe(200);
    expect(tx.indentQuoteItem.update).toHaveBeenCalledTimes(2);
    const first = tx.indentQuoteItem.update.mock.calls[0]?.[0] as {
      where: { id: number };
      data: { packaging: string; fobPricePerKg: Prisma.Decimal; cfrPricePerKg: Prisma.Decimal };
    };
    expect(first.where).toEqual({ id: 201 });
    expect(first.data.packaging).toBe('Tambor 200 kg');
    expect(first.data.fobPricePerKg.toFixed(4)).toBe('0.7000');
    expect(first.data.cfrPricePerKg.toFixed(4)).toBe('0.7950');

    const update = tx.indentQuote.update.mock.calls[0]?.[0] as { where: { id: number }; data: Record<string, unknown> };
    expect(update.where).toEqual({ id: 100 });
    expect(update.data).toMatchObject({
      status: 'RESPONDIDA',
      currency: 'EUR',
      productionLeadTimeDays: 20,
      paymentTerms: 'T/T 60 dias após B/L',
      manufacturer: 'Fabricante X',
      notes: 'Embarque em 20 dias',
      destination: 'Itajaí',
    });
    expect((update.data.validUntil as Date).toISOString()).toBe(`${dayKey(14)}T00:00:00.000Z`);
    expect((update.data.respondedAt as Date).toISOString()).toBe(`${dayKey(-1)}T15:00:00.000Z`);

    expect(tx.indentRequest.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: 'RESPONDIDA', statusChangedAt: expect.any(Date) },
    });
    expect(auditActions()).toEqual(['indent_quote.response_recorded', 'indent_request.status_changed']);
    expect(auditCall('indent_quote.response_recorded')).toMatchObject({
      entityType: 'indent_quote',
      entityId: '100',
      performedById: 7,
      beforeData: { status: 'ENVIADA' },
      afterData: { status: 'RESPONDIDA', currency: 'EUR', validUntil: dayKey(14) },
      metadata: { via: 'manual', afterAcceptance: false },
    });
  });

  it('solicitacao ja RESPONDIDA ou CONVERTIDA nao e rebaixada', async () => {
    const cookie = await loginAs('comprador');

    for (const status of ['RESPONDIDA', 'CONVERTIDA']) {
      vi.clearAllMocks();
      resetQuoteMocks();
      tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ request: { ...quoteRow().request, status } }));
      const res = await call('post', '/quotes/100/response', cookie, responseBody());
      expect(res.status, status).toBe(200);
      expect(tx.indentRequest.update, status).not.toHaveBeenCalled();
      expect(auditActions(), status).toEqual(['indent_quote.response_recorded']);
    }
  });

  it('resposta tardia depois do aceite de outra cotacao e permitida e fica marcada no log', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ request: { ...quoteRow().request, status: 'CONVERTIDA' } }));
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('post', '/quotes/100/response', cookie, responseBody());

    expect(res.status).toBe(200);
    expect(res.body.acceptedQuote).toMatchObject({ id: 150, supplierName: 'Beta Corp' });
    expect(auditCall('indent_quote.response_recorded')).toMatchObject({ metadata: { afterAcceptance: true } });
  });

  it('sem destino no corpo, mantem o porto ja gravado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ destination: 'Santos' }));

    await call('post', '/quotes/100/response', cookie, responseBody({ destination: undefined }));

    expect(tx.indentQuote.update.mock.calls[0]?.[0]).toMatchObject({ data: { destination: 'Santos' } });
  });

  it('FOB igual ao CFR e aceito; fabricante e observacao sao opcionais', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote());

    const res = await call('post', '/quotes/100/response', cookie, responseBody({ manufacturer: undefined, notes: undefined }));

    expect(res.status).toBe(200);
    expect(tx.indentQuote.update.mock.calls[0]?.[0]).toMatchObject({ data: { manufacturer: null, notes: null } });
  });

  describe('validacao (400, nada gravado)', () => {
    const item = (overrides: Record<string, unknown>) => ({
      quoteItemId: 201,
      packaging: 'Tambor',
      fobPricePerKg: '0.7',
      cfrPricePerKg: '0.8',
      ...overrides,
    });
    const second = { quoteItemId: 202, packaging: 'Saco', fobPricePerKg: '1', cfrPricePerKg: '1.2' };

    it.each([
      ['falta um item', { items: [item({})] }, 'Informe os preços de todos os itens.'],
      ['item de outra cotacao', { items: [item({}), { ...second, quoteItemId: 999 }] }, 'Item inexistente nesta cotação.'],
      ['item repetido', { items: [item({}), item({})] }, 'Item repetido.'],
      ['sem FOB', { items: [item({ fobPricePerKg: undefined }), second] }, 'Informe FOB e CFR de todos os itens.'],
      ['sem CFR', { items: [item({ cfrPricePerKg: undefined }), second] }, 'Informe FOB e CFR de todos os itens.'],
      ['5 casas', { items: [item({ cfrPricePerKg: '0.79555' }), second] }, 'Preço inválido: use até 4 casas decimais.'],
      ['virgula', { items: [item({ cfrPricePerKg: '0,795' }), second] }, 'Preço inválido: use até 4 casas decimais.'],
      ['zero', { items: [item({ cfrPricePerKg: '0' }), second] }, 'Preço inválido: use até 4 casas decimais.'],
      ['negativo', { items: [item({ fobPricePerKg: '-1' }), second] }, 'Preço inválido: use até 4 casas decimais.'],
      ['acima de 99999', { items: [item({ cfrPricePerKg: '100000' }), second] }, 'Preço inválido: use até 4 casas decimais.'],
      ['preco como numero', { items: [item({ cfrPricePerKg: 0.8 }), second] }, 'Informe FOB e CFR de todos os itens.'],
      ['sem embalagem', { items: [item({ packaging: ' ' }), second] }, 'Informe a embalagem de todos os itens.'],
      ['validade antes da resposta', { validUntil: dayKey(-3) }, 'A validade não pode ser anterior à data da resposta.'],
      ['validade acima de 365 dias', { validUntil: dayKey(400) }, 'A validade pode ir até 365 dias depois da data da resposta.'],
      ['resposta futura', { respondedOn: dayKey(1), validUntil: dayKey(10) }, 'A data da resposta não pode ser futura.'],
      ['resposta antes do envio', { respondedOn: dayKey(-9), validUntil: dayKey(5) }, 'A data da resposta não pode ser anterior ao envio.'],
      ['moeda invalida', { currency: 'BRL' }, 'Moeda inválida.'],
      ['prazo zero', { productionLeadTimeDays: 0 }, 'O prazo de produção deve ser de 1 a 365 dias.'],
      ['sem pagamento', { paymentTerms: '  ' }, 'Informe a condição de pagamento.'],
      ['campo extra (status)', { status: 'ACEITA' }, 'Campo não permitido.'],
      ['campo extra (total)', { total: '1.00' }, 'Campo não permitido.'],
    ])('%s', async (_nome, overrides, message) => {
      const cookie = await loginAs('comprador');
      tx.indentQuote.findUnique.mockResolvedValue(sentQuote());

      const res = await call('post', '/quotes/100/response', cookie, responseBody(overrides));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expectNoQuoteWrites();
    });

    it('erros de data do servico (resposta futura, antes do envio) tambem voltam com o path do campo', async () => {
      const cookie = await loginAs('comprador');
      tx.indentQuote.findUnique.mockResolvedValue(sentQuote());

      const futura = await call('post', '/quotes/100/response', cookie, responseBody({ respondedOn: dayKey(1), validUntil: dayKey(10) }));
      expect(futura.body).toEqual({ message: 'A data da resposta não pode ser futura.', path: 'respondedOn' });

      const antes = await call('post', '/quotes/100/response', cookie, responseBody({ respondedOn: dayKey(-9), validUntil: dayKey(5) }));
      expect(antes.body).toEqual({ message: 'A data da resposta não pode ser anterior ao envio.', path: 'respondedOn' });
      expectNoQuoteWrites();
    });

    it('CFR menor que FOB -> 400 com o path do campo (erro inline); FOB igual ao CFR passa', async () => {
      const cookie = await loginAs('comprador');
      tx.indentQuote.findUnique.mockResolvedValue(sentQuote());

      const res = await call(
        'post',
        '/quotes/100/response',
        cookie,
        responseBody({ items: [item({ fobPricePerKg: '0.9', cfrPricePerKg: '0.8' }), second] }),
      );

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'CFR não pode ser menor que FOB.', path: 'items.0.cfrPricePerKg' });
      expectNoQuoteWrites();
    });
  });
});

describe('/api/v1/indent/quotes/:id/accept - aceite unico por solicitacao', () => {
  it('RESPONDIDA -> ACEITA com decidedAt, solicitacao CONVERTIDA e os 2 logs; nenhuma outra cotacao e alterada', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ validUntil: new Date(`${dayKey(10)}T00:00:00.000Z`) }));

    const res = await call('post', '/quotes/100/accept', cookie);

    expect(res.status).toBe(200);
    expect(tx.indentQuote.update).toHaveBeenCalledTimes(1);
    expect(tx.indentQuote.update).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'ACEITA', decidedAt: expect.any(Date) } });
    expect(tx.indentRequest.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: 'CONVERTIDA', statusChangedAt: expect.any(Date) },
    });
    expect(auditActions()).toEqual(['indent_quote.accepted', 'indent_request.status_changed']);
    expect(auditCall('indent_request.status_changed')).toMatchObject({
      entityType: 'indent_request',
      entityId: '11',
      beforeData: { status: 'COTACAO' },
      afterData: { status: 'CONVERTIDA' },
    });
    // Aceite unico: a pergunta e feita com a solicitacao travada, na solicitacao desta cotacao.
    expect(tx.indentQuote.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { requestId: 11, status: 'ACEITA' } }));
  });

  it('2a cotacao da mesma solicitacao -> 409 com a mensagem literal e nada gravado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ id: 101, supplierId: 6 }));
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow({ revision: 1 }));

    const res = await call('post', '/quotes/101/accept', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^Esta solicitação já tem uma cotação aceita \(277\/\d{2} · Beta Corp\)\.$/);
    expectNoQuoteWrites();
  });

  it('cotacao de OUTRA solicitacao e aceita normalmente', async () => {
    const cookie = await loginAs('comprador');
    tx.$queryRaw.mockResolvedValue([{ requestId: 12 }]);
    tx.indentQuote.findUnique.mockResolvedValue(
      respondedQuote({ id: 200, requestId: 12, request: { ...quoteRow().request, id: 12, processNumber: '278/26' } }),
    );

    const res = await call('post', '/quotes/200/accept', cookie);

    expect(res.status).toBe(200);
    expect(tx.indentQuote.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { requestId: 12, status: 'ACEITA' } }));
    expect(tx.indentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12 } }));
  });

  it('validade vencida -> 409 pedindo revisao; vencendo hoje ainda aceita', async () => {
    const cookie = await loginAs('comprador');
    const yesterday = dayKey(-1);
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ validUntil: new Date(`${yesterday}T00:00:00.000Z`) }));

    const expired = await call('post', '/quotes/100/accept', cookie);

    const [year, month, day] = yesterday.split('-');
    expect(expired.status).toBe(409);
    expect(expired.body.message).toBe(`A validade desta cotação venceu em ${day}/${month}/${year}. Peça uma revisão.`);
    expectNoQuoteWrites();

    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ validUntil: new Date(`${dayKey(0)}T00:00:00.000Z`) }));
    expect((await call('post', '/quotes/100/accept', cookie)).status).toBe(200);
  });

  it('solicitacao perdida -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ request: { ...quoteRow().request, status: 'PERDIDA' } }));

    const res = await call('post', '/quotes/100/accept', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/foi marcada como perdida\.$/);
    expectNoQuoteWrites();
  });

  it('corpo com campo (status) -> 400', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote());

    const res = await call('post', '/quotes/100/accept', cookie, { status: 'ACEITA' });

    expect(res.status).toBe(400);
    expectNoQuoteWrites();
  });
});

describe('/api/v1/indent/quotes/:id/refuse - recusa', () => {
  it('RESPONDIDA -> RECUSADA com decidedAt e log; a solicitacao nao muda', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ validUntil: new Date(`${dayKey(-5)}T00:00:00.000Z`) }));

    const res = await call('post', '/quotes/100/refuse', cookie);

    expect(res.status).toBe(200);
    expect(tx.indentQuote.update).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'RECUSADA', decidedAt: expect.any(Date) } });
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(['indent_quote.refused']);
    expect(auditCall('indent_quote.refused')).toMatchObject({ metadata: { afterAcceptance: false } });
  });

  it('continua permitida depois do aceite de outra cotacao', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ id: 101, request: { ...quoteRow().request, status: 'CONVERTIDA' } }));
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('post', '/quotes/101/refuse', cookie);

    expect(res.status).toBe(200);
    expect(auditCall('indent_quote.refused')).toMatchObject({ metadata: { afterAcceptance: true } });
  });
});

describe('/api/v1/indent/quotes/:id/revision - pedir revisao', () => {
  it('cria a R2 em RASCUNHO (max + 1, baseQuoteId = raiz, itens sem preco/embalagem) e marca a original REVISADA', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(
      respondedQuote({
        currency: 'EUR',
        destination: 'Itajaí',
        items: [
          quoteItemRow(201, 21, { packaging: 'Tambor', fobPricePerKg: '0.7', cfrPricePerKg: '0.8' }),
          quoteItemRow(202, 22, { packaging: 'Saco', fobPricePerKg: '1', cfrPricePerKg: '1.2' }),
        ],
      }),
    );

    const res = await call('post', '/quotes/100/revision', cookie);

    expect(res.status).toBe(201);
    expect(tx.indentQuote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 11,
        supplierId: 5,
        revision: 2,
        status: 'RASCUNHO',
        currency: 'EUR',
        incoterm: 'CFR',
        destination: 'Itajaí',
        baseQuoteId: 100,
        createdById: 7,
        items: { create: [{ requestItemId: 21 }, { requestItemId: 22 }] },
      }),
      select: { id: true },
    });
    expect(tx.indentQuote.update).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'REVISADA' } });
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(['indent_quote.revision_requested', 'indent_quote.created_as_revision']);
    expect(auditCall('indent_quote.revision_requested')).toMatchObject({
      entityId: '100',
      metadata: { newQuoteId: 150, revision: 2, newRef: expect.stringMatching(/^R2 - 277\//) },
    });
    expect(auditCall('indent_quote.created_as_revision')).toMatchObject({ entityId: '150' });
  });

  it('revisao de revisao: R2 RESPONDIDA gera a R3 apontando para a R1', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote({ id: 101, revision: 2, baseQuoteId: 100 }));
    tx.indentQuote.aggregate.mockResolvedValue({ _max: { revision: 2 } });

    const res = await call('post', '/quotes/101/revision', cookie);

    expect(res.status).toBe(201);
    expect(tx.indentQuote.create.mock.calls[0]?.[0]).toMatchObject({ data: { revision: 3, baseQuoteId: 100 } });
    expect(tx.indentQuote.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { status: 'REVISADA' } });
    expect(auditCall('indent_quote.revision_requested')).toMatchObject({ metadata: { revision: 3, newRef: expect.stringMatching(/^R3 - 277\//) } });
  });

  it('a excecao HERDA os 4 campos, mesmo se o cliente virou LIVRE', async () => {
    const cookie = await loginAs('comprador');
    const at = new Date('2026-11-10T12:00:00.000Z');
    tx.indentQuote.findUnique.mockResolvedValue(
      respondedQuote({ exceptionReason: 'Cliente pediu', exceptionById: 4, exceptionByName: 'Ana', exceptionAt: at }),
    );

    await call('post', '/quotes/100/revision', cookie);

    expect(tx.indentQuote.create.mock.calls[0]?.[0]).toMatchObject({
      data: { exceptionReason: 'Cliente pediu', exceptionById: 4, exceptionByName: 'Ana', exceptionAt: at },
    });
  });

  it('revisar uma cotacao ja REVISADA -> 409; com ACEITA na solicitacao -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ status: 'REVISADA' }));
    const revised = await call('post', '/quotes/100/revision', cookie);
    expect(revised.status).toBe(409);
    expect(revised.body.message).toBe('Esta cotação está Revisada e não permite pedir revisão.');

    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote());
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());
    const accepted = await call('post', '/quotes/100/revision', cookie);
    expect(accepted.status).toBe(409);
    expect(accepted.body.message).toContain('já tem uma cotação aceita');
    expectNoQuoteWrites();
  });

  it('colisao do @@unique (duas revisoes em paralelo) -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(respondedQuote());
    tx.indentQuote.create.mockRejectedValue(uniqueError(['requestId', 'supplierId', 'revision']));

    const res = await call('post', '/quotes/100/revision', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe uma revisão em andamento para este fornecedor.');
  });
});

describe('/api/v1/indent/quotes/:id - transicao invalida (409, nada gravado)', () => {
  const STATUSES = ['RASCUNHO', 'ENVIADA', 'RESPONDIDA', 'ACEITA', 'RECUSADA', 'REVISADA'];
  const ACTION_PATH: Record<IndentQuoteAction, string> = {
    'mark-sent': 'mark-sent',
    items: 'items',
    response: 'response',
    accept: 'accept',
    refuse: 'refuse',
    revision: 'revision',
  };
  const cases = (Object.keys(QUOTE_TRANSITIONS) as IndentQuoteAction[]).flatMap((action) =>
    STATUSES.filter((status) => !(QUOTE_TRANSITIONS[action] as readonly string[]).includes(status)).map((status) => ({ action, status })),
  );

  it('cobre todas as combinacoes proibidas (6 acoes x status fora da coluna "De")', () => {
    expect(cases).toHaveLength(6 * 6 - 6); // 6 combinacoes permitidas na maquina de estados
  });

  it.each(cases)('$action em cotacao $status -> 409', async ({ action, status }) => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ status }));

    const res = await call('post', `/quotes/100/${ACTION_PATH[action]}`, cookie, bodyOf(action));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^Esta cotação está \w+ e não permite .+\.$/);
    expectNoQuoteWrites();
  });

  it('depois do aceite, nas outras: RASCUNHO nao age; ENVIADA so registra resposta; RESPONDIDA so recusa', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    for (const [status, blocked] of [
      ['RASCUNHO', ['mark-sent', 'items']],
      ['ENVIADA', []],
      ['RESPONDIDA', ['accept', 'revision']],
    ] as Array<[string, IndentQuoteAction[]]>) {
      tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ status, sentAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) }));
      for (const action of blocked) {
        vi.clearAllMocks();
        tx.auditLog.create.mockResolvedValue({});
        const res = await call('post', `/quotes/100/${ACTION_PATH[action]}`, cookie, bodyOf(action));
        expect(res.status, `${status} ${action}`).toBe(409);
        expect(res.body.message, `${status} ${action}`).toContain('já tem uma cotação aceita');
        expectNoQuoteWrites();
      }
    }
  });
});
