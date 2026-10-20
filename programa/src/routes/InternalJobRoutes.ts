import express, { Router } from 'express';

import { reminderEnv } from '../config/env';
import { logger } from '../lib/logger';
import { requireGoogleOidc } from '../middlewares/googleOidc';
import { ExchangeRateService } from '../services/ExchangeRateService';
import { SupplierDocumentAlertService } from '../services/SupplierDocumentAlertService';
import { SupplierPortalReminderService } from '../services/SupplierPortalReminderService';

const router = Router();

// Jobs internos chamados pelo Cloud Scheduler com ID token OIDC. Montado
// ANTES do parser global e das rotas autenticadas (portal/router), por isso
// tem parser proprio (16kb, depois do OIDC) e nao passa por tryFirebaseAuth/requireAuth.
// Os jobs sao idempotentes (upsert por moeda+data; claim unico por
// cotacao/contato/dia em SupplierPortalReminder; claim unico por documento/ciclo/marco
// em SupplierDocumentAlert),
// entao 5xx -> retry do Scheduler e seguro.
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
    logger.info({}, 'Job de lembretes diarios DESLIGADO (REMINDER_ENABLED=false).');
    res.status(200).json({ skipped: 'disabled' });
    return;
  }
  try {
    const result = await SupplierPortalReminderService.runReminderSweep();
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Falha no job interno de lembretes diarios.');
    res.status(500).json({ message: 'Falha no sweep de lembretes.' });
  }
});

// Avisos de vencimento de documentos de fornecedor (1 e-mail agrupado para a equipe COMEX).
router.post('/api/internal/jobs/supplier-document-alerts', async (_req, res) => {
  try {
    const result = await SupplierDocumentAlertService.runExpiryAlertSweep(new Date());
    if (result.outcome === 'send_failed') {
      res.status(500).json({
        message: 'Falha ao enviar o aviso de documentos.',
        documents: result.documents,
      });
      return;
    }
    if (result.outcome === 'in_progress') {
      // Outra execucao segura o claim: 503 para o Scheduler repetir (o orfao e recuperado em 15 min).
      res.status(503).json({ message: 'Outra execucao em andamento; tente de novo.', inFlight: result.inFlight });
      return;
    }
    if (result.outcome === 'sent') {
      res.status(200).json({
        sent: 1,
        documents: result.documents,
        releasedOrphans: result.releasedOrphans,
        recoveredOrphans: result.recoveredOrphans,
        inFlight: result.inFlight,
      });
      return;
    }
    res.status(200).json({
      sent: 0,
      documents: 0,
      reason: result.outcome,
      releasedOrphans: result.releasedOrphans,
      recoveredOrphans: result.recoveredOrphans,
      inFlight: result.inFlight,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Falha no job interno de avisos de documentos de fornecedor.');
    res.status(500).json({ message: 'Falha no job de avisos de documentos.' });
  }
});

export { router as internalJobRoutes };
