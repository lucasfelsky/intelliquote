// CNPJ do IQ Indent. No banco fica so com digitos (`IndentClient.cnpj`, unico).
// O web tem copia identica em web/src/pages/Indent/cnpj.ts (mesma regra antes de enviar).

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

/** "11222333000181" -> "11.222.333/0001-81". Com menos/mais de 14 digitos devolve so os digitos. */
export function formatCnpj(raw: string): string {
  const digits = normalizeCnpj(raw);

  if (digits.length !== 14) {
    return digits;
  }

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
