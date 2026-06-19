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
        updatedById: input.updatedById ?? null,
      },
    });
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
