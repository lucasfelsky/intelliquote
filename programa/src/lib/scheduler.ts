import { ExchangeRateService } from '../services/ExchangeRateService';
import { logger } from './logger';

let started = false;

/**
 * Refresh de taxas PTAX no boot, SOMENTE fora de producao (dev/local continuam
 * com taxa no banco sem depender do Cloud Scheduler).
 *
 * Em producao a atualizacao diaria vem do Cloud Scheduler
 * (POST /api/internal/jobs/exchange-rates), nao de cron dentro do processo:
 * o Cloud Run escala a zero e um cron em memoria so dispara se houver
 * instancia viva no minuto exato. Tambem evita disputar o pool do Prisma
 * durante o cold start.
 */
export function startExchangeRateScheduler(): void {
  if (started) return;
  started = true;

  if (process.env.NODE_ENV === 'production') {
    logger.info({}, 'Refresh PTAX no boot desligado em producao (job via Cloud Scheduler).');
    return;
  }

  // Refresh inicial nao bloqueante.
  void ExchangeRateService.refresh().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Falha no refresh inicial de taxas PTAX.');
  });

  logger.info({}, 'Refresh inicial de taxas PTAX disparado (ambiente nao produtivo).');
}
