import cron from 'node-cron';

import { reminderEnv } from '../config/env';
import { SupplierPortalReminderService } from '../services/SupplierPortalReminderService';
import { logger } from './logger';

let scheduled = false;

/**
 * F5: agenda o sweep diario de lembretes pre-deadline (09:00 BRT) para
 * fornecedores que ainda nao responderam e cujo token expira dentro da
 * janela (REMINDER_WINDOW_HOURS, default 48h).
 *
 * Multi-replica (Cloud Run): o cron roda em cada instancia, mas o claim
 * atomico (updateMany reminderSentAt null->now) garante 1 lembrete por
 * token. SEM sweep no startup de proposito — restart/deploy fora de hora
 * nao dispara e-mails; so o horario agendado.
 */
export function startSupplierReminderScheduler(): void {
  if (scheduled) return;
  if (!reminderEnv.enabled) {
    logger.info({}, 'Scheduler de lembretes pre-deadline DESLIGADO (REMINDER_ENABLED=false).');
    return;
  }
  scheduled = true;

  cron.schedule('0 9 * * *', () => {
    void SupplierPortalReminderService.runReminderSweep().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Falha no sweep diario de lembretes pre-deadline.');
    });
  });

  logger.info(
    { schedule: '0 9 * * * America/Sao_Paulo', windowHours: reminderEnv.windowHours },
    'Scheduler de lembretes pre-deadline iniciado.',
  );
}
