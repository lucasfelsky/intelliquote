import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { addDaysToKey, isValidDateKey } from '../utils/supplierDocumentDates';
import { parsePricePerKg } from '../utils/indentQuote';
import { INDENT_CURRENCIES } from './indent';
import { indentRequestItemSchema } from './indentRequest';

// Schemas das cotacoes do IQ Indent (PR 3). Mensagens em pt-BR; erro de campo vira 400 com a 1a mensagem e o `path` (erro inline na tela).
// Corpo sempre estrito: status, total, revisao e baseQuoteId nunca vem do cliente.

export const INDENT_QUOTE_STATUSES = ['RASCUNHO', 'ENVIADA', 'RESPONDIDA', 'ACEITA', 'RECUSADA', 'REVISADA'] as const;

const FORBIDDEN_FIELD = 'Campo não permitido.';
const PRICE_MESSAGE = 'Preço inválido: use até 4 casas decimais.';

const statusList = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    const parts = Array.isArray(value) ? value : [value];
    return parts.flatMap((part) => (typeof part === 'string' ? part.split(',') : [part])).map((part) => (typeof part === 'string' ? part.trim() : part));
  },
  z.array(z.enum(INDENT_QUOTE_STATUSES, 'Status inválido.')).max(6, 'Status inválido.').optional(),
);

// A UI do PR 3 nao usa `status` nem `q`; ficam prontos para o filtro do PR 6.
export const indentQuoteListQuerySchema = z.strictObject(
  {
    status: statusList,
    q: z
      .string()
      .trim()
      .max(100, 'A busca deve ter no máximo 100 caracteres.')
      .optional()
      .transform((value) => (value ? value : undefined)),
  },
  'Parâmetro não permitido.',
);

const dateKey = (message: string) =>
  z.string(message).refine((value) => isValidDateKey(value), { message });

export const indentQuoteMarkSentSchema = z.strictObject(
  { sentOn: dateKey('Informe a data do envio.') },
  FORBIDDEN_FIELD,
);

const priceField = z
  .string('Informe FOB e CFR de todos os itens.')
  .refine((value) => parsePricePerKg(value) !== null, { message: PRICE_MESSAGE });

const responseItemSchema = z.strictObject(
  {
    quoteItemId: z.number('Item inválido.').int('Item inválido.').positive('Item inválido.'),
    packaging: z
      .string('Informe a embalagem de todos os itens.')
      .trim()
      .min(1, 'Informe a embalagem de todos os itens.')
      .max(100, 'A embalagem deve ter no máximo 100 caracteres.'),
    fobPricePerKg: priceField,
    cfrPricePerKg: priceField,
  },
  FORBIDDEN_FIELD,
);

export const indentQuoteResponseSchema = z
  .strictObject(
    {
      respondedOn: dateKey('Informe a data da resposta.'),
      currency: z.enum(INDENT_CURRENCIES, 'Moeda inválida.'),
      validUntil: dateKey('Informe a validade da cotação.'),
      productionLeadTimeDays: z
        .number('Informe o prazo de produção em dias.')
        .int('Informe o prazo de produção em dias.')
        .min(1, 'O prazo de produção deve ser de 1 a 365 dias.')
        .max(365, 'O prazo de produção deve ser de 1 a 365 dias.'),
      paymentTerms: z
        .string('Informe a condição de pagamento.')
        .trim()
        .min(1, 'Informe a condição de pagamento.')
        .max(200, 'A condição de pagamento deve ter no máximo 200 caracteres.'),
      manufacturer: z
        .string()
        .trim()
        .max(200, 'O fabricante deve ter no máximo 200 caracteres.')
        .nullable()
        .optional()
        .transform((value) => (value ? value : null)),
      notes: z
        .string()
        .trim()
        .max(2000, 'A observação deve ter no máximo 2000 caracteres.')
        .nullable()
        .optional()
        .transform((value) => (value ? value : null)),
      destination: z
        .string()
        .trim()
        .max(80, 'O porto de destino deve ter no máximo 80 caracteres.')
        .nullable()
        .optional()
        .transform((value) => (value ? value : null)),
      items: z
        .array(responseItemSchema, 'Informe os preços de todos os itens.')
        .min(1, 'Informe os preços de todos os itens.')
        .max(200, 'Itens demais.'),
    },
    FORBIDDEN_FIELD,
  )
  .superRefine((value, ctx) => {
    if (value.validUntil < value.respondedOn) {
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'A validade não pode ser anterior à data da resposta.' });
    } else if (value.validUntil > addDaysToKey(value.respondedOn, 365)) {
      ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'A validade pode ir até 365 dias depois da data da resposta.' });
    }

    const seen = new Set<number>();
    value.items.forEach((item, index) => {
      if (seen.has(item.quoteItemId)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'quoteItemId'], message: 'Item repetido.' });
      }
      seen.add(item.quoteItemId);

      const fob = parsePricePerKg(item.fobPricePerKg);
      const cfr = parsePricePerKg(item.cfrPricePerKg);
      if (fob && cfr && new Prisma.Decimal(cfr).lessThan(fob)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'cfrPricePerKg'], message: 'CFR não pode ser menor que FOB.' });
      }
    });
  });

// Item livre no rascunho: descricao e quantidade com as mesmas regras do item da solicitacao (PR 2).
export const indentQuoteFreeItemSchema = z.strictObject(
  {
    description: indentRequestItemSchema.shape.description,
    quantityKg: indentRequestItemSchema.shape.quantityKg,
  },
  FORBIDDEN_FIELD,
);

// Aceitar, recusar e pedir revisao nao recebem corpo.
export const indentQuoteEmptyBodySchema = z.strictObject({}, FORBIDDEN_FIELD);

export type IndentQuoteListQuery = z.infer<typeof indentQuoteListQuerySchema>;
export type IndentQuoteMarkSentInput = z.infer<typeof indentQuoteMarkSentSchema>;
export type IndentQuoteResponseInput = z.infer<typeof indentQuoteResponseSchema>;
export type IndentQuoteFreeItemInput = z.infer<typeof indentQuoteFreeItemSchema>;
