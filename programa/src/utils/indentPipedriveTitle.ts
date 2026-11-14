// Titulo do negocio do Pipedrive -> revisao ("R2 -") e numero do processo (NNN/AA) do IQ Indent.
// Funcao PURA (sem banco, sem IO, sem console): quem chama decide o que fazer com o `problem`.
// Formatos cobertos: "274/26 INDENT - CLIENTE", "INDENT 270/26 - CLIENTE", "R2 - 263/26 INDENT CLIENTE", "r2-263/26",
// "R10 - 001/27", "74/26 INDENT" (-> 074/26), "R2 - INDENT CLIENTE" (sem numero). "12/11/26" (data) NAO casa.
import { formatProcessNumber, parseProcessNumber } from './indentProcessNumber';

export type DealTitleProblem = 'no_number' | 'multiple_numbers' | 'year_out_of_range' | 'invalid_number';

export interface ParsedDealTitle {
  /** `R<n>` no inicio do titulo (1-99); `null` quando nao ha prefixo de revisao. */
  revision: number | null;
  /** `NNN/AA` normalizado (3 digitos no minimo); `null` quando ha `problem`. */
  processNumber: string | null;
  /** Ano de calendario (2000 + AA) e sequencia do numero valido; `null` quando ha `problem`. */
  year: number | null;
  seq: number | null;
  problem: DealTitleProblem | null;
}

// Prefixo de revisao: "R2 -", "r2-", "R10 –", "R2:" ou "R2 " (sem separador), so no inicio do titulo.
const REVISION_PREFIX = /^\s*R\s?(\d{1,2})\b\s*[-–—:]?\s*/i;
// Numero NNN/AA em qualquer posicao; nao pode ser parte de uma data ("12/11/26") nem de numero maior.
const NUMBER_PATTERN = /(?<![\d/])(\d{1,4})\/(\d{2})(?![\d/])/g;

const BRT_TIME_ZONE = 'America/Sao_Paulo';

function currentBrtYear(now: Date): number {
  const text = new Intl.DateTimeFormat('en-CA', { timeZone: BRT_TIME_ZONE, year: 'numeric' }).format(now);
  return Number(text);
}

/** Ano aceito: entre (ano BRT atual - 1) e (atual + 1); evita aceitar "270/19" ou "270/99" por engano. */
function isYearInRange(year: number, now: Date): boolean {
  const current = currentBrtYear(now);
  return year >= current - 1 && year <= current + 1;
}

export function parseDealTitle(title: string, now: Date = new Date()): ParsedDealTitle {
  const text = String(title ?? '');
  const revisionMatch = REVISION_PREFIX.exec(text);
  const revisionValue = revisionMatch ? Number(revisionMatch[1]) : null;
  const revision = revisionValue !== null && revisionValue >= 1 ? revisionValue : null;
  const rest = revisionMatch ? text.slice(revisionMatch[0].length) : text;

  const found = new Map<string, { seq: number; yearShort: number }>();
  for (const match of rest.matchAll(NUMBER_PATTERN)) {
    const seq = Number(match[1]);
    const yearShort = Number(match[2]);
    found.set(`${seq}/${yearShort}`, { seq, yearShort });
  }

  const empty = { revision, processNumber: null, year: null, seq: null } as const;

  if (found.size === 0) {
    return { ...empty, problem: 'no_number' };
  }
  if (found.size > 1) {
    return { ...empty, problem: 'multiple_numbers' };
  }

  const [{ seq, yearShort }] = [...found.values()] as [{ seq: number; yearShort: number }];
  const year = 2000 + yearShort;
  const padded = `${String(seq).padStart(3, '0')}/${String(yearShort).padStart(2, '0')}`;

  if (seq < 1 || parseProcessNumber(padded) === null) {
    return { ...empty, problem: 'invalid_number' };
  }
  if (!isYearInRange(year, now)) {
    return { ...empty, problem: 'year_out_of_range' };
  }

  return { revision, processNumber: formatProcessNumber(year, seq), year, seq, problem: null };
}
