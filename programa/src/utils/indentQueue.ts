import { addDaysToKey, todayKeyInSaoPaulo } from './supplierDocumentDates';

// "Na fila ha" da solicitacao do IQ Indent: dias UTEIS (seg-sex) no calendario de Sao Paulo, sem feriados.

const MAX_DAYS = 3660;

// Copia da regra de isWeekendDateKey (SupplierPortalReminderService): um util nao importa service.
function isWeekendKey(key: string): boolean {
  const day = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Dias uteis estritamente DEPOIS do dia BRT de `stageEnteredAt` ate o dia BRT de `now` (inclusive).
 * Mesmo dia = 0; sexta -> segunda = 1; data futura = 0. `now` e injetavel para os testes.
 */
export function businessDaysSince(stageEnteredAt: Date, now: Date): number {
  const startKey = todayKeyInSaoPaulo(stageEnteredAt);
  const endKey = todayKeyInSaoPaulo(now);
  let count = 0;
  let key = startKey;

  for (let guard = 0; guard < MAX_DAYS; guard += 1) {
    key = addDaysToKey(key, 1);
    if (key > endKey) {
      break;
    }
    if (!isWeekendKey(key)) {
      count += 1;
    }
  }

  return count;
}

export type QueueLevel = 'neutral' | 'warning' | 'danger';

/** <= 1 dia: neutro; 2: "no limite"; > 2: "atrasada". */
export function queueLevel(days: number): QueueLevel {
  if (days > 2) {
    return 'danger';
  }
  return days === 2 ? 'warning' : 'neutral';
}
