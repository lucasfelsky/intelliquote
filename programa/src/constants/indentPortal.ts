// IQ Indent PR 4: constantes do envio por e-mail e do portal do fornecedor.
// Parte B (4a-2): constantes do portal PUBLICO do fornecedor. Mensagens em INGLES, sem nada que sugira ao fornecedor
// sem parceria que a SQ compra em nome de outro.

export const INDENT_MAILBOX = 'indent@sqquimica.com';
export const INDENT_TOKEN_TTL_DAYS = 14;
export const INDENT_MAX_RECIPIENTS = 5;
export const INDENT_MAX_SUPPLIER_EMAILS = 10;
export const INDENT_SEND_MAX_ATTACHMENTS = 3;
export const INDENT_SEND_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // soma dos anexos da Compras
export const INDENT_SEND_JSON_BODY_LIMIT_BYTES = 14 * 1024 * 1024; // base64 + JSON
export const INDENT_SEND_TOO_LARGE_MESSAGE = 'Os anexos passam de 10 MB.';
export const INDENT_MESSAGE_MAX = 2000;
export const INDENT_PORT_MAX = 80;
export const INDENT_TEMPLATE_REQUEST = 'indent_quote_request';
export const INDENT_TEMPLATE_RESPONSE_RECEIVED = 'indent_response_received';

// ---- Portal publico (4a-2) ----
export const INDENT_PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // base64url de 32 bytes
export const INDENT_PORTAL_BAD_LINK_MESSAGE =
  'This link is invalid. Please use the latest e-mail from SQ Quimica or reply to it to request a new link.';
export const INDENT_PORTAL_EXPIRED_MESSAGE = 'This link has expired. Reply to the e-mail from SQ Quimica to request a new one.';
export const INDENT_PORTAL_CLOSED_MESSAGE = 'This quotation is closed and no longer accepts responses.';
export const INDENT_PORTAL_LOCKED_MESSAGE = 'Access temporarily blocked after several invalid attempts. Please try again in a few minutes.';
export const INDENT_PORTAL_GENERIC_MESSAGE = 'Something went wrong on our side. Please try again in a few minutes.';
export const INDENT_PORTAL_CONFLICT_MESSAGE = 'Your response could not be saved due to a conflict. Please reload the page and try again.';
export const INDENT_PORTAL_NOT_PDF_MESSAGE = 'Only PDF files are accepted.';
export const INDENT_PORTAL_FILE_TOO_LARGE_MESSAGE = 'The file is larger than 10 MB.';
export const INDENT_PORTAL_TOO_MANY_FILES_MESSAGE = 'You can attach up to 5 files.';
export const INDENT_PORTAL_MAX_FILES = 5;
export const INDENT_PORTAL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const INDENT_PORTAL_PACKAGING_OPTIONS = ['25 kg bag', '50 kg bag', '200 kg drum', '1,000 kg IBC', 'Bulk'] as const;
export const INDENT_PORTAL_PAYMENT_OPTIONS = [
  'T/T 30 days after B/L date',
  'T/T 60 days after B/L date',
  'T/T 90 days after B/L date',
  'L/C at sight',
  'Other, see notes',
] as const;
export const INDENT_PORTAL_CURRENCIES = ['USD', 'EUR'] as const;
export const INDENT_PORTAL_BAD_REQUEST_MESSAGE = 'The submitted data is invalid. Please review the form and try again.';
export const INDENT_PORTAL_BODY_TOO_LARGE_MESSAGE = 'The request is too large.';
// Teto de espera do aviso a Compras antes de responder ao fornecedor (o envio segue em segundo plano).
export const INDENT_PORTAL_NOTIFY_CAP_MS = 5000;
