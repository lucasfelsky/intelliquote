import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  createTransport: vi.fn(() => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'm1' }),
  })),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: h.createTransport },
}));

// Não importar nada que toque Prisma (guard do #137): env mockado.
vi.mock('../src/config/env', () => ({
  mailerEnv: {
    smtp: {
      host: 'smtp.test',
      port: 587,
      user: 'u',
      pass: 'p',
      from: 'x@y.com',
      secure: false,
      retryAttempts: 3,
      retryBaseDelayMs: 500,
    },
  },
}));

const message = {
  to: [{ email: 'a@a.com' }],
  subject: 's',
  html: '<p>x</p>',
};

describe('SmtpMailer transport', () => {
  beforeEach(() => {
    // cachedTransport é de módulo: reimporta a cada teste.
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('cria o transport com timeouts explícitos e mantém o pool', async () => {
    const { SmtpMailer } = await import('../src/mailer/SmtpMailer');

    const result = await new SmtpMailer().send(message);

    expect(h.createTransport).toHaveBeenCalledTimes(1);
    expect(h.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        dnsTimeout: 5000,
        connectionTimeout: 20000,
        greetingTimeout: 15000,
        socketTimeout: 45000,
        pool: true,
        maxConnections: 5,
        maxMessages: 50,
        secure: false,
        host: 'smtp.test',
        port: 587,
        auth: { user: 'u', pass: 'p' },
      }),
    );
    expect(result.status).toBe('sent');
  });

  it('reaproveita o transport em envios seguidos', async () => {
    const { SmtpMailer } = await import('../src/mailer/SmtpMailer');
    const mailer = new SmtpMailer();

    await mailer.send(message);
    await mailer.send(message);

    expect(h.createTransport).toHaveBeenCalledTimes(1);
  });

  it('pior caso de um send() cabe nos 300 s do attempt-deadline', async () => {
    const { SMTP_TIMEOUTS } = await import('../src/mailer/SmtpMailer');
    // 3 tentativas e base 500 ms são os padrões de config/env.ts:180-181. Este teste
    // existe para que mexer nos timeouts não estoure o deadline sem perceber.
    const attempts = 3;
    const baseMs = 500;
    const perAttempt = Object.values(SMTP_TIMEOUTS).reduce((a, b) => a + b, 0);
    let maxBackoff = 0;
    for (let n = 1; n < attempts; n++) {
      maxBackoff += baseMs * 2 ** (n - 1) + (baseMs - 1);
    }

    expect(perAttempt * attempts + maxBackoff).toBeLessThan(300_000);
  });
});
