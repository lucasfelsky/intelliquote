import { SIM_FORNECEDORES, type SimFornecedor } from './dados';

// Simulador de score do capitulo "Comparacao e vencedora": as mesmas regras da aba Comparacoes (cada criterio ativo vale ate 1 ponto; 1 ou 2 criterios).
// So ilustra: nenhum dado real passa por aqui.
export type CriterioId = 'preco' | 'pagamento' | 'incoterm' | 'qualidade';

export interface Criterio {
  id: CriterioId;
  // Texto do chip.
  rotulo: string;
  // Nome curto na linha do ranking ("Preço 0,92 · Pagamento 1,00").
  curto: string;
}

export const CRITERIOS: readonly Criterio[] = [
  { id: 'preco', rotulo: 'Preço', curto: 'Preço' },
  { id: 'pagamento', rotulo: 'Condição de pagamento', curto: 'Pagamento' },
  { id: 'incoterm', rotulo: 'Incoterm', curto: 'Incoterm' },
  { id: 'qualidade', rotulo: 'Qualidade', curto: 'Qualidade' },
];

export const MIN_CRITERIOS = 1;
export const MAX_CRITERIOS = 2;
// Padrao da previa aprovada.
export const CRITERIOS_INICIAIS: readonly CriterioId[] = ['preco', 'pagamento'];
export const MENSAGEM_MINIMO = 'Selecione ao menos 1 critério.';
export const MENSAGEM_MAXIMO = 'Selecione no máximo 2 critérios.';
// Nivel maximo de risco do incoterm (EXW 1 ... DDP 5) e nota maxima da qualidade (5 estrelas).
const NIVEL_MAXIMO = 5;
const ESTRELAS_MAXIMAS = 5;

export type Pontos = Record<CriterioId, number>;

export interface LinhaDoRanking {
  fornecedor: SimFornecedor;
  // Pontos por criterio (0 nos criterios desligados).
  pontos: Pontos;
  total: number;
}

export const r2 = (x: number): number => Math.round(x * 100) / 100;

// Numero no formato do manual (pt-BR, casas fixas).
export function formatar(valor: number, casas: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// Ranking: total desc -> menor cesta -> maior prazo -> maior nivel de incoterm (desempate do QuoteComparisonService).
export function calcularRanking(ativos: readonly CriterioId[], fornecedores: readonly SimFornecedor[] = SIM_FORNECEDORES): LinhaDoRanking[] {
  const liga = (id: CriterioId) => ativos.includes(id);
  const menorCesta = Math.min(...fornecedores.map((f) => f.cesta));
  const maiorPrazo = Math.max(...fornecedores.map((f) => f.dias));
  return fornecedores
    .map((fornecedor) => {
      const pontos: Pontos = {
        preco: liga('preco') ? r2(menorCesta / fornecedor.cesta) : 0,
        pagamento: liga('pagamento') ? r2(fornecedor.dias / maiorPrazo) : 0,
        incoterm: liga('incoterm') ? r2(fornecedor.nivel / NIVEL_MAXIMO) : 0,
        qualidade: liga('qualidade') ? r2(fornecedor.qualidade / ESTRELAS_MAXIMAS) : 0,
      };
      return { fornecedor, pontos, total: r2(pontos.preco + pontos.pagamento + pontos.incoterm + pontos.qualidade) };
    })
    .sort((a, b) => b.total - a.total || a.fornecedor.cesta - b.fornecedor.cesta || b.fornecedor.dias - a.fornecedor.dias || b.fornecedor.nivel - a.fornecedor.nivel);
}

export interface Alternancia {
  ativos: readonly CriterioId[];
  // Vazia quando a troca foi aceita.
  mensagem: string;
}

// Liga ou desliga um criterio respeitando o minimo (1) e o maximo (2): fora do limite nada muda e a mensagem explica.
export function alternarCriterio(ativos: readonly CriterioId[], id: CriterioId): Alternancia {
  const ligado = ativos.includes(id);
  if (ligado && ativos.length <= MIN_CRITERIOS) return { ativos, mensagem: MENSAGEM_MINIMO };
  if (!ligado && ativos.length >= MAX_CRITERIOS) return { ativos, mensagem: MENSAGEM_MAXIMO };
  // Mantem a ordem dos chips (nao a ordem dos cliques).
  const proximos = CRITERIOS.map((c) => c.id).filter((c) => (c === id ? !ligado : ativos.includes(c)));
  return { ativos: proximos, mensagem: '' };
}

// Eixo do grafico: 0, meio e maximo (= quantidade de criterios ativos).
export function eixoDoRanking(quantidade: number): { meio: string; maximo: string } {
  return { meio: formatar(quantidade / 2, quantidade === 1 ? 1 : 0), maximo: String(quantidade) };
}

// Largura da barra no viewBox (0 a 1000): os pontos de cada criterio sobre a quantidade de criterios ativos.
export const LARGURA_DA_BARRA = 1000;

export interface Segmento {
  criterio: CriterioId;
  x: number;
  largura: number;
}

export function segmentosDaBarra(pontos: Pontos, ativos: readonly CriterioId[]): Segmento[] {
  const quantidade = ativos.length;
  let x = 0;
  const out: Segmento[] = [];
  for (const { id } of CRITERIOS) {
    if (!ativos.includes(id)) continue;
    const largura = Math.round((pontos[id] / quantidade) * LARGURA_DA_BARRA * 10) / 10;
    out.push({ criterio: id, x, largura });
    x = Math.round((x + largura) * 10) / 10;
  }
  return out;
}
