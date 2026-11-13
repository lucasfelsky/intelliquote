// Numero de processo do IQ Indent: NNN/AA (sequencia do ano + ano com 2 digitos).
// Acima de 999 a sequencia ganha 4 digitos ("1000/26"); o ano e sempre o do calendario BRT (quem chama decide).

/** `formatProcessNumber(2026, 7)` -> `007/26`. */
export function formatProcessNumber(year: number, seq: number): string {
  return `${String(seq).padStart(3, '0')}/${String(year % 100).padStart(2, '0')}`;
}

const PROCESS_NUMBER_PATTERN = /^(\d{3,})\/(\d{2})$/;

/** `277/26` -> `{ seq: 277, yearShort: 26 }`; qualquer outro formato -> `null`. */
export function parseProcessNumber(text: string): { seq: number; yearShort: number } | null {
  const match = PROCESS_NUMBER_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  return { seq: Number(match[1]), yearShort: Number(match[2]) };
}
