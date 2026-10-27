// Forecast preditivo (fase 0): regras comuns a todos os metodos + baselines (planilha Q/R, ingenuo, sazonal, ponderada).
import { PREDITIVO_CONFIG as C, PREDITIVO_VERSAO, ordenarAvisos } from './forecastPreditivoTipos';
import type { AnoMes, AvisoId, Metodo, MetodoTodosId, OpcoesPrevisao, ResultadoPrevisao, SerieNormalizada } from './forecastPreditivoTipos';
import { somarMeses } from './forecastPreditivoSerie';

type MetodoBaseline = 'planilha-q' | 'planilha-r' | 'ingenuo' | 'ingenuo-sazonal' | 'media-ponderada';

export const origemDe = (s: SerieNormalizada): AnoMes => somarMeses(s.inicio, s.valores.length - 1);

// Monta o resultado: p50 negativo vira 0 (com aviso); nao finito e bug e lanca.
export function montarResultado(
  s: SerieNormalizada,
  metodo: MetodoTodosId,
  p50s: number[],
  avisos: AvisoId[],
  parametros: Record<string, number>,
): ResultadoPrevisao {
  const origem = origemDe(s);
  const extra = new Set<AvisoId>(avisos);
  const pontos = p50s.map((v, i) => {
    if (!Number.isFinite(v)) throw new Error('previsao nao finita');
    if (v < 0) extra.add('previsao-negativa-zerada');
    return { h: i + 1, anoMes: somarMeses(origem, i + 1), p50: v < 0 ? 0 : v + 0 };
  });
  return { ok: true, metodo, versao: PREDITIVO_VERSAO, origem, pontos, avisos: ordenarAvisos(extra), parametros };
}

export function previsaoPlana(
  s: SerieNormalizada,
  o: OpcoesPrevisao,
  metodo: MetodoTodosId,
  valor: number,
  avisos: AvisoId[] = [],
  parametros: Record<string, number> = {},
): ResultadoPrevisao {
  return montarResultado(s, metodo, new Array<number>(o.horizonte).fill(valor), avisos, parametros);
}

// Ordem de validacao comum: horizonte, sem dados, serie toda zero, historico curto. null = pode prever.
export function validarAntes(
  s: SerieNormalizada,
  o: OpcoesPrevisao,
  metodo: MetodoTodosId,
  minimo: number,
): ResultadoPrevisao | null {
  if (!Number.isInteger(o.horizonte) || o.horizonte < 1 || o.horizonte > C.horizonteMax) {
    return { ok: false, metodo, motivo: 'horizonte-invalido' };
  }
  if (s.valores.length === 0) return { ok: false, metodo, motivo: 'sem-dados' };
  if (s.valores.every((v) => v === 0)) return previsaoPlana(s, o, metodo, 0, ['sem-venda']);
  if (s.mascara.filter((m) => !m).length < minimo) return { ok: false, metodo, motivo: 'historico-curto' };
  return null;
}

// Menor SSE; troca so se melhorar alem do empate relativo (empate fica com o primeiro da grade).
export function escolherMenorSse<T extends { sse: number }>(candidatos: T[]): T {
  let melhor = candidatos[0];
  for (let i = 1; i < candidatos.length; i++) {
    if (candidatos[i].sse < melhor.sse - C.empateRelativo * Math.max(1, melhor.sse)) melhor = candidatos[i];
  }
  return melhor;
}

// Media dos nao mascarados nos `ultimos` meses de CALENDARIO (janela fixa). Todos mascarados: media sem mascara +
// semMesValido (espelha mediaSemMeses de forecastEngine.ts).
export function mediaValidos(
  valores: number[],
  mascara: boolean[],
  ultimos: number,
): { media: number; semMesValido: boolean } {
  const n = valores.length;
  const k = Math.min(ultimos, n);
  if (k <= 0) return { media: 0, semMesValido: true };
  let soma = 0;
  let validos = 0;
  let somaTodos = 0;
  for (let i = n - k; i < n; i++) {
    somaTodos += valores[i];
    if (!mascara[i]) {
      soma += valores[i];
      validos++;
    }
  }
  return validos === 0 ? { media: somaTodos / k, semMesValido: true } : { media: soma / validos, semMesValido: false };
}

const planilha = (id: 'planilha-q' | 'planilha-r', janela: number): Metodo => (s, o) => {
  const invalido = validarAntes(s, o, id, C.minimoValidos[id]);
  if (invalido) return invalido;
  const { media, semMesValido } = mediaValidos(s.valores, s.mascara, janela);
  return previsaoPlana(s, o, id, media, semMesValido ? ['sem-mes-valido'] : [], { janela });
};

const ingenuo: Metodo = (s, o) => {
  const invalido = validarAntes(s, o, 'ingenuo', C.minimoValidos.ingenuo);
  if (invalido) return invalido;
  let i = s.valores.length - 1;
  while (i > 0 && s.mascara[i]) i--;
  return previsaoPlana(s, o, 'ingenuo', s.valores[i]);
};

const mediaPonderada: Metodo = (s, o) => {
  const invalido = validarAntes(s, o, 'media-ponderada', C.minimoValidos['media-ponderada']);
  if (invalido) return invalido;
  const n = s.valores.length;
  const pesos = C.pesosPonderada; // pesos[0] = mes mais recente
  let num = 0;
  let den = 0;
  let numTodos = 0;
  let denTodos = 0;
  for (let i = n - pesos.length; i < n; i++) {
    const w = pesos[n - 1 - i];
    numTodos += w * s.valores[i];
    denTodos += w;
    if (!s.mascara[i]) {
      num += w * s.valores[i];
      den += w;
    }
  }
  return den === 0
    ? previsaoPlana(s, o, 'media-ponderada', numTodos / denTodos, ['sem-mes-valido'])
    : previsaoPlana(s, o, 'media-ponderada', num / den);
};

const ingenuoSazonal: Metodo = (s, o) => {
  const invalido = validarAntes(s, o, 'ingenuo-sazonal', C.minimoValidos['ingenuo-sazonal']);
  if (invalido) return invalido;
  const n = s.valores.length;
  const p50s: number[] = [];
  let semMes = false;
  for (let h = 1; h <= o.horizonte; h++) {
    const a = n - 1 + h - 12;
    const b = n - 1 + h - 24;
    if (!s.mascara[a]) p50s.push(s.valores[a]);
    else if (b >= 0 && !s.mascara[b]) p50s.push(s.valores[b]);
    else {
      const m = mediaValidos(s.valores, s.mascara, 12);
      if (m.semMesValido) semMes = true;
      p50s.push(m.media);
    }
  }
  return montarResultado(s, 'ingenuo-sazonal', p50s, semMes ? ['sem-mes-valido'] : [], {});
};

export const METODOS_BASELINE: Readonly<Record<MetodoBaseline, Metodo>> = {
  'planilha-q': planilha('planilha-q', C.janelaQ),
  'planilha-r': planilha('planilha-r', C.janelaR),
  ingenuo,
  'ingenuo-sazonal': ingenuoSazonal,
  'media-ponderada': mediaPonderada,
};
