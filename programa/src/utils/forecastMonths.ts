import { isValidDateKey } from './supplierDocumentDates';

// Meses da quinzena do Forecast. Tudo em date key (YYYY-MM-DD) e aritmetica UTC:
// nunca conversao ISO de data local (no BRT viraria o dia anterior).

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDateKey(key: string): { year: number; month: number; day: number } {
  const match = DATE_KEY_PATTERN.exec(key);
  if (!isValidDateKey(key) || !match) {
    throw new Error(`Data invalida: ${key}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// Soma `n` dias (pode ser negativo) a um date key.
export function somarDias(dateKey: string, n: number): string {
  const { year, month, day } = assertDateKey(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Mes (indice absoluto = ano * 12 + mes0) deslocado por `n` meses, devolvido como { ano, mes }.
function deslocarMes(baseDate: string, n: number): { year: number; month: number } {
  const { year, month } = assertDateKey(baseDate);
  const abs = year * 12 + (month - 1) + n;
  return { year: Math.floor(abs / 12), month: (abs % 12) + 1 };
}

const rotuloMes = (baseDate: string, n: number) => pad2(deslocarMes(baseDate, n).month);

function yearMonthDe(baseDate: string, n: number): string {
  const { year, month } = deslocarMes(baseDate, n);
  return `${year}-${pad2(month)}`;
}

// Os `n` meses a partir do mes base, como 'YYYY-MM' (mes base, base+1, ..., base+n-1).
export function yearMonthsDaJanela(baseDate: string, n: number): string[] {
  const meses: string[] = [];
  for (let i = 0; i < n; i++) meses.push(yearMonthDe(baseDate, i));
  return meses;
}

// 'YYYY-MM' -> 'MM' (o rotulo que o motor usa para casar chegadas e programacoes).
export function rotuloDoYearMonth(yearMonth: string): string {
  const match = /^\d{4}-(\d{2})$/.exec(yearMonth);
  if (!match) {
    throw new Error(`Ano-mes invalido: ${yearMonth}`);
  }
  return match[1];
}

export interface RotulosDaQuinzena {
  consumo: string[]; // J2..P2: base-6 .. base-1, 'MM (ATUAL)'
  chegada: string[]; // V2..Z2: base .. base+4
  programacao: string[]; // AC2..AF2: base .. base+3
}

// Rotulos de mes ('MM') da quinzena cuja data base e `baseDate`.
export function rotulosDaQuinzena(baseDate: string): RotulosDaQuinzena {
  const consumo: string[] = [];
  for (let n = -6; n <= -1; n++) consumo.push(rotuloMes(baseDate, n));
  consumo.push(`${rotuloMes(baseDate, 0)} (ATUAL)`);
  const chegada: string[] = [];
  for (let n = 0; n <= 4; n++) chegada.push(rotuloMes(baseDate, n));
  const programacao: string[] = [];
  for (let n = 0; n <= 3; n++) programacao.push(rotuloMes(baseDate, n));
  return { consumo, chegada, programacao };
}

// 'MM' -> 'YYYY-MM' do mes mais recente que seja <= ao mes base e tenha aquele 'MM'.
export function anoMesDoRotulo(mm: string, baseDate: string): string {
  const rotulo = Number(mm);
  if (!/^\d{1,2}$/.test(mm.trim()) || rotulo < 1 || rotulo > 12) {
    throw new Error(`Rotulo de mes invalido: ${mm}`);
  }
  const { year, month } = deslocarMes(baseDate, 0);
  const ano = rotulo <= month ? year : year - 1;
  return `${ano}-${pad2(rotulo)}`;
}

export interface MesesHistorico {
  historico: string[]; // J..N: base-6 .. base-2 (YYYY-MM)
  anterior: string; // O: base-1 (YYYY-MM)
}

export function mesesHistorico(baseDate: string): MesesHistorico {
  const historico: string[] = [];
  for (let n = -6; n <= -2; n++) historico.push(yearMonthDe(baseDate, n));
  return { historico, anterior: yearMonthDe(baseDate, -1) };
}
