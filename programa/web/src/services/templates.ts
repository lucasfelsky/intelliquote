export interface EmailTemplate {
  id: number;
  key: string;
  locale: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  isActive: boolean;
  updatedAt: string;
  updatedById: number | null;
}

export interface EmailTemplateDraft {
  subject: string;
  htmlBody: string;
  textBody: string;
  isActive: boolean;
}
