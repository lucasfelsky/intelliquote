// Forecast preditivo (P1b-1): pools de residuos AS-OF da referencia. O estado vive dentro de uma chamada (nada global). Um
// residuo so vale para origens >= liberacao (= origem + m: o ultimo mes realizado da janela; na origem o, o mes o ja e
// conhecido). Fila por indice de mes de liberacao (buckets): liberarAte(mes) e O(meses), nunca varre todos os residuos; os
// quantis (tipo 7) de cada pool so sao recalculados se o pool estiver "sujo".
import { PREDITIVO_CONFIG_REF } from './forecastPreditivoConfigRef';
import { CELULAS_SBC } from './forecastPreditivoCalibracao';
import type { Calibrador, CelulaCalibracao, TabelaCalibracao } from './forecastPreditivoCalibracao';
import { quantil } from './forecastPreditivoIntervalos';
import type { Sbc } from './forecastPreditivoSegmentos';
import { indiceMes } from './forecastPreditivoSerie';
import { round6 } from './forecastPreditivoTipos';
import type { AnoMes } from './forecastPreditivoTipos';

export interface ResiduoRef {
  tipo: 'mensal' | 'lt';
  celula: Sbc;
  m: number;
  liberacao: AnoMes;
  residuo: number;
}

interface Pool {
  valores: number[];
  sujo: boolean;
  q10: number | null;
  q90: number | null;
}
interface Fila {
  residuos: ResiduoRef[];
  niveis: { real: number; previsto: number }[];
}
interface SomaNivel {
  n: number;
  real: number;
  previsto: number;
}

const ordemNumerica = (a: number, b: number) => a - b;

export interface PoolsRef {
  pendente(r: ResiduoRef): void; // fica na fila ate a liberacao
  nivelPendente(x: { liberacao: AnoMes; real: number; previsto: number }): void;
  liberarAte(mes: AnoMes): void; // libera tudo com liberacao <= mes (inclusive)
  calibrador(mesAtual: AnoMes): Calibrador; // razao de nivel = liberacoes em (mesAtual - janela, mesAtual]; chamar APOS liberarAte(mesAtual)
  paraTabela(meta: Omit<TabelaCalibracao, 'mensal' | 'leadTime' | 'nivel' | 'formato'>): TabelaCalibracao;
}

export function criarPoolsRef(
  cfg: { minResiduos: number; janelaNivelMeses: number } = {
    minResiduos: PREDITIVO_CONFIG_REF.intervalo.minResiduos,
    janelaNivelMeses: PREDITIVO_CONFIG_REF.correcaoNivel.janelaMeses,
  },
): PoolsRef {
  const fila = new Map<number, Fila>(); // indice do mes de liberacao -> pendentes
  const pools = new Map<string, Pool>();
  const niveisPorMes = new Map<number, SomaNivel>(); // liberado: somas por mes de liberacao
  let liberadoAte: number | null = null;

  const filaDe = (idx: number): Fila => {
    if (liberadoAte !== null && idx <= liberadoAte) throw new Error('liberacao anterior ao ultimo mes ja liberado');
    let f = fila.get(idx);
    if (!f) {
      f = { residuos: [], niveis: [] };
      fila.set(idx, f);
    }
    return f;
  };
  const adicionar = (chave: string, v: number) => {
    const pool = pools.get(chave);
    if (pool) {
      pool.valores.push(v);
      pool.sujo = true;
    } else pools.set(chave, { valores: [v], sujo: true, q10: null, q90: null });
  };
  const quantis = (pool: Pool): Pool => {
    if (pool.sujo) {
      pool.valores.sort(ordemNumerica);
      pool.q10 = quantil(pool.valores, PREDITIVO_CONFIG_REF.intervalo.q10);
      pool.q90 = quantil(pool.valores, PREDITIVO_CONFIG_REF.intervalo.q90);
      pool.sujo = false;
    }
    return pool;
  };

  const nivelNaJanela = (mesAtual: AnoMes): { n: number; razao: number | null } => {
    const fim = indiceMes(mesAtual);
    let n = 0;
    let real = 0;
    let previsto = 0;
    for (let k = fim - cfg.janelaNivelMeses + 1; k <= fim; k++) {
      const s = niveisPorMes.get(k);
      if (!s) continue;
      n += s.n;
      real += s.real;
      previsto += s.previsto;
    }
    // Sem vendas na janela (real = 0) ou razao que arredonda a 0 na tabela: null (= sem dado; a correcao fica em 1 e a tabela
    // gerada continua legivel por lerTabelaCalibracao, que exige razao > 0 ou null). Backtest, tabela e producao concordam.
    const razao = n > 0 && previsto > 0 ? real / previsto : null;
    return { n, razao: razao !== null && round6(razao) > 0 ? razao : null };
  };

  const escolher = (tipo: 'mensal' | 'lt', celula: string, m: number): { pool: Pool; fonte: 'celula' | 'total' } | null => {
    const c = pools.get(`${tipo}|${celula}|${m}`);
    if (c && c.valores.length >= cfg.minResiduos) return { pool: quantis(c), fonte: 'celula' };
    const t = pools.get(`${tipo}|TOTAL|${m}`);
    if (t && t.valores.length >= cfg.minResiduos) return { pool: quantis(t), fonte: 'total' };
    return null;
  };

  return {
    pendente(r) {
      filaDe(indiceMes(r.liberacao)).residuos.push(r);
    },
    nivelPendente(x) {
      filaDe(indiceMes(x.liberacao)).niveis.push({ real: x.real, previsto: x.previsto });
    },
    liberarAte(mes) {
      const alvo = indiceMes(mes);
      if (liberadoAte !== null && alvo <= liberadoAte) return;
      let k = liberadoAte === null ? (fila.size === 0 ? alvo + 1 : Math.min(...fila.keys())) : liberadoAte + 1;
      for (; k <= alvo; k++) {
        const f = fila.get(k);
        if (!f) continue;
        for (const r of f.residuos) {
          adicionar(`${r.tipo}|${r.celula}|${r.m}`, r.residuo);
          adicionar(`${r.tipo}|TOTAL|${r.m}`, r.residuo);
        }
        if (f.niveis.length > 0) {
          const s: SomaNivel = { n: 0, real: 0, previsto: 0 };
          for (const x of f.niveis) {
            s.n++;
            s.real += x.real;
            s.previsto += x.previsto;
          }
          niveisPorMes.set(k, s);
        }
        fila.delete(k);
      }
      liberadoAte = alvo;
    },
    calibrador(mesAtual) {
      return {
        intervalo(tipo, celula, m) {
          const e = escolher(tipo, celula, m);
          if (e === null || e.pool.q10 === null || e.pool.q90 === null) return null;
          return { q10: e.pool.q10, q90: e.pool.q90, fonte: e.fonte };
        },
        nivel: () => nivelNaJanela(mesAtual),
      };
    },
    paraTabela(meta) {
      const celulas = (tipo: 'mensal' | 'lt'): CelulaCalibracao[] => {
        const saida: CelulaCalibracao[] = [];
        for (const celula of [...CELULAS_SBC, 'TOTAL' as const]) {
          for (let m = 1; m <= 12; m++) {
            const p = pools.get(`${tipo}|${celula}|${m}`);
            if (!p || p.valores.length === 0) continue;
            quantis(p);
            saida.push({ celula, m, n: p.valores.length, q10: round6(p.q10!), q90: round6(p.q90!) });
          }
        }
        return saida;
      };
      const nivel = nivelNaJanela(meta.ultimoMes);
      return {
        formato: PREDITIVO_CONFIG_REF.calibracao.formato,
        versao: meta.versao,
        hashConfig: meta.hashConfig,
        correcaoNivel: meta.correcaoNivel,
        parametros: meta.parametros,
        ultimoMes: meta.ultimoMes,
        mensal: celulas('mensal'),
        leadTime: celulas('lt'),
        nivel: { n: nivel.n, razao: nivel.razao === null ? null : round6(nivel.razao) },
      };
    },
  };
}
