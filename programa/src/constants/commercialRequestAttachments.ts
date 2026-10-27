import { SUPPLIER_DOCUMENT_ALLOWED_MIME } from './supplierDocuments';

// Anexos tecnicos (TDS/MSDS) da solicitacao de desenvolvimento do comercial.
// POST /api/v1/commercial-requests/:id/attachments (arquivo em base64 no JSON, bytea no Postgres).
export const CR_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CR_ATTACHMENT_MAX_PER_REQUEST = 5;

export const CR_ATTACHMENT_KINDS = ['TDS', 'MSDS', 'OUTRO'] as const;
export type CommercialRequestAttachmentKind = (typeof CR_ATTACHMENT_KINDS)[number];

export const CR_ATTACHMENT_ALLOWED_MIME = SUPPLIER_DOCUMENT_ALLOWED_MIME;

// Tamanho maximo da string base64 aceita pelo validator (400 antes de decodificar).
export const CR_ATTACHMENT_BASE64_MAX_LENGTH =
  Math.ceil(CR_ATTACHMENT_MAX_FILE_BYTES / 3) * 4 + 1024;

// Corpo JSON: base64 + folga para os demais campos. Cloud Run aceita ate 32 MB.
export const CR_ATTACHMENT_JSON_BODY_LIMIT_BYTES =
  Math.ceil(CR_ATTACHMENT_MAX_FILE_BYTES / 3) * 4 + 256 * 1024;

export const CR_ATTACHMENT_FILE_NAME_MAX_LENGTH = 200;

export const CR_ATTACHMENT_TOO_LARGE_MESSAGE = 'O arquivo excede o limite de 10MB por anexo.';
export const CR_ATTACHMENT_INVALID_TYPE_MESSAGE =
  'Tipo de arquivo nao permitido. Envie PDF, PNG ou JPEG.';
export const CR_ATTACHMENT_TYPE_MISMATCH_MESSAGE =
  'O conteudo do arquivo nao corresponde ao tipo informado.';
export const CR_ATTACHMENT_EXTENSION_MISMATCH_MESSAGE =
  'A extensao do nome do arquivo nao corresponde ao tipo do conteudo.';
export const CR_ATTACHMENT_EMPTY_FILE_MESSAGE = 'O arquivo enviado esta vazio.';
export const CR_ATTACHMENT_INVALID_BASE64_MESSAGE = 'O conteudo do arquivo (base64) e invalido.';
export const CR_ATTACHMENT_LIMIT_MESSAGE =
  'Esta solicitacao ja tem o maximo de 5 anexos.';
export const CR_ATTACHMENT_DUPLICATE_MESSAGE = 'Este arquivo ja foi anexado.';
export const CR_ATTACHMENT_ONLY_DEVELOPMENT_MESSAGE =
  'Anexos tecnicos so valem para solicitacao de desenvolvimento (com item novo).';
export const CR_ATTACHMENT_ONLY_PENDING_MESSAGE =
  'Anexos so podem ser alterados enquanto a solicitacao estiver pendente.';
export const CR_ATTACHMENT_NOT_FOUND_MESSAGE = 'Solicitacao nao encontrada.';
export const CR_ATTACHMENT_FILE_NOT_FOUND_MESSAGE = 'Anexo nao encontrado.';
