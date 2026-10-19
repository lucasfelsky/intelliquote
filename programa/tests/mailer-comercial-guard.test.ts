// Defesa central (funil sendAndLog): usuario `comercial` nunca recebe e-mail em to/cc,
// salvo opt-out explicito (allowComercialRecipients). Tambem cobre loadComexCc.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  send: vi.fn(),
  mailLogCreate: vi.fn(),
  mailLogUpdate: vi.fn(),
  userFindMany: vi.fn(),
  profileFindUnique: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../src/mailer/ConsoleMailer', () => ({
  ConsoleMailer: class {
    send = h.send;
  },
}));
vi.mock('../src/mailer/SmtpMailer', () => ({
  SmtpMailer: class {
    send = h.send;
  },
}));
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    mailLog: { create: h.mailLogCreate, update: h.mailLogUpdate },
    user: { findMany: h.userFindMany },
    companyProfile: { findUnique: h.profileFindUnique },
  },
}));
vi.mock('../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: h.loggerError },
}));

import {
  SKIPPED_COMERCIAL_LOOKUP_FAILED,
  SKIPPED_COMERCIAL_RECIPIENT,
  sendAndLog,
} from '../src/mailer/MailerService';
import { loadComexCc } from '../src/services/CreditSupportService';

const base = {
  subject: 's',
  html: '<p>x</p>',
  templateId: 'tpl',
  templateVars: { a: 1 },
  relatedEntityType: 'quote_request',
  relatedEntityId: '9',
};

function sentMessage() {
  return h.send.mock.calls[0][0] as {
    to: Array<{ email: string; name?: string }>;
    cc?: Array<{ email: string; name?: string }>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockResolvedValue({ providerMessageId: 'm1', status: 'sent' });
  h.mailLogCreate.mockResolvedValue({ id: 1 });
  h.mailLogUpdate.mockResolvedValue({});
  h.userFindMany.mockResolvedValue([]);
  h.profileFindUnique.mockResolvedValue({ id: 1, dispatchCc: null });
});

describe('sendAndLog - defesa central contra destinatario comercial', () => {
  it('consulta so usuarios com papel comercial', async () => {
    await sendAndLog({ ...base, to: { email: 'forn@acme.com' } });

    expect(h.userFindMany.mock.calls[0][0].where).toEqual({ role: { name: 'comercial' } });
  });

  it('sem comercial entre os destinatarios: envio inalterado', async () => {
    h.userFindMany.mockResolvedValue([{ email: 'vendas@sqquimica.com' }]);

    await sendAndLog({
      ...base,
      to: { email: 'forn@acme.com', name: 'Forn' },
      cc: [{ email: 'comex@sqquimica.com', name: 'COMEX' }],
    });

    expect(sentMessage().to).toEqual([{ email: 'forn@acme.com', name: 'Forn' }]);
    expect(sentMessage().cc).toEqual([{ email: 'comex@sqquimica.com', name: 'COMEX' }]);
  });

  it('cc comercial e removido (caixa diferente), demais mantidos; MailLog reflete o cc final', async () => {
    h.userFindMany.mockResolvedValue([{ email: 'Vendas@SQQuimica.com' }]);

    await sendAndLog({
      ...base,
      to: { email: 'forn@acme.com' },
      cc: [{ email: 'VENDAS@sqquimica.com' }, { email: 'comex@sqquimica.com' }],
    });

    expect(sentMessage().cc).toEqual([{ email: 'comex@sqquimica.com' }]);
    expect(h.mailLogCreate.mock.calls[0][0].data.ccList).toBe('comex@sqquimica.com');
  });

  it('todos os cc comercial: cc vira indefinido', async () => {
    h.userFindMany.mockResolvedValue([{ email: 'vendas@sqquimica.com' }]);

    await sendAndLog({
      ...base,
      to: { email: 'forn@acme.com' },
      cc: [{ email: 'vendas@sqquimica.com' }],
    });

    expect(sentMessage().cc).toBeUndefined();
    expect(h.mailLogCreate.mock.calls[0][0].data.ccList).toBeNull();
  });

  it('to comercial com cc sobrando: NAO promove o cc; suprime o envio inteiro (MailLog suppressed)', async () => {
    h.userFindMany.mockResolvedValue([{ email: 'vendas@sqquimica.com' }]);

    const result = await sendAndLog({
      ...base,
      to: { email: 'Vendas@sqquimica.com', name: 'Vendas' },
      cc: [
        { email: 'comex1@sqquimica.com', name: 'C1' },
        { email: 'comex2@sqquimica.com', name: 'C2' },
      ],
    });

    expect(h.send).not.toHaveBeenCalled();
    expect(result.error).toBe(SKIPPED_COMERCIAL_RECIPIENT);
    expect(h.mailLogCreate).toHaveBeenCalledTimes(1);
    expect(h.mailLogCreate.mock.calls[0][0].data.status).toBe('suppressed');
    expect(h.mailLogCreate.mock.calls[0][0].data.errorMessage).toBe('skipped_comercial_recipient');
  });

  it('to comercial e cc comercial: nao envia, registra MailLog suppressed e nao lanca', async () => {
    h.userFindMany.mockResolvedValue([
      { email: 'vendas@sqquimica.com' },
      { email: 'vendas2@sqquimica.com' },
    ]);

    const result = await sendAndLog({
      ...base,
      to: { email: 'vendas@sqquimica.com' },
      cc: [{ email: 'vendas2@sqquimica.com' }],
    });

    expect(h.send).not.toHaveBeenCalled();
    expect(result).toEqual({
      providerMessageId: '',
      status: 'failed',
      error: SKIPPED_COMERCIAL_RECIPIENT,
    });
    expect(h.mailLogCreate).toHaveBeenCalledTimes(1);
    const data = h.mailLogCreate.mock.calls[0][0].data;
    expect(data.status).toBe('suppressed');
    expect(data.errorMessage).toBe('skipped_comercial_recipient');
    expect(data.templateId).toBe('tpl');
    expect(h.mailLogUpdate).not.toHaveBeenCalled();
    expect(h.loggerWarn).toHaveBeenCalled();
  });

  it('to comercial sem cc: nao envia', async () => {
    h.userFindMany.mockResolvedValue([{ email: 'vendas@sqquimica.com' }]);

    const result = await sendAndLog({ ...base, to: { email: 'vendas@sqquimica.com' } });

    expect(h.send).not.toHaveBeenCalled();
    expect(result.error).toBe(SKIPPED_COMERCIAL_RECIPIENT);
  });

  it('opt-out allowComercialRecipients: mantem to e cc comercial e nem consulta papeis', async () => {
    h.userFindMany.mockResolvedValue([{ email: 'vendas@sqquimica.com' }]);

    await sendAndLog({
      ...base,
      to: { email: 'vendas@sqquimica.com' },
      cc: [{ email: 'vendas2@sqquimica.com' }],
      allowComercialRecipients: true,
    });

    expect(h.userFindMany).not.toHaveBeenCalled();
    expect(sentMessage().to).toEqual([{ email: 'vendas@sqquimica.com' }]);
    expect(sentMessage().cc).toEqual([{ email: 'vendas2@sqquimica.com' }]);
  });

  it('falha ao consultar papeis: fail-closed (nao envia, loga o erro, nao lanca)', async () => {
    h.userFindMany.mockRejectedValue(new Error('db caiu'));

    const result = await sendAndLog({ ...base, to: { email: 'forn@acme.com' } });

    expect(h.send).not.toHaveBeenCalled();
    expect(h.mailLogCreate).not.toHaveBeenCalled();
    expect(result).toEqual({
      providerMessageId: '',
      status: 'failed',
      error: SKIPPED_COMERCIAL_LOOKUP_FAILED,
    });
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe('loadComexCc (Credit Support)', () => {
  it('e-mail do dispatchCc que pertence a usuario comercial fica fora', async () => {
    h.profileFindUnique.mockResolvedValue({
      id: 1,
      dispatchCc: JSON.stringify(['Vendas@sqquimica.com', 'financeiro@sqquimica.com']),
    });
    h.userFindMany.mockResolvedValue([{ email: 'vendas@SQQuimica.com' }]);

    const cc = await loadComexCc();

    expect(cc.map((c) => c.email)).toEqual(['financeiro@sqquimica.com']);
  });
});
