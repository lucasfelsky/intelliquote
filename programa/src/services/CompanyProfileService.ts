import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { HttpError } from '../utils/http';

export interface CompanyProfileInput {
  companyName: string;
  tradeName?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  purchasingEmail?: string | null;
  purchasingPhone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  // Lista de e-mails fixos em copia automatica em todos os envios de
  // cotacao desta empresa. Cada item ja deve estar normalizado
  // (lowercase, trim). Persistido como JSON array de strings.
  dispatchCc?: string[] | null;
  awardApprovalThreshold?: number | null;
  updatedById?: number | null;
}

export class CompanyProfileService {
  static async get(client: PrismaClient | Prisma.TransactionClient = defaultPrisma) {
    const profile = await client.companyProfile.findUnique({ where: { id: 1 } });
    if (!profile) {
      return client.companyProfile.create({
        data: {
          id: 1,
          companyName: 'SQ Quimica',
        },
      });
    }
    return profile;
  }

  static async update(
    input: CompanyProfileInput,
    client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
  ) {
    // E-mail de usuario `comercial` nunca persiste no CC (mesmo vindo como "extra" manual).
    const dispatchCcJson = JSON.stringify(
      await excludeComercialEmails(normalizeDispatchCc(input.dispatchCc), client),
    );

    const existing = await client.companyProfile.findUnique({ where: { id: 1 } });
    if (!existing) {
      return client.companyProfile.create({
        data: {
          id: 1,
          companyName: input.companyName,
          tradeName: input.tradeName ?? null,
          taxId: input.taxId ?? null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          country: input.country ?? 'Brazil',
          purchasingEmail: input.purchasingEmail ?? null,
          purchasingPhone: input.purchasingPhone ?? null,
          website: input.website ?? null,
          logoUrl: input.logoUrl ?? null,
          awardApprovalThreshold: input.awardApprovalThreshold ?? null,
          dispatchCc: dispatchCcJson,
          updatedById: input.updatedById ?? null,
        },
      });
    }

    return client.companyProfile.update({
      where: { id: 1 },
      data: {
        companyName: input.companyName,
        tradeName: input.tradeName ?? null,
        taxId: input.taxId ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? 'Brazil',
        purchasingEmail: input.purchasingEmail ?? null,
        purchasingPhone: input.purchasingPhone ?? null,
        website: input.website ?? null,
        logoUrl: input.logoUrl ?? null,
        awardApprovalThreshold: input.awardApprovalThreshold,
        dispatchCc: dispatchCcJson,
        updatedById: input.updatedById ?? null,
      },
    });
  }

  static async normalizeDispatchCcWithUsers(input: {
    extraEmails: string[];
  }): Promise<string[]> {
    return normalizeDispatchCcWithUsers({ extraEmails: input.extraEmails });
  }
}

/**
 * E-mails (lowercase) de todos os usuarios com papel `comercial`, ativos ou nao.
 * O comercial nunca pode receber e-mail com dados de fornecedor/preco/magic link.
 */
export async function loadComercialEmails(
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<Set<string>> {
  const users = await client.user.findMany({
    where: { role: { name: 'comercial' } },
    select: { email: true },
  });
  return new Set(
    users
      .map((u) => u.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e)),
  );
}

/**
 * Remove destinatarios (to/cc) que pertencem a usuarios `comercial`, comparando
 * e-mail case-insensitive. Filtra NO MOMENTO DO ENVIO: o dispatchCc e' uma lista
 * gravada, entao quem estava nela e depois virou comercial continuaria recebendo.
 */
export async function excludeComercialRecipients<T extends { email: string }>(
  items: T[],
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<T[]> {
  if (items.length === 0) return items;
  const comercial = await loadComercialEmails(client);
  if (comercial.size === 0) return items;
  return items.filter((item) => !comercial.has((item.email ?? '').trim().toLowerCase()));
}

export async function excludeComercialEmails(
  emails: string[],
  client: PrismaClient | Prisma.TransactionClient = defaultPrisma,
): Promise<string[]> {
  const kept = await excludeComercialRecipients(
    emails.map((email) => ({ email })),
    client,
  );
  return kept.map((item) => item.email);
}

/**
 * Normaliza a lista de e-mails em copia automatica:
 *  - remove espacos nas pontas
 *  - converte para lowercase
 *  - dedup case-insensitive
 *  - descarta strings vazias e entradas sem '@'
 */
export function normalizeDispatchCc(input: string[] | null | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Normaliza a lista de e-mails em copia automatica incluindo os perfis
 * (id, name, email) atualmente ativos no sistema. E-mails passados em
 * `extraEmails` sao preservados mesmo que nao correspondam a um perfil
 * (ex: financeiro@sqquimica.com). Deduplicacao case-insensitive.
 */
export async function normalizeDispatchCcWithUsers(input: {
  extraEmails: string[];
  client?: PrismaClient | Prisma.TransactionClient;
}): Promise<string[]> {
  const userClient = input.client ?? defaultPrisma;
  const users = await userClient.user.findMany({
    // `comercial` fica fora: o CC dos envios a fornecedor carrega dados de preco/fornecedor.
    where: { isActive: true, role: { name: { not: 'comercial' } } },
    select: { email: true },
  });
  const userEmails = users
    .map((u) => u.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e) && e.includes('@'));
  return normalizeDispatchCc([...userEmails, ...input.extraEmails]);
}

/**
 * Le o campo dispatchCc do perfil (JSON) com fallback seguro caso esteja
 * mal-formado (devolve array vazio em vez de quebrar).
 */
export function readDispatchCc(profile: { dispatchCc: string | null } | null | undefined): string[] {
  if (!profile || !profile.dispatchCc) return [];
  try {
    const parsed = JSON.parse(profile.dispatchCc);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

export function requireCompanyProfileFields(profile: Awaited<ReturnType<typeof CompanyProfileService.get>>) {
  const missing: string[] = [];
  if (!profile.companyName) missing.push('companyName');
  if (!profile.purchasingEmail) missing.push('purchasingEmail');
  if (missing.length > 0) {
    throw new HttpError(
      412,
      `Perfil da empresa incompleto: configure ${missing.join(' e ')} antes de enviar cotacoes.`,
    );
  }
  return profile;
}
