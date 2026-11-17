// Helpers para e-mails/portais VOLTADOS AO FORNECEDOR e ao parceiro de credito.
// O codigo interno da cotacao (requestCode, ex.: SEA-VP-17112026) e o id
// numerico (quoteRequestId) nunca podem aparecer para eles. Funcoes puras,
// sem dependencia de prisma.

const INTERNAL_KEYS = ['requestCode', 'quoteRequestId'] as const;

/**
 * Remove `requestCode`/`quoteRequestId` das variaveis de um renderer externo.
 * Protege contra cast/spread: mesmo que o chamador passe o campo (ou que um
 * template salvo no banco use `{{requestCode}}`), ele chega vazio ao render.
 */
export function omitRequestCode<T extends object>(
  vars: T,
): Omit<T, 'requestCode' | 'quoteRequestId'> {
  const copy: Record<string, unknown> = { ...(vars as Record<string, unknown>) };
  for (const key of INTERNAL_KEYS) {
    delete copy[key];
  }
  return copy as Omit<T, 'requestCode' | 'quoteRequestId'>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tira o codigo de um texto gerado pelo sistema (ex.: assunto ja gravado) e
 * normaliza espacos e separadores duplicados:
 * `Sourcing request SEA-1 - Photoiniator` -> `Sourcing request - Photoiniator`.
 * Se o codigo nao aparece no texto, devolve o texto intacto.
 */
export function stripRequestCode(text: string, code: string | null | undefined): string {
  const trimmedCode = (code ?? '').trim();
  if (!trimmedCode) return text;
  const pattern = new RegExp(escapeRegExp(trimmedCode), 'gi');
  if (!pattern.test(text)) return text;
  pattern.lastIndex = 0;

  return text
    .replace(pattern, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\s[-\u2013\u2014])(?:\s+[-\u2013\u2014])+(?=\s|$)/g, '$1')
    .replace(/^[\s\-\u2013\u2014:]+/, '')
    .replace(/[\s\-\u2013\u2014:,]+$/, '')
    .replace(/[ \t]{2,}/g, ' ');
}
