import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  send: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  loggerError: vi.fn(),
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
  prisma: { mailLog: { create: h.create, update: h.update } },
}));
vi.mock('../src/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: h.loggerError },
}));

import { sendAndLog } from '../src/mailer/MailerService';

const input = {
  to: { email: 'a@a.com', name: 'A' },
  subject: 's',
  html: '<p>x</p>',
  templateId: 't',
  templateVars: {},
};

describe('sendAndLog - falha pos-envio no mailLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.create.mockResolvedValue({ id: 7 });
    h.update.mockResolvedValue({});
  });

  it('a) send ok + mailLog.update lanca: retorna o result do provedor e loga o erro', async () => {
    const result = { providerMessageId: 'm1', status: 'sent' as const };
    h.send.mockResolvedValue(result);
    h.update.mockRejectedValue(new Error('db caiu'));

    await expect(sendAndLog(input)).resolves.toEqual(result);
    expect(h.loggerError).toHaveBeenCalledTimes(1);
    expect(h.loggerError.mock.calls[0][0]).toMatchObject({ mailLogId: 7, reason: 'db caiu' });
  });

  it('c) mailer.send lanca: propaga o erro (nao engole) e nao atualiza o log', async () => {
    h.send.mockRejectedValue(new Error('smtp'));

    await expect(sendAndLog(input)).rejects.toThrow('smtp');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('mailLog.create inicial falha: propaga o erro e nao envia', async () => {
    h.create.mockRejectedValue(new Error('db'));

    await expect(sendAndLog(input)).rejects.toThrow('db');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('caminho feliz: atualiza o mailLog com o status e nao loga erro', async () => {
    h.send.mockResolvedValue({ providerMessageId: 'm2', status: 'queued' });

    await expect(sendAndLog(input)).resolves.toMatchObject({ status: 'queued' });
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: expect.objectContaining({ status: 'queued' }) }),
    );
    expect(h.loggerError).not.toHaveBeenCalled();
  });
});
