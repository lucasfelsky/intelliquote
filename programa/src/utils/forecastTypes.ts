// Porte de Forecast-prototipo/src/motor/tipos.ts (mesmos nomes e formato: a fixture carrega sem conversao).
// Tipos do motor do Forecast. Os nomes das colunas seguem a aba FORECAST (MACRO)
// para que a conferência contra a planilha seja direta.

export type StatusCompra = 'nao' | 'cotando' | 'confirmado' | 'po' | 'preco';

export interface Produto {
  linha: number; // linha da planilha (3..340)
  n: number | null; // coluna A
  item: string; // coluna I
  codigos: string[]; // B..H (EMB.1..EMB.7), '' quando vazio
  historico: number[]; // J..N: consumo dos 5 meses mais antigos (vem da quinzena anterior)
  analiseForecast: number | null; // AO: quantidade decidida pelo Comex
  obs: string; // AT
  fonte: string; // AU
  precoFechado: string; // AV
  embalagem: string; // AW
  naoFraciona: string; // AX
  qtdAmostra: string; // AY
  solicitarAmostra: string; // AZ
  status: StatusCompra; // cor da célula do item
}

export interface Lancamento {
  codigo: string;
  qtd: number;
}

export interface LancamentoMensal extends Lancamento {
  mes: string; // "10", "11", "12", "01"...
}

export interface Entradas {
  estoque: Lancamento[]; // aba ESTOQUE (DS9004): A código, E saldo
  vendasMes: Lancamento[]; // VENDAS MENSAL (DS9003, mês anterior)
  vendasAtual: Lancamento[]; // VENDAS ATUAL (DIA 15)
  vendasAnual: Lancamento[]; // VENDAS ANUAL
  programacoes: LancamentoMensal[]; // PROGRAMAÇÕES: A código, D qtd, I mês
  chegadas: LancamentoMensal[]; // CHEGADAS: E código, L qtd, Z mês
  leadtime: { fonte: string; total: number | null }[]; // LEADTIME: A fonte, G total
  margem: { codigo: string; margem: number | null }[]; // MARGEM: A código, B margem
  clientesAtivos: string[]; // CLIENTES ATIVOS: coluna C (um código por linha)
  // Compra em aberto do FUP por código (qualquer linha não CONCLUÍDA). Não é entrada do motor: congelada só para a
  // regra dos pendentes de cadastro (5C). Ausente em quinzena gravada antes do 5C.
  comprasEmAberto?: Lancamento[];
}

export interface Quinzena {
  id: string; // "10-2"
  arquivo: string;
  dataBase: string; // ISO (yyyy-mm-dd)
  mesesConsumo: string[]; // J2..P2
  mesesChegada: string[]; // V2..Z2
  mesesProgramacao: string[]; // AC2..AF2
  produtos: Produto[];
  entradas: Entradas;
  // Valores que o Excel calculou e gravou na planilha, por linha e coluna.
  esperado: Record<string, Record<string, number | string | null>>;
}

// Uma linha calculada, com as mesmas colunas da planilha.
export interface LinhaCalculada {
  linha: number;
  O: number; // venda do mês anterior
  P: number; // venda do mês atual (até o dia 15)
  Q: number; // média trimestral
  R: number; // média semestral
  S: number; // média anual (÷ 11)
  T: number | null; // segurança = Q ÷ 30 × lead time
  U: number; // estoque
  chegadas: number[]; // V..Z
  AA: number | string; // meses de estoque
  programacoes: number[]; // AC..AF
  AG: number; // consumo do mês atual = maior entre Q e P
  projecao: number[]; // AH..AM
  AN: number | null; // demanda
  AQ: number | null; // lead time total (dias)
  AP: string | null; // data de chegada se pedir hoje (ISO)
  AR: number | string; // margem do primeiro código encontrado
  AS: number; // clientes ativos
  // PR 6c: so presente quando a linha tem meses marcados como atipicos. Q/R/AG acima ja sao os valores SEM esses meses;
  // aqui ficam os da planilha (antes/depois). Indices: 0..5 = J..O, 6 = P. `semMesValido`: todos os meses da media
  // estavam marcados, entao Q (ou R) ficou como a planilha (sem divisao por zero).
  mediaAjustada?: { meses: number[]; Q: number; R: number; AG: number; semMesValido: boolean };
}

export const COLUNAS_CONFERIDAS = [
  'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA',
  'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AQ', 'AR', 'AS',
] as const;
export type ColunaConferida = (typeof COLUNAS_CONFERIDAS)[number];
