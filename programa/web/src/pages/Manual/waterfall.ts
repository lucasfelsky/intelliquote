import { WATERFALL } from './dados';
import { r2 } from './simulador';

// Waterfall do landed cost (formulas do QuoteComparisonService, so para ilustrar):
// CIF = preco x cambio + frete + seguro; II = CIF x aliquota; IPI = (CIF + II) x aliquota; PIS/COFINS = CIF x (PIS + COFINS); total = CIF + II + IPI + PIS/COFINS + outras taxas.
export const EIXO = 1000;
// Folga do eixo acima do total, para a barra do total nao encostar na borda.
const FOLGA = 1.04;
// Menor largura (em unidades do eixo) de uma barra: o seguro (R$ 1.200) continua visivel.
const LARGURA_MINIMA = 6;

export interface PassoDoWaterfall {
  chave: string;
  rotulo: string;
  // Onde a barra comeca e quanto ela vale (R$).
  inicio: number;
  valor: number;
  // CIF e Total landed: barras cheias, partindo de 0, destacadas.
  total: boolean;
  // Posicao e largura da barra no eixo 0-1000.
  x: number;
  largura: number;
  // Texto do valor ("+ R$ 18.500,00"; sem "+ " nas barras que partem de 0).
  valorTexto: string;
}

export interface ResultadoDoWaterfall {
  passos: PassoDoWaterfall[];
  cif: number;
  total: number;
  gatilho: number;
  // Posicao da linha do gatilho no eixo 0-1000 e em % da largura do trilho.
  xGatilho: number;
  gatilhoPct: number;
  acimaDoGatilho: boolean;
}

export const moeda = (valor: number): string => `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const arredondar1 = (n: number): number => Math.round(n * 10) / 10;

export function calcularWaterfall(entrada = WATERFALL): ResultadoDoWaterfall {
  const preco = entrada.precoUsd * entrada.cambio;
  const cif = preco + entrada.frete + entrada.seguro;
  const ii = r2(cif * entrada.aliquotaIi);
  const ipi = r2((cif + ii) * entrada.aliquotaIpi);
  const pisCofins = r2(cif * (entrada.aliquotaPis + entrada.aliquotaCofins));
  const total = r2(cif + ii + ipi + pisCofins + entrada.outrasTaxas);
  const maximo = total * FOLGA;
  const bruto: Array<[string, string, number, number, boolean]> = [
    ['proposta', 'Proposta em R$ (43.100 × 5,42)', 0, preco, false],
    ['frete', 'Frete', preco, entrada.frete, false],
    ['seguro', 'Seguro', preco + entrada.frete, entrada.seguro, false],
    ['cif', 'CIF', 0, cif, true],
    ['ii', 'II (12%)', cif, ii, false],
    ['ipi', 'IPI (3,25%)', cif + ii, ipi, false],
    ['pis-cofins', 'PIS + COFINS (11,75%)', cif + ii + ipi, pisCofins, false],
    ['outras', 'Outras taxas', cif + ii + ipi + pisCofins, entrada.outrasTaxas, false],
    ['total', 'Total landed', 0, total, true],
  ];
  const passos = bruto.map(([chave, rotulo, inicio, valor, cheio]) => ({
    chave,
    rotulo,
    inicio,
    valor,
    total: cheio,
    x: arredondar1((inicio / maximo) * EIXO),
    largura: Math.max(arredondar1((valor / maximo) * EIXO), LARGURA_MINIMA),
    valorTexto: `${cheio || inicio === 0 ? '' : '+ '}${moeda(valor)}`,
  }));
  const xGatilho = arredondar1((entrada.gatilho / maximo) * EIXO);
  return { passos, cif, total, gatilho: entrada.gatilho, xGatilho, gatilhoPct: arredondar1((entrada.gatilho / maximo) * 100), acimaDoGatilho: total > entrada.gatilho };
}
