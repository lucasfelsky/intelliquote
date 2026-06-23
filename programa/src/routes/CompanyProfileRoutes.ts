import { Router } from 'express';
import { z } from 'zod';
import { CompanyProfileService, normalizeDispatchCc, readDispatchCc } from '../services/CompanyProfileService';
import { allowRoles, requireAuth } from '../middlewares/auth';
import { handleControllerError, HttpError } from '../utils/http';

const companyProfileRoutes = Router();

// Regex simples: so queremos garantir que cada CC parece um e-mail.
// A normalizacao completa (trim/lowercase/dedup) acontece no service.
const emailShape = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Informe um e-mail valido.');

const companyProfileUpdateSchema = z.object({
  companyName: z.string().trim().min(1, 'Informe a razao social.'),
  tradeName: z.string().trim().nullable().optional(),
  taxId: z.string().trim().nullable().optional(),
  addressLine1: z.string().trim().nullable().optional(),
  addressLine2: z.string().trim().nullable().optional(),
  city: z.string().trim().nullable().optional(),
  state: z.string().trim().nullable().optional(),
  postalCode: z.string().trim().nullable().optional(),
  country: z.string().trim().nullable().optional(),
  purchasingEmail: emailShape.nullable().optional().or(z.literal('').transform(() => null)),
  purchasingPhone: z.string().trim().nullable().optional(),
  website: z.string().trim().nullable().optional(),
  logoUrl: z.string().trim().nullable().optional(),
  // Lista de e-mails que recebem copia automatica em todos os envios
  // de cotacao desta empresa (CC fixo do escritorio de compras, por
  // exemplo). Aceitamos ate 50 entradas para evitar abuso.
  dispatchCc: z
    .array(emailShape)
    .max(50, 'Limite de 50 enderecos em copia automatica.')
    .optional(),
});

companyProfileRoutes.get(
  '/',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  async (_req, res) => {
    try {
      const profile = await CompanyProfileService.get();
      // dispatchCc e persistido como JSON string para manter compatibilidade
      // com schemas que nao tem tipo nativo de array. Hidratamos para o
      // formato que o frontend espera (array de strings) na resposta.
      const { dispatchCc, ...rest } = profile;
      return res.status(200).json({
        ...rest,
        dispatchCc: readDispatchCc(profile),
      });
    } catch (error) {
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  },
);

companyProfileRoutes.put(
  '/',
  requireAuth,
  allowRoles(['admin', 'comprador', 'gestor', 'viewer']),
  async (req, res) => {
    try {
      // Aceitamos duas representacoes:
      //   { dispatchCc: ["a@x", ...], includeUserProfiles: true }
      // ou:
      //   { dispatchCc: { includeUserProfiles: true, extras: ["a@x", ...] } }
      //
      // `includeUserProfiles=true` faz o backend puxar todos os e-mails
      // dos perfis ativos do sistema alem dos `extras` manuais, de forma
      // que o admin nao precise marcar usuario por usuario no checkbox
      // para garantir que a equipe toda esta sempre em copia.
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const rawCc = rawBody.dispatchCc;
      const explicit =
        rawCc && typeof rawCc === 'object' && !Array.isArray(rawCc)
          ? (rawCc as Record<string, unknown>)
          : null;

      const includeUsers =
        typeof rawBody.includeUserProfiles === 'boolean'
          ? rawBody.includeUserProfiles
          : explicit
            ? Boolean(explicit.includeUserProfiles)
            : false;
      const extras = explicit && Array.isArray(explicit.extras)
        ? (explicit.extras as unknown[])
        : Array.isArray(rawCc)
          ? (rawCc as unknown[])
          : [];

      const parsed = companyProfileUpdateSchema.safeParse({
        ...rawBody,
        dispatchCc: extras,
      });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return res.status(400).json({
          message: first?.message ?? 'Dados do perfil invalidos. Confira os campos destacados.',
        });
      }
      let finalCc: string[];
            if (includeUsers) {
              finalCc = await CompanyProfileService.normalizeDispatchCcWithUsers({
                extraEmails: parsed.data.dispatchCc ?? [],
              });
            } else {
              finalCc = normalizeDispatchCc(parsed.data.dispatchCc ?? []);
            }
      const updated = await CompanyProfileService.update({
        ...parsed.data,
        dispatchCc: finalCc,
        updatedById: req.user?.id ?? null,
      });
      // Hidrata dispatchCc para array de strings antes de devolver.
      const { dispatchCc, ...rest } = updated;
      return res.status(200).json({
        ...rest,
        dispatchCc: readDispatchCc(updated),
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ message: error.message });
      }
      const handled = handleControllerError(error);
      return res.status(handled.status).json({ message: handled.message });
    }
  },
);

export { companyProfileRoutes };

