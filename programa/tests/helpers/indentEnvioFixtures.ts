import { expect, vi } from 'vitest';
import { expectNoQuoteWrites, prismaMock, quoteRow, resetQuoteMocks, sentQuote, tx } from './indentRoutesMock';

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
