import { z } from 'zod';

import { Incoterm } from '@prisma/client';

import { ORIGIN_PORT_MAX_LENGTH } from '../utils/originPort';

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

// Porto de origem: ''/espacos/null viram null; max 120. undefined = ausente (portal antigo).
const originPortField = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || null : value),
  z.string().max(ORIGIN_PORT_MAX_LENGTH).nullable().optional(),
);

const optionalQuantityField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  nonNegativeIntegerField.optional(),
);

// Item marcado como "Temporarily unavailable" nao carrega preco/quantidade: o
// servidor ignora qualquer valor enviado e grava zeros. Item disponivel segue
// exigindo unitPrice, quantity e totalPrice (superRefine abaixo).
const supplierPortalResponseItemBaseSchema = z.object({
  quoteRequestItemId: positiveIntegerField,
  isUnavailable: z.boolean().optional().default(false),
  // Checkbox simples do portal: ausente/desmarcado = nao DG. Item indisponivel e sempre gravado como false.
  isDangerousGood: z.boolean().optional().default(false),
  unitPrice: optionalPositiveNumberField,
  quantity: optionalQuantityField,
  totalPrice: optionalPositiveNumberField,
  leadTimeDays: optionalNonNegativeIntegerField,
  notes: optionalTrimmedStringField,
  originPort: originPortField,
  incotermPrices: z
    .array(
      z.object({
        incoterm: z.nativeEnum(Incoterm),
        unitPrice: positiveNumberField.max(999999999999.99),
      }),
    )
    .min(1)
    .optional(),
});

export const supplierPortalResponseItemSchema = supplierPortalResponseItemBaseSchema.superRefine(
  (item, ctx) => {
    if (item.isUnavailable) return;
    const required = [
      ['unitPrice', item.unitPrice],
      ['quantity', item.quantity],
      ['totalPrice', item.totalPrice],
    ] as const;
    for (const [field, value] of required) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `Provide ${field} for every item that is not marked as unavailable.`,
        });
      }
    }
  },
);

export const supplierPortalResponseSubmitSchema = z.object({
  currency: optionalCurrencyCodeField,
  incoterm: z.nativeEnum(Incoterm),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  exchangeRate: optionalPositiveNumberField,
  // 0 e valido quando todos os itens estao marcados como indisponiveis.
  totalPrice: z.coerce.number().min(0),
  totalPriceCurrency: optionalCurrencyCodeField,
  validityDays: z.coerce.number().int().min(1).max(365),
  notes: optionalTrimmedStringField,
  originPort: originPortField,
  items: z.array(supplierPortalResponseItemSchema).min(1, 'Informe ao menos um item.'),
});

export type SupplierPortalResponseSubmitInput = z.infer<
  typeof supplierPortalResponseSubmitSchema
>;
export type SupplierPortalResponseItemInput = z.infer<
  typeof supplierPortalResponseItemSchema
>;
export type AvailablePortalItem = Omit<
  SupplierPortalResponseItemInput,
  'unitPrice' | 'quantity' | 'totalPrice' | 'isUnavailable'
> & { unitPrice: number; quantity: number; totalPrice: number; isUnavailable: false };

export function isAvailablePortalItem(
  item: SupplierPortalResponseItemInput,
): item is AvailablePortalItem {
  return (
    !item.isUnavailable &&
    item.unitPrice !== undefined &&
    item.quantity !== undefined &&
    item.totalPrice !== undefined
  );
}

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
  comexCcFirstOnly: z.boolean().optional().default(false),
});

// Preview reaproveita os limites do create (subject/message/locale/expiresInDays).
// recipientContactIds e opcional: lista vazia devolve `preview: null`.
export const dispatchPreviewSchema = dispatchCreateSchema
  .pick({ subject: true, message: true, locale: true, expiresInDays: true })
  .extend({
    recipientContactIds: z.array(positiveIntegerField).max(500).optional().default([]),
  });

export type DispatchCreateInput = z.infer<typeof dispatchCreateSchema>;

// Portal do parceiro de credito (PR2b): ''/null/espacos em notes = ausente; max 2000.
const creditPortalNotesField = z.preprocess(
  (value) =>
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
      ? undefined
      : value,
  z.string().trim().max(2000).optional(),
);

export const creditPortalSubmitSchema = z.object({
  // Sem coerce: null/'' nao viram 0.
  paymentTermsDays: z.number().int().min(0).max(720),
  validityDays: z.number().int().min(1).max(365),
  notes: creditPortalNotesField,
  items: z
    .array(
      z.object({
        quoteRequestItemId: positiveIntegerField,
        unitPrice: positiveNumberField.max(999999999999.99),
      }),
    )
    .min(1)
    .max(500),
});

export type CreditPortalSubmitInput = z.infer<typeof creditPortalSubmitSchema>;
