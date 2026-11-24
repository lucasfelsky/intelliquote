import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
vi.mock('../src/mailer/MailerService', async (original) =>
  (await import('./helpers/indentEnvioFixtures')).createMailerModule(await original<Record<string, unknown>>()),
);
import '../src/app'; // carrega o app na coleta, fora do timeout do 1o teste (o helper importa tarde)

import { INDENT_MAILBOX, INDENT_SEND_JSON_BODY_LIMIT_BYTES } from '../src/constants/indentPortal';
import { mailerEnv } from '../src/config/env';
import {
  acceptedRow,
  auditActions,
  auditCall,
  call,
  expectNoQuoteWrites,
  getApp,
  loginAs,
  prismaMock,
  quoteItemRow,
  quoteRow,
  sentQuote,
  tx,
} from './helpers/indentRoutesMock';
import {
  activeToken,
  draftQuote,
  envioClient,
  envioSupplier,
  expectNothingSent,
  mailerMock,
  persistedJson,
  rawTokensFromMails,
  resetEnvioMocks,
  sendBody,
  sentMails,
  sentWithTokens,
} from './helpers/indentEnvioFixtures';

// Envio da cotacao do IQ Indent ao fornecedor (PR 4a): send, send-context, resend e estado do portal. Usuario logado: id 7.

beforeEach(resetEnvioMocks);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n').toString('base64');
const NO_ONE_SENT = 'Nenhum e-mail foi enviado; a cotação voltou para rascunho.';

function lockSql(): string[] {
  return tx.$queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?').replace(/\s+/g, ' '));
}

// Uma trava `lockIndentQuote` = 3 consultas, a partir de `from`: le o requestId, trava a SOLICITACAO e so depois a COTACAO.
function expectLockOrder(from = 0) {
  const sql = lockSql();
  expect(sql[from]).toContain('SELECT "requestId" FROM "IndentQuote"');
  expect(sql[from + 1]).toContain('"IndentRequest"');
  expect(sql[from + 1]).toContain('FOR NO KEY UPDATE');
  expect(sql[from + 2]).toContain('"IndentQuote"');
  expect(sql[from + 2]).toContain('FOR NO KEY UPDATE');
}

describe('papeis e rotas', () => {
  it('viewer: 403 em send e resend; 200 em send-context e portal', async () => {
    const cookie = await loginAs('viewer');

    expect((await call('post', '/quotes/100/send', cookie, sendBody())).status).toBe(403);
    expect((await call('post', '/quotes/100/resend', cookie, {})).status).toBe(403);
    expect((await call('get', '/quotes/100/send-context', cookie)).status).toBe(200);
    expect((await call('get', '/quotes/100/portal', cookie)).status).toBe(200);
    expectNothingSent();
  });

  it('comercial: 403 nas 4 rotas', async () => {
    const cookie = await loginAs('comercial');

    expect((await call('get', '/quotes/100/send-context', cookie)).status).toBe(403);
    expect((await call('post', '/quotes/100/send', cookie, sendBody())).status).toBe(403);
    expect((await call('post', '/quotes/100/resend', cookie, {})).status).toBe(403);
    expect((await call('get', '/quotes/100/portal', cookie)).status).toBe(403);
  });

  it('sem login: 401', async () => {
    const app = await getApp();
    expect((await request(app).post('/api/v1/indent/quotes/100/send').send(sendBody())).status).toBe(401);
    expect((await request(app).get('/api/v1/indent/quotes/100/portal')).status).toBe(401);
  });

  it('id invalido -> 400', async () => {
    const cookie = await loginAs('comprador');
    expect((await call('post', '/quotes/abc/send', cookie, sendBody())).status).toBe(400);
  });
});

describe('POST /quotes/:id/send - validacao (400 com path, nada gravado)', () => {
  it.each([
    ['sem destinatario', { recipients: [] }, 'Escolha ou digite ao menos um e-mail.', 'recipients'],
    ['so espacos', { recipients: ['  '] }, 'Escolha ou digite ao menos um e-mail.', 'recipients'],
    ['e-mail invalido', { recipients: ['a@x.test', 'lixo'] }, 'E-mail inválido.', 'recipients'],
    [
      '6 destinatarios',
      { recipients: Array.from({ length: 6 }, (_, i) => `u${i}@x.test`) },
      'Escolha no máximo 5 destinatários.',
      'recipients',
    ],
    ['sem porto', { destinationPort: undefined }, 'Informe o porto de destino.', 'destinationPort'],
    ['porto em branco', { destinationPort: '   ' }, 'Informe o porto de destino.', 'destinationPort'],
    ['mensagem longa', { message: 'x'.repeat(2001) }, 'A mensagem deve ter no máximo 2000 caracteres.', 'message'],
    ['campo extra', { status: 'ACEITA' }, 'Campo não permitido.', ''],
    ['4 anexos', { attachments: Array.from({ length: 4 }, () => ({ fileName: 'a.pdf', contentBase64: PDF })) }, 'Envie no máximo 3 anexos.', 'attachments'],
  ])('%s', async (_motivo, overrides, message, path) => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, sendBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(message);
    expect(res.body.path).toBe(path);
    expectNothingSent();
  });
});

describe('POST /quotes/:id/send - copia da equipe COMEX', () => {
  it('copia a equipe COMEX (INTELLIQUOTE_COMEX_CC_LIST) so no 1o e-mail, sem duplicar o To', async () => {
    const original = mailerEnv.comexCcList;
    mailerEnv.comexCcList = [
      { email: 'comex@sq.test', name: 'Equipe COMEX' },
      { email: 'WEI@acme.test' },
    ];

    try {
      const cookie = await loginAs('comprador');
      const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['wei@acme.test', 'li@acme.test'] }));

      expect(res.status).toBe(200);
      const mails = sentMails();
      expect(mails).toHaveLength(2);
      expect(mails[0].cc).toEqual([{ email: 'comex@sq.test', name: 'Equipe COMEX' }]);
      expect(mails[1].cc).toBeUndefined();
    } finally {
      mailerEnv.comexCcList = original;
    }
  });
});

describe('POST /quotes/:id/send - envio', () => {
  it('normaliza e deduplica os destinatarios; 1 token e 1 IndentMailLog por destinatario; Reply-To constante', async () => {
    const cookie = await loginAs('comprador');

    const res = await call(
      'post',
      '/quotes/100/send',
      cookie,
      sendBody({ recipients: ['Wei@Acme.test', 'wei@acme.test', ' li@acme.test '], message: '  Please quote  ' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { email: 'wei@acme.test', status: 'sent' },
      { email: 'li@acme.test', status: 'sent' },
    ]);
    expect(res.body.quote.id).toBe(100);
    expect(tx.indentPortalToken.create).toHaveBeenCalledTimes(2);
    expect(tx.indentMailLog.create).toHaveBeenCalledTimes(2);
    expect(mailerMock.sendAndLog).toHaveBeenCalledTimes(2);

    for (const mail of sentMails()) {
      expect(mail.replyTo).toEqual({ email: INDENT_MAILBOX, name: 'SQ Quimica Indent' });
      expect(mail.cc).toBeUndefined();
      expect(mail.templateId).toBe('indent_quote_request');
      expect(mail.relatedEntityType).toBe('indent_quote');
      expect(mail.templateVars).toEqual({ quoteId: 100, ref: expect.any(String), kind: 'REQUEST', hasPartnership: false, showClientName: false });
      expect(mail.subject).toMatch(/^\d{3}\/\d{2} · Indent quotation request · /);
    }

    const token = tx.indentPortalToken.create.mock.calls[0][0].data;
    expect(token).toMatchObject({
      quoteId: 100,
      supplierId: 5,
      recipientEmail: 'wei@acme.test',
      showClientName: false,
      destinationPort: 'Santos',
      message: 'Please quote',
      createdById: 7,
    });
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);
    expect(tx.indentMailLog.create.mock.calls[0][0].data).toMatchObject({
      quoteId: 100,
      tokenId: 901,
      kind: 'REQUEST',
      toEmail: 'wei@acme.test',
      status: 'queued',
      hasPartnership: false,
      showClientName: false,
      sentById: 7,
      templateId: 'indent_quote_request',
    });
    expect(prismaMock.indentMailLog.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.indentMailLog.update.mock.calls[0][0]).toMatchObject({
      where: { id: 701 },
      data: { status: 'sent', providerMessageId: 'msg-1', errorMessage: null },
    });
  });

  it('RASCUNHO -> ENVIADA com sentAt, log indent_quote.sent e trava solicitacao -> cotacao', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(200);
    expect(tx.indentQuote.update).toHaveBeenCalledTimes(1);
    expect(tx.indentQuote.update.mock.calls[0][0]).toMatchObject({
      where: { id: 100 },
      data: { status: 'ENVIADA', sentAt: expect.any(Date) },
    });
    expect(auditActions()).toEqual(['indent_quote.sent']);
    expect(auditCall('indent_quote.sent')).toMatchObject({
      performedById: 7,
      entityType: 'indent_quote',
      beforeData: { status: 'RASCUNHO' },
      afterData: { status: 'ENVIADA' },
      metadata: { via: 'email', kind: 'REQUEST', recipients: ['wei@acme.test'], hasPartnership: false, showClientName: false, attachmentNames: [] },
    });
    expectLockOrder();
    expect(lockSql()).toHaveLength(3);
  });

  it('o token cru nunca vai para AuditLog, IndentMailLog, templateVars nem logs; so o hash e gravado', async () => {
    const cookie = await loginAs('comprador');
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))),
    );

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['a@acme.test', 'b@acme.test'] }));
    spies.forEach((spy) => spy.mockRestore());

    expect(res.status).toBe(200);
    const raws = rawTokensFromMails();
    expect(raws).toHaveLength(2);
    expect(raws[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(raws[0]).not.toBe(raws[1]);

    const everything = [persistedJson(), JSON.stringify(tx.indentPortalToken.create.mock.calls), logged.join('\n'), JSON.stringify(res.body)];
    for (const raw of raws) {
      for (const text of everything) {
        expect(text).not.toContain(raw);
      }
    }
    expect(persistedJson()).not.toContain('token=');
    // o e-mail leva o link, com o token cru
    expect(String(sentMails()[0].html)).toContain(`token=${raws[0]}`);
  });

  it('saveToSupplier acrescenta os e-mails novos ao cadastro e audita before/after', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['wei@acme.test', 'novo@acme.test'], saveToSupplier: true }));

    expect(res.status).toBe(200);
    expect(tx.indentSupplier.update.mock.calls[0][0]).toEqual({
      where: { id: 5 },
      data: { contactEmails: ['wei@acme.test', 'novo@acme.test'] },
    });
    expect(auditCall('indent_supplier.contact_emails_added')).toMatchObject({
      entityType: 'indent_supplier',
      beforeData: { contactEmails: ['wei@acme.test'] },
      afterData: { contactEmails: ['wei@acme.test', 'novo@acme.test'] },
    });
  });

  it('sem saveToSupplier o cadastro nao muda; e-mail ja cadastrado nao grava de novo', async () => {
    const cookie = await loginAs('comprador');

    await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['novo@acme.test'] }));
    expect(tx.indentSupplier.update).not.toHaveBeenCalled();

    await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['wei@acme.test'], saveToSupplier: true }));
    expect(tx.indentSupplier.update).not.toHaveBeenCalled();
  });

  it('o 11o e-mail do cadastro -> 400 e NADA e enviado nem gravado', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.findUnique.mockResolvedValue(
      envioSupplier({ contactEmails: Array.from({ length: 10 }, (_, i) => `u${i}@acme.test`) }),
    );

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['novo@acme.test'], saveToSupplier: true }));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('O cadastro do fornecedor já tem 10 e-mails; desmarque "Salvar no cadastro".');
    expect(res.body.path).toBe('saveToSupplier');
    expectNothingSent();
    expect(tx.indentSupplier.update).not.toHaveBeenCalled();
  });

  it('revisao (R2): kind REVISION, assunto com "R2 - " e tokens anteriores da cadeia revogados (superseded)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(draftQuote({ revision: 2, baseQuoteId: 99 }));

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(200);
    expect(tx.indentPortalToken.updateMany.mock.calls[0][0]).toEqual({
      where: { revokedAt: null, quote: { requestId: 11, supplierId: 5, revision: { lt: 2 } } },
      data: { revokedAt: expect.any(Date), revokedReason: 'superseded' },
    });
    expect(tx.indentMailLog.create.mock.calls[0][0].data.kind).toBe('REVISION');
    expect(sentMails()[0].subject).toMatch(/^R2 - \d{3}\/\d{2} · Indent price update requested · /);
    expect(sentMails()[0].templateVars.kind).toBe('REVISION');
    expect(String(sentMails()[0].html)).toContain('Price update requested');
  });

  it('R1 nao revoga tokens de outras versoes', async () => {
    const cookie = await loginAs('comprador');
    await call('post', '/quotes/100/send', cookie, sendBody());
    expect(tx.indentPortalToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('timeout das transacoes do envio', () => {
  it('send, compensacao e resend usam timeout de 15 s e maxWait de 10 s', async () => {
    const cookie = await loginAs('comprador');
    const options = { timeout: 15000, maxWait: 10000 };

    await call('post', '/quotes/100/send', cookie, sendBody());
    expect(prismaMock.$transaction.mock.calls.map((c) => c[1])).toEqual([options]);

    prismaMock.$transaction.mockClear();
    mailerMock.sendAndLog.mockResolvedValue({ providerMessageId: '', status: 'failed', error: 'smtp down' });
    await call('post', '/quotes/100/send', cookie, sendBody()); // todos falham: 2a transacao (compensacao)
    expect(prismaMock.$transaction.mock.calls.map((c) => c[1])).toEqual([options, options]);

    prismaMock.$transaction.mockClear();
    tx.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
    tx.indentPortalToken.findMany.mockResolvedValue([activeToken(11, 'wei@acme.test')]);
    await call('post', '/quotes/100/resend', cookie, {});
    expect(prismaMock.$transaction.mock.calls.map((c) => c[1])).toEqual([options]);
  });
});

describe('POST /quotes/:id/send - falhas de e-mail', () => {
  it('falha parcial: 200, o token de quem falhou e revogado (send_failed) e o log mostra o erro', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog.mockImplementation(async ({ to }: { to: { email: string } }) =>
      to.email === 'b@acme.test' ? { providerMessageId: '', status: 'failed', error: 'smtp 550 mailbox unavailable' } : { providerMessageId: 'ok', status: 'sent' },
    );

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['a@acme.test', 'b@acme.test'] }));

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { email: 'a@acme.test', status: 'sent' },
      { email: 'b@acme.test', status: 'failed', error: 'smtp 550 mailbox unavailable' },
    ]);
    expect(prismaMock.indentPortalToken.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.indentPortalToken.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: [902] } },
      data: { revokedAt: expect.any(Date), revokedReason: 'send_failed' },
    });
    expect(prismaMock.indentMailLog.update.mock.calls[1][0]).toMatchObject({
      where: { id: 702 },
      data: { status: 'failed', errorMessage: 'smtp 550 mailbox unavailable' },
    });
    // a cotacao continua ENVIADA (um destinatario recebeu)
    expect(tx.indentQuote.update).toHaveBeenCalledTimes(1);
  });

  it('excecao do sendAndLog vira failed so daquele destinatario', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog
      .mockResolvedValueOnce({ providerMessageId: 'ok', status: 'queued' })
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['a@acme.test', 'b@acme.test'] }));

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { email: 'a@acme.test', status: 'queued' },
      { email: 'b@acme.test', status: 'failed', error: 'ECONNRESET' },
    ]);
  });

  it('todos falham: 502, a cotacao volta a RASCUNHO, links revogados, log send_failed e contactEmails mantido', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog.mockResolvedValue({ providerMessageId: '', status: 'failed', error: 'smtp down' });
    tx.indentQuote.findUnique.mockResolvedValueOnce(draftQuote()).mockResolvedValue(sentQuote());

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['novo@acme.test'], saveToSupplier: true }));

    expect(res.status).toBe(502);
    expect(res.body.message).toBe(NO_ONE_SENT);
    expect(res.body.results).toEqual([{ email: 'novo@acme.test', status: 'failed', error: 'smtp down' }]);
    expect(res.body.quote).toBeUndefined();
    const updates = tx.indentQuote.update.mock.calls.map((c) => c[0]);
    expect(updates[0].data).toMatchObject({ status: 'ENVIADA' });
    expect(updates[1]).toEqual({ where: { id: 100 }, data: { status: 'RASCUNHO', sentAt: null } });
    expect(tx.indentPortalToken.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: [901] } },
      data: { revokedAt: expect.any(Date), revokedReason: 'send_failed' },
    });
    expect(auditActions()).toContain('indent_quote.send_failed');
    // a compensacao e uma 2a transacao: refaz a trava solicitacao -> cotacao
    expect(lockSql()).toHaveLength(6);
    expectLockOrder(0);
    expectLockOrder(3);
    // o e-mail novo do cadastro NAO e desfeito
    expect(tx.indentSupplier.update).toHaveBeenCalledTimes(1);
    expect(tx.indentSupplier.update.mock.calls.every((c) => c[0].data.contactEmails !== undefined)).toBe(true);
  });

  it('todos falham mas o fornecedor ja respondeu entre o envio e a falha: nao volta a RASCUNHO', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog.mockResolvedValue({ providerMessageId: '', status: 'failed', error: 'smtp down' });
    tx.indentQuote.findUnique.mockResolvedValueOnce(draftQuote()).mockResolvedValue(sentQuote());
    tx.indentPortalResponse.findUnique.mockResolvedValue({ id: 1 });

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(502);
    expect(tx.indentQuote.update.mock.calls.map((c) => c[0].data.status)).toEqual(['ENVIADA']);
  });

  it('destinatario "comercial" (suprimido pelo mailer): status suppressed; se for o unico, 502', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog.mockImplementation(async ({ to }: { to: { email: string } }) =>
      to.email === 'vendas@acme.test'
        ? { providerMessageId: '', status: 'failed', error: 'skipped_comercial_recipient' }
        : { providerMessageId: 'ok', status: 'sent' },
    );

    const mixed = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['vendas@acme.test', 'a@acme.test'] }));
    expect(mixed.status).toBe(200);
    expect(mixed.body.results[0]).toMatchObject({ email: 'vendas@acme.test', status: 'suppressed' });
    expect(prismaMock.indentMailLog.update.mock.calls[0][0].data.status).toBe('suppressed');

    vi.clearAllMocks();
    tx.indentQuote.findUnique.mockResolvedValueOnce(draftQuote()).mockResolvedValue(sentQuote());
    tx.indentPortalToken.create.mockResolvedValue({ id: 950 });
    tx.indentMailLog.create.mockResolvedValue({ id: 750 });
    tx.auditLog.create.mockResolvedValue({});
    tx.$queryRaw.mockResolvedValue([{ requestId: 11 }]);
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier());
    tx.indentClient.findUnique.mockResolvedValue(envioClient);
    tx.indentPortalResponse.findUnique.mockResolvedValue(null);
    prismaMock.indentMailLog.update.mockResolvedValue({});
    const only = await call('post', '/quotes/100/send', cookie, sendBody({ recipients: ['vendas@acme.test'] }));
    expect(only.status).toBe(502);
    expect(only.body.results).toEqual([{ email: 'vendas@acme.test', status: 'suppressed', error: 'skipped_comercial_recipient' }]);
  });
});

describe('POST /quotes/:id/send - precondicoes (409, nada gravado)', () => {
  it('processNumber nulo', async () => {
    const cookie = await loginAs('comprador');
    const base = draftQuote();
    tx.indentQuote.findUnique.mockResolvedValue({ ...base, request: { ...base.request, processNumber: null } });

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Digite a referência da solicitação antes de enviar.');
    expectNothingSent();
  });

  it('cliente pendente (sem vinculo)', async () => {
    const cookie = await loginAs('comprador');
    const base = draftQuote();
    tx.indentQuote.findUnique.mockResolvedValue({ ...base, request: { ...base.request, client: null } });

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Vincule o cliente antes de enviar.');
    expectNothingSent();
  });

  it('cotacao sem itens; fornecedor inativo; fornecedor inexistente', async () => {
    const cookie = await loginAs('comprador');

    tx.indentQuote.findUnique.mockResolvedValue(draftQuote({ items: [] }));
    const noItems = await call('post', '/quotes/100/send', cookie, sendBody());
    expect(noItems.status).toBe(409);
    expect(noItems.body.message).toBe('A cotação não tem itens.');

    tx.indentQuote.findUnique.mockResolvedValue(draftQuote());
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ isActive: false }));
    const inactive = await call('post', '/quotes/100/send', cookie, sendBody());
    expect(inactive.status).toBe(409);
    expect(inactive.body.message).toBe('Este fornecedor está inativo no Indent.');

    tx.indentSupplier.findUnique.mockResolvedValue(null);
    expect((await call('post', '/quotes/100/send', cookie, sendBody())).status).toBe(404);
    expectNothingSent();
  });

  it('cotacao inexistente -> 404; solicitacao PERDIDA -> 409', async () => {
    const cookie = await loginAs('comprador');
    tx.$queryRaw.mockResolvedValue([]);
    expect((await call('post', '/quotes/100/send', cookie, sendBody())).status).toBe(404);

    tx.$queryRaw.mockResolvedValue([{ requestId: 11 }]);
    const base = draftQuote();
    tx.indentQuote.findUnique.mockResolvedValue({ ...base, request: { ...base.request, status: 'PERDIDA' } });
    const lost = await call('post', '/quotes/100/send', cookie, sendBody());
    expect(lost.status).toBe(409);
    expect(lost.body.message).toContain('foi marcada como perdida');
    expectNothingSent();
  });
});

describe('aceite unico - envio, contexto e reenvio', () => {
  it('send: 409 e nada gravado quando outra cotacao da solicitacao ja foi aceita', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('já tem uma cotação aceita');
    expectNothingSent();
  });

  it('send-context: 409 quando ja ha aceite', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('get', '/quotes/100/send-context', cookie);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('já tem uma cotação aceita');
  });

  it('resend: 409 e nada gravado quando ja ha aceite', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
    tx.indentQuote.findFirst.mockResolvedValue(acceptedRow());

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('já tem uma cotação aceita');
    expectNothingSent();
  });
});

describe('marcada sem email - cotacao ENVIADA por fora (mark-sent)', () => {
  const markedSent = () => sentQuote({ _count: { portalTokens: 0 } });

  it('send: 409 por status (so RASCUNHO envia)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(markedSent());

    const res = await call('post', '/quotes/100/send', cookie, sendBody());

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Esta cotação está Enviada e não permite enviar ao fornecedor.');
    expectNothingSent();
  });

  it('resend: 409 com a mensagem literal (nao ha link para reenviar)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(markedSent());

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Esta cotação foi marcada como enviada sem e-mail: não há link para reenviar.');
    expectNothingSent();
  });

  it('getPortalState = MARCADA_SEM_EMAIL', async () => {
    const cookie = await loginAs('viewer');
    prismaMock.indentQuote.findUnique.mockResolvedValue(markedSent());

    const res = await call('get', '/quotes/100/portal', cookie);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('MARCADA_SEM_EMAIL');
    expect(res.body.canResend).toBe(false);
    expect(res.body.recipients).toEqual([]);
  });
});

describe('POST /quotes/:id/resend', () => {
  const twoActive = () => [activeToken(11, 'wei@acme.test'), activeToken(12, 'li@acme.test')];

  beforeEach(() => {
    tx.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
    tx.indentPortalToken.findMany.mockResolvedValue(twoActive());
  });

  it('cria tokens novos, envia kind RESEND e so DEPOIS revoga os antigos (resend); status e sentAt nao mudam', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { email: string }) => r.email)).toEqual(['wei@acme.test', 'li@acme.test']);
    expect(tx.indentPortalToken.create).toHaveBeenCalledTimes(2);
    expect(tx.indentMailLog.create.mock.calls.map((c) => c[0].data.kind)).toEqual(['RESEND', 'RESEND']);
    expect(tx.indentMailLog.create.mock.calls[0][0].data.attachmentNames).toEqual([]);
    expect(sentMails().map((m) => m.templateVars.kind)).toEqual(['RESEND', 'RESEND']);
    expect(tx.indentQuote.update).not.toHaveBeenCalled();
    expect(lockSql()).toHaveLength(3);
    expectLockOrder();
    expect(auditActions()).toEqual(['indent_quote.resent']);
    expect(auditCall('indent_quote.resent')).toMatchObject({ metadata: { recipients: ['wei@acme.test', 'li@acme.test'] } });

    const revoke = prismaMock.indentPortalToken.updateMany.mock.calls[0][0];
    expect(revoke).toEqual({ where: { id: { in: [11, 12] }, revokedAt: null }, data: { revokedAt: expect.any(Date), revokedReason: 'resend' } });
    expect(Math.min(...prismaMock.indentPortalToken.updateMany.mock.invocationCallOrder)).toBeGreaterThan(
      Math.max(...mailerMock.sendAndLog.mock.invocationCallOrder),
    );
    expect(persistedJson()).not.toContain(rawTokensFromMails()[0]);
  });

  it('usa porto, mensagem e showClientName do token ativo mais recente; com parceria atual', async () => {
    const cookie = await loginAs('comprador');
    tx.indentPortalToken.findMany.mockResolvedValue([
      activeToken(12, 'li@acme.test', { destinationPort: 'Paranaguá', message: 'Please confirm', showClientName: true }),
      activeToken(11, 'wei@acme.test'),
    ]);
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(200);
    expect(tx.indentPortalToken.create.mock.calls[0][0].data).toMatchObject({
      destinationPort: 'Paranaguá',
      message: 'Please confirm',
      showClientName: true,
    });
    expect(String(sentMails()[0].html)).toContain(envioClient.name);
  });

  it('falha parcial: o antigo de quem falhou continua valendo; o novo que falhou vira send_failed', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog.mockImplementation(async ({ to }: { to: { email: string } }) =>
      to.email === 'li@acme.test' ? { providerMessageId: '', status: 'failed', error: 'smtp down' } : { providerMessageId: 'ok', status: 'sent' },
    );

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(200);
    const calls = prismaMock.indentPortalToken.updateMany.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ where: { id: { in: [11] }, revokedAt: null }, data: { revokedAt: expect.any(Date), revokedReason: 'resend' } });
    expect(calls).toContainEqual({ where: { id: { in: [902] } }, data: { revokedAt: expect.any(Date), revokedReason: 'send_failed' } });
  });

  it('todos falham: 502, links antigos NAO sao revogados e os novos viram send_failed', async () => {
    const cookie = await loginAs('comprador');
    mailerMock.sendAndLog.mockResolvedValue({ providerMessageId: '', status: 'failed', error: 'smtp down' });

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(502);
    expect(res.body.message).toBe('Nenhum e-mail foi reenviado; os links anteriores continuam valendo.');
    const calls = prismaMock.indentPortalToken.updateMany.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ where: { id: { in: [901, 902] } }, data: { revokedAt: expect.any(Date), revokedReason: 'send_failed' } });
    expect(tx.indentQuote.update).not.toHaveBeenCalled();
  });

  it('corpo com campo -> 400; sem token ativo -> 409', async () => {
    const cookie = await loginAs('comprador');
    expect((await call('post', '/quotes/100/resend', cookie, { x: 1 })).status).toBe(400);

    tx.indentPortalToken.findMany.mockResolvedValue([]);
    const none = await call('post', '/quotes/100/resend', cookie, {});
    expect(none.status).toBe(409);
    expect(none.body.message).toBe('Esta cotação foi marcada como enviada sem e-mail: não há link para reenviar.');
  });

  it('RESPONDIDA nao reenvia (status)', async () => {
    const cookie = await loginAs('comprador');
    tx.indentQuote.findUnique.mockResolvedValue(quoteRow({ status: 'RESPONDIDA', _count: { portalTokens: 1 } }));

    const res = await call('post', '/quotes/100/resend', cookie, {});

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Esta cotação está Respondida e não permite reenviar o link.');
    expect(mailerMock.sendAndLog).not.toHaveBeenCalled();
  });
});

describe('anexos da Compras e confirmacao', () => {
  it('nao-PDF -> 400; base64 invalido -> 400; sem anexos nao exige confirmacao', async () => {
    const cookie = await loginAs('comprador');
    const text = Buffer.from('hello world').toString('base64');

    const notPdf = await call('post', '/quotes/100/send', cookie, sendBody({ attachments: [{ fileName: 'a.pdf', contentBase64: text }], attachmentsConfirmed: true }));
    expect(notPdf.status).toBe(400);
    expect(notPdf.body.message).toBe('Envie só arquivos PDF.');
    expect(notPdf.body.path).toBe('attachments');

    const bad = await call('post', '/quotes/100/send', cookie, sendBody({ attachments: [{ fileName: 'a.pdf', contentBase64: '***' }], attachmentsConfirmed: true }));
    expect(bad.status).toBe(400);
    expectNothingSent();

    expect((await call('post', '/quotes/100/send', cookie, sendBody())).status).toBe(200);
  });

  it('mais de 10 MB somados -> 400 (dentro do limite do parser)', async () => {
    const cookie = await loginAs('comprador');
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10.2 * 1024 * 1024, 65)]).toString('base64');

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ attachments: [{ fileName: 'big.pdf', contentBase64: big }], attachmentsConfirmed: true }));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Os anexos passam de 10 MB.');
    expectNothingSent();
  });

  it('sem parceria e sem confirmacao -> 400; com confirmacao, envia, registra o nome e a confirmacao', async () => {
    const cookie = await loginAs('comprador');
    const attachments = [{ fileName: 'Spec/sheet?.PDF', contentBase64: PDF }];

    const refused = await call('post', '/quotes/100/send', cookie, sendBody({ attachments }));
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('Confirme que conferiu que o arquivo não cita o cliente.');
    expect(refused.body.path).toBe('attachmentsConfirmed');
    expectNothingSent();

    const ok = await call('post', '/quotes/100/send', cookie, sendBody({ attachments, attachmentsConfirmed: true }));
    expect(ok.status).toBe(200);
    const mail = sentMails()[0];
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe('Specsheet.pdf');
    expect(mail.attachments[0].contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(mail.attachments[0].content)).toBe(true);
    expect(tx.indentMailLog.create.mock.calls[0][0].data).toMatchObject({
      attachmentNames: ['Specsheet.pdf'],
      attachmentsConfirmedAt: expect.any(Date),
      attachmentsConfirmedById: 7,
    });
    expect(auditCall('indent_quote.sent')).toMatchObject({ metadata: { attachmentNames: ['Specsheet.pdf'] } });
    // o conteudo do PDF nao e persistido em lugar nenhum
    expect(persistedJson()).not.toContain(PDF);
  });

  it('com parceria nao exige confirmacao', async () => {
    const cookie = await loginAs('comprador');
    tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true }));

    const res = await call('post', '/quotes/100/send', cookie, sendBody({ attachments: [{ fileName: 'a.pdf', contentBase64: PDF }] }));

    expect(res.status).toBe(200);
    expect(tx.indentMailLog.create.mock.calls[0][0].data.attachmentsConfirmedAt).toBeUndefined();
  });

  it('nome do arquivo que cita o cliente (sem parceria) -> 422 e nada enviado', async () => {
    const cookie = await loginAs('comprador');

    const res = await call(
      'post',
      '/quotes/100/send',
      cookie,
      sendBody({ attachments: [{ fileName: 'Industria Quimica Vale do Itajai Ltda.pdf', contentBase64: PDF }], attachmentsConfirmed: true }),
    );

    expect(res.status).toBe(422);
    expect(res.body.message).toBe(
      'O conteúdo do e-mail identifica o cliente (campo: attachments[0].fileName). Revise o item ou o porto antes de enviar.',
    );
    expectNothingSent();
  });
});

describe('GET /quotes/:id/send-context', () => {
  it('devolve o contexto do modal (assunto, remetente, Reply-To, fornecedor e e-mails)', async () => {
    const cookie = await loginAs('viewer');
    prismaMock.indentSupplier.findUnique.mockResolvedValue(envioSupplier({ hasPartnership: true, contactEmails: ['a@acme.test', 'b@acme.test'] }));
    prismaMock.indentQuote.findUnique.mockResolvedValue(draftQuote({ destination: 'Itajaí' }));

    const res = await call('get', '/quotes/100/send-context', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'REQUEST',
      replyTo: INDENT_MAILBOX,
      supplier: { id: 5, name: 'Acme Chemicals', hasPartnership: true, contactEmails: ['a@acme.test', 'b@acme.test'] },
      clientName: 'Cliente Exemplo Ltda',
      destinationPort: 'Itajaí',
      firstItemName: 'Zinco',
    });
    expect(res.body.subject).toMatch(/^\d{3}\/\d{2} · Indent quotation request · Zinco$/);
    expect(typeof res.body.fromDisplay).toBe('string');
  });

  it('ENVIADA -> 409 (so RASCUNHO envia); revisao -> kind REVISION', async () => {
    const cookie = await loginAs('comprador');
    prismaMock.indentQuote.findUnique.mockResolvedValue(sentQuote());
    expect((await call('get', '/quotes/100/send-context', cookie)).status).toBe(409);

    prismaMock.indentQuote.findUnique.mockResolvedValue(draftQuote({ revision: 3 }));
    const rev = await call('get', '/quotes/100/send-context', cookie);
    expect(rev.body.kind).toBe('REVISION');
    expect(rev.body.subject).toMatch(/^R3 - /);
  });
});

describe('GET /quotes/:id/portal - estado da secao', () => {
  it('AGUARDANDO: destinatarios ativos, ultimo envio, ultimo acesso, vencimento, e-mails e anexos', async () => {
    const cookie = await loginAs('comprador');
    const sentAt = new Date('2026-11-14T12:00:00.000Z');
    prismaMock.indentQuote.findUnique.mockResolvedValue(sentWithTokens());
    prismaMock.indentPortalToken.findMany.mockResolvedValue([
      { recipientEmail: 'a@acme.test', revokedAt: null, expiresAt: new Date('2026-11-28T00:00:00.000Z'), lastSeenAt: new Date('2026-11-15T10:00:00.000Z') },
      { recipientEmail: 'b@acme.test', revokedAt: null, expiresAt: new Date('2026-11-30T00:00:00.000Z'), lastSeenAt: null },
      { recipientEmail: 'old@acme.test', revokedAt: new Date('2026-11-14T00:00:00.000Z'), expiresAt: new Date('2026-12-30T00:00:00.000Z'), lastSeenAt: new Date('2026-11-16T10:00:00.000Z') },
    ]);
    prismaMock.indentMailLog.findFirst.mockResolvedValue({ sentAt });
    prismaMock.indentMailLog.findMany.mockResolvedValue([{ id: 1, kind: 'REQUEST', toEmail: 'a@acme.test', status: 'sent', errorMessage: null, createdAt: sentAt, sentAt, attachmentNames: [] }]);
    prismaMock.indentPortalAttachment.findMany.mockResolvedValue([{ id: 3, fileName: 'x.pdf', fileSize: 10, createdAt: sentAt }]);

    const res = await call('get', '/quotes/100/portal', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'AGUARDANDO',
      recipients: ['a@acme.test', 'b@acme.test'],
      lastSentAt: sentAt.toISOString(),
      lastAccessAt: '2026-11-16T10:00:00.000Z',
      expiresAt: '2026-11-30T00:00:00.000Z',
      canResend: true,
      response: null,
    });
    expect(res.body.mails).toHaveLength(1);
    expect(res.body.attachments).toEqual([{ id: 3, fileName: 'x.pdf', fileSize: 10, createdAt: sentAt.toISOString() }]);
    expect(prismaMock.indentMailLog.findMany.mock.calls[0][0]).toMatchObject({ where: { quoteId: 100 }, take: 50 });
  });

  it('RESPONDIDO: resposta do portal (versao) ou manual (respondedAt); RASCUNHO = NAO_ENVIADO', async () => {
    const cookie = await loginAs('comprador');
    const submittedAt = new Date('2026-11-15T09:00:00.000Z');
    prismaMock.indentQuote.findUnique.mockResolvedValue(quoteRow({ status: 'RESPONDIDA', respondedAt: submittedAt }));
    prismaMock.indentPortalResponse.findUnique.mockResolvedValue({ version: 2, submittedAt });

    const portal = await call('get', '/quotes/100/portal', cookie);
    expect(portal.body.state).toBe('RESPONDIDO');
    expect(portal.body.response).toEqual({ version: 2, submittedAt: submittedAt.toISOString(), via: 'portal' });

    prismaMock.indentPortalResponse.findUnique.mockResolvedValue(null);
    const manual = await call('get', '/quotes/100/portal', cookie);
    expect(manual.body.state).toBe('RESPONDIDO');
    expect(manual.body.response).toEqual({ version: null, submittedAt: submittedAt.toISOString(), via: 'manual' });

    prismaMock.indentQuote.findUnique.mockResolvedValue(draftQuote());
    expect((await call('get', '/quotes/100/portal', cookie)).body.state).toBe('NAO_ENVIADO');
  });
});

describe('parser do /send (limite de 14 MB depois do login)', () => {
  const huge = () => ({ contentBase64: 'A'.repeat(INDENT_SEND_JSON_BODY_LIMIT_BYTES + 1) });

  it('sem login: 401 JSON mesmo com corpo acima do limite global de 1 MB (o corpo nao e lido; nao vira 413)', async () => {
    const app = await getApp();

    // 9 MB: acima do parser global (1 MB) e dentro do teto de descarte do requireAuthBeforeBody (11 MB).
    const res = await request(app)
      .post('/api/v1/indent/quotes/100/send')
      .send({ contentBase64: 'A'.repeat(9 * 1024 * 1024) });

    expect(res.status).toBe(401);
    expect(res.type).toBe('application/json');
  });

  it('sem login e corpo > 14 MB: 401 (ou reset por Connection: close), NUNCA 413 - o corpo nao e bufferizado sem login', async () => {
    const app = await getApp();

    // Mesmo padrao do #92: acima do teto de descarte (11 MB) o 401 sai na hora com Connection: close e o cliente pode ver reset.
    const outcome = await request(app)
      .post('/api/v1/indent/quotes/100/send')
      .send(huge())
      .then(
        (res) => ({ status: res.status, message: res.body?.message as string | undefined }),
        (error: NodeJS.ErrnoException) => ({ status: 0, message: error.code }),
      );

    expect(outcome.status).not.toBe(413);
    if (outcome.status === 0) {
      expect(['ECONNRESET', 'EPIPE']).toContain(outcome.message);
    } else {
      expect(outcome.status).toBe(401);
    }
    expectNothingSent();
  });

  it('ordem das camadas: requireAuthBeforeBody vem ANTES do parser de 14 MB e do parser global no caminho do /send', async () => {
    const app = await getApp();
    const path = '/api/v1/indent/quotes/100/send';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack = (app as any)._router.stack as Array<{ name: string; regexp: RegExp }>;
    const matching = stack.map((layer, index) => ({ layer, index })).filter(({ layer }) => layer.regexp.test(path));
    const auth = matching.find(({ layer }) => layer.name === 'requireAuthBeforeBodyMiddleware');
    const jsonParsers = matching.filter(({ layer }) => layer.name === 'jsonParser');

    expect(auth).toBeDefined();
    expect(jsonParsers.length).toBeGreaterThanOrEqual(2); // o de 14 MB (so no /send) e o global de 1 MB
    expect(jsonParsers.every(({ index }) => index > auth!.index)).toBe(true);
  });

  it('com login e corpo > 14 MB: 413 com a mensagem amigavel', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, huge());

    expect(res.status).toBe(413);
    expect(res.body.message).toBe('Os anexos passam de 10 MB.');
    expectNothingSent();
  });

  it('com login, um corpo de 9 MB passa do parser global (so o /send aceita ate 14 MB) e chega na validacao', async () => {
    const cookie = await loginAs('comprador');

    const res = await call('post', '/quotes/100/send', cookie, { ...sendBody(), attachmentsConfirmed: true, pad: 'A'.repeat(9 * 1024 * 1024) });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Campo não permitido.');
  });
});
