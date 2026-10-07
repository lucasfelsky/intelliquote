import { Incoterm, QuoteRequestStatus, SupplierStatus } from '@prisma/client';
import { z } from 'zod';
import { normalizeAcceptedIncoterms } from '../utils/incoterm';

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
// Fornecedor sem incoterm selecionado = aceita todos (normaliza para os 11).
const acceptedIncotermsCreateField = z.preprocess(
  (value) => (value === undefined || value === null ? [] : value),
  z.array(incotermField).transform(normalizeAcceptedIncoterms),
);
const acceptedIncotermsUpdateField = z
  .array(incotermField)
  .transform(normalizeAcceptedIncoterms)
  .optional();

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

// F12 (backlog 2026-07-12): etiquetas livres do fornecedor. Trim, descarta
// vazias, limita tamanho e dedup (case-insensitive) preservando a 1a grafia.
const tagsField = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .transform((tags) => {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const tag of tags) {
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
      }
      return result;
    })
    .optional(),
);

// F12: nota por dimensao (1..5).
const ratingField = z.coerce.number().int().min(1).max(5);

// Fornecedor <-> ItemFamily (m2m implicito): ids das familias vinculadas ao
// fornecedor. Opcional; quando ausente, o controller nao toca em `families`.
const familyIdsField = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  z.array(positiveIntegerField).optional(),
);

export const supplierCreateSchema = z.object({
  name: requiredTrimmedStringField,
  website: nullableTrimmedStringField.optional(),
  acceptedIncoterms: acceptedIncotermsCreateField,
  status: z.nativeEnum(SupplierStatus).optional(),
  country: nullableTrimmedStringField.optional(),
  notes: nullableTrimmedStringField.optional(),
  paymentTermsDays: nonNegativeIntegerField.optional(),
  tags: tagsField,
  familyIds: familyIdsField,
});

export const supplierUpdateSchema = z.object({
  name: optionalTrimmedStringField,
  website: nullableOptionalTrimmedStringField,
  acceptedIncoterms: acceptedIncotermsUpdateField,
  status: z.nativeEnum(SupplierStatus).optional(),
  country: nullableOptionalTrimmedStringField,
  notes: nullableOptionalTrimmedStringField,
  paymentTermsDays: nonNegativeIntegerField.optional(),
  tags: tagsField,
  familyIds: familyIdsField,
});

// Importação em massa de fornecedores via planilha (.xlsx). O parser puro
// (`src/utils/supplierImport.ts`) monta o candidato linha a linha e valida
// aqui antes de aceitar; a mensagem de erro do Zod vira 1 dos `reasons`.
export const supplierImportRowSchema = z.object({
  name: requiredTrimmedStringField,
  country: nullableTrimmedStringField,
  website: nullableTrimmedStringField,
  acceptedIncoterms: acceptedIncotermsCreateField,
  paymentTermsDays: nonNegativeIntegerField,
  familyIds: z.array(positiveIntegerField).default([]),
  tags: tagsField,
  notes: nullableTrimmedStringField,
  contacts: z
    .array(
      z.object({
        name: requiredTrimmedStringField,
        email: lowercasedEmailField,
        phone: nullableTrimmedStringField,
        position: nullableTrimmedStringField,
      }),
    )
    .max(20),
});

export const supplierImportPreviewSchema = z.object({
  contentBase64: z.string().min(1),
});

export const supplierImportConfirmSchema = z.object({
  rows: z
    .array(
      z.object({
        row: positiveIntegerField,
        data: supplierImportRowSchema,
      }),
    )
    .min(1)
    .max(500),
});

// F12: avaliacao opcional do fornecedor vencedor, capturada ao concluir a
// cotacao. O supplierId e' validado no controller (precisa ter respondido a
// cotacao). comment opcional.
export const supplierReviewInputSchema = z.object({
  supplierId: positiveIntegerField,
  priceRating: ratingField,
  leadTimeRating: ratingField,
  qualityRating: ratingField,
  comment: nullableTrimmedStringField.optional(),
});

export const quoteRequestCloseSchema = z.object({
  notifyLosers: z.boolean().optional(),
  review: supplierReviewInputSchema.optional(),
});

export const quoteRequestCreateSchema = z.object({
  requestCode: optionalUppercaseTrimmedStringField,
  productName: nullableTrimmedStringField.optional(),
  quantity: optionalPositiveIntegerField,
  description: nullableTrimmedStringField.optional(),
  desiredIncoterm: z.array(incotermField).min(1),
  destinationPort: nullableTrimmedStringField.optional(),
  originPort: nullableTrimmedStringField.optional(),
  currency: optionalCurrencyCodeField,
  deadlineAt: nullableDateField.optional(),
  status: z.nativeEnum(QuoteRequestStatus).optional(),
});

export const quoteRequestUpdateSchema = z.object({
  requestCode: optionalUppercaseTrimmedStringField,
  productName: nullableOptionalTrimmedStringField,
  quantity: optionalPositiveIntegerField,
  description: nullableOptionalTrimmedStringField,
  desiredIncoterm: z.array(incotermField).min(1).optional(),
  destinationPort: nullableOptionalTrimmedStringField,
  originPort: nullableOptionalTrimmedStringField,
  currency: optionalCurrencyCodeField,
  deadlineAt: nullableOptionalDateField,
});

export const quoteResponseCreateSchema = z.object({
  quoteRequestId: positiveIntegerField,
  supplierId: positiveIntegerField,
  offeredPrice: optionalPositiveNumberField,
  targetPrice: optionalPositiveNumberField,
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
  items: z
    .array(
      z.object({
        quoteRequestItemId: positiveIntegerField,
        unitPrice: positiveNumberField,
        quantity: positiveIntegerField,
        leadTimeDays: nullableOptionalNonNegativeIntegerField,
        notes: nullableOptionalTrimmedStringField,
      })
    )
    .optional(),
});

export const quoteResponseUpdateSchema = z.object({
  quoteRequestId: optionalPositiveIntegerField,
  supplierId: optionalPositiveIntegerField,
  offeredPrice: optionalPositiveNumberField,
  targetPrice: optionalPositiveNumberField,
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
  items: z
    .array(
      z.object({
        quoteRequestItemId: positiveIntegerField,
        unitPrice: positiveNumberField,
        quantity: positiveIntegerField,
        leadTimeDays: nullableOptionalNonNegativeIntegerField,
        notes: nullableOptionalTrimmedStringField,
      })
    )
    .optional(),
});

// Usado tanto pra preview quanto pro envio de verdade do botao "Responder"
// (POST /quote-responses/:id/reply[/preview]). `subject`/`message` sao
// editados na hora, na modal de resposta -- por isso opcionais (sem eles,
// usa-se o default calculado a partir do item/fornecedor).
export const quoteResponseReplySchema = z.object({
  subject: z.string().trim().max(300).optional(),
  message: z.string().trim().max(4000).optional(),
  targetPrice: z.number().positive().nullable().optional(),
  // Target price POR ITEM (modal "Responder" em cotacoes multi-item). O
  // caminho de 1 item continua usando so' `targetPrice` acima (zero
  // regressao); este campo so' e' usado quando `items.length > 1`.
  itemTargets: z
    .array(
      z.object({
        quoteResponseItemId: positiveIntegerField,
        targetPrice: z.number().positive().nullable(),
      })
    )
    .optional(),
});

// Usado pelo botao "Enviar Ordem de Compra" (POST
// /quote-responses/:id/purchase-order) na tela de Comparacao. Anexo = upload
// de PDF em base64 (so'-envio, sem storage durave -- espelha o padrao do
// attachmentCreateSchema). `forwarderInfo` e' o contato do despachante,
// digitado na hora no modal.
export const quotePurchaseOrderSchema = z.object({
  subject: z.string().trim().max(300).optional(),
  message: z.string().trim().max(4000).optional(),
  forwarderInfo: z.string().trim().max(2000).optional(),
  fileName: z.string().trim().min(1, 'Informe o nome do arquivo.'),
  contentBase64: z.string().min(1, 'Envie o conteudo do PDF em base64.'),
  fileType: z.literal(
    'application/pdf',
    'Apenas arquivos PDF sao aceitos para a Ordem de Compra.',
  ),
  fileSize: z.coerce.number().int().nonnegative(),
});

export const quoteComparisonWeightsSchema = z.object({
  priceWeight: optionalNonNegativeNumberField,
  paymentTermsWeight: optionalNonNegativeNumberField,
  incotermWeight: optionalNonNegativeNumberField,
  qualityWeight: optionalNonNegativeNumberField,
});

// A obrigatoriedade condicional de `reason` (exigido quando o vencedor manual
// difere do vencedor calculado) e' aplicada no controller, nao aqui.
export const quoteWinnerOverrideSchema = z.object({
  quoteResponseId: positiveIntegerField,
  reason: z.preprocess(
    (value) =>
      value === undefined ? undefined : value === null || value === '' ? null : value,
    z.string().trim().max(2000).nullable().optional(),
  ),
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

// Assinatura de e-mail do proprio usuario (Minha conta). Texto: ate 2000
// caracteres apos o trim; string vazia vira null (remove o texto).
export const ACCOUNT_SIGNATURE_TEXT_MAX_LENGTH = 2000;
export const accountSignatureTextSchema = z.object({
  text: z
    .string('Informe o texto da assinatura (ou null para remover).')
    .trim()
    .max(
      ACCOUNT_SIGNATURE_TEXT_MAX_LENGTH,
      `O texto da assinatura deve ter no maximo ${ACCOUNT_SIGNATURE_TEXT_MAX_LENGTH} caracteres.`,
    )
    .nullable()
    .transform((value) => (value ? value : null)),
});

// Imagem da assinatura: so' PNG/JPEG. O tipo declarado precisa bater com o
// detectado pelo conteudo (validado no controller via detectImage).
export const accountSignatureImageSchema = z.object({
  fileName: z.string().trim().min(1, 'Informe o nome do arquivo.').max(255),
  contentBase64: z.string().min(1, 'Envie o conteudo da imagem em base64.'),
  fileType: z.enum(['image/png', 'image/jpeg'], 'Apenas imagens PNG ou JPEG sao aceitas.'),
  fileSize: z.coerce.number().int().nonnegative(),
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

export const portalTokenRegenerateSchema = z.object({
  expiresInDays: z.number().int().min(1).max(60).optional(),
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

const purchaseOrderLabelField = z
  .string({ error: 'Informe o rotulo da PO.' })
  .trim()
  .min(1, 'Informe o rotulo da PO.')
  .max(60, 'O rotulo da PO deve ter no maximo 60 caracteres.');

export const purchaseOrderCreateSchema = z
  .object({
    label: purchaseOrderLabelField.optional(),
    adoptUnassigned: z.boolean().optional().default(false),
    group: z.boolean().optional().default(false),
  })
  .refine((v) => !v.group || (v.label === undefined && !v.adoptUnassigned), {
    message: 'Agrupar por PO nao aceita rotulo nem adoptUnassigned.',
  });

export const purchaseOrderRenameSchema = z.object({
  label: purchaseOrderLabelField,
});

export const purchaseOrderReorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()),
});

export const itemMovePurchaseOrderSchema = z.object({
  purchaseOrderId: z.number().int().positive().nullable(),
});

export const itemCreatePurchaseOrderIdSchema = z.number().int().positive();
