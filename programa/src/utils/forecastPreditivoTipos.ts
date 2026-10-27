// Forecast preditivo (fase 0, modo sombra): tipos, versao e config. Funcoes PURAS, sem banco, sem HTTP, sem relogio.
// Nada aqui altera o motor da planilha (forecastEngine.ts): o preditivo so o compara, em teste e no CLI local.
import { createHash } from 'node:crypto';

export const PREDITIVO_VERSAO = 'p0.1.0';

export type AnoMes = string; // 'YYYY-MM'

export type MetodoId =
  | 'planilha-q'
  | 'planilha-r'
  | 'ingenuo'
  | 'ingenuo-sazonal'
  | 'media-ponderada'
  | 'ses'
  | 'holt'
  | 'holt-amortecido'
  | 'croston'
  | 'sba';

// Ordem de saida do relatorio.
export const METODO_IDS: readonly MetodoId[] = [
  'planilha-q',
  'planilha-r',
  'ingenuo',
  'ingenuo-sazonal',
  'media-ponderada',
  'ses',
  'holt',
  'holt-amortecido',
  'croston',
  'sba',
];

export type AvisoId =
  | 'historico-curto'
  | 'sem-venda'
  | 'sem-mes-valido'
  | 'negativo-zerado'
  | 'lacuna-cortada'
  | 'degrau-nivel'
  | 'mes-duplicado-somado'
  | 'previsao-negativa-zerada';

export const AVISO_IDS: readonly AvisoId[] = [
  'historico-curto',
  'sem-venda',
  'sem-mes-valido',
  'negativo-zerado',
  'lacuna-cortada',
  'degrau-nivel',
  'mes-duplicado-somado',
  'previsao-negativa-zerada',
];

export interface PontoMensal {
  anoMes: AnoMes;
  qtd: number;
  atipico?: boolean;
  ruptura?: boolean;
}

export interface SerieEntrada {
  id: string;
  pontos: PontoMensal[];
  fonte?: string;
  familia?: string;
  leadTimeDias?: number | null;
}

export interface SerieNormalizada {
  id: string;
  inicio: AnoMes;
  valores: number[];
  mascara: boolean[];
  meta: { fonte: string | null; familia: string | null; leadTimeDias: number | null };
  avisos: AvisoId[];
}

export interface OpcoesPrevisao {
  horizonte: number; // 1..12
}

export interface PontoPrevisto {
  h: number;
  anoMes: AnoMes;
  p50: number;
  p10?: number;
  p90?: number;
}

export type ResultadoPrevisao =
  | {
      ok: true;
      metodo: MetodoId;
      versao: string;
      origem: AnoMes;
      pontos: PontoPrevisto[];
      avisos: AvisoId[];
      parametros: Record<string, number>;
    }
  | { ok: false; metodo: MetodoId; motivo: 'historico-curto' | 'sem-dados' | 'horizonte-invalido' };

export type Metodo = (s: SerieNormalizada, o: OpcoesPrevisao) => ResultadoPrevisao;

function congelar<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) congelar(v);
    Object.freeze(o);
  }
  return o;
}

// Entra no hashConfig: mudou aqui, sobe a versao (PREDITIVO_VERSAO).
export const PREDITIVO_CONFIG = congelar({
  horizontePadrao: 6,
  horizonteMax: 12,
  minTreinoPadrao: 6,
  leadTimePadraoDias: 90,
  razaoFaltaExcesso: 3,
  janelaQ: 3,
  janelaR: 6,
  pesosPonderada: [3, 2, 1],
  minimoValidos: {
    'planilha-q': 1,
    'planilha-r': 1,
    ingenuo: 1,
    'media-ponderada': 3,
    'ingenuo-sazonal': 13,
    ses: 4,
    holt: 8,
    'holt-amortecido': 8,
  },
  minimoVendas: { croston: 2, sba: 2 },
  gradeSes: { alfa: [0.1, 0.2, 0.3, 0.5] },
  gradeHolt: { alfa: [0.1, 0.2, 0.3, 0.5], beta: [0.05, 0.1, 0.2] },
  gradeHoltAmortecido: { alfa: [0.1, 0.2, 0.3, 0.5], beta: [0.05, 0.1, 0.2], phi: [0.8, 0.9, 0.98] },
  gradeCroston: { alfa: [0.05, 0.1, 0.2] },
  segmentos: {
    abcA: 0.8,
    abcB: 0.95,
    janelaAbc: 6,
    janelaVariacao: 12,
    adi: 1.32,
    cv2: 0.49,
    xyzX: 0.5,
    xyzY: 1.0,
  },
  degrauRazao: 20,
  promocao: {
    minOrigens: 6,
    minObs: 30,
    wapeRel: 0.9,
    viesMax: 0.1,
    viesFolga: 0.02,
    custoRel: 0.95,
    vitoria: 0.55,
    guardaA: 1.25,
  },
  empateRelativo: 1e-9,
});

// Mesmo criterio de forecastDbcorpRegras.ts (reimplementado, nao importado).
export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === 'object') {
    const origem = v as Record<string, unknown>;
    const saida: Record<string, unknown> = {};
    for (const k of Object.keys(origem).sort()) saida[k] = canonico(origem[k]);
    return saida;
  }
  return v;
}

// SHA-256 (hex) do JSON com chaves ordenadas recursivamente.
export function hashCanonico(valor: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonico(valor))).digest('hex');
}

// Avisos sem repeticao, na ordem de AVISO_IDS.
export function ordenarAvisos(avisos: Iterable<AvisoId>): AvisoId[] {
  const conjunto = new Set(avisos);
  return AVISO_IDS.filter((a) => conjunto.has(a));
}
