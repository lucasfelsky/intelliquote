// Forecast preditivo (P1b-1): tabela de calibracao dos intervalos (so AGREGADOS adimensionais: quantis de residuos escalonados,
// contagens e a razao real/previsto; nenhum id, nenhuma quantidade em KG), fator de correcao de nivel encolhido e leitura estrita
// da tabela. Funcoes puras. A tabela e gerada pelo CLI (--gerar-calibracao) e passada como ENTRADA da previsao.
import { PREDITIVO_CONFIG_REF, hashConfigRef } from './forecastPreditivoConfigRef';
import type { ParametrosCorrecao } from './forecastPreditivoConfigRef';
import type { Sbc } from './forecastPreditivoSegmentos';
import { anoMesValido } from './forecastPreditivoSerie';
import type { AnoMes } from './forecastPreditivoTipos';

export const CELULAS_SBC: readonly Sbc[] = ['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente'];

export interface CelulaCalibracao {
  celula: Sbc | 'TOTAL';
  m: number; // h (mensal) ou hl (lead time)
  n: number;
  q10: number;
  q90: number;
}

export interface TabelaCalibracao {
  formato: 'preditivo-calibracao-v1';
  versao: string;
  hashConfig: string;
  correcaoNivel: boolean;
  parametros: { horizonte: number; minTreino: number; historicoMaximo: number | null; usarMascara: boolean; janelaNivelMeses: number };
  ultimoMes: AnoMes;
  mensal: CelulaCalibracao[];
  leadTime: CelulaCalibracao[];
  nivel: { n: number; razao: number | null };
}

export interface Calibrador {
  intervalo(tipo: 'mensal' | 'lt', celula: Sbc, m: number): { q10: number; q90: number; fonte: 'celula' | 'total' } | null;
  nivel(): { n: number; razao: number | null };
}

// razao null/nao finita ou n < minPares -> sem correcao; senao w = n/(n+k), bruto = 1 + w (razao - 1), fator = bruto dentro de [fatorMin, fatorMax].
export function fatorCorrecao(razao: number | null, n: number, p: ParametrosCorrecao): { fator: number; aplicado: boolean; noLimite: boolean } {
  if (razao === null || !Number.isFinite(razao) || !(n >= p.minPares)) return { fator: 1, aplicado: false, noLimite: false };
  const w = n / (n + p.k);
  const bruto = 1 + w * (razao - 1);
  const fator = Math.min(Math.max(bruto, p.fatorMin), p.fatorMax);
  return { fator, aplicado: true, noLimite: bruto < p.fatorMin || bruto > p.fatorMax };
}

type Leitura = { ok: true; tabela: TabelaCalibracao } | { ok: false; erro: string };
const invalida = (campo: string): Leitura => ({ ok: false, erro: `calibracao invalida: ${campo}` });
const objeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const inteiro = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// mesmas chaves, nem mais nem menos
const chavesExatas = (o: Record<string, unknown>, chaves: readonly string[]) => Object.keys(o).length === chaves.length && chaves.every((k) => k in o);

function lerCelulas(v: unknown): CelulaCalibracao[] | null {
  if (!Array.isArray(v)) return null;
  const vistas = new Set<string>();
  const saida: CelulaCalibracao[] = [];
  for (const c of v as unknown[]) {
    if (!objeto(c) || !chavesExatas(c, ['celula', 'm', 'n', 'q10', 'q90'])) return null;
    const { celula, m, n, q10, q90 } = c;
    if (typeof celula !== 'string' || !(celula === 'TOTAL' || (CELULAS_SBC as readonly string[]).includes(celula))) return null;
    if (!inteiro(m, 1, 12) || !inteiro(n, 0, Number.MAX_SAFE_INTEGER) || !finito(q10) || !finito(q90) || q10 > q90) return null;
    if (vistas.has(`${celula}|${m}`)) return null;
    vistas.add(`${celula}|${m}`);
    saida.push({ celula: celula as CelulaCalibracao['celula'], m, n, q10, q90 });
  }
  return saida;
}

// Tudo-ou-nada. Erro = mensagem fixa com o NOME do campo, nunca o valor.
export function lerTabelaCalibracao(texto: string): Leitura {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return invalida('json');
  }
  if (!objeto(j)) return invalida('raiz');
  const CHAVES = ['formato', 'versao', 'hashConfig', 'correcaoNivel', 'parametros', 'ultimoMes', 'mensal', 'leadTime', 'nivel'];
  if (!chavesExatas(j, CHAVES)) return invalida('chaves');
  if (j.formato !== PREDITIVO_CONFIG_REF.calibracao.formato) return invalida('formato');
  if (typeof j.versao !== 'string') return invalida('versao');
  if (typeof j.hashConfig !== 'string') return invalida('hashConfig');
  if (typeof j.correcaoNivel !== 'boolean') return invalida('correcaoNivel');
  const p = j.parametros;
  if (!objeto(p) || !chavesExatas(p, ['horizonte', 'minTreino', 'historicoMaximo', 'usarMascara', 'janelaNivelMeses'])) return invalida('parametros');
  const { horizonte, minTreino, historicoMaximo, usarMascara, janelaNivelMeses } = p;
  if (!inteiro(horizonte, 1, 12) || !inteiro(minTreino, 1, Number.MAX_SAFE_INTEGER) || !inteiro(janelaNivelMeses, 1, 240) || typeof usarMascara !== 'boolean') return invalida('parametros');
  if (!(historicoMaximo === null || inteiro(historicoMaximo, 1, PREDITIVO_CONFIG_REF.historicoMaximoLimite))) return invalida('parametros');
  if (!anoMesValido(j.ultimoMes)) return invalida('ultimoMes');
  const mensal = lerCelulas(j.mensal);
  if (mensal === null) return invalida('mensal');
  const leadTime = lerCelulas(j.leadTime);
  if (leadTime === null) return invalida('leadTime');
  const nv = j.nivel;
  if (!objeto(nv) || !chavesExatas(nv, ['n', 'razao']) || !inteiro(nv.n, 0, Number.MAX_SAFE_INTEGER)) return invalida('nivel');
  if (!(nv.razao === null || (finito(nv.razao) && nv.razao > 0))) return invalida('nivel');
  return {
    ok: true,
    tabela: {
      formato: 'preditivo-calibracao-v1',
      versao: j.versao,
      hashConfig: j.hashConfig,
      correcaoNivel: j.correcaoNivel,
      parametros: { horizonte, minTreino, historicoMaximo, usarMascara, janelaNivelMeses },
      ultimoMes: j.ultimoMes,
      mensal,
      leadTime,
      nivel: { n: nv.n, razao: nv.razao },
    },
  };
}

// A funcao de previsao ignora a tabela incompativel (nunca inventa intervalo): formato, hashConfig e modo da correcao.
export function compatibilidadeTabela(t: TabelaCalibracao, correcaoNivel: boolean): 'calibracao-incompativel' | null {
  const ok = t.formato === PREDITIVO_CONFIG_REF.calibracao.formato && t.hashConfig === hashConfigRef() && t.correcaoNivel === correcaoNivel;
  return ok ? null : 'calibracao-incompativel';
}

// celula|m com n >= minResiduos -> 'celula'; senao TOTAL|m com n >= minResiduos -> 'total'; senao null.
export function calibradorDaTabela(t: TabelaCalibracao, minResiduos: number = PREDITIVO_CONFIG_REF.intervalo.minResiduos): Calibrador {
  const indice = (cs: CelulaCalibracao[]) => new Map(cs.map((c) => [`${c.celula}|${c.m}`, c]));
  const mapas = { mensal: indice(t.mensal), lt: indice(t.leadTime) };
  return {
    intervalo(tipo, celula, m) {
      const mapa = mapas[tipo];
      const c = mapa.get(`${celula}|${m}`);
      if (c && c.n >= minResiduos) return { q10: c.q10, q90: c.q90, fonte: 'celula' };
      const total = mapa.get(`TOTAL|${m}`);
      if (total && total.n >= minResiduos) return { q10: total.q10, q90: total.q90, fonte: 'total' };
      return null;
    },
    nivel: () => ({ n: t.nivel.n, razao: t.nivel.razao }),
  };
}
