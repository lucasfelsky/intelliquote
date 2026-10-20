import { z } from 'zod';

// Resolvedor puro de destinatarios a partir da lista de contatos de um fornecedor/parceiro.
// Usado pela PO (fornecedor e parceiro de Credit Support) e pelo "Responder": o contato
// principal/preferido vai no To e os demais contatos em Cc. Sem Prisma: quem chama carrega
// a lista JA ordenada (isPrimary desc, id asc).

export interface RecipientContact {
  id: number;
  name: string;
  email: string;
}

// Mesmo criterio do Zod usado em validators/domain.ts (z.string().trim().email()).
const emailSchema = z.string().trim().email();

function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

export function resolveContactRecipients<T extends RecipientContact>(
  contacts: T[],
  opts: { preferredContactId?: number | null; blockedEmails?: Set<string> } = {},
): { to: T; contactCc: T[] } | null {
  const blocked = opts.blockedEmails ?? new Set<string>();
  const seen = new Set<string>();
  const survivors: T[] = [];

  for (const contact of contacts) {
    const email = (contact.email ?? '').trim();
    if (!email || !isValidEmail(email)) continue;
    const key = email.toLowerCase();
    if (blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    survivors.push({ ...contact, email });
  }

  if (survivors.length === 0) return null;

  const preferredId = opts.preferredContactId ?? null;
  const preferredIndex =
    preferredId === null ? -1 : survivors.findIndex((contact) => contact.id === preferredId);
  const ordered =
    preferredIndex > 0
      ? [survivors[preferredIndex], ...survivors.filter((_, index) => index !== preferredIndex)]
      : survivors;

  const [to, ...rest] = ordered;
  return {
    to,
    contactCc: rest.map((contact) => ({ ...contact, email: contact.email.toLowerCase() })),
  };
}

// Junta listas de Cc: trim + lowercase, descarta vazio/invalido, descarta o proprio To
// (sem diferenciar maiusculas) e duplicados (fica a primeira ocorrencia).
export function mergeCc(
  toEmail: string,
  ...lists: Array<Array<{ email: string; name?: string | null }>>
): Array<{ email: string; name: string }> {
  const seen = new Set<string>([toEmail.trim().toLowerCase()]);
  const merged: Array<{ email: string; name: string }> = [];
  for (const list of lists) {
    for (const item of list) {
      const email = (item.email ?? '').trim().toLowerCase();
      if (!email || !isValidEmail(email) || seen.has(email)) continue;
      seen.add(email);
      merged.push({ email, name: item.name ?? '' });
    }
  }
  return merged;
}
