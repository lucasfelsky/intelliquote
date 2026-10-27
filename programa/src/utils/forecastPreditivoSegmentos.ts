// Forecast preditivo (fase 0): segmentacao ABC (volume), XYZ (variacao) e SBC (Syntetos-Boylan), usando so meses <= `ate`.
import { mediaValidos } from './forecastPreditivoBaselines';
import { cortarAte } from './forecastPreditivoSerie';
import { PREDITIVO_CONFIG as C } from './forecastPreditivoTipos';
import type { AnoMes, SerieNormalizada } from './forecastPreditivoTipos';

export type Abc = 'A' | 'B' | 'C' | 'sem-venda';
export type Xyz = 'X' | 'Y' | 'Z' | 'n/a';
export type Sbc = 'smooth' | 'erratic' | 'intermittent' | 'lumpy' | 'insuficiente';

export interface Segmento {
  abc: Abc;
  xyz: Xyz;
  sbc: Sbc;
}

export function classificarSbc(adi: number, cv2: number): Exclude<Sbc, 'insuficiente'> {
  if (adi <= C.segmentos.adi) return cv2 <= C.segmentos.cv2 ? 'smooth' : 'erratic';
  return cv2 <= C.segmentos.cv2 ? 'intermittent' : 'lumpy';
}

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Desvio padrao populacional / media (CV); o quadrado e o CV2.
function cv(xs: number[]): number {
  const m = media(xs);
  return Math.sqrt(media(xs.map((x) => (x - m) * (x - m)))) / m;
}

function variacao(s: SerieNormalizada): { xyz: Xyz; sbc: Sbc } {
  const janela: number[] = [];
  for (let i = s.valores.length - 1; i >= 0 && janela.length < C.segmentos.janelaVariacao; i--) {
    if (!s.mascara[i]) janela.push(s.valores[i]);
  }
  const vendas = janela.filter((v) => v > 0);
  const xyz: Xyz = vendas.length < 2 ? 'n/a' : cv(vendas) < C.segmentos.xyzX ? 'X' : cv(vendas) <= C.segmentos.xyzY ? 'Y' : 'Z';
  const sbc: Sbc =
    janela.length < 3 || vendas.length < 2
      ? 'insuficiente'
      : classificarSbc(janela.length / vendas.length, cv(vendas) ** 2);
  return { xyz, sbc };
}

export function segmentar(series: SerieNormalizada[], ate: AnoMes): Map<string, Segmento> {
  const cortadas = series.map((s) => ({ id: s.id, s: cortarAte(s, ate) }));
  const volumes = cortadas.map(({ id, s }) => ({
    id,
    volume: s ? mediaValidos(s.valores, s.mascara, C.segmentos.janelaAbc).media : 0,
  }));
  const positivos = volumes
    .filter((v) => v.volume > 0)
    .sort((a, b) => b.volume - a.volume || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = positivos.reduce((t, v) => t + v.volume, 0);
  const abc = new Map<string, Abc>();
  let acumulado = 0;
  for (const v of positivos) {
    abc.set(v.id, acumulado < C.segmentos.abcA * total ? 'A' : acumulado < C.segmentos.abcB * total ? 'B' : 'C');
    acumulado += v.volume;
  }
  const saida = new Map<string, Segmento>();
  for (const { id, s } of cortadas) {
    const { xyz, sbc } = s ? variacao(s) : { xyz: 'n/a' as Xyz, sbc: 'insuficiente' as Sbc };
    saida.set(id, { abc: abc.get(id) ?? 'sem-venda', xyz, sbc });
  }
  return saida;
}
