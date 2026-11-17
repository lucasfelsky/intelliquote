import { z } from 'zod';
import { INDENT_MAX_SUPPLIER_EMAILS } from '../constants/indentPortal';

// Lista de e-mails do fornecedor do IQ Indent (cadastro, importacao e destinatarios do envio).
// Mesmo criterio de e-mail de `contactRecipients.ts` (z.string().trim().email()).

const emailSchema = z.string().trim().email();

function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

export type NormalizedEmailList = { emails: string[] } | { error: 'invalid' | 'too_many' };

/** Texto livre (separado por virgula, ponto e virgula ou espaco) ou lista: trim + minusculas, sem vazios nem duplicados. */
export function normalizeEmailList(input: string | string[] | null | undefined): NormalizedEmailList {
  const parts = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,;\s]+/) : [];
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const part of parts) {
    const email = String(part ?? '').trim().toLowerCase();

    if (!email) {
      continue;
    }
    if (!isValidEmail(email)) {
      return { error: 'invalid' };
    }
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }

  if (emails.length > INDENT_MAX_SUPPLIER_EMAILS) {
    return { error: 'too_many' };
  }

  return { emails };
}

/** Importacao: descarta invalidos e duplicados e corta no limite do cadastro (sem erro). */
export function normalizeEmailListLenient(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const value of values) {
    const email = (value ?? '').trim().toLowerCase();

    if (!email || !isValidEmail(email) || seen.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }

  return emails.slice(0, INDENT_MAX_SUPPLIER_EMAILS);
}
