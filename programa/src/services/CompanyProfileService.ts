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
    const dispatchCcJson = JSON.stringify(normalizeDispatchCc(input.dispatchCc));

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
        dispatchCc: dispatchCcJson,
        updatedById: input.updatedById ?? null,
      },
    });
  }
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
