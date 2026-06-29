import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage, MailSendResult } from './Mailer';
import { mailerEnv } from '../config/env';

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const { host, port, user, pass, secure } = mailerEnv.smtp;
  if (!host || !user || !pass) {
    throw new Error(
      'SMTP nao configurado: defina SMTP_HOST, SMTP_USER e SMTP_PASS nas variaveis de ambiente.',
    );
  }
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: secure || port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 50,
  });
  return cachedTransport;
}

// Códigos nodemailer considerados transitórios (rede/tempo). Erros de auth (EAUTH),
// envelope (EENVELOPE) ou mensagem (EMESSAGE) são definitivos e NÃO são retentados.
const TRANSIENT_NODEMAILER_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'ESTREAM',
  'EDNS',
  'EECONNRESET',
]);

// Códigos SMTP 4xx temporários (Throttle/queue/greylisting). 5xx são definitivos.
const TRANSIENT_SMTP_RESPONSE_CODES = new Set([421, 450, 451, 452, 454]);

function isTransientSmtpError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  const responseCode = (error as { responseCode?: unknown }).responseCode;
  if (typeof code === 'string' && TRANSIENT_NODEMAILER_CODES.has(code)) return true;
  if (
    typeof responseCode === 'number' &&
    TRANSIENT_SMTP_RESPONSE_CODES.has(responseCode)
  ) {
    return true;
  }
  // Greylisting / throttle costumam aparecer como string 4xx no `response`.
  const response = (error as { response?: unknown }).response;
  if (typeof response === 'string' && /^4\d{2}\b/.test(response.trim())) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Backoff exponencial com jitter: base * 2^(attempt-1) + jitter(0..base).
function backoffDelay(attempt: number, baseMs: number): number {
  const exp = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * baseMs);
  return exp + jitter;
}

export class SmtpMailer implements Mailer {
  async send(msg: MailMessage): Promise<MailSendResult> {
    const transport = getTransport();
    const fromAddress = formatFrom(mailerEnv.smtp.from, mailerEnv.smtp.user);
    const maxAttempts = Math.max(1, mailerEnv.smtp.retryAttempts);
    const baseDelay = Math.max(0, mailerEnv.smtp.retryBaseDelayMs);

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await transport.sendMail({
          from: fromAddress,
          to: msg.to.map(formatAddress).join(', '),
          cc: msg.cc?.map(formatAddress).join(', '),
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          replyTo: msg.replyTo ? formatAddress(msg.replyTo) : undefined,
          attachments: msg.attachments?.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          })),
          headers: msg.tags?.length ? { 'X-Tags': msg.tags.join(',') } : undefined,
        });
        return {
          providerMessageId: result.messageId ?? '',
          status: 'sent',
        };
      } catch (error) {
        lastError = error;
        // Não retentar erros definitivos (auth, envelope, mensagem, 5xx).
        if (!isTransientSmtpError(error) || attempt === maxAttempts) {
          break;
        }
        await sleep(backoffDelay(attempt, baseDelay));
      }
    }

    return {
      providerMessageId: '',
      status: 'failed',
      error:
        lastError instanceof Error
          ? lastError.message
          : lastError != null
            ? String(lastError)
            : 'SMTP send failed',
    };
  }

  async sendBulk(msgs: MailMessage[]): Promise<MailSendResult[]> {
    return Promise.all(msgs.map((m) => this.send(m)));
  }
}

function formatAddress(addr: { email: string; name?: string }): string {
  if (addr.name && addr.name.trim().length > 0) {
    return `"${addr.name}" <${addr.email}>`;
  }
  return addr.email;
}

function formatFrom(from: string, fallbackUser: string): string {
  if (from && from.includes('@')) {
    if (from.includes('<') && from.includes('>')) return from;
    return `IntelliQuote <${from}>`;
  }
  if (fallbackUser) {
    return `IntelliQuote <${fallbackUser}>`;
  }
  return from;
}
