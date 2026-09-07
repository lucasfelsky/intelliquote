// DEMO_MODE trava o mailer: getMailer() SEMPRE retorna ConsoleMailer quando
// demoEnv.enabled, independente de MAILER_PROVIDER (cinto-e-suspensorio
// para o e-mail nunca sair de verdade na area de teste).
//
// getMailer() cacheia um singleton em modulo; usamos vi.resetModules() +
// import dinamico para pegar uma instancia fresca do MailerService a cada
// cenario, com o env mockado ANTES do import.

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('MailerService — trava de DEMO_MODE', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('../src/lib/prisma', () => ({ prisma: {} }));
  });

  it('getMailer() retorna ConsoleMailer quando demoEnv.enabled=true mesmo com MAILER_PROVIDER=smtp', async () => {
    vi.doMock('../src/config/env', () => ({
      demoEnv: { enabled: true, resetToken: null, userPassword: null },
      mailerEnv: {
        provider: 'smtp',
        smtp: { host: '', port: 587, user: '', pass: '', from: '', secure: false, retryAttempts: 3, retryBaseDelayMs: 500 },
        comexCcList: [],
        portalUrl: 'http://localhost:3000',
      },
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getMailer } = await import('../src/mailer/MailerService');
    const { ConsoleMailer } = await import('../src/mailer/ConsoleMailer');
    const { SmtpMailer } = await import('../src/mailer/SmtpMailer');

    const mailer = getMailer();

    expect(mailer).toBeInstanceOf(ConsoleMailer);
    expect(mailer).not.toBeInstanceOf(SmtpMailer);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEMO_MODE'));

    // Segunda chamada reusa o singleton — nao gera um novo warn.
    getMailer();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('sem DEMO_MODE, getMailer() respeita MAILER_PROVIDER=smtp normalmente', async () => {
    vi.doMock('../src/config/env', () => ({
      demoEnv: { enabled: false, resetToken: null, userPassword: null },
      mailerEnv: {
        provider: 'smtp',
        smtp: { host: '', port: 587, user: '', pass: '', from: '', secure: false, retryAttempts: 3, retryBaseDelayMs: 500 },
        comexCcList: [],
        portalUrl: 'http://localhost:3000',
      },
    }));

    const { getMailer } = await import('../src/mailer/MailerService');
    const { SmtpMailer } = await import('../src/mailer/SmtpMailer');

    const mailer = getMailer();

    expect(mailer).toBeInstanceOf(SmtpMailer);
  });

  it('sem DEMO_MODE, getMailer() respeita MAILER_PROVIDER=console normalmente', async () => {
    vi.doMock('../src/config/env', () => ({
      demoEnv: { enabled: false, resetToken: null, userPassword: null },
      mailerEnv: {
        provider: 'console',
        smtp: { host: '', port: 587, user: '', pass: '', from: '', secure: false, retryAttempts: 3, retryBaseDelayMs: 500 },
        comexCcList: [],
        portalUrl: 'http://localhost:3000',
      },
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getMailer } = await import('../src/mailer/MailerService');
    const { ConsoleMailer } = await import('../src/mailer/ConsoleMailer');

    const mailer = getMailer();

    expect(mailer).toBeInstanceOf(ConsoleMailer);
    // Nao e' o caminho do DEMO_MODE: sem o warn especifico dele.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEMO_MODE'));

    warnSpy.mockRestore();
  });
});
