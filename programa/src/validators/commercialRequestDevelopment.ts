import { z } from 'zod';
import {
  CR_ATTACHMENT_ALLOWED_MIME,
  CR_ATTACHMENT_BASE64_MAX_LENGTH,
  CR_ATTACHMENT_EMPTY_FILE_MESSAGE,
  CR_ATTACHMENT_FILE_NAME_MAX_LENGTH,
  CR_ATTACHMENT_INVALID_TYPE_MESSAGE,
  CR_ATTACHMENT_KINDS,
  CR_ATTACHMENT_TOO_LARGE_MESSAGE,
} from '../constants/commercialRequestAttachments';

// Solicitacao de desenvolvimento (item novo sem catalogo) e anexos tecnicos.

const MAX_DB_INT = 2147483647;

/** Vinculo do item novo ao catalogo, feito pela Comex. */
export const commercialRequestLinkCatalogSchema = z.object({
  catalogItemId: z
    .number({ error: 'Item de catalogo invalido.' })
    .int('Item de catalogo invalido.')
    .positive('Item de catalogo invalido.')
    .max(MAX_DB_INT, 'Item de catalogo invalido.'),
});

export type CommercialRequestLinkCatalogInput = z.infer<typeof commercialRequestLinkCatalogSchema>;

/** Upload de anexo tecnico (TDS/MSDS/Outro): arquivo em base64 no JSON. */
export const commercialRequestAttachmentUploadSchema = z
  .object({
    kind: z.enum(CR_ATTACHMENT_KINDS, { error: 'Tipo de anexo invalido. Use TDS, MSDS ou Outro.' }),
    fileName: z
      .string({ error: 'Informe o nome do arquivo.' })
      .trim()
      .min(1, 'Informe o nome do arquivo.')
      .max(CR_ATTACHMENT_FILE_NAME_MAX_LENGTH, 'O nome do arquivo aceita no maximo 200 caracteres.'),
    mimeType: z.enum(CR_ATTACHMENT_ALLOWED_MIME, { error: CR_ATTACHMENT_INVALID_TYPE_MESSAGE }),
    contentBase64: z
      .string({ error: 'Envie o conteudo do arquivo.' })
      .min(1, CR_ATTACHMENT_EMPTY_FILE_MESSAGE)
      // Rejeita antes de decodificar o base64 (evita copias grandes em memoria).
      .max(CR_ATTACHMENT_BASE64_MAX_LENGTH, CR_ATTACHMENT_TOO_LARGE_MESSAGE),
  })
  .strict();

export type CommercialRequestAttachmentUploadInput = z.infer<
  typeof commercialRequestAttachmentUploadSchema
>;
