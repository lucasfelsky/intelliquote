// IQ Indent PR 4: constantes do envio por e-mail e do portal do fornecedor.
// (O 4a-2 acrescenta as constantes do portal publico.)

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
export const INDENT_TEMPLATE_RESPONSE_RECEIVED = 'indent_response_received'; // usado no 4a-2
