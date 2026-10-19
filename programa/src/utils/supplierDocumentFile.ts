import {
  SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH,
  SUPPLIER_DOCUMENT_INVALID_BASE64_MESSAGE,
  type SupplierDocumentMime,
} from '../constants/supplierDocuments';

const DATA_URL_PREFIX = /^data:[^;,]*(?:;[^;,]*)*;base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

// Aceita prefixo data-URL e quebras de linha; qualquer outro caractere fora do alfabeto
// base64 lanca (Buffer.from(..., 'base64') ignoraria silenciosamente).
export function decodeStrictBase64(input: string): Buffer {
  const withoutPrefix = input.trim().replace(DATA_URL_PREFIX, '');
  const compact = withoutPrefix.replace(/[\r\n]/g, '');

  if (!BASE64_BODY.test(compact) || compact.length % 4 === 1) {
    throw new Error(SUPPLIER_DOCUMENT_INVALID_BASE64_MESSAGE);
  }

  return Buffer.from(compact, 'base64');
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => buffer[index] === byte);
}

// Detecta o tipo real pelos magic bytes (PDF "%PDF-", PNG, JPEG).
export function detectDocumentMime(buffer: Buffer): SupplierDocumentMime | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  return null;
}

const EXTENSION_BY_MIME: Record<SupplierDocumentMime, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

// Nome seguro para gravar/reutilizar (AuditLog, e-mail do PR2): so o basename (sem / \ ..),
// sem caracteres de controle, ate SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH, preservando a
// extensao. Vazio apos limpar -> "documento.<ext>" pelo tipo detectado.
export function sanitizeDocumentFileName(raw: string, mime: SupplierDocumentMime): string {
  const withoutControl = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  const segments = withoutControl.split(/[\\/]/);
  const basename = (segments[segments.length - 1] ?? '').replace(/\.{2,}/g, '.').trim();
  const cleaned = basename.replace(/^\.+/, '').trim();

  if (cleaned.length === 0) {
    return `documento.${EXTENSION_BY_MIME[mime]}`;
  }

  if (cleaned.length <= SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH) {
    return cleaned;
  }

  const extension = /\.[A-Za-z0-9]{1,10}$/.exec(cleaned)?.[0] ?? '';
  const stem = cleaned.slice(0, cleaned.length - extension.length);
  return `${stem.slice(0, SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH - extension.length)}${extension}`;
}
