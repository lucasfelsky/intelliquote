import {
  FORECAST_PRAZO_REAL_JANELA_DIAS,
  FORECAST_PRAZO_REAL_MAX_DIAS,
  FORECAST_PRAZO_REAL_MIN_CHEGADAS,
} from '../constants/forecast';
import { daysUntil } from './supplierDocumentDates';
import type { DataDaCelula, FupLinha } from './forecastDbcorpRegras';
import type { AmostraPrazoFup } from './forecastTypes';

// Prazo real medio por fonte (3C). PURO: so aritmetica de date key (sem relogio, banco ou planilha).

export interface EstatisticaPrazo {
  chegadas: number;
  media: number; // dias, arredondado
  mediana: number; // dias, arredondado quando n par
  min: number;
  max: number;
  poucasChegadas: boolean;
}

export interface PrazoRealDaFonte {
  po: EstatisticaPrazo | null;
  etd: EstatisticaPrazo | null;
}

export interface PrazoRealPorFonte {
  porFonte: Map<number, PrazoRealDaFonte>;
  semFonte: { chegadas: number };
}

// Dias de `inicio` ate `fim` (date keys). Negativo ou acima do maximo = dado ruim (null).
function intervaloEmDias(inicio: DataDaCelula, fim: string): number | null {
  if (inicio.tipo !== 'data') return null;
  const dias = daysUntil(fim, inicio.key);
  return dias < 0 || dias > FORECAST_PRAZO_REAL_MAX_DIAS ? null : dias;
}

// Toda linha do FUP com codigo e ETA FINAL valida, de QUALQUER status (CONCLUIDO e ATRAC. AG. LIBERACAO tambem
// sao historico de chegada), com ETA FINAL entre (base - janela) e a base.
export function amostrasDePrazo(linhas: readonly FupLinha[], baseDate: string): AmostraPrazoFup[] {
  const amostras: AmostraPrazoFup[] = [];
  for (const linha of linhas) {
    if (linha.codigo === '' || linha.etaFinal.tipo !== 'data') continue;
    const etaFinal = linha.etaFinal.key;
    const idade = daysUntil(baseDate, etaFinal);
    if (idade < 0 || idade > FORECAST_PRAZO_REAL_JANELA_DIAS) continue;
    const poDias = intervaloEmDias(linha.dataPo, etaFinal);
    const etdDias = intervaloEmDias(linha.etd, etaFinal);
    if (poDias === null && etdDias === null) continue;
    amostras.push({ codigo: linha.codigo, etaFinal, poDias, etdDias });
  }
  return amostras;
}

export function estatisticaDePrazo(dias: readonly number[]): EstatisticaPrazo | null {
  const n = dias.length;
  if (n === 0) return null;
  const ordenados = [...dias].sort((a, b) => a - b);
  const soma = ordenados.reduce((acc, d) => acc + d, 0);
  const meio = Math.floor(n / 2);
  const mediana = n % 2 === 1 ? ordenados[meio] : Math.round((ordenados[meio - 1] + ordenados[meio]) / 2);
  return {
    chegadas: n,
    media: Math.round(soma / n),
    mediana,
    min: ordenados[0],
    max: ordenados[n - 1],
    poucasChegadas: n < FORECAST_PRAZO_REAL_MIN_CHEGADAS,
  };
}

// Agrupa as amostras pela fonte do produto (codigo ja normalizado pelo parseFup). Sem fonte: so conta.
export function prazoRealPorFonte(
  amostras: readonly AmostraPrazoFup[],
  fonteDoCodigo: ReadonlyMap<string, number>,
): PrazoRealPorFonte {
  const acumulado = new Map<number, { po: number[]; etd: number[] }>();
  let semFonte = 0;
  for (const amostra of amostras) {
    const sourceId = fonteDoCodigo.get(amostra.codigo);
    if (sourceId === undefined) {
      semFonte += 1;
      continue;
    }
    const dias = acumulado.get(sourceId) ?? { po: [], etd: [] };
    if (amostra.poDias !== null) dias.po.push(amostra.poDias);
    if (amostra.etdDias !== null) dias.etd.push(amostra.etdDias);
    acumulado.set(sourceId, dias);
  }
  const porFonte = new Map<number, PrazoRealDaFonte>();
  for (const [sourceId, dias] of acumulado) {
    porFonte.set(sourceId, { po: estatisticaDePrazo(dias.po), etd: estatisticaDePrazo(dias.etd) });
  }
  return { porFonte, semFonte: { chegadas: semFonte } };
}
