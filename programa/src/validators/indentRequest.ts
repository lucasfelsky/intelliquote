import { z } from 'zod';

// Schemas das solicitacoes do IQ Indent (PR 2). Mensagens em pt-BR; erro de campo vira 400 com a 1a mensagem.

const positiveId = z.number().int().positive();

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

const QUANTITY_MESSAGE = 'Informe a quantidade em kg.';

// Quantidade em kg: > 0, ate 1e9 e ate 3 casas decimais (coluna Decimal(14,3)).
const quantityField = z
  .number(QUANTITY_MESSAGE)
  .positive(QUANTITY_MESSAGE)
  .max(1_000_000_000, 'A quantidade deve ser de no máximo 1.000.000.000 kg.')
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, {
    message: 'A quantidade aceita no máximo 3 casas decimais.',
  });

export const indentRequestItemSchema = z.object({
  productId: positiveId.optional(),
  description: z
    .string('Informe o produto.')
    .trim()
    .min(1, 'Informe o produto.')
    .max(300, 'O produto deve ter no máximo 300 caracteres.'),
  quantityKg: quantityField,
});

// `strictObject`: responsavel/autoria vem do usuario logado; qualquer campo extra (ex.: ownerName) e recusado.
export const indentRequestCreateSchema = z.strictObject(
  {
    clientId: z
      .number('Escolha o cliente.')
      .int('Escolha o cliente.')
      .positive('Escolha o cliente.'),
    items: z
      .array(indentRequestItemSchema, 'Inclua ao menos um item.')
      .min(1, 'Inclua ao menos um item.')
      .max(50, 'Informe no máximo 50 itens.'),
  },
  'Campo não permitido: o responsável é o seu usuário.',
);

export const INDENT_REQUEST_FILTERS = ['todas', 'pipedrive', 'iq', 'nova', 'pendente'] as const;

export const indentRequestListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100, 'A busca deve ter no máximo 100 caracteres.')
    .optional()
    .transform((value) => (value ? value : undefined)),
  filter: z.enum(INDENT_REQUEST_FILTERS, 'Filtro inválido.').default('todas'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const indentConfirmItemsSchema = z.object({
  itemIds: z
    .array(positiveId, 'Lista de itens inválida.')
    .min(1, 'Informe ao menos um item.')
    .max(50, 'Informe no máximo 50 itens.')
    .transform((ids) => dedupe(ids)),
});

export const indentGenerateQuotesSchema = z.object({
  suppliers: z
    .array(
      z.object({
        supplierId: positiveId,
        exceptionReason: z
          .string()
          .trim()
          .max(500, 'O motivo da exceção deve ter no máximo 500 caracteres.')
          .nullable()
          .optional(),
      }),
      'Lista de fornecedores inválida.',
    )
    .min(1, 'Escolha ao menos um fornecedor.')
    .max(50, 'Escolha no máximo 50 fornecedores.')
    .transform((list) => {
      // Dedup por supplierId: o 1o vence.
      const seen = new Set<number>();
      return list.filter((entry) => {
        if (seen.has(entry.supplierId)) {
          return false;
        }
        seen.add(entry.supplierId);
        return true;
      });
    }),
});

export type IndentRequestCreateInput = z.infer<typeof indentRequestCreateSchema>;
export type IndentRequestListQuery = z.infer<typeof indentRequestListQuerySchema>;
export type IndentConfirmItemsInput = z.infer<typeof indentConfirmItemsSchema>;
export type IndentGenerateQuotesInput = z.infer<typeof indentGenerateQuotesSchema>;
