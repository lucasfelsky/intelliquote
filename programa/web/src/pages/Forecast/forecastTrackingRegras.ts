import type { ForecastStatus } from '@/services/forecast';
import type { ForecastCotacaoVinculada, ForecastDecisao } from '@/services/forecastDecisoes';
import { dataHoraSp } from './forecastDecisaoCampos';
import { kgBr, STATUS_ROTULO } from './forecastPainel';

// Regras PURAS da Qtd. final fixa, do status automatico e do tracking por linha do relatorio de compras (E7 do relatorio
// enxuto). Sem React e sem HTTP. O status derivado vem do backend (`statusDerivado`, vocabulario T6); aqui so se escolhe
// o que mostrar: rascunho local > status derivado da cotacao vinculada > status congelado da quinzena (itens antigos).

export type StatusDaLinha = ForecastStatus | 'cotacao_criada' | 'rascunho';
export type TomDoStatus = 'muted' | 'info' | 'warning' | 'success';

export const ROTULO_COTACAO_CRIADA = 'Cotação criada';
export const ROTULO_RASCUNHO = 'Rascunho';

/** Mesmos rotulos do STATUS_ROTULO (paridade com o XLSX) + os dois estados novos da tela. */
export function rotuloDoStatus(status: StatusDaLinha): string {
  if (status === 'cotacao_criada') return ROTULO_COTACAO_CRIADA;
  if (status === 'rascunho') return ROTULO_RASCUNHO;
  return STATUS_ROTULO[status] ?? status;
}

const TOM_DO_STATUS: Record<StatusDaLinha, TomDoStatus> = {
  rascunho: 'muted',
  nao: 'muted',
  cotacao_criada: 'info',
  cotando: 'warning',
  confirmado: 'info',
  po: 'success',
  preco: 'muted',
};

/** Status que a cotacao vinculada implica (usado quando o backend antigo nao manda `statusDerivado`). */
export function statusDaCotacaoVinculada(cotacao: ForecastCotacaoVinculada): StatusDaLinha {
  switch (cotacao.statusCotacao) {
    case 'criada':
      return 'cotacao_criada';
    case 'enviada':
      return 'cotando';
    case 'fechada':
      return 'confirmado';
    case 'po_enviada':
      return 'po';
  }
}

export interface StatusExibido {
  origem: 'rascunho' | 'cotacao' | 'congelado';
  status: StatusDaLinha;
  rotulo: string;
  /** `null` = status congelado de sempre (texto simples, como antes da E7); os demais viram selo. */
  tom: TomDoStatus | null;
}

export function statusDaLinha(
  statusCongelado: ForecastStatus,
  decisao: ForecastDecisao | undefined,
  noRascunho: boolean,
): StatusExibido {
  if (noRascunho) return { origem: 'rascunho', status: 'rascunho', rotulo: ROTULO_RASCUNHO, tom: TOM_DO_STATUS.rascunho };
  const cotacao = decisao?.cotacao ?? null;
  if (cotacao) {
    const status: StatusDaLinha = decisao?.statusDerivado ?? statusDaCotacaoVinculada(cotacao);
    return { origem: 'cotacao', status, rotulo: rotuloDoStatus(status), tom: TOM_DO_STATUS[status] ?? 'muted' };
  }
  return { origem: 'congelado', status: statusCongelado, rotulo: rotuloDoStatus(statusCongelado), tom: null };
}

export const LEGENDA_QTD_FINAL = 'Preenchida ao enviar a cotação; atualizada ao fechar com o fornecedor.';
export const TITULO_COLUNA_QTD_FINAL = 'Qtd. final (sistema)';

export interface QtdFinalExibida {
  /** `—` enquanto nao ha envio; depois a quantidade em kg (formato pt-BR). */
  texto: string;
  preenchida: boolean;
  /** Linha discreta sob o valor (so quando ja ha quantidade; a celula vazia explica no pop-up ao passar o mouse). */
  apoio: string | null;
  /** Tooltip: a regra + o momento da ultima atualizacao. */
  dica: string;
}

export function qtdFinalDaLinha(decisao: ForecastDecisao | undefined): QtdFinalExibida {
  const kg = decisao?.finalKg ?? null;
  const cotacao = decisao?.cotacao ?? null;
  const quando = decisao?.finalAt ? dataHoraSp(decisao.finalAt) : '';
  const atualizada = quando ? ` Atualizada em ${quando}.` : '';
  if (kg === null) {
    return {
      texto: '—',
      preenchida: false,
      apoio: null,
      dica: cotacao?.statusCotacao === 'criada'
        ? `${cotacao.requestCode} ainda não foi enviada aos fornecedores. ${LEGENDA_QTD_FINAL}`
        : `${TITULO_COLUNA_QTD_FINAL}: ${LEGENDA_QTD_FINAL}`,
    };
  }
  const fechada = cotacao?.statusCotacao === 'fechada' || cotacao?.statusCotacao === 'po_enviada';
  const dia = quando ? quando.slice(0, 5) : '';
  const base = fechada ? 'após o fechamento' : 'quantidade cotada';
  return {
    texto: kgBr(kg),
    preenchida: true,
    apoio: dia ? `${base} · ${dia}` : base,
    dica: `${TITULO_COLUNA_QTD_FINAL}: ${LEGENDA_QTD_FINAL}${atualizada}`,
  };
}

export const rotaDaCotacao = (id: number): string => `/cotacoes/${id}`;
/** A PO e enviada (e consultada) na aba "Comparações" do detalhe da cotacao: o destino mais direto. */
export const rotaDoPedido = (id: number): string => `/cotacoes/${id}?aba=comparacao`;

export const temPedido = (cotacao: ForecastCotacaoVinculada | null | undefined): boolean => cotacao?.statusCotacao === 'po_enviada';

/** Texto do status da cotacao vinculada (expansor Detalhes). */
export function textoStatusDaCotacao(cotacao: ForecastCotacaoVinculada): string {
  switch (cotacao.statusCotacao) {
    case 'criada':
      return 'criada, ainda não enviada aos fornecedores';
    case 'enviada':
      return 'enviada aos fornecedores';
    case 'fechada':
      return 'fechada com o fornecedor';
    case 'po_enviada':
      return 'fechada, PO enviada';
  }
}
