import { z } from 'zod';
import {
  SUPPLIER_DOCUMENT_ALLOWED_MIME,
  SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH,
  SUPPLIER_DOCUMENT_TOO_LARGE_MESSAGE,
} from '../constants/supplierDocuments';
import { isValidDateKey } from '../utils/supplierDocumentDates';

const nameField = z
  .string({ error: 'Informe o nome do documento.' })
  .trim()
  .min(1, 'Informe o nome do documento.')
  .max(120, 'O nome do documento aceita no maximo 120 caracteres.');

const expiresOnField = z
  .string({ error: 'Informe a data de vencimento (AAAA-MM-DD).' })
  .refine((value) => isValidDateKey(value), 'Data de vencimento invalida (use AAAA-MM-DD).');

const notesField = z
  .string()
  .trim()
  .max(1000, 'A observacao aceita no maximo 1000 caracteres.')
  .nullable()
  .transform((value) => (value === '' ? null : value));

const fileNameField = z
  .string({ error: 'Informe o nome do arquivo.' })
  .trim()
  .min(1, 'Informe o nome do arquivo.')
  .max(200, 'O nome do arquivo aceita no maximo 200 caracteres.');

const mimeTypeField = z.enum(SUPPLIER_DOCUMENT_ALLOWED_MIME, {
  error: 'Tipo de arquivo nao permitido. Envie PDF, PNG ou JPEG.',
});

const contentBase64Field = z
  .string({ error: 'Envie o conteudo do arquivo.' })
  .min(1, 'O arquivo enviado esta vazio.')
  // Rejeita antes de decodificar o base64 (evita copias grandes em memoria).
  .max(SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH, SUPPLIER_DOCUMENT_TOO_LARGE_MESSAGE);

export const supplierDocumentCreateSchema = z.object({
  supplierId: z.coerce.number().int().positive('Fornecedor invalido.'),
  name: nameField,
  expiresOn: expiresOnField,
  notes: notesField.optional(),
  fileName: fileNameField,
  mimeType: mimeTypeField,
  contentBase64: contentBase64Field,
});

export const supplierDocumentUpdateSchema = z
  .object({
    name: nameField.optional(),
    expiresOn: expiresOnField.optional(),
    notes: notesField.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.expiresOn !== undefined || value.notes !== undefined,
    'Informe ao menos um campo para atualizar.',
  );

export const supplierDocumentReplaceFileSchema = z.object({
  fileName: fileNameField,
  mimeType: mimeTypeField,
  contentBase64: contentBase64Field,
  expiresOn: expiresOnField,
});

export const supplierDocumentListQuerySchema = z.object({
  supplierId: z.coerce
    .number({ error: 'Informe o fornecedor.' })
    .int()
    .positive('Fornecedor invalido.'),
});

export type SupplierDocumentCreateInput = z.infer<typeof supplierDocumentCreateSchema>;
export type SupplierDocumentUpdateInput = z.infer<typeof supplierDocumentUpdateSchema>;
export type SupplierDocumentReplaceFileInput = z.infer<typeof supplierDocumentReplaceFileSchema>;
