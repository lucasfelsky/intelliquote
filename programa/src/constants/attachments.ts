// Limites de anexos (POST /api/v1/attachments).
export const ATTACHMENT_MAX_FILE_BYTES = 5 * 1024 * 1024;

// O arquivo viaja em base64 dentro do JSON: o corpo cresce 4/3 em relacao ao
// binario, mais folga para prefixo data-URL e demais campos. Cloud Run aceita
// requisicoes de ate 32 MB, entao este teto fica bem abaixo.
export const ATTACHMENT_JSON_BODY_LIMIT_BYTES =
  Math.ceil(ATTACHMENT_MAX_FILE_BYTES / 3) * 4 + 256 * 1024;

export const ATTACHMENT_TOO_LARGE_MESSAGE = 'O arquivo excede o limite de 5MB por anexo.';
