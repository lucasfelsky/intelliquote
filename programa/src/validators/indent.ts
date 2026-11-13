import { z } from 'zod';
import { isValidCnpj, normalizeCnpj } from '../utils/cnpj';

// Schemas do IQ Indent (cadastros). Mensagens em pt-BR; erro de campo vira 400 com a 1a mensagem.

const CAS_PATTERN = /^\d{2,7}-\d{2}-\d$/;

function requiredName(max: number, requiredMessage: string) {
  return z
    .string(requiredMessage)
    .trim()
    .min(1, requiredMessage)
    .max(max, `O texto deve ter no máximo ${max} caracteres.`);
}

// Texto opcional: vazio/null vira null; ausente continua ausente (update parcial).
function optionalText(max: number) {
  return z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
      }
      return value;
    },
    z.string().max(max, `O texto deve ter no máximo ${max} caracteres.`).nullable().optional(),
  );
}

const positiveId = z.number().int().positive();

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

const cnpjField = z
  .string('Informe o CNPJ.')
  .transform((value) => normalizeCnpj(value))
  .refine((value) => isValidCnpj(value), { message: 'CNPJ inválido.' });

const pipedriveOrgIdField = z.number().int().positive().nullable().optional();

export const indentClientCreateSchema = z.object({
  name: requiredName(200, 'Informe a razão social.'),
  cnpj: cnpjField,
  city: optionalText(120),
  ownerName: optionalText(120),
  pipedriveOrgId: pipedriveOrgIdField,
});

export const indentClientUpdateSchema = z.object({
  name: requiredName(200, 'Informe a razão social.').optional(),
  cnpj: cnpjField.optional(),
  city: optionalText(120),
  ownerName: optionalText(120),
  pipedriveOrgId: pipedriveOrgIdField,
  isActive: z.boolean().optional(),
});

export const INDENT_RULE_MODES = ['LIVRE', 'APROVADOS', 'BLOQUEIO'] as const;

export const indentClientRuleSchema = z
  .object({
    mode: z.enum(INDENT_RULE_MODES, 'Modo de restrição inválido.'),
    supplierIds: z
      .array(positiveId, 'Lista de fornecedores inválida.')
      .max(500, 'Selecione no máximo 500 fornecedores.')
      .default([])
      .transform((ids) => dedupe(ids)),
    reason: z.string().max(2000, 'O motivo deve ter no máximo 2000 caracteres.').nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'LIVRE') {
      return;
    }

    if (value.supplierIds.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['supplierIds'],
        message: 'Escolha ao menos um fornecedor na lista',
      });
    }

    if (!(value.reason ?? '').trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Informe o motivo da restrição.',
      });
    }
  });

export const indentProductIdsSchema = z
  .array(positiveId, 'Lista de produtos inválida.')
  .max(1000, 'Selecione no máximo 1000 produtos.')
  .transform((ids) => dedupe(ids));

export const indentSupplierProductsSchema = z.object({
  productIds: indentProductIdsSchema,
});

export const INDENT_SUPPLIER_TYPES = ['FABRICANTE', 'TRADING', 'IMPORTADO'] as const;
export const INDENT_CURRENCIES = ['USD', 'EUR'] as const;
export const INDENT_INCOTERMS = ['CFR', 'CIF', 'FOB'] as const;

const supplierTypeField = z.enum(INDENT_SUPPLIER_TYPES, 'Tipo de fornecedor inválido.');
const supplierCurrencyField = z.enum(INDENT_CURRENCIES, 'Moeda inválida.');
const supplierIncotermField = z.enum(INDENT_INCOTERMS, 'Incoterm inválido.');

export const indentSupplierCreateSchema = z.object({
  name: requiredName(200, 'Informe a razão social.'),
  country: optionalText(120),
  contactName: optionalText(200),
  type: supplierTypeField.default('TRADING'),
  defaultCurrency: supplierCurrencyField.default('USD'),
  defaultIncoterm: supplierIncotermField.default('CFR'),
  hasPartnership: z.boolean().optional(),
  productIds: indentProductIdsSchema.optional(),
});

export const indentSupplierUpdateSchema = z.object({
  name: requiredName(200, 'Informe a razão social.').optional(),
  country: optionalText(120),
  contactName: optionalText(200),
  type: supplierTypeField.optional(),
  defaultCurrency: supplierCurrencyField.optional(),
  defaultIncoterm: supplierIncotermField.optional(),
  hasPartnership: z.boolean().optional(),
  isActive: z.boolean().optional(),
  productIds: indentProductIdsSchema.optional(),
});

const synonymsField = z
  .array(z.string().trim().min(1, 'Sinônimo vazio.').max(200, 'Sinônimo muito longo.'))
  .max(30, 'Informe no máximo 30 sinônimos.');

const casField = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value;
  },
  z.string().regex(CAS_PATTERN, 'CAS inválido.').nullable().optional(),
);

export const indentProductCreateSchema = z.object({
  name: requiredName(200, 'Informe o nome do produto.'),
  acronym: optionalText(60),
  manufacturer: optionalText(200),
  cas: casField,
  unit: z
    .string()
    .trim()
    .min(1, 'Informe a unidade.')
    .max(16, 'A unidade deve ter no máximo 16 caracteres.')
    .default('kg'),
  synonyms: synonymsField.default([]),
  notes: optionalText(2000),
});

export const indentProductUpdateSchema = z.object({
  name: requiredName(200, 'Informe o nome do produto.').optional(),
  acronym: optionalText(60),
  manufacturer: optionalText(200),
  cas: casField,
  unit: z
    .string()
    .trim()
    .min(1, 'Informe a unidade.')
    .max(16, 'A unidade deve ter no máximo 16 caracteres.')
    .optional(),
  synonyms: synonymsField.optional(),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

function queryFlag(value: unknown): boolean {
  return value === '1' || value === 'true';
}

const pageField = z.coerce.number().int().min(1).default(1);
const pageSizeField = z.coerce.number().int().min(1).max(100).default(20);

export const indentListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  page: pageField,
  pageSize: pageSizeField,
  inativos: z.preprocess(queryFlag, z.boolean()).default(false),
});

export const indentProductListQuerySchema = indentListQuerySchema.extend({
  origin: z.enum(['CADASTRADO', 'LIVRE']).optional(),
});

export const indentImportQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  page: pageField,
});

export const indentImportSchema = z.object({
  ids: z
    .array(positiveId, 'Lista de registros inválida.')
    .min(1, 'Selecione ao menos um registro.')
    .max(100, 'Importe no máximo 100 registros por vez.')
    .transform((ids) => dedupe(ids)),
});

export type IndentClientCreateInput = z.infer<typeof indentClientCreateSchema>;
export type IndentClientUpdateInput = z.infer<typeof indentClientUpdateSchema>;
export type IndentClientRuleInput = z.infer<typeof indentClientRuleSchema>;
export type IndentSupplierCreateInput = z.infer<typeof indentSupplierCreateSchema>;
export type IndentSupplierUpdateInput = z.infer<typeof indentSupplierUpdateSchema>;
export type IndentProductCreateInput = z.infer<typeof indentProductCreateSchema>;
export type IndentProductUpdateInput = z.infer<typeof indentProductUpdateSchema>;
export type IndentListQuery = z.infer<typeof indentListQuerySchema>;
export type IndentProductListQuery = z.infer<typeof indentProductListQuerySchema>;
