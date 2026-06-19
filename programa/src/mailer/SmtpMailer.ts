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

export class SmtpMailer implements Mailer {
  async send(msg: MailMessage): Promise<MailSendResult> {
    const transport = getTransport();
    const fromAddress = formatFrom(mailerEnv.smtp.from, mailerEnv.smtp.user);
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
        headers: msg.tags?.length
          ? { 'X-Tags': msg.tags.join(',') }
          : undefined,
      });
      return {
        providerMessageId: result.messageId ?? '',
        status: 'sent',
      };
    } catch (error) {
      return {
        providerMessageId: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
