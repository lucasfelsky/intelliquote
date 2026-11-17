import { expect, vi } from 'vitest';
import request from 'supertest';
import { dayKey, expectNoQuoteWrites, getApp, prismaMock, quoteRow, resetQuoteMocks, sentQuote, tx } from './indentRoutesMock';

// Fixtures e defaults dos testes de ENVIO do IQ Indent (PR 4a). Nomes e CNPJ FICTICIOS (repo publico).
// Uso, no topo do arquivo de teste:
//   vi.mock('../src/lib/prisma', async () => (await import('./helpers/indentRoutesMock')).createIndentPrismaModule());
//   vi.mock('../src/mailer/MailerService', async (original) =>
//     (await import('./helpers/indentEnvioFixtures')).createMailerModule(await original()));
// e `beforeEach(resetEnvioMocks)`.

export const mailerMock = { sendAndLog: vi.fn() };

/** Fabrica do `vi.mock('../src/mailer/MailerService', ...)`: mantem as constantes reais e troca so o `sendAndLog`. */
export function createMailerModule(original: Record<string, unknown>) {
  return { ...original, sendAndLog: mailerMock.sendAndLog };
}

export const envioClient = { name: 'Indústria Química Vale do Itajaí Ltda', cnpj: '12345678000195' };
export const outroCliente = { name: 'Vale Verde Fertilizantes Ltda', cnpj: '11222333000181' };

export function envioSupplier(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    name: 'Acme Chemicals',
    hasPartnership: false,
    isActive: true,
    contactEmails: ['wei@acme.test'] as string[],
    ...overrides,
  };
}

export function sendBody(overrides: Record<string, unknown> = {}) {
  return {
    recipients: ['wei@acme.test'],
    destinationPort: 'Santos',
    showClientName: false,
    saveToSupplier: false,
    ...overrides,
  };
}

/** Nada foi gravado nem enviado: cotacao intocada, sem token, sem IndentMailLog e sem e-mail. */
export function expectNothingSent() {
  expectNoQuoteWrites();
  expect(tx.indentPortalToken.create).not.toHaveBeenCalled();
  expect(tx.indentMailLog.create).not.toHaveBeenCalled();
  expect(mailerMock.sendAndLog).not.toHaveBeenCalled();
}

/** Cotacao pronta para o envio: RASCUNHO com o cliente do envio. */
export function draftQuote(overrides: Record<string, unknown> = {}) {
  return quoteRow({ revision: 1, ...overrides });
}

/** Cotacao ENVIADA com link ativo (alvo do reenvio). */
export function sentWithTokens(overrides: Record<string, unknown> = {}) {
  return sentQuote({ _count: { portalTokens: 1 }, ...overrides });
}

export function activeToken(id: number, email: string, overrides: Record<string, unknown> = {}) {
  return { id, recipientEmail: email, destinationPort: 'Santos', message: null as string | null, showClientName: false, ...overrides };
}

/** Primeiro argumento de cada `sendAndLog` (um por destinatario). */
export function sentMails() {
  return mailerMock.sendAndLog.mock.calls.map((c) => c[0] as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Texto de tudo que um teste precisa varrer atras do token cru: AuditLog, IndentMailLog, MailLog.templateVars e chamadas de gravacao. */
export function persistedJson(): string {
  return JSON.stringify([
    tx.auditLog.create.mock.calls,
    tx.indentMailLog.create.mock.calls,
    prismaMock.indentMailLog.update.mock.calls,
    tx.indentSupplier.update.mock.calls,
    tx.indentQuote.update.mock.calls,
    sentMails().map((mail) => mail.templateVars),
  ]);
}

/** Tokens crus gerados no envio: o `portalLink` so existe dentro do html/texto passado ao `sendAndLog`. */
export function rawTokensFromMails(): string[] {
  return sentMails().map((mail) => /token=([A-Za-z0-9_%-]+)/.exec(String(mail.text))?.[1] ?? '');
}

export function resetEnvioMocks() {
  resetQuoteMocks();

  let tokenId = 900;
  let mailLogId = 700;

  mailerMock.sendAndLog.mockReset();
  mailerMock.sendAndLog.mockResolvedValue({ providerMessageId: 'msg-1', status: 'sent' });

  tx.indentSupplier.findUnique.mockResolvedValue(envioSupplier());
  tx.indentSupplier.update.mockResolvedValue({});
  tx.indentClient.findUnique.mockResolvedValue(envioClient);
  tx.indentQuote.findUnique.mockResolvedValue(draftQuote());
  tx.indentPortalToken.create.mockImplementation(async () => ({ id: (tokenId += 1) }));
  tx.indentPortalToken.findMany.mockResolvedValue([]);
  tx.indentPortalToken.updateMany.mockResolvedValue({ count: 0 });
  tx.indentPortalToken.count.mockResolvedValue(0);
  tx.indentMailLog.create.mockImplementation(async () => ({ id: (mailLogId += 1) }));
  tx.indentMailLog.findMany.mockResolvedValue([]);
  tx.indentPortalResponse.findUnique.mockResolvedValue(null);
  tx.indentPortalAttachment.findMany.mockResolvedValue([]);

  prismaMock.indentQuote.findUnique.mockResolvedValue(draftQuote());
  prismaMock.indentSupplier.findUnique.mockResolvedValue(envioSupplier());
  prismaMock.indentPortalToken.findMany.mockResolvedValue([]);
  prismaMock.indentPortalToken.count.mockResolvedValue(0);
  prismaMock.indentPortalToken.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.indentMailLog.update.mockResolvedValue({});
  prismaMock.indentMailLog.findMany.mockResolvedValue([]);
  prismaMock.indentMailLog.findFirst.mockResolvedValue(null);
  prismaMock.indentPortalResponse.findUnique.mockResolvedValue(null);
  prismaMock.indentPortalAttachment.findMany.mockResolvedValue([]);
}

// ---- Portal publico do fornecedor (4a-2) ----
// Token de teste valido (43 chars base64url) e fixtures da view/resposta. Nomes FICTICIOS (repo publico).
export const RAW_TOKEN = 'Ab1_'.repeat(11).slice(0, 43);
export const FUTURE = new Date(Date.now() + 10 * 24 * 3600 * 1000);

let uaSeq = 0;
/** `User-Agent` unico por requisicao: o rate limit (10/min) e o lockout sao por IP + UA e vivem em memoria no processo. */
export function nextUa(): string {
  uaSeq += 1;
  return `indent-portal-test-${uaSeq}`;
}

export const portalItem = (id: number, requestItemId: number, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  requestItemId,
  packaging: null as string | null,
  fobPricePerKg: null as string | null,
  cfrPricePerKg: null as string | null,
  requestItem: { description: name, quantityKg: '25000', product: { name, cas: '7440-66-6' } },
  ...overrides,
});

/** Linha do `indentPortalToken.findUnique` do `resolveToken`. */
export function portalTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    quoteId: 100,
    supplierId: 5,
    showClientName: false,
    destinationPort: 'Santos',
    message: null as string | null,
    expiresAt: FUTURE,
    revokedAt: null as Date | null,
    firstSeenAt: null as Date | null,
    quote: { status: 'ENVIADA', request: { status: 'COTACAO' } },
    ...overrides,
  };
}

/** Cotacao no formato do `viewSelect` do portal (o que `getView` le). */
export function portalQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    requestId: 11,
    supplierId: 5,
    revision: 1,
    status: 'ENVIADA',
    currency: 'USD',
    incoterm: 'CFR',
    respondedAt: null as Date | null,
    validUntil: null as Date | null,
    productionLeadTimeDays: null as number | null,
    paymentTerms: null as string | null,
    manufacturer: null as string | null,
    request: { processNumber: '277/26', status: 'COTACAO', client: { ...envioClient } },
    supplier: { name: 'Acme Chemicals', hasPartnership: false, type: 'TRADING' },
    items: [portalItem(201, 21, 'Zinco'), portalItem(202, 22, 'Acido citrico')],
    ...overrides,
  };
}

export function respondBody(overrides: Record<string, unknown> = {}) {
  return {
    currency: 'USD',
    productionLeadTimeDays: 20,
    paymentTerms: 'T/T 30 days after B/L date',
    validUntil: dayKey(20),
    manufacturer: 'Acme Works',
    notes: 'Prices ex-works.',
    items: [
      { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.7000', cfrPricePerKg: '0.7950' },
      { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '1.2', cfrPricePerKg: '1.35' },
    ],
    ...overrides,
  };
}

/** Defaults do portal: token valido, cotacao ENVIADA sem resposta, delegates de gravacao prontos. */
export function resetPortalMocks() {
  resetEnvioMocks();

  prismaMock.indentPortalToken.findUnique.mockResolvedValue(portalTokenRow());
  prismaMock.indentPortalToken.update.mockResolvedValue({});
  prismaMock.indentPortalAccessLog.create.mockResolvedValue({});
  prismaMock.indentQuote.findUnique.mockResolvedValue(portalQuote());
  prismaMock.indentQuote.findFirst.mockResolvedValue(null);
  prismaMock.indentPortalResponse.findUnique.mockResolvedValue(null);
  prismaMock.indentPortalAttachment.findMany.mockResolvedValue([]);
  prismaMock.indentPortalAttachment.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);

  tx.indentPortalToken.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: FUTURE });
  tx.indentQuote.findUnique.mockResolvedValue(sentQuote({ _count: { portalTokens: 1 } }));
  tx.indentPortalResponse.findUnique.mockResolvedValue(null);
  tx.indentPortalResponse.create.mockResolvedValue({ id: 50 });
  tx.indentPortalResponse.update.mockResolvedValue({});
  tx.indentPortalResponseItem.deleteMany.mockResolvedValue({ count: 0 });
  tx.indentPortalResponseItem.createMany.mockResolvedValue({ count: 2 });
  tx.indentPortalResponseRevision.create.mockResolvedValue({});
  tx.indentPortalAttachment.findFirst.mockResolvedValue(null);
  tx.indentPortalAttachment.count.mockResolvedValue(0);
  tx.indentPortalAttachment.create.mockImplementation(async ({ data }: { data: { fileName: string; fileSize: number } }) => ({
    id: 61,
    fileName: data.fileName,
    fileSize: data.fileSize,
  }));
  tx.indentPortalAttachmentFile.create.mockResolvedValue({});
  tx.indentRequest.update.mockResolvedValue({});
  tx.indentQuoteItem.update.mockResolvedValue({});
}

/** Cada trava `lockIndentQuote` = 3 consultas: le o requestId, trava a SOLICITACAO e so depois a COTACAO. */
export function expectPortalLockOrder(from = 0) {
  const sql = tx.$queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?').replace(/\s+/g, ' '));

  expect(sql[from]).toContain('SELECT "requestId" FROM "IndentQuote"');
  expect(sql[from + 1]).toContain('"IndentRequest"');
  expect(sql[from + 1]).toContain('FOR NO KEY UPDATE');
  expect(sql[from + 2]).toContain('"IndentQuote"');
  expect(sql[from + 2]).toContain('FOR NO KEY UPDATE');
}

/** Rota publica (sem cookie): GET/POST em `/api/indent-portal/...`, sempre com um User-Agent novo. */
export async function portal(method: 'get' | 'post', path: string, options: { body?: unknown; ua?: string; type?: string; headers?: Record<string, string> } = {}) {
  const app = await getApp();
  const req = request(app)[method](`/api/indent-portal${path}`).set('User-Agent', options.ua ?? nextUa());

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    req.set(name, value);
  }
  if (method === 'get') {
    return req;
  }
  if (options.type) {
    return req.set('Content-Type', options.type).send(options.body as Buffer);
  }
  return req.send((options.body ?? {}) as object);
}

/** Todas as gravacoes do portal: nada pode ter sido escrito (cotacao, resposta, itens, anexo, solicitacao, AuditLog). */
export function expectNoPortalWrites() {
  expectNoQuoteWrites();
  expect(tx.indentPortalResponse.create).not.toHaveBeenCalled();
  expect(tx.indentPortalResponse.update).not.toHaveBeenCalled();
  expect(tx.indentPortalResponseItem.createMany).not.toHaveBeenCalled();
  expect(tx.indentPortalResponseRevision.create).not.toHaveBeenCalled();
  expect(tx.indentPortalAttachment.create).not.toHaveBeenCalled();
  expect(tx.indentPortalAttachmentFile.create).not.toHaveBeenCalled();
}
