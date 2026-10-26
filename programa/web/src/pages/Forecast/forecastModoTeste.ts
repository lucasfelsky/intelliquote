import type { ForecastImportOptions } from '@/services/forecast';
import { mesAno, NOTA_DBCORP_CONFIRMACAO } from './forecastImport';

/**
 * Opcoes efetivas do modo "Importar como teste": so a quinzena e criada. Desligado devolve a MESMA referencia
 * recebida (as preferencias do usuario nunca sao sobrescritas); nunca muta.
 */
export function opcoesComModoTeste(opcoes: ForecastImportOptions, modoTeste: boolean): ForecastImportOptions {
  return modoTeste ? { atualizarCadastro: false, gravarHistorico: false, criarQuinzena: true } : opcoes;
}

export function textoAvisoModoTeste(rotulo: string, yearMonth: string | null): string {
  const historico = yearMonth ? `o histórico de ${mesAno(yearMonth)}` : 'o histórico de vendas';
  return `Modo teste: o cadastro (produtos, códigos e fontes) e ${historico} não serão alterados. Só a quinzena ${rotulo} será criada; ela ocupa esse rótulo até ser excluída pelo botão “Excluir quinzena”.`;
}

export function textoBloqueioModoTeste(rotulo: string): string {
  return `No modo teste só a quinzena é criada, e a quinzena ${rotulo} já existe: exclua-a pelo botão “Excluir quinzena” ou escolha outra data-base ou quinzena.`;
}

export const NOTA_DBCORP_SEM_TESTE = `“Importar como teste” existe só para a planilha. ${NOTA_DBCORP_CONFIRMACAO}`;

export const NOTA_RESUMO_MODO_TESTE =
  'Modo teste: a tabela abaixo só compara a planilha com o cadastro e o histórico atuais; nada disso será gravado.';
