export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: MailAddress[];
  cc?: MailAddress[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: MailAddress;
  tags?: string[];
  attachments?: MailAttachment[];
}

export interface MailSendResult {
  providerMessageId: string;
  status: 'sent' | 'queued' | 'failed';
  error?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<MailSendResult>;
  sendBulk?(msgs: MailMessage[]): Promise<MailSendResult[]>;
}
