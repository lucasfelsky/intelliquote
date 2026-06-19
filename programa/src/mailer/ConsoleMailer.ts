import type { Mailer, MailMessage, MailSendResult } from './Mailer';

export class ConsoleMailer implements Mailer {
  async send(msg: MailMessage): Promise<MailSendResult> {
    const preview = {
      to: msg.to,
      cc: msg.cc ?? [],
      subject: msg.subject,
      text: msg.text ?? msg.html.replace(/<[^>]+>/g, '').slice(0, 280),
    };
    // eslint-disable-next-line no-console
    console.log('[ConsoleMailer] send', JSON.stringify(preview, null, 2));
    return {
      providerMessageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'sent',
    };
  }

  async sendBulk(msgs: MailMessage[]): Promise<MailSendResult[]> {
    const results: MailSendResult[] = [];
    for (const msg of msgs) {
      results.push(await this.send(msg));
    }
    return results;
  }
}
