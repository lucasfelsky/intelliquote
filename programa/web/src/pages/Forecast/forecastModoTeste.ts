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

// Nota da aba DBCorp do admin (antes da previa): o modo teste tambem existe nos relatorios. Segue DIFERENTE de
// `NOTA_DBCORP_CONFIRMACAO` (a do comprador) e sem a frase do atalho, que so aparece apos a previa.
export const NOTA_DBCORP_SEM_TESTE = `Como na planilha, os relatórios DBCorp podem ser importados em modo teste. ${NOTA_DBCORP_CONFIRMACAO}`;

// --- Modo teste dos relatorios DBCorp (PR2 do piloto) ----------------------------------------------------

/** O servidor so aplicou o modo teste se ecoou `modoTeste === true` (backend antigo descarta a chave). */
export function servidorAplicouModoTeste(resposta: { modoTeste?: unknown }): boolean {
  return resposta.modoTeste === true;
}

const historicoDe = (yearMonth: string | null) =>
  yearMonth ? `o histórico de ${mesAno(yearMonth)}` : 'o histórico do mês anterior';

export function textoCaixaModoTesteDbcorp(yearMonth: string | null): string {
  return `Importar como teste (não altera ${historicoDe(yearMonth)} nem os prazos das fontes)`;
}

export const DICA_MODO_TESTE_DBCORP = 'Só cria a quinzena, com o mesmo cálculo; ela pode ser excluída depois.';

export function textoAvisoModoTesteDbcorp(rotulo: string, yearMonth: string | null): string {
  return `Modo teste: ${historicoDe(yearMonth)} e os prazos das fontes não serão alterados. Só a quinzena ${rotulo} será criada, com o mesmo cálculo; ela ocupa esse rótulo até ser excluída pelo botão “Excluir quinzena”. O “Completar cadastro” continua gravando o cadastro na hora.`;
}

export function textoHistoricoModoTeste(yearMonth: string | null): string {
  return `Modo teste: ${historicoDe(yearMonth)} não será substituído; as VENDAS do mês anterior só entram no cálculo desta quinzena.`;
}

export const NOTA_PRAZOS_MODO_TESTE =
  'No modo teste, o prazo usado vale só para esta quinzena: os prazos alterados não viram padrão no modo teste.';

export function textoPadroesNaoGravados(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? 'No modo teste, o prazo alterado de 1 fonte não vira padrão.'
    : `No modo teste, os prazos alterados de ${n} fontes não viram padrão.`;
}

export const NOTA_COMPLETAR_MODO_TESTE =
  'No modo teste, “Completar cadastro” grava o cadastro na hora e isso não é desfeito ao excluir a quinzena de teste.';

export function textoEcoAusente(rotulo: string, yearMonth: string | null): string {
  return `O servidor não confirmou o modo teste: a quinzena ${rotulo} foi gravada como importação normal, ${historicoDe(yearMonth)} foi substituído e os prazos alterados viraram o padrão das fontes. Avise um administrador antes de importar de novo.`;
}

export function textoModoTesteNaoConfirmado(rotulo: string, yearMonth: string | null): string {
  return `A quinzena ${rotulo} foi criada, mas a resposta do servidor não chegou: não foi possível confirmar o modo teste. Confira com um administrador ${historicoDe(yearMonth)} e os prazos das fontes.`;
}

export const NOTA_RESUMO_MODO_TESTE =
  'Modo teste: a tabela abaixo só compara a planilha com o cadastro e o histórico atuais; nada disso será gravado.';
