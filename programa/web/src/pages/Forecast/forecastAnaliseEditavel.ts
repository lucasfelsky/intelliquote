// Coluna ANALISE FORECAST do painel editavel: regras puras (sem React) de quando a celula edita, como valida e o que envia.
// Modulo proprio: nao depende do editor antigo do relatorio (ForecastDecisaoCompra) nem de forecastDecisaoCampos.
//
// A celula grava a MESMA ForecastPurchaseDecision do relatorio de compras (quantidadeKg por snapshot+produto).
// O status de uma decisao com cotacao e derivado no backend: aqui nunca se muda status/observacao de decisao existente
// (o PUT envia so a quantidade) e a Qtd. final do sistema nao e tocada.
import type { ForecastLinha } from '@/services/forecast';
import {
  cotacaoAbertaDaDecisao,
  FORECAST_DECISAO_KG_MAX,
  type ForecastDecisao,
  type ForecastDecisaoGravada,
  type ForecastDecisaoPut,
} from '@/services/forecastDecisoes';
import { lerKgBr } from '@/services/forecastDemandaComercial';

export type SomenteLeitura = { motivo: string } | null;

/** Numero -> texto do campo: virgula decimal, ate 3 casas, sem separador de milhar (1234,5). */
export function kgParaCampo(n: number): string {
  return n.toFixed(3).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',');
}

export interface QuantidadeValidada {
  erro: string | null;
  /** Sem erro: `null` = campo vazio (apaga a decisao). */
  kg: number | null;
}

/** Valida o texto do campo (espelha o Zod do backend, que revalida). Campo vazio e valido: apaga a decisao. */
export function validarQuantidade(texto: string): QuantidadeValidada {
  const t = texto.trim();
  if (t === '') return { erro: null, kg: null };
  const kg = lerKgBr(t);
  if (t.startsWith('-')) return { erro: 'A quantidade não pode ser negativa.', kg: null };
  if (kg === null) return { erro: 'Informe a quantidade em kg (ex.: 1.600 ou 1600,5).', kg: null };
  if (kg > FORECAST_DECISAO_KG_MAX) return { erro: 'A quantidade aceita no máximo 10.000.000 kg.', kg: null };
  if (!/^\d+(\.\d{1,3})?$/.test(String(kg))) return { erro: 'A quantidade aceita no máximo 3 casas decimais.', kg: null };
  return { erro: null, kg };
}

/**
 * Linha fora da lista de compra: sem falta (AN > 0) ou sem AN. A lista de compra do relatorio so tem item com falta; o
 * backend e quem decide (se o item for da lista, a flag `incluidoManualmente` e ignorada; se nao for candidato, recusa).
 */
export function foraDaListaDeCompra(linha: Pick<ForecastLinha, 'AN'>): boolean {
  return linha.AN === null || linha.AN > 0;
}

/** A decisao existente de item de fora da lista segue como incluida de proposito (o PUT reenvia a flag). */
export function incluiManualmente(linha: Pick<ForecastLinha, 'AN'>, decisao: ForecastDecisao | undefined): boolean {
  return decisao?.incluidoManualmente === true || foraDaListaDeCompra(linha);
}

export const DICA_FORA_DA_LISTA =
  'Item fora da lista de compra (sem falta): ao preencher, ele entra como incluído manualmente e passa a ser candidato a cotação.';

/** Dica da coluna ANALISE FORECAST (balao do icone "i" no titulo; o mesmo texto fica no DOM para leitor de tela). */
export const APOIO_ANALISE_PREENCHER =
  'Clique na célula para preencher a quantidade fechada no forecast. Enter grava, Esc cancela e campo vazio apaga.';
export const APOIO_ANALISE_CANDIDATO =
  'Item fora da lista de compra (sem falta) preenchido passa a ser candidato a cotação. Item já em cotação fica só para leitura.';

export const MOTIVO_SEM_CADASTRO = 'Item fora do cadastro do Forecast: não recebe quantidade fechada.';

/** Por que a celula nao edita (nulo = edita). Papel de leitura e dado de decisoes indisponivel ficam a cargo de quem monta. */
export function somenteLeitura(linha: ForecastLinha, decisao: ForecastDecisao | undefined): SomenteLeitura {
  if (linha.productId === null || linha.productId === undefined) return { motivo: MOTIVO_SEM_CADASTRO };
  const cotacao = cotacaoAbertaDaDecisao(decisao);
  if (cotacao) {
    return {
      motivo: `Quantidade já em cotação (${cotacao.requestCode}): para alterar, ajuste na cotação.`,
    };
  }
  return null;
}

/**
 * Corpo do PUT. `kg` nulo apaga. Decisao existente: so a quantidade (status e observacao ficam como estao no servidor).
 * Decisao nova: o status do item (como o editor antigo). A flag so vai quando o item esta fora da lista.
 */
export function corpoDaGravacao(
  linha: Pick<ForecastLinha, 'AN' | 'status'>,
  decisao: ForecastDecisao | undefined,
  kg: number | null,
): ForecastDecisaoPut {
  if (kg === null) return { quantidadeKg: null };
  const manual = incluiManualmente(linha, decisao) ? { incluidoManualmente: true } : {};
  return decisao ? { quantidadeKg: kg, ...manual } : { quantidadeKg: kg, status: linha.status, ...manual };
}

/** Lista nova com a decisao devolvida pelo PUT no lugar do item (ou sem ele, quando apagada). */
export function aplicarGravacao(
  lista: ForecastDecisao[] | undefined,
  productId: number,
  r: ForecastDecisaoGravada,
): ForecastDecisao[] {
  const resto = (lista ?? []).filter((d) => d.productId !== productId);
  return r.decisao ? [...resto, r.decisao].sort((a, b) => a.productId - b.productId) : resto;
}
