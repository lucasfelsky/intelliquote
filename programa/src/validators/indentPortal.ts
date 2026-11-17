import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  INDENT_MAX_RECIPIENTS,
  INDENT_MESSAGE_MAX,
  INDENT_PORTAL_CURRENCIES,
  INDENT_PORTAL_PACKAGING_OPTIONS,
  INDENT_PORTAL_PAYMENT_OPTIONS,
  INDENT_PORT_MAX,
  INDENT_SEND_MAX_ATTACHMENTS,
} from '../constants/indentPortal';
import { parsePricePerKg } from '../utils/indentQuote';
import { isValidDateKey } from '../utils/supplierDocumentDates';

// Schemas do envio da cotacao do IQ Indent ao fornecedor (PR 4). Mensagens em pt-BR; erro de campo vira 400 com `message` e `path`.
// Corpo sempre estrito: status, token, remetente e Reply-To nunca vem do cliente.

const FORBIDDEN_FIELD = 'Campo não permitido.';
const MAX_RECIPIENTS_MESSAGE = `Escolha no máximo ${INDENT_MAX_RECIPIENTS} destinatários.`;
const emailSchema = z.string().trim().email();

const recipientsField = z
  .array(z.string().max(254), 'Escolha ou digite ao menos um e-mail.')
  .max(20, MAX_RECIPIENTS_MESSAGE)
  .transform((values, ctx) => {
    const seen = new Set<string>();
    const emails: string[] = [];

    for (const value of values) {
      const email = value.trim().toLowerCase();

      if (!email) {
        continue;
      }
      if (!emailSchema.safeParse(email).success) {
        ctx.addIssue({ code: 'custom', path: [], message: 'E-mail inválido.' });
        return z.NEVER;
      }
      if (!seen.has(email)) {
        seen.add(email);
        emails.push(email);
      }
    }

    if (emails.length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Escolha ou digite ao menos um e-mail.' });
      return z.NEVER;
    }
    if (emails.length > INDENT_MAX_RECIPIENTS) {
      ctx.addIssue({ code: 'custom', path: [], message: MAX_RECIPIENTS_MESSAGE });
      return z.NEVER;
    }

    return emails;
  });

// Mensagem livre: remove caracteres de controle (exceto quebra de linha), trim; vazia vira null.
const messageField = z
  .string()
  .max(INDENT_MESSAGE_MAX, `A mensagem deve ter no máximo ${INDENT_MESSAGE_MAX} caracteres.`)
  .nullable()
  .optional()
  .transform((value) => {
    // eslint-disable-next-line no-control-regex
    const cleaned = (value ?? '').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').trim();
    return cleaned === '' ? null : cleaned;
  });

const destinationPortField = z
  .string('Informe o porto de destino.')
  .trim()
  .min(1, 'Informe o porto de destino.')
  .max(INDENT_PORT_MAX, `O porto deve ter no máximo ${INDENT_PORT_MAX} caracteres.`)
  // eslint-disable-next-line no-control-regex
  .transform((value) => value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim());

export const indentSendSchema = z.strictObject(
  {
    recipients: recipientsField,
    saveToSupplier: z.boolean().default(false),
    message: messageField,
    showClientName: z.boolean().default(false),
    destinationPort: destinationPortField,
    attachments: z
      .array(
        z.strictObject(
          {
            fileName: z.string('Informe o nome do arquivo.').trim().min(1, 'Informe o nome do arquivo.').max(120, 'O nome do arquivo deve ter no máximo 120 caracteres.'),
            contentBase64: z.string('Arquivo inválido.').min(1, 'Arquivo inválido.'),
          },
          FORBIDDEN_FIELD,
        ),
      )
      .max(INDENT_SEND_MAX_ATTACHMENTS, `Envie no máximo ${INDENT_SEND_MAX_ATTACHMENTS} anexos.`)
      .optional(),
    attachmentsConfirmed: z.boolean().optional(),
  },
  FORBIDDEN_FIELD,
);

export const indentResendSchema = z.strictObject({}, FORBIDDEN_FIELD);

export type IndentSendInput = z.output<typeof indentSendSchema>;

// ---- Resposta do fornecedor pelo portal publico (4a-2). Mensagens em INGLES (chegam ao fornecedor); erro de campo vira 400 { message, path }. ----
// Corpo sempre estrito: status, versao, token, ator e cliente nunca vem do fornecedor.
const PORTAL_FORBIDDEN_FIELD = 'Field not allowed.';
const PRICE_PATTERN = /^\d{1,5}(\.\d{1,4})?$/;

// Texto livre do fornecedor: sem caracteres de controle (a quebra de linha so e mantida onde faz sentido), trim; vazio vira null.
const stripControls = (value: string, keepNewline: boolean) =>
  // eslint-disable-next-line no-control-regex
  value.replace(keepNewline ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g, keepNewline ? '' : ' ').trim();

const portalPriceField = z
  .string('Enter the FOB and CFR price for every item.')
  .refine((value) => PRICE_PATTERN.test(value), { message: 'Use up to 4 decimal places.' })
  .refine((value) => !PRICE_PATTERN.test(value) || parsePricePerKg(value) !== null, { message: 'The price must be greater than zero.' });

const portalItemSchema = z.strictObject(
  {
    quoteItemId: z.number('Invalid item.').int('Invalid item.').positive('Invalid item.'),
    packaging: z.enum(INDENT_PORTAL_PACKAGING_OPTIONS, 'Choose the packaging for every item.'),
    fobPricePerKg: portalPriceField,
    cfrPricePerKg: portalPriceField,
  },
  PORTAL_FORBIDDEN_FIELD,
);

export const indentPortalRespondSchema = z
  .strictObject(
    {
      currency: z.enum(INDENT_PORTAL_CURRENCIES, 'Choose the currency.'),
      productionLeadTimeDays: z
        .number('Production lead time must be 1 to 365 days.')
        .int('Production lead time must be 1 to 365 days.')
        .min(1, 'Production lead time must be 1 to 365 days.')
        .max(365, 'Production lead time must be 1 to 365 days.'),
      paymentTerms: z.enum(INDENT_PORTAL_PAYMENT_OPTIONS, 'Choose the payment terms.'),
      validUntil: z.string('Enter the validity date.').refine((value) => isValidDateKey(value), { message: 'Enter the validity date.' }),
      manufacturer: z
        .string()
        .max(200, 'The manufacturer must have at most 200 characters.')
        .nullable()
        .optional()
        .transform((value) => stripControls(value ?? '', false) || null),
      notes: z
        .string()
        .max(2000, 'The notes must have at most 2000 characters.')
        .nullable()
        .optional()
        .transform((value) => stripControls(value ?? '', true) || null),
      items: z
        .array(portalItemSchema, 'Please fill in every item.')
        .min(1, 'Please fill in every item.')
        .max(200, 'Too many items.'),
    },
    PORTAL_FORBIDDEN_FIELD,
  )
  .superRefine((value, ctx) => {
    const seen = new Set<number>();

    value.items.forEach((item, index) => {
      if (seen.has(item.quoteItemId)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'quoteItemId'], message: 'Duplicated item.' });
      }
      seen.add(item.quoteItemId);

      const fob = parsePricePerKg(item.fobPricePerKg);
      const cfr = parsePricePerKg(item.cfrPricePerKg);

      if (fob && cfr && new Prisma.Decimal(cfr).lessThan(fob)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'cfrPricePerKg'], message: 'CFR cannot be lower than FOB.' });
      }
    });
  });

export type IndentPortalRespondInput = z.output<typeof indentPortalRespondSchema>;
