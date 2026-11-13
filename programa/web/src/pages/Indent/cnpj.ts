// CNPJ do IQ Indent. Copia identica de src/utils/cnpj.ts (backend): a mesma regra antes de enviar. Mantenha as duas em sincronia.

/** Remove tudo que nao e digito ("11.222.333/0001-81" -> "11222333000181"). */
export function normalizeCnpj(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) {
    sum += Number(base[i]) * (weights[i] as number);
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** 14 digitos, nao todos iguais e digitos verificadores corretos. Aceita entrada com mascara. */
export function isValidCnpj(raw: string): boolean {
  const digits = normalizeCnpj(raw);

  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) {
    return false;
  }

  const first = checkDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return first === Number(digits[12]) && second === Number(digits[13]);
}

/** "11222333000181" -> "11.222.333/0001-81". Com menos/mais de 14 digitos devolve so os digitos; null (CNPJ pendente) devolve "". */
export function formatCnpj(raw: string | null): string {
  const digits = normalizeCnpj(raw ?? '');

  if (digits.length !== 14) {
    return digits;
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/** Mascara progressiva para o campo digitado ("1122233" -> "11.222.33"); ignora o que passa de 14 digitos. */
export function maskCnpjInput(raw: string): string {
  const d = normalizeCnpj(raw).slice(0, 14);
  let out = d.slice(0, 2);
  if (d.length > 2) out += `.${d.slice(2, 5)}`;
  if (d.length > 5) out += `.${d.slice(5, 8)}`;
  if (d.length > 8) out += `/${d.slice(8, 12)}`;
  if (d.length > 12) out += `-${d.slice(12, 14)}`;
  return out;
}
