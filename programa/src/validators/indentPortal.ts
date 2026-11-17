import { z } from 'zod';
import {
  INDENT_MAX_RECIPIENTS,
  INDENT_MESSAGE_MAX,
  INDENT_PORT_MAX,
  INDENT_SEND_MAX_ATTACHMENTS,
} from '../constants/indentPortal';

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
