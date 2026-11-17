// Sigilo do cliente final no IQ Indent (PR 4): perfil de exposicao do fornecedor e deteccao de vazamento.
// O nome do cliente so pode aparecer para fornecedor COM parceria E com a opcao ligada no envio. Para os demais, nada que
// identifique o cliente (nome, CNPJ, porto) nem frase que diga que a SQ compra em nome de outro pode chegar ao fornecedor.

export interface IndentExposureProfile {
  hasPartnership: boolean;
  showClient: boolean;
}

/** showClient = parceria ATUAL do fornecedor E a opcao "mostrar o nome do cliente" do envio. */
export function buildIndentExposureProfile(
  supplier: { hasPartnership: boolean },
  showClientName: boolean,
): IndentExposureProfile {
  return {
    hasPartnership: supplier.hasPartnership,
    showClient: supplier.hasPartnership && showClientName,
  };
}

// LIMITES CONHECIDOS (risco residual aceito, ver PLAN "Riscos"): este detector pega o nome do cliente como PALAVRA INTEIRA depois de
// normalizar acento, caixa, pontuacao, caracteres invisiveis, largura total e homoglifos comuns. NAO pega: nome grudado ("valeverde"),
// dominio ("valeverde.com.br"), abreviacao ou sigla ("VV Fertilizantes"), cidade, grafias foneticas e o CONTEUDO dos PDFs anexados
// (este depende da confirmacao humana no envio).

// Homoglifos cirilicos/gregos (ja em minuscula) -> letra latina parecida. Tabela pequena de proposito: so o que engana a leitura.
const HOMOGLYPHS: ReadonlyMap<number, string> = new Map<number, string>([
  // cirilico
  [0x0430, 'a'], [0x0432, 'b'], [0x0441, 'c'], [0x0435, 'e'], [0x0451, 'e'], [0x0456, 'i'], [0x0458, 'j'], [0x043a, 'k'],
  [0x04cf, 'l'], [0x043c, 'm'], [0x043d, 'h'], [0x043e, 'o'], [0x0440, 'p'], [0x0455, 's'], [0x0442, 't'], [0x0443, 'y'],
  [0x0445, 'x'], [0x0475, 'v'], [0x051b, 'q'], [0x051d, 'w'], [0x0501, 'd'],
  // grego
  [0x03b1, 'a'], [0x03b2, 'b'], [0x03b5, 'e'], [0x03b7, 'n'], [0x03b9, 'i'], [0x03ba, 'k'], [0x03bd, 'v'], [0x03bf, 'o'],
  [0x03c1, 'p'], [0x03c4, 't'], [0x03c5, 'u'], [0x03c7, 'x'], [0x03b3, 'y'], [0x03c9, 'w'], [0x03c2, 's'],
  // latinas que o NFKD nao decompoe
  [0x00f8, 'o'], [0x0142, 'l'], [0x0111, 'd'], [0x0131, 'i'], [0x00df, 'ss'], [0x00e6, 'ae'], [0x0153, 'oe'],
]);

// Remove marcas combinantes (\p{M}) e caracteres de formato (\p{Cf}: zero-width, soft hyphen, bidi).
const INVISIBLE_OR_COMBINING = /[\p{M}\p{Cf}]/gu;

/**
 * NFKD (largura total, algarismos romanos e ligaduras caem em ASCII), sem marcas combinantes nem caracteres invisiveis, minusculas,
 * homoglifos cirilicos/gregos para latim, nao alfanumerico vira espaco, espacos colapsados.
 */
export function normalizeForMatch(text: string): string {
  const folded = String(text ?? '')
    .normalize('NFKD')
    .replace(INVISIBLE_OR_COMBINING, '')
    .toLowerCase();
  let mapped = '';

  for (const char of folded) {
    mapped += HOMOGLYPHS.get(char.codePointAt(0) ?? 0) ?? char;
  }

  return mapped.replace(/[^a-z0-9]+/g, ' ').trim();
}

const CORPORATE_SUFFIXES = ['ltda', 'sa', 'eireli', 'epp', 'me', 'mei'];

const GENERIC_FIRST_WORDS = new Set([
  'industria',
  'comercio',
  'quimica',
  'quimicos',
  'brasil',
  'grupo',
  'companhia',
  'cia',
  'distribuidora',
  'importadora',
  'exportadora',
  'sq',
]);

function stripCorporateSuffix(normalized: string): string {
  let words = normalized.split(' ').filter(Boolean);

  for (;;) {
    const last = words[words.length - 1];
    const beforeLast = words[words.length - 2];

    if (words.length > 1 && last === 'a' && beforeLast === 's') {
      words = words.slice(0, -2);
    } else if (words.length > 1 && last !== undefined && CORPORATE_SUFFIXES.includes(last)) {
      words = words.slice(0, -1);
    } else {
      return words.join(' ');
    }
  }
}

/**
 * Termos que identificam o cliente: nome completo, nome sem sufixo societario, 1a palavra (>= 4 letras e nao generica) e CNPJ
 * (14 digitos, comparado por digitos). Cidade nao e termo. Tudo normalizado por `normalizeForMatch`.
 */
export function buildClientTerms(client: { name: string; cnpj: string | null }): string[] {
  const terms = new Set<string>();
  const full = normalizeForMatch(client.name);

  if (full) {
    terms.add(full);

    const stripped = stripCorporateSuffix(full);
    if (stripped) {
      terms.add(stripped);
    }

    const firstWord = (stripped || full).split(' ')[0] ?? '';
    if (firstWord.length >= 4 && !GENERIC_FIRST_WORDS.has(firstWord)) {
      terms.add(firstWord);
    }
  }

  const cnpjDigits = String(client.cnpj ?? '').replace(/\D/g, '');
  if (cnpjDigits.length === 14) {
    terms.add(cnpjDigits);
  }

  // "SQ Quimica" e a propria remetente: nunca e termo de vazamento.
  terms.delete('sq');
  terms.delete('sq quimica');

  return Array.from(terms);
}

/** Devolve a CHAVE do 1o campo que cita o cliente (palavra inteira; CNPJ por digitos), ou `null`. Nunca devolve o valor. */
export function findClientLeak(fields: Record<string, string | null | undefined>, terms: string[]): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || value.trim() === '') {
      continue;
    }

    const padded = ` ${normalizeForMatch(value)} `;
    const digits = value.normalize('NFKD').replace(INVISIBLE_OR_COMBINING, '').replace(/\D/g, '');

    for (const term of terms) {
      const hit = /^\d{14}$/.test(term) ? digits.includes(term) : padded.includes(` ${term} `);

      if (hit) {
        return key;
      }
    }
  }

  return null;
}

/** Frases que dizem que a SQ compra para outro (aplicada sobre o texto ja normalizado). */
export const FORBIDDEN_BUYER_PHRASES = /\b(buyers?|purchasers?|compradora?|compradores|on behalf of|our customers?|nosso cliente|nossos clientes)\b/i;

export function hasForbiddenBuyerPhrase(text: string): boolean {
  return FORBIDDEN_BUYER_PHRASES.test(normalizeForMatch(text));
}
