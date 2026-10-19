// Limites e mensagens dos documentos do fornecedor (POST/PUT /api/v1/supplier-documents).
export const SUPPLIER_DOCUMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;

// O arquivo viaja em base64 dentro do JSON: o corpo cresce 4/3 em relacao ao binario, mais
// folga para prefixo data-URL e demais campos (mesma formula de constants/attachments.ts).
// Cloud Run aceita requisicoes de ate 32 MB, entao este teto fica abaixo.
export const SUPPLIER_DOCUMENT_JSON_BODY_LIMIT_BYTES =
  Math.ceil(SUPPLIER_DOCUMENT_MAX_FILE_BYTES / 3) * 4 + 256 * 1024;

export const SUPPLIER_DOCUMENT_ALLOWED_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

export type SupplierDocumentMime = (typeof SUPPLIER_DOCUMENT_ALLOWED_MIME)[number];

// Janela (em dias) em que o documento passa a ser considerado "a vencer".
export const SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS = 30;

export const SUPPLIER_DOCUMENT_TOO_LARGE_MESSAGE =
  'O arquivo excede o limite de 10MB por documento.';
export const SUPPLIER_DOCUMENT_INVALID_TYPE_MESSAGE =
  'Tipo de arquivo nao permitido. Envie PDF, PNG ou JPEG.';
export const SUPPLIER_DOCUMENT_TYPE_MISMATCH_MESSAGE =
  'O conteudo do arquivo nao corresponde ao tipo informado.';
export const SUPPLIER_DOCUMENT_EMPTY_FILE_MESSAGE = 'O arquivo enviado esta vazio.';
export const SUPPLIER_DOCUMENT_INVALID_BASE64_MESSAGE =
  'O conteudo do arquivo (base64) e invalido.';

// Tamanho maximo da string base64 aceita pelo validator (rejeita com 400 antes de decodificar):
// base64 do limite binario + folga para prefixo data-URL.
export const SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH =
  Math.ceil(SUPPLIER_DOCUMENT_MAX_FILE_BYTES / 3) * 4 + 1024;

// Tamanho maximo do nome do arquivo gravado (apos sanitizacao).
export const SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH = 150;
