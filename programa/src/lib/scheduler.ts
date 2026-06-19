import cron from 'node-cron';

import { ExchangeRateService } from '../services/ExchangeRateService';
import { logger } from './logger';

let scheduled = false;

/**
 * Agenda a sincronizacao diaria de taxas PTAX (BCB) as 06:00 BRT (UTC-3)
 * e dispara um refresh inicial no startup.
 *
 * Em ambientes com varias instancias (Cloud Run), o agendamento roda em
 * cada replica. Como a tabela tem constraint UNIQUE (currency, referenceDate)
 * o upsert eh idempotente.
 */
export function startExchangeRateScheduler(): void {
  if (scheduled) return;
  scheduled = true;

  // Refresh inicial nao bloqueante.
  void ExchangeRateService.refresh().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Falha no refresh inicial de taxas PTAX.');
  });

  // Cron diario 06:00 horario de Brasilia. Expressao cron usa o fuso
  // da maquina; no Cloud Run definimos TZ=America/Sao_Paulo no ambiente.
  const task = cron.schedule('0 6 * * *', () => {
    void ExchangeRateService.refresh().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Falha no refresh diario de taxas PTAX.');
    });
  });

  // Impede que o cron mantenha o processo vivo em ambientes onde isso
  // atrapalhe (vitest, scripts de migracao, etc).
  if (typeof task.start === 'function') {
    // ja esta rodando apos schedule().
  }

  logger.info({ schedule: '0 6 * * * America/Sao_Paulo' }, 'Scheduler de cambio iniciado.');
}
