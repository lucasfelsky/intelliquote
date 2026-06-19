import { z } from 'zod';

import { Incoterm } from '@prisma/client';

const templateLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Locale invalido (use en, pt-BR, es, ...)');

export const emailTemplateUpsertSchema = z.object({
  subject: z.string().trim().min(1, 'Informe o assunto.').max(255),
  htmlBody: z.string().min(1, 'Informe o corpo HTML.'),
  textBody: z.string().min(1, 'Informe o corpo em texto puro.'),
  isActive: z.boolean().optional().default(true),
});

export const emailTemplateQuerySchema = z.object({
  key: z.string().trim().min(1).max(64).optional(),
  locale: templateLocaleSchema.optional(),
});

export type EmailTemplateUpsertInput = z.infer<typeof emailTemplateUpsertSchema>;
export type EmailTemplateQueryInput = z.infer<typeof emailTemplateQuerySchema>;

const positiveIntegerField = z.coerce.number().int().positive();
const positiveNumberField = z.coerce.number().positive();
const nonNegativeIntegerField = z.coerce.number().int().min(0);
const optionalNonNegativeIntegerField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  nonNegativeIntegerField.optional(),
);
const optionalPositiveNumberField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  positiveNumberField.optional(),
);
const requiredTrimmedStringField = z.string().trim().min(1);
const optionalTrimmedStringField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  requiredTrimmedStringField.optional(),
);
const currencyCodeField = requiredTrimmedStringField
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), {
    message: 'Informe um codigo de moeda valido.',
  });
const optionalCurrencyCodeField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  currencyCodeField.optional(),
);

export const supplierPortalResponseItemSchema = z.object({
  quoteRequestItemId: positiveIntegerField,
  unitPrice: positiveNumberField,
  quantity: nonNegativeIntegerField,
  totalPrice: positiveNumberField,
  leadTimeDays: optionalNonNegativeIntegerField,
  notes: optionalTrimmedStringField,
});

export const supplierPortalResponseSubmitSchema = z.object({
  currency: optionalCurrencyCodeField,
  incoterm: z.nativeEnum(Incoterm),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  exchangeRate: optionalPositiveNumberField,
  totalPrice: positiveNumberField,
  totalPriceCurrency: optionalCurrencyCodeField,
  validityDays: z.coerce.number().int().min(1).max(365),
  notes: optionalTrimmedStringField,
  items: z.array(supplierPortalResponseItemSchema).min(1, 'Informe ao menos um item.'),
});

export type SupplierPortalResponseSubmitInput = z.infer<
  typeof supplierPortalResponseSubmitSchema
>;
export type SupplierPortalResponseItemInput = z.infer<
  typeof supplierPortalResponseItemSchema
>;

export const dispatchRecipientSelectionSchema = z.object({
  supplierContactId: positiveIntegerField,
  include: z.boolean().optional().default(true),
});

export const dispatchCreateSchema = z.object({
  recipientContactIds: z
    .array(positiveIntegerField)
    .min(1, 'Selecione ao menos um destinatario.')
    // Sem limite pratico: na plataforma real podemos ter cotacoes com dezenas
    // ou centenas de fornecedores. O validator apenas exige ao menos 1.
    .max(500, 'Limite maximo de 500 destinatarios por envio.'),
  subject: optionalTrimmedStringField,
  message: optionalTrimmedStringField,
  locale: z.string().trim().min(2).max(10).optional(),
  expiresInDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .default(14),
});

export type DispatchCreateInput = z.infer<typeof dispatchCreateSchema>;
