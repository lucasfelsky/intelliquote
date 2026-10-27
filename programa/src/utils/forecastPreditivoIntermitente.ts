// Forecast preditivo (fase 0): demanda intermitente. Croston e SBA (Syntetos-Boylan: Croston x (1 - alfa / 2)).
// Meses mascarados saem da sequencia (nao contam no intervalo entre vendas).
import { escolherMenorSse, montarResultado, validarAntes } from './forecastPreditivoBaselines';
import { PREDITIVO_CONFIG as C } from './forecastPreditivoTipos';
import type { Metodo, SerieNormalizada } from './forecastPreditivoTipos';

// 1a venda na posicao k (1-based) da sequencia: tamanho = y_k, intervalo = k. A cada venda seguinte, com distancia d da
// anterior, ambos sao suavizados com alfa. SSE = erros de 1 passo (y_t - tamanho / intervalo) apos a 1a venda.
// null com menos de 2 vendas.
export function crostonEstado(
  valores: number[],
  mascara: boolean[],
  alfa: number,
  minimoVendas: number = C.minimoVendas.croston,
): { tamanho: number; intervalo: number; sse: number } | null {
  const seq = valores.filter((_, i) => !mascara[i]);
  const k = seq.findIndex((v) => v > 0);
  if (k < 0 || seq.filter((v) => v > 0).length < minimoVendas) return null;
  let tamanho = seq[k];
  let intervalo = k + 1;
  let ultima = k;
  let sse = 0;
  for (let t = k + 1; t < seq.length; t++) {
    const erro = seq[t] - tamanho / intervalo;
    sse += erro * erro;
    if (seq[t] > 0) {
      tamanho = alfa * seq[t] + (1 - alfa) * tamanho;
      intervalo = alfa * (t - ultima) + (1 - alfa) * intervalo;
      ultima = t;
    }
  }
  return { tamanho, intervalo, sse };
}

function melhorCroston(s: SerieNormalizada, id: 'croston' | 'sba'): { alfa: number; taxa: number } | null {
  const candidatos: { alfa: number; taxa: number; sse: number }[] = [];
  for (const alfa of C.gradeCroston.alfa) {
    const e = crostonEstado(s.valores, s.mascara, alfa, C.minimoVendas[id]);
    if (e) candidatos.push({ alfa, taxa: e.tamanho / e.intervalo, sse: e.sse });
  }
  return candidatos.length === 0 ? null : escolherMenorSse(candidatos);
}

function intermitente(id: 'croston' | 'sba'): Metodo {
  return (s, o) => {
    const invalido = validarAntes(s, o, id, 0);
    if (invalido) return invalido;
    const m = melhorCroston(s, id);
    if (!m) return { ok: false, metodo: id, motivo: 'historico-curto' };
    const valor = id === 'sba' ? (1 - m.alfa / 2) * m.taxa : m.taxa;
    return montarResultado(s, id, new Array<number>(o.horizonte).fill(valor), [], { alfa: m.alfa });
  };
}

export const METODOS_INTERMITENTE: Readonly<Record<'croston' | 'sba', Metodo>> = {
  croston: intermitente('croston'),
  sba: intermitente('sba'),
};
