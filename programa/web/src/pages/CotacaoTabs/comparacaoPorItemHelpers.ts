// Helpers puros da visao "Preco por item" (matriz item x fornecedor) da aba Comparacao.
// Sem React e sem import de VALOR de `@/services/quoteResponses` (so tipos): tudo aqui e testavel em unidade.
// Fonte dos precos: `QuoteResponseItem.unitPrice` (preco no incoterm da proposta; mesma base do total do ranking,
// que soma unitario x quantidade PEDIDA). `incotermPrices` nao entra. O total do rodape vem do backend (offeredPrice).

import type { ComparisonResult, ExcludedComparisonResponse, QuoteResponse } from '@/services/quoteResponses';

// Subconjunto do item da cotacao que a matriz usa (o detalhe da cotacao ja carrega esses campos).
export interface ItemDaCotacao {
  id: number;
  itemCode: string | null;
  productName: string;
  description: string | null;
  quantity: number;
  unit: string;
  targetPrice: number | null;
}

export type CelulaItem =
  | { tipo: 'preco'; unitario: number; qtdCotada: number | null }
  | { tipo: 'indisponivel' }
  | { tipo: 'nao-cotou' };

export interface ColunaMatriz {
  // Identidade composta (resposta:alternativa), igual a `candidateKey` do Ranking. Aqui sempre ":0" (so respostas diretas).
  key: string;
  quoteResponseId: number | null;
  nome: string;
  // Posicao no Ranking (indice em rankedResults + 1; pode pular se uma alternativa via parceiro ocupa uma posicao). null = fora do ranking.
  posicao: number | null;
  foraDoRanking: boolean;
  vencedora: boolean;
  rotuloVencedora: string | null;
  moeda: string | null;
  // Total dos itens do backend (offeredPrice). null = fora do ranking (incompleta).
  total: number | null;
  incoterm: string | null;
  pagamentoDias: number | null;
  leadTimeDias: number | null;
  resposta: QuoteResponse | undefined;
}

export interface ColunasMontadas {
  colunas: ColunaMatriz[];
  // Havia alternativa via parceiro (ranqueada ou fora do ranking) que NAO virou coluna.
  temViaParceiro: boolean;
}

// ---------- Formatacao ----------

// USD -> US$, BRL -> R$, demais ficam com o proprio codigo (mesma regra do Ranking).
export function rotuloMoeda(code: string | null | undefined): string {
  if (!code) return '';
  return code === 'USD' ? 'US$' : code === 'BRL' ? 'R$' : code;
}

// "KG" -> "kg" (como no mock-up).
export function formatarUnidade(unit: string | null | undefined): string {
  return (unit ?? '').trim().toLowerCase();
}

export function formatarNumero(value: number | null | undefined, fractionDigits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatarQuantidade(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR');
}

// Mesmo formato do Ranking: "N dias" ou "—".
export function formatarLeadTime(days: number | null | undefined): string {
  return typeof days === 'number' && days > 0 ? `${days} dias` : '—';
}

// Subtitulo do item: "codigo · descricao" so com as partes presentes; vazio -> sem subtitulo.
export function subtituloDoItem(item: Pick<ItemDaCotacao, 'itemCode' | 'description'>): string {
  return [item.itemCode, item.description]
    .map((parte) => (parte ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}

// ---------- Colunas ----------

function viaParceiro(r: { creditSupportRequestId?: number | null }): boolean {
  return typeof r.creditSupportRequestId === 'number' && r.creditSupportRequestId > 0;
}

// Mesma chave de `candidateKey` (services/quoteResponses); duplicada aqui para nao importar valor do service.
export function chaveCandidato(r: {
  quoteResponseId?: number;
  supplierId: number;
  creditSupportRequestId?: number | null;
}): string {
  return `${r.quoteResponseId ?? 's' + r.supplierId}:${r.creditSupportRequestId ?? 0}`;
}

// Lead time de proposta fora do ranking: maior leadTimeDays entre os itens NAO indisponiveis; sem nenhum, o da resposta.
export function leadTimeDaResposta(resposta: QuoteResponse | undefined): number | null {
  if (!resposta) return null;
  let maior: number | null = null;
  for (const item of resposta.items ?? []) {
    if (item.isUnavailable) continue;
    const dias = item.leadTimeDays;
    if (typeof dias === 'number' && Number.isFinite(dias) && dias > 0 && (maior === null || dias > maior)) maior = dias;
  }
  if (maior !== null) return maior;
  const geral = resposta.leadTimeDays;
  return typeof geral === 'number' && Number.isFinite(geral) && geral > 0 ? geral : null;
}

// Colunas na ordem do Ranking: ranqueadas diretas (posicao = indice + 1 em rankedResults), depois as fora do ranking.
// Alternativas via parceiro nao viram coluna (o preco por item delas nao existe no web).
export function montarColunas({
  rankedResults,
  excluded,
  excludedWinnerKey,
  respostas,
  winnerBadgeLabel,
}: {
  rankedResults: ComparisonResult[];
  excluded: ExcludedComparisonResponse[];
  excludedWinnerKey: string | null;
  respostas: QuoteResponse[];
  winnerBadgeLabel: string;
}): ColunasMontadas {
  const porId = new Map<number, QuoteResponse>();
  for (const r of respostas) porId.set(r.id, r);

  const colunas: ColunaMatriz[] = [];
  let temViaParceiro = false;

  rankedResults.forEach((r, indice) => {
    if (viaParceiro(r)) {
      temViaParceiro = true;
      return;
    }
    const resposta = typeof r.quoteResponseId === 'number' ? porId.get(r.quoteResponseId) : undefined;
    colunas.push({
      key: chaveCandidato(r),
      quoteResponseId: r.quoteResponseId ?? null,
      nome: r.supplier?.name || `Fornecedor #${r.supplierId}`,
      posicao: indice + 1,
      foraDoRanking: false,
      vencedora: r.isWinner,
      rotuloVencedora: r.isWinner ? winnerBadgeLabel : null,
      moeda: resposta?.currency ?? r.currency ?? null,
      total: typeof r.offeredPrice === 'number' && Number.isFinite(r.offeredPrice) ? r.offeredPrice : null,
      incoterm: r.offeredIncoterm ?? null,
      pagamentoDias: typeof r.paymentTermsDays === 'number' ? r.paymentTermsDays : null,
      leadTimeDias: r.leadTimeDays ?? null,
      resposta,
    });
  });

  for (const entry of excluded) {
    if (viaParceiro(entry)) {
      temViaParceiro = true;
      continue;
    }
    const resposta = porId.get(entry.quoteResponseId);
    const chave = chaveCandidato(entry);
    const vencedora = excludedWinnerKey !== null && chave === excludedWinnerKey;
    colunas.push({
      key: chave,
      quoteResponseId: entry.quoteResponseId,
      nome: entry.supplier?.name || `Fornecedor #${entry.supplierId}`,
      posicao: null,
      foraDoRanking: true,
      vencedora,
      rotuloVencedora: vencedora ? winnerBadgeLabel : null,
      moeda: resposta?.currency ?? null,
      total: null,
      incoterm: resposta?.offeredIncoterm ?? null,
      pagamentoDias: typeof resposta?.paymentTermsDays === 'number' ? resposta.paymentTermsDays : null,
      leadTimeDias: leadTimeDaResposta(resposta),
      resposta,
    });
  }

  return { colunas, temViaParceiro };
}

// Moeda de referencia = moeda da 1a coluna que a conhece (ranqueada primeiro). O backend so ranqueia propostas na mesma moeda.
export function moedaDeReferencia(colunas: ColunaMatriz[]): string | null {
  for (const coluna of colunas) if (coluna.moeda) return coluna.moeda;
  return null;
}

export function emMoedaDeReferencia(coluna: ColunaMatriz, moedaRef: string | null): boolean {
  return moedaRef !== null && coluna.moeda === moedaRef;
}

// ---------- Celulas ----------

// Celula do item na proposta: preco, indisponivel ou nao cotou. Item duplicado na resposta: vale a primeira ocorrencia.
export function celulaDoItem(
  resposta: Pick<QuoteResponse, 'items'> | undefined,
  item: Pick<ItemDaCotacao, 'id' | 'quantity'>,
): CelulaItem {
  const linha = resposta?.items?.find((i) => i.quoteRequestItemId === item.id);
  if (!linha) return { tipo: 'nao-cotou' };
  if (linha.isUnavailable) return { tipo: 'indisponivel' };
  const unitario = linha.unitPrice;
  if (typeof unitario !== 'number' || !Number.isFinite(unitario) || unitario <= 0) return { tipo: 'nao-cotou' };
  const qtd = linha.quantity;
  const divergente = typeof qtd === 'number' && Number.isFinite(qtd) && qtd !== item.quantity;
  return { tipo: 'preco', unitario, qtdCotada: divergente ? qtd : null };
}

// Matriz de celulas: [indice do item][indice da coluna].
export function calcularCelulas(itens: ItemDaCotacao[], colunas: ColunaMatriz[]): CelulaItem[][] {
  return itens.map((item) => colunas.map((coluna) => celulaDoItem(coluna.resposta, item)));
}

// Menor valor positivo e finito (ignora null/undefined/NaN).
export function menorPorLinha(precos: ReadonlyArray<number | null | undefined>): number | null {
  let menor: number | null = null;
  for (const p of precos) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) continue;
    if (menor === null || p < menor) menor = p;
  }
  return menor;
}

// Precos da linha que concorrem ao "menor": so celulas com preco, em colunas na moeda de referencia.
export function precosDaLinha(
  celulasDaLinha: CelulaItem[],
  colunas: ColunaMatriz[],
  moedaRef: string | null,
): Array<number | null> {
  return celulasDaLinha.map((celula, c) => {
    const coluna = colunas[c];
    if (!coluna || !emMoedaDeReferencia(coluna, moedaRef)) return null;
    return celula.tipo === 'preco' ? celula.unitario : null;
  });
}

// (p / menor - 1) x 100.
export function deltaPercentual(preco: number, menor: number): number {
  return (preco / menor - 1) * 100;
}

// Chaves das colunas ranqueadas com o menor total (empates incluidos). Fora do ranking nao tem total.
export function menoresTotais(colunas: ColunaMatriz[]): Set<string> {
  const totais = colunas.filter((c) => !c.foraDoRanking && c.total !== null).map((c) => c.total as number);
  const menor = menorPorLinha(totais);
  const chaves = new Set<string>();
  if (menor === null) return chaves;
  for (const c of colunas) if (!c.foraDoRanking && c.total === menor) chaves.add(c.key);
  return chaves;
}

// "Menor preco em N de M": em quantos itens a coluna tem (ou empata) o menor preco. Coluna em outra moeda -> null.
export function contarMenores(
  celulas: CelulaItem[][],
  colunas: ColunaMatriz[],
  moedaRef: string | null,
): Map<string, number | null> {
  const contagem = new Map<string, number | null>();
  for (const coluna of colunas) contagem.set(coluna.key, emMoedaDeReferencia(coluna, moedaRef) ? 0 : null);
  for (const linha of celulas) {
    const precos = precosDaLinha(linha, colunas, moedaRef);
    const menor = menorPorLinha(precos);
    if (menor === null) continue;
    precos.forEach((p, c) => {
      const coluna = colunas[c];
      if (coluna && p === menor) contagem.set(coluna.key, (contagem.get(coluna.key) ?? 0) + 1);
    });
  }
  return contagem;
}

export interface SimulacaoMenorPorItem {
  // Σ menor_i x quantidade pedida_i, arredondada a centavos. null quando algum item nao tem preco em nenhuma coluna.
  soma: number | null;
  // Fornecedores distintos escolhidos (desempate de cada item pela ordem das colunas: a mais bem ranqueada leva).
  fornecedores: number;
  itensSemPreco: string[];
}

export function simularMenorPorItem(
  itens: ItemDaCotacao[],
  colunas: ColunaMatriz[],
  moedaRef: string | null,
): SimulacaoMenorPorItem {
  const celulas = calcularCelulas(itens, colunas);
  const escolhidos = new Set<string>();
  const itensSemPreco: string[] = [];
  let soma = 0;
  itens.forEach((item, i) => {
    const precos = precosDaLinha(celulas[i] ?? [], colunas, moedaRef);
    const menor = menorPorLinha(precos);
    if (menor === null) {
      itensSemPreco.push(item.productName || `Item ${item.id}`);
      return;
    }
    const indice = precos.findIndex((p) => p === menor);
    const dona = colunas[indice];
    if (dona) escolhidos.add(dona.key);
    soma += menor * item.quantity;
  });
  return {
    soma: itensSemPreco.length > 0 ? null : Math.round(soma * 100) / 100,
    fornecedores: escolhidos.size,
    itensSemPreco,
  };
}
