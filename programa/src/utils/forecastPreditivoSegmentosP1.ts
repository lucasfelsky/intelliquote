// Forecast preditivo (P1a): eixos de segmento novos (classe de lead time, fonte por posto de volume, regra de protecao)
// e ordenacao/rotulo das chaves de segmento. A fonte so aparece como posto (fonte-01..fonte-10, outras, sem-fonte).
import { PREDITIVO_CONFIG_P1, REGRA_IDS, ROTULO_DORMENTE } from './forecastPreditivoConfigP1';
import type { RegraProtecao } from './forecastPreditivoConfigP1';
import type { Segmento } from './forecastPreditivoSegmentos';
import type { SerieNormalizada } from './forecastPreditivoTipos';

export type ClasseLt = '<=60' | '61-90' | '>90' | 'padrao';

// null (lead time nao informado: vale o padrao da opcao) -> 'padrao'.
export function classeLeadTime(leadTimeDias: number | null): ClasseLt {
  if (leadTimeDias === null) return 'padrao';
  if (leadTimeDias <= PREDITIVO_CONFIG_P1.segmentos.ltAte60) return '<=60';
  return leadTimeDias <= PREDITIVO_CONFIG_P1.segmentos.ltAte90 ? '61-90' : '>90';
}

// O lead time pede mais meses do que o horizonte cobre: min(H, n) trunca. n = max(1, ceil(LT / 30)) + 1.
export function leadTimeTruncado(leadTimeDias: number, horizonte: number): boolean {
  return Math.max(1, Math.ceil(leadTimeDias / 30)) + 1 > horizonte;
}

const porTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rotuloPosto = (i: number) => 'fonte-' + String(i + 1).padStart(2, '0');

// nome da fonte -> rotulo, por volume total (soma dos valores) desc, empate pelo nome asc; alem do top, 'outras'.
// Serie sem fonte nao entra no mapa: use rotuloFonteDaSerie.
export function rotulosFonte(series: SerieNormalizada[], top = PREDITIVO_CONFIG_P1.segmentos.topFontes): Map<string, string> {
  const volume = new Map<string, number>();
  for (const s of series) {
    const f = s.meta.fonte;
    if (f === null) continue;
    volume.set(f, (volume.get(f) ?? 0) + s.valores.reduce((a, b) => a + b, 0));
  }
  const ordenadas = [...volume.entries()].sort((a, b) => b[1] - a[1] || porTexto(a[0], b[0]));
  return new Map(ordenadas.map(([f], i) => [f, i < top ? rotuloPosto(i) : 'outras']));
}

export function rotuloFonteDaSerie(s: SerieNormalizada, mapa: Map<string, string>): string {
  return s.meta.fonte === null ? 'sem-fonte' : (mapa.get(s.meta.fonte) ?? 'sem-fonte');
}

export function chavesSegmentoP1(seg: Segmento, classeLt: ClasseLt, rotuloFonte: string, regra: RegraProtecao): string[] {
  return [
    'TOTAL',
    'ABC:' + seg.abc,
    'SBC:' + seg.sbc,
    'XYZ:' + seg.xyz,
    'ABC/SBC:' + seg.abc + '/' + seg.sbc,
    'LT:' + classeLt,
    'FONTE:' + rotuloFonte,
    'REGRA:' + regra,
  ];
}

export const EIXOS_P1: readonly string[] = ['TOTAL', 'ABC', 'SBC', 'XYZ', 'ABC/SBC', 'LT', 'FONTE', 'REGRA'];
const ORDEM_VALORES: Readonly<Record<string, readonly string[]>> = {
  ABC: ['A', 'B', 'C', 'sem-venda'],
  SBC: ['smooth', 'erratic', 'intermittent', 'lumpy', 'insuficiente'],
  XYZ: ['X', 'Y', 'Z', 'n/a'],
  LT: ['<=60', '61-90', '>90', 'padrao'],
  REGRA: REGRA_IDS,
};

function partir(chave: string): { eixo: number; valor: string } {
  const i = chave.indexOf(':');
  const nome = i < 0 ? chave : chave.slice(0, i);
  return { eixo: EIXOS_P1.indexOf(nome), valor: i < 0 ? '' : chave.slice(i + 1) };
}

// Posicao do valor dentro do eixo: ordem declarada; FONTE: fonte-NN (texto), 'outras', 'sem-fonte'; ABC/SBC por texto.
function posicao(eixo: number, valor: string): number {
  const nome = EIXOS_P1[eixo];
  if (nome === 'FONTE') return valor === 'sem-fonte' ? 2 : valor === 'outras' ? 1 : 0;
  const ordem = ORDEM_VALORES[nome];
  if (!ordem) return 0;
  const i = ordem.indexOf(valor);
  return i < 0 ? ordem.length : i;
}

export function ordenarSegmentosP1(chaves: string[]): string[] {
  const info = new Map(chaves.map((c) => [c, partir(c)]));
  return [...chaves].sort((a, b) => {
    const x = info.get(a)!;
    const y = info.get(b)!;
    return x.eixo - y.eixo || posicao(x.eixo, x.valor) - posicao(y.eixo, y.valor) || porTexto(x.valor, y.valor);
  });
}

// 'ABC:sem-venda' -> 'ABC sem venda >=6 meses'; demais 'EIXO valor'; 'TOTAL' fica 'TOTAL'.
export function rotuloSegmento(chave: string): string {
  if (chave === 'ABC:sem-venda') return 'ABC ' + ROTULO_DORMENTE;
  const i = chave.indexOf(':');
  return i < 0 ? chave : chave.slice(0, i) + ' ' + chave.slice(i + 1);
}
