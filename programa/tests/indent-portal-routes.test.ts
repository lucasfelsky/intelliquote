import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
vi.mock('../src/mailer/MailerService', async (original) =>
  (await import('./helpers/indentEnvioFixtures')).createMailerModule(await original<Record<string, unknown>>()),
);
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste

import {
  INDENT_MAILBOX,
  INDENT_PORTAL_BAD_LINK_MESSAGE,
  INDENT_PORTAL_CLOSED_MESSAGE,
  INDENT_PORTAL_EXPIRED_MESSAGE,
  INDENT_PORTAL_LOCKED_MESSAGE,
} from '../src/constants/indentPortal';
import { acceptedRow, auditActions, auditCall, dayKey, loginAs, prismaMock, sentQuote, tx, uniqueError } from './helpers/indentRoutesMock';
import {
  FUTURE,
  RAW_TOKEN,
  expectNoPortalWrites,
  expectPortalLockOrder,
  mailerMock,
  nextUa,
  portal,
  portalItem,
  portalQuote,
  portalTokenRow,
  resetPortalMocks,
  respondBody,
  sentMails,
} from './helpers/indentEnvioFixtures';

// Portal PUBLICO do fornecedor do IQ Indent (PR 4a-2): token, enumeracao, view por allowlist, resposta, anexos e download interno.
// Rate limit e lockout sao em memoria por IP + User-Agent: cada requisicao leva um User-Agent novo (nextUa).

beforeEach(resetPortalMocks);

const PT = /(ç|ã|õ|é|í|ó|ú|â|ê|ô|à|Cotação|inválid|não )/;
const NOT_ENGLISH_LEAK = /\b(buyer|purchaser|on behalf of|our customer)\b/i;
const HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');
const url = (suffix = '') => `/${RAW_TOKEN}${suffix}`;

// Nada que o fornecedor receba em erro pode citar comprador nem vir em portugues.
function expectCleanError(res: { status: number; body: Record<string, unknown>; text: string }) {
  expect(res.text).not.toMatch(NOT_ENGLISH_LEAK);
  expect(res.text).not.toMatch(PT);
  expect(typeof res.body.message).toBe('string');
}

function pdf(size = 64, head = '%PDF-1.4\n'): Buffer {
  return Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(Math.max(0, size - head.length), 0x20)]);
}

describe('token e enumeracao', () => {
  it('formato invalido -> 404 unico, sem consultar o banco, com log INVALID bad_format e sem tokenId', async () => {
    for (const bad of ['abc', 'x'.repeat(42), 'x'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(42)}%20`]) {
      prismaMock.indentPortalAccessLog.create.mockClear();
      const res = await portal('get', `/${bad}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: INDENT_PORTAL_BAD_LINK_MESSAGE, code: 'LINK_INVALID' });
      expect(prismaMock.indentPortalAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tokenId: null, kind: 'INVALID', reason: 'bad_format' }),
      });
    }
    expect(prismaMock.indentPortalToken.findUnique).not.toHaveBeenCalled();
  });

  it('inexistente -> o MESMO 404 do formato invalido, log not_found e consulta so pelo hash', async () => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(null);

    const res = await portal('get', url());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: INDENT_PORTAL_BAD_LINK_MESSAGE, code: 'LINK_INVALID' });
    expect(prismaMock.indentPortalToken.findUnique.mock.calls[0]![0].where).toEqual({ tokenHash: HASH });
    expect(prismaMock.indentPortalAccessLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tokenId: null, kind: 'INVALID', reason: 'not_found' }),
    });
  });

  it('5 invalidas -> 6a 429 LOCKED, e o lockout e COMPARTILHADO com /api/portal/:token', async () => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(null);
    const ua = nextUa();

    for (let i = 0; i < 5; i += 1) {
      expect((await portal('get', url(), { ua })).status).toBe(404);
    }
    const locked = await portal('get', url(), { ua });
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ message: INDENT_PORTAL_LOCKED_MESSAGE, code: 'LOCKED' });

    // o mesmo cliente (IP + UA) esta bloqueado tambem no portal do IQ principal
    const { default: request } = await import('supertest');
    const { app } = await import('../src/app');
    const other = await request(app).get(`/api/portal/${'q'.repeat(43)}`).set('User-Agent', ua);
    expect(other.status).toBe(429);
  });

  it('410 (existe mas nao serve) NAO conta como tentativa invalida: nao bloqueia', async () => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ revokedAt: new Date() }));
    const ua = nextUa();

    for (let i = 0; i < 7; i += 1) {
      expect((await portal('get', url(), { ua })).status).toBe(410);
    }
  });

  it('revogado, vencido e cotacao fechada -> 410 com code; o log leva o tokenId e nunca o token nem o hash', async () => {
    const cases: Array<[Record<string, unknown>, string, string, string]> = [
      [{ revokedAt: new Date() }, 'LINK_CLOSED', INDENT_PORTAL_BAD_LINK_MESSAGE, 'revoked'],
      [{ expiresAt: new Date(Date.now() - 1000) }, 'LINK_EXPIRED', INDENT_PORTAL_EXPIRED_MESSAGE, 'expired'],
      [{ quote: { status: 'REVISADA', request: { status: 'COTACAO' } } }, 'LINK_CLOSED', INDENT_PORTAL_CLOSED_MESSAGE, 'closed'],
      [{ quote: { status: 'RASCUNHO', request: { status: 'COTACAO' } } }, 'LINK_CLOSED', INDENT_PORTAL_CLOSED_MESSAGE, 'closed'],
      [{ quote: { status: 'ENVIADA', request: { status: 'PERDIDA' } } }, 'LINK_CLOSED', INDENT_PORTAL_CLOSED_MESSAGE, 'closed'],
    ];

    for (const [override, code, message, reason] of cases) {
      prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow(override));
      prismaMock.indentPortalAccessLog.create.mockClear();

      const res = await portal('get', url());

      expect(res.status).toBe(410);
      // So o vencido leva referencia e validade (a tela "Link expired"); revogado e fechado seguem so { message, code }.
      expect(res.body).toEqual(
        code === 'LINK_EXPIRED' ? { message, code, processRef: '277/26', expiresAt: (override.expiresAt as Date).toISOString() } : { message, code },
      );
      expectCleanError(res);
      const logged = JSON.stringify(prismaMock.indentPortalAccessLog.create.mock.calls);
      expect(logged).toContain(`"reason":"${reason}"`);
      expect(logged).toContain('"tokenId":900');
      expect(logged).not.toContain(RAW_TOKEN);
      expect(logged).not.toContain(HASH);
    }
  });

  it('410 LINK_EXPIRED: referencia da revisao ("R2 - ...") e validade ISO, sem cliente, parceria, token nem hash; o resto do corpo nao muda', async () => {
    const expiresAt = new Date('2026-11-10T14:00:00.000Z');
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(
      portalTokenRow({ expiresAt, showClientName: true, quote: { status: 'ENVIADA', revision: 2, request: { status: 'COTACAO', processNumber: '275/26' } } }),
    );

    const res = await portal('get', url());

    expect(res.status).toBe(410);
    expect(res.body).toStrictEqual({ message: INDENT_PORTAL_EXPIRED_MESSAGE, code: 'LINK_EXPIRED', processRef: 'R2 - 275/26', expiresAt: '2026-11-10T14:00:00.000Z' });
    expectCleanError(res);
    expect(res.text).not.toMatch(/Itaja|12345678000195|Acme|Santos|partner|hasPartnership|supplier|tokenId|quoteId/i);
    expect(res.text).not.toContain(RAW_TOKEN);
    expect(res.text).not.toContain(HASH);
    // POST com link vencido passa pelo mesmo resolve: mesmo corpo.
    const post = await portal('post', url('/respond'), { body: respondBody() });
    expect(post.status).toBe(410);
    expect(post.body).toStrictEqual(res.body);
    expectNoPortalWrites();
  });

  it('404 (formato invalido e inexistente) nao ganha processRef nem expiresAt', async () => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(null);

    for (const path of [`/${'a'.repeat(42)}!`, url()]) {
      const res = await portal('get', path);

      expect(res.status).toBe(404);
      expect(res.body).toStrictEqual({ message: INDENT_PORTAL_BAD_LINK_MESSAGE, code: 'LINK_INVALID' });
    }
  });

  it('todas as respostas levam Cache-Control: no-store (200, 404, 410, 400)', async () => {
    const ok = await portal('get', url());
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(null);
    const notFound = await portal('get', url());
    const malformed = await portal('get', '/abc');

    for (const res of [ok, notFound, malformed]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(ok.status).toBe(200);
  });

  it('erros 400/404/410/413/500 nunca citam comprador nem vem em portugues (inclusive erro nao-HttpError)', async () => {
    const bodies = [
      (await portal('post', url('/respond'), { body: respondBody({ currency: 'BRL' }) })),
      (await portal('post', url('/respond'), { body: { items: 'x' } })),
    ];
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(null);
    bodies.push(await portal('get', url()));
    prismaMock.indentPortalToken.findUnique.mockRejectedValue(new Error('Falha interna em portugues: conexão'));
    const boom = await portal('get', url());
    bodies.push(boom);

    expect(boom.status).toBe(500);
    for (const res of bodies) {
      expectCleanError(res);
    }
  });
});

describe('view (GET) por allowlist', () => {
  const VIEW_KEYS = [
    'attachments', 'currency', 'destination', 'endCustomer', 'expiresAt', 'incoterm', 'items', 'manufacturerRequired', 'message',
    'options', 'previousOffer', 'processRef', 'requestType', 'requestedBy', 'response', 'revision', 'state',
  ].sort();

  it('chaves EXATAS (nenhum campo extra) e valores do estado open', async () => {
    const res = await portal('get', url());

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(VIEW_KEYS);
    expect(res.body).toMatchObject({
      state: 'open',
      processRef: '277/26',
      revision: 1,
      requestedBy: 'SQ Quimica',
      requestType: 'Indent',
      destination: 'Santos',
      incoterm: 'CFR',
      currency: 'USD',
      endCustomer: null,
      message: null,
      manufacturerRequired: true,
      previousOffer: null,
      response: null,
      attachments: [],
    });
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['cas', 'name', 'quantityKg', 'quoteItemId']);
    expect(res.body.items[0]).toEqual({ quoteItemId: 201, name: 'Zinco', cas: '7440-66-6', quantityKg: '25000.000' });
    expect(Object.keys(res.body.options).sort()).toEqual(['currencies', 'maxFileBytes', 'maxFiles', 'packaging', 'paymentTerms']);
    expect(res.body.options.packaging).toEqual(['25 kg bag', '50 kg bag', '200 kg drum', '1,000 kg IBC', 'Bulk']);
    expect(res.body.options.paymentTerms).toEqual([
      'T/T 30 days after B/L date', 'T/T 60 days after B/L date', 'T/T 90 days after B/L date', 'L/C at sight', 'Other, see notes',
    ]);
    expect(res.body.options.maxFiles).toBe(5);
    expect(res.body.options.maxFileBytes).toBe(10 * 1024 * 1024);
  });

  it('dado interno NUNCA sai: dono, e-mails, notas, Pipedrive, CNPJ, cidade, excecao e outras cotacoes', async () => {
    const base = portalQuote();
    prismaMock.indentQuote.findUnique.mockResolvedValue({
      ...base,
      notes: 'nota interna da Compras',
      exceptionReason: 'motivo interno',
      createdById: 7,
      request: { ...base.request, ownerName: 'Dono Interno', dealTitle: 'Negocio X', rawNote: 'rascunho da nota', noteSupplierHint: 'dica', client: { ...base.request.client, city: 'Itajai' } },
      supplier: { ...base.supplier, contactName: 'Fulano', contactEmails: ['interno@sq.test'] },
    });

    const res = await portal('get', url());
    const json = JSON.stringify(res.body);

    for (const secret of ['nota interna', 'motivo interno', 'Dono Interno', 'Negocio X', 'rascunho da nota', 'dica', 'Itajai', 'Fulano', 'interno@sq.test', '12345678000195', 'cnpj']) {
      expect(json).not.toContain(secret);
    }
  });

  it('registra VIEW e atualiza o token (firstSeenAt na 1a vez, lastSeenAt, accessCount + 1)', async () => {
    const res = await portal('get', url());

    expect(res.status).toBe(200);
    expect(prismaMock.indentPortalAccessLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenId: 900, kind: 'VIEW', reason: null }) });
    const data = prismaMock.indentPortalToken.update.mock.calls[0]![0].data;
    expect(data.accessCount).toEqual({ increment: 1 });
    expect(data.firstSeenAt).toBeInstanceOf(Date);
    expect(data.lastSeenAt).toBeInstanceOf(Date);
  });

  it('segundo acesso preserva firstSeenAt', async () => {
    const first = new Date('2026-11-01T10:00:00Z');
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ firstSeenAt: first }));

    await portal('get', url());

    expect(prismaMock.indentPortalToken.update.mock.calls[0]![0].data.firstSeenAt).toEqual(first);
  });

  it('falha ao gravar o log/atualizar o token NAO derruba a view', async () => {
    prismaMock.indentPortalAccessLog.create.mockRejectedValue(new Error('db'));
    prismaMock.indentPortalToken.update.mockRejectedValue(new Error('db'));

    expect((await portal('get', url())).status).toBe(200);
  });

  it('fabricante obrigatorio so para TRADING', async () => {
    prismaMock.indentQuote.findUnique.mockResolvedValue(portalQuote({ supplier: { name: 'Acme', hasPartnership: false, type: 'FABRICANTE' } }));

    expect((await portal('get', url())).body.manufacturerRequired).toBe(false);
  });

  it('endCustomer: so com parceria ATUAL + opcao do envio; parceria desligada depois some com o cliente', async () => {
    const withPartnership = portalQuote({ supplier: { name: 'Acme', hasPartnership: true, type: 'TRADING' } });
    prismaMock.indentQuote.findUnique.mockResolvedValue(withPartnership);
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ showClientName: true }));
    expect((await portal('get', url())).body.endCustomer).toBe('Indústria Química Vale do Itajaí Ltda');

    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ showClientName: false }));
    expect((await portal('get', url())).body.endCustomer).toBeNull();

    prismaMock.indentQuote.findUnique.mockResolvedValue(portalQuote());
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ showClientName: true }));
    expect((await portal('get', url())).body.endCustomer).toBeNull();
  });

  it('revision: previousOffer casa por requestItemId, embalagem fora das 5 opcoes vira null e nao ha notes', async () => {
    prismaMock.indentQuote.findUnique.mockResolvedValue(portalQuote({ revision: 2 }));
    prismaMock.indentQuote.findFirst.mockResolvedValue({
      currency: 'EUR',
      productionLeadTimeDays: 25,
      paymentTerms: 'T/T 60 days after B/L date',
      validUntil: new Date('2026-12-30T00:00:00Z'),
      manufacturer: 'Acme Works',
      notes: 'nota interna da R1',
      items: [
        { requestItemId: 22, packaging: '  50 KG   bag ', fobPricePerKg: '1.2', cfrPricePerKg: '1.35' },
        { requestItemId: 21, packaging: 'Pallet 1t', fobPricePerKg: '0.7', cfrPricePerKg: '0.795' },
      ],
    });

    const res = await portal('get', url());

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('revision');
    expect(prismaMock.indentQuote.findFirst.mock.calls[0]![0].where).toEqual({ requestId: 11, supplierId: 5, revision: 1 });
    expect(Object.keys(res.body.previousOffer).sort()).toEqual(['currency', 'items', 'manufacturer', 'paymentTerms', 'productionLeadTimeDays', 'validUntil']);
    expect(res.body.previousOffer.validUntil).toBe('2026-12-30');
    expect(res.body.previousOffer.items).toEqual([
      { quoteItemId: 201, packaging: null, fobPricePerKg: '0.7000', cfrPricePerKg: '0.7950' },
      { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '1.2000', cfrPricePerKg: '1.3500' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('nota interna');
  });

  it('sent (resposta do portal): inclui a resposta e a observacao do fornecedor, e os anexos', async () => {
    prismaMock.indentQuote.findUnique.mockResolvedValue(portalQuote({ status: 'RESPONDIDA', respondedAt: new Date() }));
    prismaMock.indentPortalResponse.findUnique.mockResolvedValue({
      version: 2,
      submittedAt: new Date('2026-11-15T10:00:00Z'),
      currency: 'USD',
      productionLeadTimeDays: 20,
      paymentTerms: 'L/C at sight',
      validUntil: new Date('2026-12-15T00:00:00Z'),
      manufacturer: 'Acme Works',
      notes: 'Prices ex-works.',
      items: [{ quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.7', cfrPricePerKg: '0.795' }],
    });
    prismaMock.indentPortalAttachment.findMany.mockResolvedValue([{ id: 61, fileName: 'tds.pdf', fileSize: 1234, createdAt: new Date() }]);

    const res = await portal('get', url());

    expect(res.body.state).toBe('sent');
    expect(Object.keys(res.body.response).sort()).toEqual([
      'currency', 'items', 'manufacturer', 'notes', 'paymentTerms', 'productionLeadTimeDays', 'submittedAt', 'validUntil', 'version', 'via',
    ]);
    expect(res.body.response).toMatchObject({ via: 'portal', version: 2, notes: 'Prices ex-works.', validUntil: '2026-12-15' });
    expect(res.body.attachments).toEqual([expect.objectContaining({ id: 61, fileName: 'tds.pdf', fileSize: 1234 })]);
  });

  it('sent (resposta MANUAL): a observacao interna da Compras NUNCA vai ao portal', async () => {
    prismaMock.indentQuote.findUnique.mockResolvedValue(
      portalQuote({
        status: 'RESPONDIDA',
        respondedAt: new Date('2026-11-14T12:00:00Z'),
        validUntil: new Date('2026-12-20T00:00:00Z'),
        productionLeadTimeDays: 15,
        paymentTerms: 'T/T 30 dias',
        manufacturer: 'Acme Works',
        notes: 'observacao interna: cliente Vale Verde pediu desconto',
        items: [portalItem(201, 21, 'Zinco', { packaging: '25 kg bag', fobPricePerKg: '0.7', cfrPricePerKg: '0.8' })],
      }),
    );

    const res = await portal('get', url());

    expect(res.body.state).toBe('sent');
    expect(res.body.response).toMatchObject({ via: 'manual', version: null, notes: null, productionLeadTimeDays: 15 });
    expect(JSON.stringify(res.body)).not.toContain('observacao interna');
    expect(JSON.stringify(res.body)).not.toContain('Vale Verde');
  });
});

describe('resposta (POST /respond)', () => {
  it('1a resposta: 201 versao 1; grava resposta, itens (Decimal) e copia para a cotacao RESPONDIDA; solicitacao COTACAO -> RESPONDIDA com ator null', async () => {
    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 1, revised: false, unchanged: false });
    expectPortalLockOrder();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);

    const created = tx.indentPortalResponse.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ quoteId: 100, lastTokenId: 900, currency: 'USD', productionLeadTimeDays: 20, version: 1, paymentTerms: 'T/T 30 days after B/L date' });
    const items = tx.indentPortalResponseItem.createMany.mock.calls[0]![0].data;
    expect(items.map((i: { quoteItemId: number; fobPricePerKg: { toFixed: (n: number) => string } }) => [i.quoteItemId, i.fobPricePerKg.toFixed(4)])).toEqual([[201, '0.7000'], [202, '1.2000']]);

    const quoteUpdate = tx.indentQuote.update.mock.calls[0]![0].data;
    expect(quoteUpdate).toMatchObject({ status: 'RESPONDIDA', currency: 'USD', productionLeadTimeDays: 20, manufacturer: 'Acme Works', notes: 'Prices ex-works.' });
    expect(quoteUpdate.respondedAt).toBeInstanceOf(Date);
    expect(tx.indentQuoteItem.update).toHaveBeenCalledTimes(2);
    expect(tx.indentQuoteItem.update.mock.calls[1]![0]).toMatchObject({ where: { id: 202 }, data: { packaging: '50 kg bag' } });
    expect(tx.indentRequest.update).toHaveBeenCalledWith({ where: { id: 11 }, data: expect.objectContaining({ status: 'RESPONDIDA' }) });

    expect(auditActions()).toEqual(['indent_request.status_changed', 'indent_quote.portal_submit']);
    expect(tx.auditLog.create.mock.calls.every((c) => c[0].data.performedById === null)).toBe(true);
    expect(auditCall('indent_quote.portal_submit')).toMatchObject({
      entityId: '100',
      metadata: { via: 'portal', version: 1, afterAcceptance: false, tokenId: 900 },
    });
  });

  it('o portal NUNCA grava ACEITA (nem em quote.update, nem no AuditLog)', async () => {
    await portal('post', url('/respond'), { body: respondBody() });

    expect(JSON.stringify([tx.indentQuote.update.mock.calls, tx.auditLog.create.mock.calls, tx.indentRequest.update.mock.calls])).not.toContain('ACEITA');
  });

  it('depois do commit: log SUBMIT e aviso a Compras (autor do envio), sem token nem preco', async () => {
    prismaMock.indentMailLog.findFirst.mockResolvedValue({ sentById: 7 });
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Ana Compradora', email: 'ana@sq.test', isActive: true, role: { name: 'comprador' } });

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(201);
    expect(prismaMock.indentPortalAccessLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenId: 900, kind: 'SUBMIT' }) });
    const [mail] = sentMails();
    expect(mail).toMatchObject({ to: { email: 'ana@sq.test' }, templateId: 'indent_response_received', relatedEntityType: 'indent_quote', relatedEntityId: '100' });
    expect(mail.subject).toBe('[IQ Indent] Resposta de Acme Chemicals na cotação 277/26');
    expect(mail.templateVars).toEqual({ quoteId: 100, version: 1, afterAcceptance: false });
    expect(mail.html).toContain('/indent/cotacoes?cotacao=100');
    expect(JSON.stringify(mail)).not.toContain(RAW_TOKEN);
    expect(JSON.stringify(mail)).not.toMatch(/0\.795|1\.35/);
  });

  it('aviso: sem IndentMailLog (ou autor inativo/comercial) vai para a caixa do Indent', async () => {
    await portal('post', url('/respond'), { body: respondBody() });
    expect(sentMails()[0]!.to.email).toBe(INDENT_MAILBOX);

    mailerMock.sendAndLog.mockClear();
    prismaMock.indentMailLog.findFirst.mockResolvedValue({ sentById: 7 });
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Inativo', email: 'x@sq.test', isActive: false, role: { name: 'comprador' } });
    await portal('post', url('/respond'), { body: respondBody({ productionLeadTimeDays: 21 }) });
    expect(sentMails()[0]!.to.email).toBe(INDENT_MAILBOX);
  });

  it('SMTP lento (aviso que nunca termina): o 201 volta em ~5 s e o aviso segue em segundo plano', async () => {
    mailerMock.sendAndLog.mockReturnValue(new Promise(() => undefined));
    const started = Date.now();

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500); // esperou o teto, nao desistiu antes
    expect(mailerMock.sendAndLog).toHaveBeenCalledTimes(1);
  }, 20000);

  it('falha no aviso (SMTP/usuario) NAO altera o 201', async () => {
    mailerMock.sendAndLog.mockRejectedValue(new Error('smtp down'));

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
  });

  it('2a resposta DIFERENTE: versao 2, snapshot da versao anterior, itens recriados e aviso com a versao', async () => {
    const stored = {
      id: 50, version: 1, submittedAt: new Date('2026-11-14T10:00:00Z'), currency: 'USD', productionLeadTimeDays: 20,
      paymentTerms: 'T/T 30 days after B/L date', validUntil: new Date(`${dayKey(20)}T00:00:00Z`), manufacturer: 'Acme Works', notes: 'Prices ex-works.',
      items: [
        { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.7', cfrPricePerKg: '0.795' },
        { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '1.2', cfrPricePerKg: '1.35' },
      ],
    };
    tx.indentPortalResponse.findUnique.mockResolvedValue(stored);
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ status: 'RESPONDIDA', respondedAt: new Date() }));

    const res = await portal('post', url('/respond'), { body: respondBody({ productionLeadTimeDays: 30 }) });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 2, revised: true, unchanged: false });
    expect(tx.indentPortalResponseRevision.create.mock.calls[0]![0].data).toMatchObject({
      responseId: 50, version: 1, snapshot: expect.objectContaining({ productionLeadTimeDays: 20 }),
    });
    expect(tx.indentPortalResponse.update.mock.calls[0]![0]).toMatchObject({ where: { id: 50 }, data: { version: 2, productionLeadTimeDays: 30 } });
    expect(tx.indentPortalResponseItem.deleteMany).toHaveBeenCalledWith({ where: { responseId: 50 } });
    expect(tx.indentPortalResponse.create).not.toHaveBeenCalled();
    expect(auditActions()).toContain('indent_quote.portal_revise');
    expect(sentMails()[0]!.subject).toContain('(versão 2)');
  });

  it('resposta IDENTICA e idempotente: 200 unchanged, sem versao, sem gravar, sem log SUBMIT e sem aviso', async () => {
    tx.indentPortalResponse.findUnique.mockResolvedValue({
      id: 50, version: 3, submittedAt: new Date('2026-11-14T10:00:00Z'), currency: 'USD', productionLeadTimeDays: 20,
      paymentTerms: 'T/T 30 days after B/L date', validUntil: new Date(`${dayKey(20)}T00:00:00Z`), manufacturer: 'Acme Works', notes: 'Prices ex-works.',
      items: [
        { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '1.2000', cfrPricePerKg: '1.3500' },
        { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.7', cfrPricePerKg: '0.795' },
      ],
    });
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ status: 'RESPONDIDA', respondedAt: new Date() }));

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 3, revised: true, unchanged: true });
    expectNoPortalWrites();
    expect(tx.indentPortalResponseItem.deleteMany).not.toHaveBeenCalled();
    expect(mailerMock.sendAndLog).not.toHaveBeenCalled();
    expect(prismaMock.indentPortalAccessLog.create).not.toHaveBeenCalled();
  });

  const INVALID: Array<[string, Record<string, unknown>, string, string]> = [
    ['moeda fora de USD/EUR', { currency: 'BRL' }, 'Choose the currency.', 'currency'],
    ['prazo 0', { productionLeadTimeDays: 0 }, 'Production lead time must be 1 to 365 days.', 'productionLeadTimeDays'],
    ['prazo 366', { productionLeadTimeDays: 366 }, 'Production lead time must be 1 to 365 days.', 'productionLeadTimeDays'],
    ['prazo fracionado', { productionLeadTimeDays: 1.5 }, 'Production lead time must be 1 to 365 days.', 'productionLeadTimeDays'],
    ['pagamento fora da lista', { paymentTerms: 'Net 45' }, 'Choose the payment terms.', 'paymentTerms'],
    ['validade invalida', { validUntil: '2026-13-40' }, 'Enter the validity date.', 'validUntil'],
    ['validade no passado', { validUntil: dayKey(-1) }, 'The validity must be between today and 365 days from today.', 'validUntil'],
    ['validade > 365 dias', { validUntil: dayKey(366) }, 'The validity must be between today and 365 days from today.', 'validUntil'],
    ['TRADING sem fabricante', { manufacturer: '   ' }, 'Please inform the manufacturer.', 'manufacturer'],
    ['campo extra', { status: 'ACEITA' }, 'Field not allowed.', ''],
    ['embalagem fora da lista', { items: [{ quoteItemId: 201, packaging: 'Pallet', fobPricePerKg: '1', cfrPricePerKg: '2' }, { quoteItemId: 202, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'Choose the packaging for every item.', 'items.0.packaging'],
    ['preco zero', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '0', cfrPricePerKg: '2' }, { quoteItemId: 202, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'The price must be greater than zero.', 'items.0.fobPricePerKg'],
    ['preco com 5 casas', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '1.00001', cfrPricePerKg: '2' }, { quoteItemId: 202, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'Use up to 4 decimal places.', 'items.0.fobPricePerKg'],
    ['preco negativo', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '-1', cfrPricePerKg: '2' }, { quoteItemId: 202, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'Use up to 4 decimal places.', 'items.0.fobPricePerKg'],
    ['CFR menor que FOB', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '2', cfrPricePerKg: '1.9999' }, { quoteItemId: 202, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'CFR cannot be lower than FOB.', 'items.0.cfrPricePerKg'],
    ['item repetido', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }, { quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'Duplicated item.', 'items.1.quoteItemId'],
    ['item faltando', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'Please fill in every item.', 'items'],
    ['item de OUTRA cotacao', { items: [{ quoteItemId: 201, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }, { quoteItemId: 999, packaging: 'Bulk', fobPricePerKg: '1', cfrPricePerKg: '2' }] }, 'Please fill in every item.', 'items'],
  ];

  it.each(INVALID)('validacao: %s -> 400 em ingles com path e nada gravado', async (_name, override, message, path) => {
    const res = await portal('post', url('/respond'), { body: respondBody(override) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message, path });
    expectCleanError(res);
    expectNoPortalWrites();
    expect(tx.indentPortalResponse.create).not.toHaveBeenCalled();
  });

  it('fornecedor que nao e TRADING nao precisa informar o fabricante', async () => {
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ supplier: { id: 5, name: 'Acme', country: 'China', contactName: null, hasPartnership: false, type: 'FABRICANTE' } }));

    const res = await portal('post', url('/respond'), { body: respondBody({ manufacturer: null }) });

    expect(res.status).toBe(201);
    expect(tx.indentPortalResponse.create.mock.calls[0]![0].data.manufacturer).toBeNull();
  });

  it('link vencido ou revogado ENTRE o GET e o POST: 410 sem gravar (rechecado dentro da trava)', async () => {
    tx.indentPortalToken.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
    const expired = await portal('post', url('/respond'), { body: respondBody() });
    tx.indentPortalToken.findUnique.mockResolvedValue({ revokedAt: new Date(), expiresAt: FUTURE });
    const revoked = await portal('post', url('/respond'), { body: respondBody() });

    expect(expired.status).toBe(410);
    expect(expired.body).toEqual({ message: INDENT_PORTAL_EXPIRED_MESSAGE, code: 'LINK_EXPIRED' });
    expect(revoked.status).toBe(410);
    expect(revoked.body.code).toBe('LINK_CLOSED');
    expectNoPortalWrites();
  });

  it('cotacao mudou para fechada DENTRO da trava (ex.: a Compras pediu revisao): 410 e nada gravado', async () => {
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ status: 'REVISADA' }));

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(410);
    expectNoPortalWrites();
  });

  it('erro inesperado dentro da transacao -> 500 generico em ingles (sem vazar a mensagem)', async () => {
    tx.indentPortalResponse.create.mockRejectedValue(new Error('segredo interno do banco'));

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('segredo');
    expectCleanError(res);
  });
});

describe('apos aceite (resposta tardia da cotacao que nao foi aceita)', () => {
  it('ENVIADA com OUTRA cotacao ACEITA: 201 afterAcceptance, solicitacao continua CONVERTIDA e o aviso avisa', async () => {
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ request: { id: 11, processNumber: '277/26', status: 'CONVERTIDA', client: { id: 3, name: 'X', city: 'Y', supplierRuleMode: 'LIVRE' } } }));
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await portal('post', url('/respond'), { body: respondBody() });

    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
    expect(tx.indentRequest.update).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(['indent_quote.portal_submit']);
    expect(auditCall('indent_quote.portal_submit')).toMatchObject({ metadata: { afterAcceptance: true, version: 1 } });
    expect(sentMails()[0]!.subject).toBe('[IQ Indent] Resposta de Acme Chemicals na cotação 277/26 (após aceite de outra cotação)');
    expect(sentMails()[0]!.templateVars.afterAcceptance).toBe(true);
    expect(JSON.stringify(tx.indentQuote.update.mock.calls)).not.toContain('ACEITA');
  });

  it('a view do portal nao tem nenhuma chave nem valor com "accept" quando outra cotacao foi aceita', async () => {
    prismaMock.indentQuote.findUnique.mockResolvedValue(portalQuote({ request: { processNumber: '277/26', status: 'CONVERTIDA', client: portalQuote().request.client } }));
    prismaMock.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await portal('get', url());

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/accept|aceit|convert/i);
  });

  it.each(['ACEITA', 'RECUSADA', 'REVISADA'])('a PROPRIA cotacao %s -> 410 LINK_CLOSED no GET e no POST, nada gravado', async (status) => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ quote: { status, request: { status: 'CONVERTIDA' } } }));

    const get = await portal('get', url());
    const post = await portal('post', url('/respond'), { body: respondBody() });

    expect([get.status, post.status]).toEqual([410, 410]);
    expect(post.body).toEqual({ message: INDENT_PORTAL_CLOSED_MESSAGE, code: 'LINK_CLOSED' });
    expectNoPortalWrites();
  });

  it('solicitacao PERDIDA: 410 no resolve e tambem dentro da trava (nada gravado)', async () => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow({ quote: { status: 'ENVIADA', request: { status: 'PERDIDA' } } }));
    expect((await portal('post', url('/respond'), { body: respondBody() })).status).toBe(410);

    resetPortalMocks();
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ request: { id: 11, processNumber: '277/26', status: 'PERDIDA', client: { id: 3, name: 'X', city: 'Y', supplierRuleMode: 'LIVRE' } } }));
    expect((await portal('post', url('/respond'), { body: respondBody() })).status).toBe(410);
    expectNoPortalWrites();
  });
});

describe('anexos do fornecedor (POST /attachments)', () => {
  const upload = (body: Buffer | string, extra: { type?: string; name?: string; token?: string } = {}) =>
    portal('post', `/${extra.token ?? RAW_TOKEN}/attachments`, {
      body: body as Buffer,
      type: extra.type ?? 'application/pdf',
      headers: extra.name !== undefined ? { 'X-File-Name': extra.name } : {},
    });

  it('token invalido -> 404 sem ler o corpo (Connection: close) e nada gravado', async () => {
    prismaMock.indentPortalToken.findUnique.mockResolvedValue(null);

    // keep-alive pedido de proposito: sem `Connection: close` do servidor o corpo nao lido sujaria a conexao reaproveitada
    const res = await portal('post', url('/attachments'), { body: pdf(2048), type: 'application/pdf', headers: { Connection: 'keep-alive' } });

    expect(res.status).toBe(404);
    expect(res.headers.connection).toBe('close');
    expect(res.body.code).toBe('LINK_INVALID');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expectNoPortalWrites();
  });

  it('PDF valido: 201 com {id, fileName, fileSize}; grava o arquivo e o AuditLog so com nome, tamanho e sha256', async () => {
    const file = pdf(500);

    const res = await upload(file, { name: encodeURIComponent('Relatorio TDS.pdf') });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 61, fileName: 'Relatorio TDS.pdf', fileSize: 500 });
    expectPortalLockOrder();
    expect(tx.indentPortalAttachment.create.mock.calls[0]![0].data).toMatchObject({
      quoteId: 100, tokenId: 900, mimeType: 'application/pdf', fileSize: 500, sha256: createHash('sha256').update(file).digest('hex'),
    });
    expect(Buffer.from(tx.indentPortalAttachmentFile.create.mock.calls[0]![0].data.data).equals(file)).toBe(true);
    expect(auditCall('indent_quote.portal_attachment_added')).toMatchObject({
      performedById: null,
      afterData: expect.objectContaining({ fileName: 'Relatorio TDS.pdf', fileSize: 500 }),
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(RAW_TOKEN);
    expect(prismaMock.indentPortalAccessLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tokenId: 900, kind: 'UPLOAD' }) });
  });

  it('nome do arquivo saneado: sem caminho, aspas, controle; ".pdf" garantido; nome sem X-File-Name ou malformado tem padrao', async () => {
    const dirty = await upload(pdf(100), { name: encodeURIComponent('..\\..\\etc/pass"wd<>|*?.txt\r\n') });
    const noHeader = await upload(pdf(101));
    const broken = await upload(pdf(102), { name: '%E0%A4%A' });

    expect(dirty.body.fileName).toBe('....etcpasswd.txt.pdf');
    expect(dirty.body.fileName).not.toMatch(/[\\/"<>|*?\r\n]/);
    expect(noHeader.body.fileName).toBe('attachment.pdf');
    expect(broken.body.fileName).toBe('attachment.pdf');
  });

  it('nao e PDF: Content-Type errado, magic number errado ou corpo vazio -> 400 NOT_PDF e nada gravado', async () => {
    const wrongType = await upload(pdf(100), { type: 'text/plain' });
    const wrongMagic = await upload(Buffer.from('MZ not a pdf at all'));
    const empty = await upload(Buffer.alloc(0));

    for (const res of [wrongType, wrongMagic, empty]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Only PDF files are allowed.', code: 'NOT_PDF' });
    }
    expectNoPortalWrites();
  });

  it('maior que 10 MB -> 413 FILE_TOO_LARGE (e exatamente 10 MB passa)', async () => {
    const tooBig = await upload(pdf(10 * 1024 * 1024 + 1));
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ message: 'The file is larger than 10 MB.', code: 'FILE_TOO_LARGE' });
    expectNoPortalWrites();
    // quem barra e o limite do `express.raw` (antes do servico): nenhuma transacao/trava foi aberta
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();

    const exact = await upload(pdf(10 * 1024 * 1024));
    expect(exact.status).toBe(201);
  });

  it('6o arquivo -> 409 TOO_MANY_FILES; mesmo arquivo repetido -> 200 com o existente (sem recriar)', async () => {
    tx.indentPortalAttachment.count.mockResolvedValue(5);
    const sixth = await upload(pdf(300));
    expect(sixth.status).toBe(409);
    expect(sixth.body).toEqual({ message: 'You can attach up to 5 files.', code: 'TOO_MANY_FILES' });
    expect(tx.indentPortalAttachment.create).not.toHaveBeenCalled();

    tx.indentPortalAttachment.findFirst.mockResolvedValue({ id: 33, fileName: 'old.pdf', fileSize: 300 });
    const repeated = await upload(pdf(300));
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual({ id: 33, fileName: 'old.pdf', fileSize: 300 });
    expect(tx.indentPortalAttachment.findFirst.mock.calls[0]![0].where).toMatchObject({ quoteId: 100, sha256: createHash('sha256').update(pdf(300)).digest('hex') });
    expect(tx.indentPortalAttachment.create).not.toHaveBeenCalled();
  });

  it('corrida no mesmo arquivo (P2002 do unique quoteId+sha256): 200 com o existente', async () => {
    tx.indentPortalAttachment.create.mockRejectedValue(uniqueError(['quoteId', 'sha256']));
    prismaMock.indentPortalAttachment.findFirst.mockResolvedValue({ id: 34, fileName: 'x.pdf', fileSize: 64 });

    const res = await upload(pdf(64));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 34, fileName: 'x.pdf', fileSize: 64 });
  });

  it('cotacao fechada ou link vencido entre o resolve e a gravacao: 410 e nada gravado', async () => {
    tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ status: 'RECUSADA' }));
    expect((await upload(pdf(80))).status).toBe(410);

    tx.indentQuote.findUnique.mockResolvedValue(sentQuote());
    tx.indentPortalToken.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() - 1) });
    expect((await upload(pdf(81))).status).toBe(410);
    expectNoPortalWrites();
  });
});

describe('download interno do anexo', () => {
  const file = { fileName: 'Relatório "Ação" (final)*.pdf', mimeType: 'application/pdf', file: { data: Buffer.from('%PDF-1.4 conteudo') } };

  it('viewer le: PDF byte a byte, nosniff e Content-Disposition RFC 5987', async () => {
    const { call } = await import('./helpers/indentRoutesMock');
    const cookie = await loginAs('viewer');
    prismaMock.indentPortalAttachment.findFirst.mockResolvedValue(file);

    const res = await call('get', '/quotes/100/portal-attachments/61', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="Relat_rio _A__o_ (final)*.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%22A%C3%A7%C3%A3o%22%20%28final%29%2A.pdf`,
    );
    expect(Buffer.from(res.body).toString()).toBe('%PDF-1.4 conteudo');
    expect(prismaMock.indentPortalAttachment.findFirst.mock.calls[0]![0].where).toEqual({ id: 61, quoteId: 100 });
  });

  it('comercial 403; anexo de OUTRA cotacao 404; ids invalidos 400', async () => {
    const { call } = await import('./helpers/indentRoutesMock');
    expect((await call('get', '/quotes/100/portal-attachments/61', await loginAs('comercial'))).status).toBe(403);

    const cookie = await loginAs('comprador');
    prismaMock.indentPortalAttachment.findFirst.mockResolvedValue(null);
    const other = await call('get', '/quotes/100/portal-attachments/99', cookie);
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ message: 'Anexo não encontrado.' });
    expect((await call('get', '/quotes/100/portal-attachments/abc', cookie)).status).toBe(400);
    expect((await call('get', '/quotes/abc/portal-attachments/1', cookie)).status).toBe(400);
  });

  it('sem login -> 401', async () => {
    const { getApp } = await import('./helpers/indentRoutesMock');
    const { default: request } = await import('supertest');

    expect((await request(await getApp()).get('/api/v1/indent/quotes/100/portal-attachments/61')).status).toBe(401);
  });
});

describe('IndentPortalRoutes: contrato de importacao do PortalRoutes', () => {
  it('nao herda a mensagem "contact your buyer" nem os helpers de token/erro do portal do IQ', async () => {
    const { readFileSync } = await import('node:fs');
    const sources = ['src/routes/IndentPortalRoutes.ts', 'src/services/IndentPortalService.ts', 'src/constants/indentPortal.ts'].map((f) => readFileSync(f, 'utf8'));

    for (const source of sources) {
      expect(source).not.toMatch(/PORTAL_INVALID_LINK_MESSAGE|getTokenFromRequest|portalErrorBody|portalFallbackMessage/);
      expect(source).not.toMatch(/\b(buyer|purchaser|on behalf of|our customer)\b/i);
    }
  });
});

describe('aviso a Compras (renderIndentResponseReceived)', () => {
  it('escapa o nome do fornecedor, limpa CR/LF do assunto, nao reprocessa {{x}} e so mostra o aviso de aceite quando cabe', async () => {
    const { renderIndentResponseReceived } = await import('../src/mailer/renderIndentResponseReceived');
    const evil = renderIndentResponseReceived({
      supplierName: 'A&B <script>alert(1)</script> "Q"\r\nBcc: x@y.test {{ref}}',
      ref: 'R2 - 277/26',
      version: 2,
      afterAcceptance: false,
      quoteUrl: 'https://app.test/indent/cotacoes?cotacao=100&x="1"',
    });

    expect(evil.subject).not.toMatch(/[\r\n]/);
    expect(evil.subject).toBe('[IQ Indent] Resposta de A&B <script>alert(1)</script> "Q" Bcc: x@y.test {{ref}} na cotação R2 - 277/26 (versão 2)');
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).toContain('A&amp;B &lt;script&gt;');
    expect(evil.html).toContain('cotacao=100&amp;x=&quot;1&quot;');
    expect(evil.html).toContain('{{ref}}'); // valor literal, passada unica
    expect(evil.html).not.toContain('Esta solicitação já tem outra cotação aceita');
    expect(evil.html).toContain('(versão 2)');

    const late = renderIndentResponseReceived({ supplierName: 'Acme', ref: '277/26', version: 1, afterAcceptance: true, quoteUrl: 'https://app.test/x' });
    expect(late.html).toContain('já tem outra cotação aceita');
    expect(late.html).not.toContain('versão');
    expect(late.text).toContain('já tem outra cotação aceita');
    expect(late.subject).toBe('[IQ Indent] Resposta de Acme na cotação 277/26 (após aceite de outra cotação)');
    expect(late.html + late.text).not.toMatch(/token|price|preço/i);
  });
});

describe('teto do aviso (notifyWithCap) com timers falsos', () => {
  it('passa do teto -> resolve sem esperar o envio, loga so a chave e nao deixa timer pendente quando termina antes', async () => {
    const { IndentPortalNotificationService } = await import('../src/services/IndentPortalNotificationService');
    vi.useFakeTimers();
    try {
      mailerMock.sendAndLog.mockReturnValue(new Promise(() => undefined));
      let done = false;
      const pending = IndentPortalNotificationService.notifyWithCap({ quoteId: 100, version: 1, afterAcceptance: false }, 5000).then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(4999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await pending;
      expect(done).toBe(true);
      expect(vi.getTimerCount()).toBe(0);

      mailerMock.sendAndLog.mockResolvedValue({ providerMessageId: 'm', status: 'sent' });
      await IndentPortalNotificationService.notifyWithCap({ quoteId: 100, version: 1, afterAcceptance: false }, 5000);
      expect(vi.getTimerCount()).toBe(0); // terminou rapido: o timer do teto foi limpo
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('erros de parser no prefixo /api/indent-portal (JSON em ingles, no-store, sem eco)', () => {
  const raw = (path: string, payload: string | Buffer, type = 'application/json') =>
    portal('post', path, { body: payload as Buffer, type });

  it('JSON malformado -> 400 BAD_REQUEST em JSON, no-store, sem eco do corpo nem do token', async () => {
    const res = await raw(url('/respond'), '{"currency": "USD", SEGREDO-NO-CORPO');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ message: 'The submitted data is invalid. Please review the form and try again.', code: 'BAD_REQUEST' });
    expect(res.text).not.toContain('SEGREDO');
    expect(res.text).not.toContain(RAW_TOKEN);
    expect(res.text).not.toMatch(/<html|SyntaxError|at /i);
    expectCleanError(res);
  });

  it('corpo > 1 MB -> 413 BODY_TOO_LARGE em JSON, no-store e sem eco', async () => {
    const big = JSON.stringify({ notes: 'x'.repeat(1024 * 1024 + 10) });

    const res = await raw(url('/respond'), big);

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ message: 'The request is too large.', code: 'BODY_TOO_LARGE' });
    expect(res.text).not.toContain(RAW_TOKEN);
    expectCleanError(res);
  });

  it('o tratamento vale so para /api/indent-portal: o portal de credito mantem o comportamento anterior', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('../src/app');

    const other = await request(app).post(`/api/credit-portal/${RAW_TOKEN}/respond`).set('User-Agent', nextUa()).set('Content-Type', 'application/json').send('{ruim');

    expect(other.status).toBe(400);
    expect(other.body.code).toBeUndefined();
  });
});
