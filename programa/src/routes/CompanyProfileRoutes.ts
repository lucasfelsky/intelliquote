import { Router } from 'express';
import { z } from 'zod';
import { CompanyProfileService } from '../services/CompanyProfileService';
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
      return res.status(200).json(profile);
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
      const parsed = companyProfileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return res.status(400).json({
          message: first?.message ?? 'Dados do perfil invalidos. Confira os campos destacados.',
        });
      }
      const updated = await CompanyProfileService.update({
        ...parsed.data,
        updatedById: req.user?.id ?? null,
      });
      return res.status(200).json(updated);
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

