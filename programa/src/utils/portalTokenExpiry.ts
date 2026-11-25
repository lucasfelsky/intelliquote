import { todayKeyInSaoPaulo } from './supplierDocumentDates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TokenExpirySource = 'deadline' | 'ttl';

/**
 * Fim do dia (23:59:59.999) no calendario de Sao Paulo da data informada.
 * Offset fixo -03:00 (Brasil sem horario de verao desde 2019), mesmo padrao de
 * IndentQuoteWorkflowService/IndentRequestService.
 */
export function endOfDayInSaoPaulo(date: Date): Date {
  return new Date(`${todayKeyInSaoPaulo(date)}T23:59:59.999-03:00`);
}

/**
 * Validade do link do portal do fornecedor. Quando a cotacao tem prazo
 * (deadlineAt) e o fim do dia BRT dele ainda esta no futuro, o link vale ate
 * esse instante (source 'deadline'). Sem prazo, ou com prazo ja vencido, cai no
 * TTL em dias (source 'ttl'). Funcao unica usada por todos os pontos que criam
 * SupplierPortalToken de cotacao.
 */
export function computeTokenExpiry(
  quoteRequest: { deadlineAt: Date | null | undefined },
  ttlDays: number,
  now: Date = new Date(),
): { expiresAt: Date; source: TokenExpirySource } {
  if (quoteRequest.deadlineAt) {
    const endOfDay = endOfDayInSaoPaulo(quoteRequest.deadlineAt);
    if (endOfDay.getTime() > now.getTime()) {
      return { expiresAt: endOfDay, source: 'deadline' };
    }
  }
  return { expiresAt: new Date(now.getTime() + ttlDays * MS_PER_DAY), source: 'ttl' };
}
