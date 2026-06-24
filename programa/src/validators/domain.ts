import { Incoterm, QuoteRequestStatus, SupplierStatus } from '@prisma/client';
import { z } from 'zod';

const requiredTrimmedStringField = z.string().trim().min(1);
const uppercaseTrimmedStringField = requiredTrimmedStringField.transform((value) =>
  value.toUpperCase(),
);
const lowercasedEmailField = z.string().trim().email().transform((value) =>
  value.toLowerCase(),
);

const optionalTrimmedStringField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  requiredTrimmedStringField.optional(),
);
const optionalUppercaseTrimmedStringField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  uppercaseTrimmedStringField.optional(),
);
const nullableTrimmedStringField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? null : value,
  requiredTrimmedStringField.nullable(),
);
const nullableOptionalTrimmedStringField = z.preprocess(
  (value) =>
    value === undefined ? undefined : value === null || value === '' ? null : value,
  requiredTrimmedStringField.nullable().optional(),
);
const optionalEmailField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  lowercasedEmailField.optional(),
);

const currencyCodeField = uppercaseTrimmedStringField.refine(
  (value) => /^[A-Z]{3}$/.test(value),
  {
    message: 'Informe um codigo de moeda valido.',
  },
);
const optionalCurrencyCodeField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  currencyCodeField.optional(),
);

const positiveNumberField = z.coerce.number().positive();
const positiveIntegerField = z.coerce.number().int().positive();
const nonNegativeNumberField = z.coerce.number().min(0);
const nonNegativeIntegerField = z.coerce.number().int().min(0);

const optionalPositiveNumberField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  positiveNumberField.optional(),
);
const optionalPositiveIntegerField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  positiveIntegerField.optional(),
);
const optionalNonNegativeNumberField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  nonNegativeNumberField.optional(),
);
const nullableNonNegativeIntegerField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? null : value,
  nonNegativeIntegerField.nullable(),
);
const nullableOptionalNonNegativeIntegerField = z.preprocess(
  (value) =>
    value === undefined ? undefined : value === null || value === '' ? null : value,
  nonNegativeIntegerField.nullable().optional(),
);

const incotermField = z.nativeEnum(Incoterm);
const optionalIncotermField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  incotermField.optional(),
);

const nullableDateField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? null : value,
  z.coerce.date().nullable(),
);
const nullableOptionalDateField = z.preprocess(
  (value) =>
    value === undefined ? undefined : value === null || value === '' ? null : value,
  z.coerce.date().nullable().optional(),
);
const optionalDateField = z.preprocess(
  (value) =>
    value === undefined || value === null || value === '' ? undefined : value,
  z.coerce.date().optional(),
);

export const supplierCreateSchema = z.object({
  name: requiredTrimmedStringField,
  website: nullableTrimmedStringField.optional(),
  acceptedIncoterms: z.array(incotermField).min(1),
  status: z.nativeEnum(SupplierStatus).optional(),
  country: nullableTrimmedStringField.optional(),
  notes: nullableTrimmedStringField.optional(),
  paymentTermsDays: nonNegativeIntegerField.optional(),
});

export const supplierUpdateSchema = z.object({
  name: optionalTrimmedStringField,
  website: nullableOptionalTrimmedStringField,
  acceptedIncoterms: z.array(incotermField).min(1).optional(),
  status: z.nativeEnum(SupplierStatus).optional(),
  country: nullableOptionalTrimmedStringField,
  notes: nullableOptionalTrimmedStringField,
  paymentTermsDays: nonNegativeIntegerField.optional(),
});

export const quoteRequestCreateSchema = z.object({
  requestCode: optionalUppercaseTrimmedStringField,
  productName: nullableTrimmedStringField.optional(),
  quantity: optionalPositiveIntegerField,
  description: nullableTrimmedStringField.optional(),
  desiredIncoterm: incotermField,
  destinationPort: nullableTrimmedStringField.optional(),
  currency: optionalCurrencyCodeField,
  deadlineAt: nullableDateField.optional(),
  status: z.nativeEnum(QuoteRequestStatus).optional(),
});

export const quoteRequestUpdateSchema = z.object({
  requestCode: optionalUppercaseTrimmedStringField,
  productName: nullableOptionalTrimmedStringField,
  quantity: optionalPositiveIntegerField,
  description: nullableOptionalTrimmedStringField,
  desiredIncoterm: incotermField.optional(),
  destinationPort: nullableOptionalTrimmedStringField,
  currency: optionalCurrencyCodeField,
  deadlineAt: nullableOptionalDateField,
});

export const quoteResponseCreateSchema = z.object({
  quoteRequestId: positiveIntegerField,
  supplierId: positiveIntegerField,
  offeredPrice: positiveNumberField,
  currency: optionalCurrencyCodeField,
  exchangeRate: optionalPositiveNumberField,
  freightCost: optionalNonNegativeNumberField,
  insuranceCost: optionalNonNegativeNumberField,
  otherFees: optionalNonNegativeNumberField,
  importDuty: optionalNonNegativeNumberField,
  ipi: optionalNonNegativeNumberField,
  pis: optionalNonNegativeNumberField,
  cofins: optionalNonNegativeNumberField,
  offeredIncoterm: incotermField,
  paymentTermsDays: nonNegativeIntegerField,
  leadTimeDays: nullableNonNegativeIntegerField.optional(),
  notes: nullableTrimmedStringField.optional(),
  submittedAt: optionalDateField,
});

export const quoteResponseUpdateSchema = z.object({
  quoteRequestId: optionalPositiveIntegerField,
  supplierId: optionalPositiveIntegerField,
  offeredPrice: optionalPositiveNumberField,
  currency: optionalCurrencyCodeField,
  exchangeRate: optionalPositiveNumberField,
  freightCost: optionalNonNegativeNumberField,
  insuranceCost: optionalNonNegativeNumberField,
  otherFees: optionalNonNegativeNumberField,
  importDuty: optionalNonNegativeNumberField,
  ipi: optionalNonNegativeNumberField,
  pis: optionalNonNegativeNumberField,
  cofins: optionalNonNegativeNumberField,
  offeredIncoterm: incotermField.optional(),
  paymentTermsDays: z.preprocess(
    (value) =>
      value === undefined || value === null || value === '' ? undefined : value,
    nonNegativeIntegerField.optional(),
  ),
  leadTimeDays: nullableOptionalNonNegativeIntegerField,
  notes: nullableOptionalTrimmedStringField,
  submittedAt: optionalDateField,
});

export const quoteComparisonWeightsSchema = z.object({
  priceWeight: optionalPositiveNumberField,
  paymentTermsWeight: optionalPositiveNumberField,
  incotermWeight: optionalPositiveNumberField,
});

export const userCreateSchema = z.object({
  name: requiredTrimmedStringField,
  email: lowercasedEmailField,
  password: z.string().min(8, 'A palavra-passe deve ter pelo menos 8 caracteres.'),
  role: z.enum(['admin', 'comprador', 'gestor', 'viewer']),
});

export const userUpdateSchema = z.object({
  name: optionalTrimmedStringField,
  email: optionalEmailField,
  role: z.enum(['admin', 'comprador', 'gestor', 'viewer']).optional(),
  isActive: z.boolean().optional(),
});

export const userPasswordResetSchema = z.object({
  password: z.string().min(8, 'A palavra-passe deve ter pelo menos 8 caracteres.'),
});

export const passwordRecoveryRequestSchema = z.object({
  email: z.string().trim().email('Informe um e-mail valido.'),
});

export const passwordRecoveryResetSchema = z.object({
  token: z.string().trim().min(20, 'Token invalido.'),
  password: z.string().min(8, 'A palavra-passe deve ter pelo menos 8 caracteres.'),
});

const attachmentEntityTypeSchema = z.enum([
  'supplier',
  'quote_request',
  'quote_response',
  'quote_request_item',
]);

export const attachmentCreateSchema = z.object({
  fileName: z.string().trim().min(1, 'Informe o nome do arquivo.'),
  contentBase64: z.string().min(1, 'Envie o conteudo do arquivo em base64.'),
  fileType: z.string().trim().min(1, 'Informe o tipo do arquivo.'),
  fileSize: z.coerce.number().int().nonnegative(),
  entityType: attachmentEntityTypeSchema,
  entityId: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

export const attachmentListQuerySchema = z.object({
  entityType: attachmentEntityTypeSchema.optional(),
  entityId: z.string().trim().min(1).optional(),
});

export const supplierContactCreateSchema = z.object({
  supplierId: positiveIntegerField.optional(),
  name: requiredTrimmedStringField,
  email: lowercasedEmailField,
  phone: nullableTrimmedStringField.optional(),
  position: nullableTrimmedStringField.optional(),
  role: nullableTrimmedStringField.optional(),
  isPrimary: z.boolean().optional(),
});

export const supplierContactUpdateSchema = z.object({
  name: optionalTrimmedStringField,
  email: optionalEmailField,
  phone: nullableOptionalTrimmedStringField,
  position: nullableOptionalTrimmedStringField,
  isPrimary: z.boolean().optional(),
});

export const reportQuerySchema = z.object({
  from: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  to: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
});

export const helpArticleListQuerySchema = z.object({
  category: z
    .enum([
      'general',
      'fornecedor',
      'cotacao',
      'proposta',
      'comparacao',
      'auditoria',
      'usuarios',
      'anexos',
      'relatorios',
      'onboarding',
      'portal',
      'empresa',
    ])
    .optional(),
  search: z.string().trim().min(2).max(80).optional(),
});

export {
  supplierPortalResponseItemSchema,
  supplierPortalResponseSubmitSchema,
  dispatchCreateSchema,
  dispatchRecipientSelectionSchema,
} from './supplierPortal';
export type {
  SupplierPortalResponseSubmitInput,
  SupplierPortalResponseItemInput,
  DispatchCreateInput,
} from './supplierPortal';
