import { Prisma } from '@prisma/client';

// Regras puras das cotacoes do IQ Indent (PR 3): referencia, maquina de estados, total e parse de preco.
// A maquina de estados mora AQUI (fonte unica): o workflow valida com ela e a tela le `allowedActions` do backend.

export type IndentQuoteStatusName = 'RASCUNHO' | 'ENVIADA' | 'RESPONDIDA' | 'ACEITA' | 'RECUSADA' | 'REVISADA';
export type IndentQuoteAction = 'mark-sent' | 'items' | 'response' | 'accept' | 'refuse' | 'revision';

export const QUOTE_STATUS_LABEL: Record<IndentQuoteStatusName, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  RESPONDIDA: 'Respondida',
  ACEITA: 'Aceita',
  RECUSADA: 'Recusada',
  REVISADA: 'Revisada',
};

export const QUOTE_ACTION_LABEL: Record<IndentQuoteAction, string> = {
  'mark-sent': 'marcar como enviada',
  items: 'incluir itens',
  response: 'registrar a resposta',
  accept: 'aceitar',
  refuse: 'recusar',
  revision: 'pedir revisão',
};

/** Estados em que cada acao e permitida (coluna "De" da maquina de estados). */
export const QUOTE_TRANSITIONS: Record<IndentQuoteAction, readonly IndentQuoteStatusName[]> = {
  'mark-sent': ['RASCUNHO'],
  items: ['RASCUNHO'],
  response: ['ENVIADA'],
  accept: ['RESPONDIDA'],
  refuse: ['RESPONDIDA'],
  revision: ['RESPONDIDA'],
};

/** Depois que UMA cotacao da solicitacao foi aceita, estas acoes ficam bloqueadas nas demais (aceite unico). */
export const ACTIONS_BLOCKED_AFTER_ACCEPT: readonly IndentQuoteAction[] = ['mark-sent', 'items', 'accept', 'revision'];

const ALL_ACTIONS: readonly IndentQuoteAction[] = ['mark-sent', 'items', 'response', 'accept', 'refuse', 'revision'];

/** RASCUNHO e ENVIADA: cotacao ainda em aberto (sem resposta registrada). */
export function isOpenQuote(status: string): boolean {
  return status === 'RASCUNHO' || status === 'ENVIADA';
}

/** `revision = 1` -> `NNN/AA`; `revision = n > 1` -> `R<n> - NNN/AA`. */
export function formatQuoteRef(processNumber: string, revision: number): string {
  return revision > 1 ? `R${revision} - ${processNumber}` : processNumber;
}

/**
 * Acoes que a tela pode oferecer (e que o backend aceita) para a cotacao. Sem escrita (viewer) ou com a solicitacao perdida: nenhuma.
 * `hasAcceptedInRequest`: a solicitacao ja tem uma cotacao ACEITA (qualquer uma, inclusive esta).
 */
export function allowedQuoteActions(
  status: string,
  canWrite: boolean,
  requestStatus: string,
  hasAcceptedInRequest: boolean,
): IndentQuoteAction[] {
  if (!canWrite || requestStatus === 'PERDIDA') {
    return [];
  }

  return ALL_ACTIONS.filter((action) => {
    if (!(QUOTE_TRANSITIONS[action] as readonly string[]).includes(status)) {
      return false;
    }
    return !(hasAcceptedInRequest && ACTIONS_BLOCKED_AFTER_ACCEPT.includes(action));
  });
}

type DecimalInput = Prisma.Decimal | string | number;

/**
 * Total estimado = soma de quantidade x CFR por kg dos itens com CFR (igual a `cotTotal` do mock). Sempre em Decimal; devolve
 * string com 2 casas, ou `null` quando nenhum item tem CFR.
 */
export function computeQuoteTotal(
  items: Array<{ quantityKg: DecimalInput; cfrPricePerKg: DecimalInput | null | undefined }>,
): string | null {
  let total = new Prisma.Decimal(0);
  let any = false;

  for (const item of items) {
    if (item.cfrPricePerKg === null || item.cfrPricePerKg === undefined) {
      continue;
    }
    total = total.plus(new Prisma.Decimal(item.quantityKg).times(new Prisma.Decimal(item.cfrPricePerKg)));
    any = true;
  }

  return any ? total.toFixed(2) : null;
}

const PRICE_PATTERN = /^\d{1,5}(\.\d{1,4})?$/;

/** Preco por kg digitado: string decimal com ponto, ate 5 inteiros e 4 casas, > 0. `null` quando invalido. */
export function parsePricePerKg(text: unknown): Prisma.Decimal | null {
  if (typeof text !== 'string' || !PRICE_PATTERN.test(text)) {
    return null;
  }
  const value = new Prisma.Decimal(text);
  return value.greaterThan(0) ? value : null;
}
