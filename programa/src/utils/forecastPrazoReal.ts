import {
  FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS,
  FORECAST_PRAZO_REAL_JANELA_DIAS,
  FORECAST_PRAZO_REAL_MAX_DIAS,
  FORECAST_PRAZO_REAL_MIN_CHEGADAS,
  FORECAST_PRAZO_SUGESTAO_DIFERENCA_MIN_DIAS,
  FORECAST_PRAZO_SUGESTAO_DISPERSAO_ALTA_DIAS,
  FORECAST_PRAZO_SUGESTAO_JANELA_DIAS,
  FORECAST_PRAZO_SUGESTAO_MIN_AMOSTRAS,
  FORECAST_PRAZO_SUGESTAO_PERCENTIL,
} from '../constants/forecast';
import { daysUntil } from './supplierDocumentDates';
import {
  parseProntidaoAte,
  type DataDaCelula,
  type FontePrazoInfo,
  type FupLinha,
  type MudancaDePrazo,
  type PrazoChegada,
  type ResumoPrazosEstimativa,
} from './forecastDbcorpRegras';
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
  prontidao: EstatisticaPrazo | null;
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
// sao historico de chegada), com ETA FINAL entre (base - janela) e a base. Mede DATA PO, ETD e DATA PRONTIDAO ate a
// ETA FINAL; a linha so sai se os tres intervalos forem invalidos.
export function amostrasDePrazo(linhas: readonly FupLinha[], baseDate: string): AmostraPrazoFup[] {
  const amostras: AmostraPrazoFup[] = [];
  for (const linha of linhas) {
    if (linha.codigo === '' || linha.etaFinal.tipo !== 'data') continue;
    const etaFinal = linha.etaFinal.key;
    const idade = daysUntil(baseDate, etaFinal);
    if (idade < 0 || idade > FORECAST_PRAZO_REAL_JANELA_DIAS) continue;
    const poDias = intervaloEmDias(linha.dataPo, etaFinal);
    const etdDias = intervaloEmDias(linha.etd, etaFinal);
    const prontidaoDias = prontidaoEmDias(linha, etaFinal);
    if (poDias === null && etdDias === null && prontidaoDias === null) continue;
    amostras.push({ codigo: linha.codigo, etaFinal, poDias, etdDias, prontidaoDias });
  }
  return amostras;
}

// DATA PRONTIDAO -> ETA FINAL. O ano do texto sem ano vem da DATA PO (ou da ETA FINAL, sem DATA PO). Prontidao
// depois do ETD da mesma linha e dado inconsistente: so este intervalo e anulado.
function prontidaoEmDias(linha: FupLinha, etaFinal: string): number | null {
  const dataPo = linha.dataPo.tipo === 'data' ? linha.dataPo.key : null;
  const prontidao = parseProntidaoAte(linha.prontidao, dataPo, etaFinal);
  if (prontidao.tipo !== 'data') return null;
  if (linha.etd.tipo === 'data' && prontidao.key > linha.etd.key) return null;
  return intervaloEmDias(prontidao, etaFinal);
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
  const acumulado = new Map<number, { po: number[]; etd: number[]; prontidao: number[] }>();
  let semFonte = 0;
  for (const amostra of amostras) {
    const sourceId = fonteDoCodigo.get(amostra.codigo);
    if (sourceId === undefined) {
      semFonte += 1;
      continue;
    }
    const dias = acumulado.get(sourceId) ?? { po: [], etd: [], prontidao: [] };
    if (amostra.poDias !== null) dias.po.push(amostra.poDias);
    if (amostra.etdDias !== null) dias.etd.push(amostra.etdDias);
    if (amostra.prontidaoDias !== null && amostra.prontidaoDias !== undefined) {
      dias.prontidao.push(amostra.prontidaoDias);
    }
    acumulado.set(sourceId, dias);
  }
  const porFonte = new Map<number, PrazoRealDaFonte>();
  for (const [sourceId, dias] of acumulado) {
    porFonte.set(sourceId, {
      po: estatisticaDePrazo(dias.po),
      etd: estatisticaDePrazo(dias.etd),
      prontidao: estatisticaDePrazo(dias.prontidao),
    });
  }
  return { porFonte, semFonte: { chegadas: semFonte } };
}

// --- Sugestao do prazo de chegada por fonte -------------------------------------------------------------------
// Nada aqui alimenta resolverPrazosChegada nem mudancasDePrazo: a sugestao e so informacao para a tela, e o valor
// que vale continua sendo o digitado / salvo / padrao.

export interface ConfigSugestaoPrazo {
  percentil: number; // 0..1, nearest-rank: define o valor sugerido
  minAmostras: number;
  diferencaMinDias: number;
  janelaDias: number;
  dispersaoAltaDias: number;
}

export const CONFIG_SUGESTAO_PRAZO_PADRAO: ConfigSugestaoPrazo = {
  percentil: FORECAST_PRAZO_SUGESTAO_PERCENTIL,
  minAmostras: FORECAST_PRAZO_SUGESTAO_MIN_AMOSTRAS,
  diferencaMinDias: FORECAST_PRAZO_SUGESTAO_DIFERENCA_MIN_DIAS,
  janelaDias: FORECAST_PRAZO_SUGESTAO_JANELA_DIAS,
  dispersaoAltaDias: FORECAST_PRAZO_SUGESTAO_DISPERSAO_ALTA_DIAS,
};

export interface EvidenciaPrazo {
  amostras: number; // chegadas medidas (por linha do FUP, nao por kg)
  mediana: number;
  percentil: number; // rotulo do percentil de sugestao (75 = P75)
  valorPercentil: number; // dias nesse percentil, sem clamp
  min: number;
  max: number;
  de: string; // menor ETA FINAL das amostras (yyyy-mm-dd)
  ate: string; // maior ETA FINAL das amostras
  // valorPercentil bem acima da mediana: amostra muito dispersa, a sugestao deve ser lida com cuidado.
  dispersaoAlta: boolean;
}

// 'sugerida': mostra o valor e o botao. 'diferenca_pequena': prazo atual ja perto do medido. 'poucas_amostras':
// menos chegadas que o minimo (dias = null).
export type SituacaoSugestaoPrazo = 'sugerida' | 'diferenca_pequena' | 'poucas_amostras';

export interface SugestaoPrazoCampo {
  situacao: SituacaoSugestaoPrazo;
  dias: number | null;
  atual: number; // salvo da fonte ?? padrao: o prazo contra o qual a diferenca foi medida
  minAmostras: number;
  evidencia: EvidenciaPrazo;
}

export interface SugestaoPrazoDaFonte {
  prontidao: SugestaoPrazoCampo | null;
  etd: SugestaoPrazoCampo | null;
}

export type ResumoPrazosComSugestao = Omit<ResumoPrazosEstimativa, 'fontes'> & {
  fontes: Array<ResumoPrazosEstimativa['fontes'][number] & { sugestao: SugestaoPrazoDaFonte | null }>;
};

// Percentil por posicao (nearest-rank): ordenados[ceil(p * n) - 1]. Lista vazia = null. Nao altera a entrada.
export function percentilDePrazo(dias: readonly number[], p: number): number | null {
  const n = dias.length;
  if (n === 0) return null;
  const ordenados = [...dias].sort((a, b) => a - b);
  // O ajuste absorve o erro de ponto flutuante (0.7 * 10 = 7.000000000000001).
  const posicao = Math.min(n, Math.max(1, Math.ceil(p * n - 1e-9)));
  return ordenados[posicao - 1];
}

interface PontoDePrazo {
  dias: number;
  etaFinal: string;
}

function sugestaoDoCampo(pontos: readonly PontoDePrazo[], atual: number, cfg: ConfigSugestaoPrazo): SugestaoPrazoCampo | null {
  if (pontos.length === 0) return null;
  const dias = pontos.map((p) => p.dias);
  const estatistica = estatisticaDePrazo(dias);
  const valorPercentil = percentilDePrazo(dias, cfg.percentil);
  if (!estatistica || valorPercentil === null) return null;
  const etas = pontos.map((p) => p.etaFinal).sort();
  const calculado = Math.min(
    FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS,
    Math.max(0, Math.round(valorPercentil)),
  );
  const evidencia: EvidenciaPrazo = {
    amostras: estatistica.chegadas,
    mediana: estatistica.mediana,
    percentil: Math.round(cfg.percentil * 100),
    valorPercentil,
    min: estatistica.min,
    max: estatistica.max,
    de: etas[0],
    ate: etas[etas.length - 1],
    dispersaoAlta: valorPercentil - estatistica.mediana >= cfg.dispersaoAltaDias,
  };
  if (estatistica.chegadas < cfg.minAmostras) {
    return { situacao: 'poucas_amostras', dias: null, atual, minAmostras: cfg.minAmostras, evidencia };
  }
  const situacao: SituacaoSugestaoPrazo =
    Math.abs(calculado - atual) < cfg.diferencaMinDias ? 'diferenca_pequena' : 'sugerida';
  return { situacao, dias: calculado, atual, minAmostras: cfg.minAmostras, evidencia };
}

// Sugestao por fonte ATIVA (`fontes`) e por campo, pelas chegadas medidas das amostras. Linha -> fonte so pelo codigo
// (`fonteDoCodigo`); codigo sem fonte ou de fonte fora de `fontes` nao entra. A fonte so aparece no resultado se
// algum campo tem chegada medida.
export function sugerirPrazosChegada(args: {
  amostras: readonly AmostraPrazoFup[];
  fonteDoCodigo: ReadonlyMap<string, number>;
  fontes: readonly FontePrazoInfo[];
  padrao: PrazoChegada;
  baseDate: string;
  config?: Partial<ConfigSugestaoPrazo>;
}): Map<number, SugestaoPrazoDaFonte> {
  const cfg: ConfigSugestaoPrazo = { ...CONFIG_SUGESTAO_PRAZO_PADRAO, ...args.config };
  const ativas = new Map(args.fontes.map((f) => [f.sourceId, f]));
  const acumulado = new Map<number, { prontidao: PontoDePrazo[]; etd: PontoDePrazo[] }>();
  for (const amostra of args.amostras) {
    const sourceId = args.fonteDoCodigo.get(amostra.codigo);
    if (sourceId === undefined || !ativas.has(sourceId)) continue;
    const idade = daysUntil(args.baseDate, amostra.etaFinal);
    if (idade < 0 || idade > cfg.janelaDias) continue;
    const pontos = acumulado.get(sourceId) ?? { prontidao: [], etd: [] };
    if (amostra.prontidaoDias !== null && amostra.prontidaoDias !== undefined) {
      pontos.prontidao.push({ dias: amostra.prontidaoDias, etaFinal: amostra.etaFinal });
    }
    if (amostra.etdDias !== null) pontos.etd.push({ dias: amostra.etdDias, etaFinal: amostra.etaFinal });
    acumulado.set(sourceId, pontos);
  }
  const sugestoes = new Map<number, SugestaoPrazoDaFonte>();
  for (const [sourceId, pontos] of acumulado) {
    const fonte = ativas.get(sourceId)!;
    const sugestao: SugestaoPrazoDaFonte = {
      prontidao: sugestaoDoCampo(
        pontos.prontidao,
        fonte.salvo.prontidaoDias ?? args.padrao.prontidaoDias,
        cfg,
      ),
      etd: sugestaoDoCampo(pontos.etd, fonte.salvo.etdDias ?? args.padrao.etdDias, cfg),
    };
    if (sugestao.prontidao !== null || sugestao.etd !== null) sugestoes.set(sourceId, sugestao);
  }
  return sugestoes;
}

// Copia do resumo com `sugestao` em cada fonte (null quando a fonte nao tem chegada medida). Nao muta a entrada.
export function anexarSugestoes(
  resumo: ResumoPrazosEstimativa,
  sugestoes: ReadonlyMap<number, SugestaoPrazoDaFonte>,
): ResumoPrazosComSugestao {
  return {
    ...resumo,
    fontes: resumo.fontes.map((f) => ({ ...f, sugestao: sugestoes.get(f.sourceId) ?? null })),
  };
}

// Linhas da tabela com pelo menos um campo 'sugerida'.
export function contarFontesComSugestao(resumo: ResumoPrazosComSugestao): number {
  return resumo.fontes.filter(
    (f) => f.sugestao?.prontidao?.situacao === 'sugerida' || f.sugestao?.etd?.situacao === 'sugerida',
  ).length;
}

// Mudancas de prazo (as que serao gravadas) em que TODO campo alterado e igual ao valor de uma sugestao 'sugerida'
// daquele campo. Mede quantas vezes a pessoa adotou a sugestao; nao decide nada.
export function contarMudancasIguaisASugestao(
  mudancas: readonly MudancaDePrazo[],
  resumo: ResumoPrazosComSugestao,
): number {
  const porFonte = new Map(resumo.fontes.map((f) => [f.sourceId, f.sugestao]));
  const igual = (valor: number | undefined, campo: SugestaoPrazoCampo | null | undefined): boolean =>
    valor === undefined || (campo?.situacao === 'sugerida' && campo.dias === valor);
  let total = 0;
  for (const m of mudancas) {
    const sugestao = porFonte.get(m.sourceId);
    if (!sugestao) continue;
    const alterouAlgo = m.arrivalFromReadinessDays !== undefined || m.arrivalFromEtdDays !== undefined;
    if (alterouAlgo && igual(m.arrivalFromReadinessDays, sugestao.prontidao) && igual(m.arrivalFromEtdDays, sugestao.etd)) {
      total += 1;
    }
  }
  return total;
}
