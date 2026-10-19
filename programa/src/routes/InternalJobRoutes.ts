import express, { Router } from 'express';

import { reminderEnv } from '../config/env';
import { logger } from '../lib/logger';
import { requireGoogleOidc } from '../middlewares/googleOidc';
import { ExchangeRateService } from '../services/ExchangeRateService';
import { SupplierPortalReminderService } from '../services/SupplierPortalReminderService';

const router = Router();

// Jobs internos chamados pelo Cloud Scheduler com ID token OIDC. Montado
// ANTES do parser global e das rotas autenticadas (portal/router), por isso
// tem parser proprio (16kb, depois do OIDC) e nao passa por tryFirebaseAuth/requireAuth.
// Os dois jobs sao idempotentes (upsert por moeda+data; claim atomico
// reminderSentAt), entao 5xx -> retry do Scheduler e seguro.
router.use('/api/internal/jobs', requireGoogleOidc(), express.json({ limit: '16kb' }));

const BRT_TIME_ZONE = 'America/Sao_Paulo';

// Data civil (yyyy-MM-dd) e dia da semana em Brasilia, independente do TZ do processo.
function brtToday(now: Date): { dateKey: string; isWeekday: boolean } {
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: BRT_TIME_ZONE, weekday: 'short' }).format(now);
  return { dateKey, isWeekday: weekday !== 'Sat' && weekday !== 'Sun' };
}

router.post('/api/internal/jobs/exchange-rates', async (_req, res) => {
  try {
    const snapshots = await ExchangeRateService.refresh();
    if (snapshots.length === 0) {
      // Nenhuma taxa de fechamento disponivel (boletim ainda nao saiu / BCB fora):
      // 503 para o Scheduler repetir.
      res.status(503).json({ message: 'Nenhuma taxa PTAX obtida do BCB.' });
      return;
    }
    const referenceDate = snapshots.map((s) => s.referenceDate).sort().pop() ?? null;
    const today = brtToday(new Date());
    if (today.isWeekday && referenceDate !== null && referenceDate < today.dateKey) {
      // Dia util e o Fechamento de hoje ainda nao saiu: o upsert gravou o boletim
      // anterior (inofensivo); 503 para o Scheduler repetir. Em feriado os retries
      // esgotam sem efeito colateral.
      logger.warn(
        { referenceDate, today: today.dateKey },
        'Fechamento PTAX do dia ainda indisponivel; Scheduler deve repetir.',
      );
      res.status(503).json({
        message: 'Fechamento PTAX do dia ainda indisponivel.',
        referenceDate,
        today: today.dateKey,
      });
      return;
    }
    res.status(200).json({
      refreshed: snapshots.length,
      currencies: snapshots.map((s) => s.currency),
      referenceDate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Falha no job interno de taxas PTAX.');
    res.status(500).json({ message: 'Falha ao atualizar taxas PTAX.' });
  }
});

router.post('/api/internal/jobs/supplier-reminders', async (_req, res) => {
  if (!reminderEnv.enabled) {
    logger.info({}, 'Job de lembretes pre-deadline DESLIGADO (REMINDER_ENABLED=false).');
    res.status(200).json({ skipped: 'disabled' });
    return;
  }
  try {
    const result = await SupplierPortalReminderService.runReminderSweep();
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Falha no job interno de lembretes pre-deadline.');
    res.status(500).json({ message: 'Falha no sweep de lembretes.' });
  }
});

export { router as internalJobRoutes };
