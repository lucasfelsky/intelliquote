import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import { sendAndLog } from '../mailer/MailerService';
import {
  SUPPLIER_DOCUMENT_EXPIRY_TEMPLATE_KEY,
  renderSupplierDocumentExpiry,
  type SupplierDocumentExpiryRow,
} from '../mailer/renderSupplierDocumentExpiry';
import { SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS } from '../constants/supplierDocuments';
import {
  addDaysToKey,
  dateKeyToDbDate,
  daysUntil,
  dbDateToKey,
  resolveMilestone,
  todayKeyInSaoPaulo,
  type SupplierDocumentAlertMilestone,
} from '../utils/supplierDocumentDates';
import { AuditLogService } from './AuditLogService';
import { loadComexCc } from './CreditSupportService';

// Claim com mais de 15 min = execucao morta (o attempt-deadline do Scheduler e o
// timeout do Cloud Run sao 300 s, entao um run vivo nunca tem claim "orfao").
export const ALERT_ORPHAN_MINUTES = 15;
export const ALERT_RUN_ENTITY_TYPE = 'supplier_document_alert_run';

const AUDIT_ENTITY_TYPE = 'supplier_document';

export type SupplierDocumentAlertOutcome =
  | 'sent'
  | 'nothing_due'
  | 'already_claimed'
  | 'in_progress'
  | 'no_recipients'
  | 'send_failed';

export interface SupplierDocumentAlertSweepResult {
  outcome: SupplierDocumentAlertOutcome;
  /** Documentos incluidos no e-mail (sent/send_failed) ou 0. */
  documents: number;
  releasedOrphans: number;
  recoveredOrphans: number;
  /** Marcos pendentes bloqueados por claim vivo (< 15 min) de OUTRA execucao. */
  inFlight: number;
}

interface PendingAlert extends SupplierDocumentExpiryRow {
  alertCycle: number;
}

function alertKey(a: { documentId: number; alertCycle: number; milestone: string }): string {
  return `${a.documentId}:${a.alertCycle}:${a.milestone}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// PR2 Documentos do fornecedor: 1 e-mail agrupado por execucao para a equipe COMEX com os
// documentos que atingiram um marco (D30, D15, D7, D0, EXPIRED). Idempotencia por claim:
// SupplierDocumentAlert (documento, ciclo, marco) com create + P2002. Falha de envio
// libera os claims do run (o Scheduler repete); falha DEPOIS do envio nunca libera.
// Catch-up: um documento vencido ha muito tempo recebe EXPIRED uma unica vez.
export class SupplierDocumentAlertService {
  static async runExpiryAlertSweep(now: Date = new Date()): Promise<SupplierDocumentAlertSweepResult> {
    const runId = randomUUID();
    const todayKey = todayKeyInSaoPaulo(now);
    const cutoff = new Date(now.getTime() - ALERT_ORPHAN_MINUTES * 60 * 1000);

    const { releasedOrphans, recoveredOrphans } = await this.settleOrphans(now, cutoff);
    let inFlight = 0;
    const finish = (outcome: SupplierDocumentAlertOutcome, documents = 0): SupplierDocumentAlertSweepResult => ({
      outcome,
      documents,
      releasedOrphans,
      recoveredOrphans,
      inFlight,
    });

    const candidates = await prisma.supplierDocument.findMany({
      where: {
        deletedAt: null,
        supplier: { deletedAt: null, status: 'active' },
        expiresOn: {
          lte: dateKeyToDbDate(addDaysToKey(todayKey, SUPPLIER_DOCUMENT_EXPIRING_WINDOW_DAYS)),
        },
      },
      select: {
        id: true,
        name: true,
        expiresOn: true,
        alertCycle: true,
        supplier: { select: { id: true, name: true } },
      },
    });

    const due: PendingAlert[] = [];
    for (const doc of candidates) {
      const expiresOn = dbDateToKey(doc.expiresOn);
      const daysLeft = daysUntil(expiresOn, todayKey);
      const milestone = resolveMilestone(daysLeft);
      if (!milestone) continue;
      due.push({
        documentId: doc.id,
        documentName: doc.name,
        supplierId: doc.supplier.id,
        supplierName: doc.supplier.name,
        expiresOn,
        daysLeft,
        milestone,
        alertCycle: doc.alertCycle,
      });
    }

    // Pre-filtro em memoria: evita um P2002 por documento por dia. Chave `sent` = descartada;
    // chave `claimed` (so sobra claim < 15 min, os orfaos ja foram tratados) = em andamento
    // por outra execucao (inFlight), o que NAO pode virar 200 "nada a fazer". A corrida
    // continua coberta pelo P2002 do claim.
    let pending = due;
    if (due.length > 0) {
      const existing = await prisma.supplierDocumentAlert.findMany({
        where: { documentId: { in: due.map((d) => d.documentId) } },
        select: { documentId: true, alertCycle: true, milestone: true, status: true },
      });
      const statusByKey = new Map(existing.map((a) => [alertKey(a), a.status]));
      pending = [];
      for (const d of due) {
        const status = statusByKey.get(alertKey(d));
        if (status === undefined) {
          pending.push(d);
        } else if (status !== 'sent') {
          inFlight += 1;
        }
      }
    }

    if (pending.length === 0) {
      if (inFlight > 0) {
        logger.warn({ runId, inFlight }, 'Avisos de vencimento de documentos: outra execucao em andamento.');
        return finish('in_progress');
      }
      logger.info({ runId, candidates: candidates.length }, 'Avisos de vencimento de documentos: nada a enviar.');
      return finish('nothing_due');
    }

    // Destinatarios so sao carregados quando ha marco pendente (sem warn diario a toa).
    const recipients = await loadComexCc();
    if (recipients.length === 0) {
      logger.warn(
        { runId, pending: pending.length },
        'Avisos de vencimento de documentos sem destinatarios: lista COMEX vazia (INTELLIQUOTE_COMEX_CC_LIST + Empresa > copia do envio).',
      );
      return finish('no_recipients');
    }

    const claimed: PendingAlert[] = [];
    const conflicts: PendingAlert[] = [];
    for (const alert of pending) {
      try {
        await prisma.supplierDocumentAlert.create({
          data: {
            documentId: alert.documentId,
            alertCycle: alert.alertCycle,
            milestone: alert.milestone,
            status: 'claimed',
            runId,
            claimedAt: now,
          },
        });
        claimed.push(alert);
      } catch (error) {
        if (isUniqueViolation(error)) {
          conflicts.push(alert);
          continue;
        }
        await this.releaseRunClaims(runId);
        throw error;
      }
    }

    if (conflicts.length > 0) {
      // P2002: outra execucao/instancia ja tem a linha. Se ainda esta `claimed` (ou sumiu no
      // meio), o marco ainda nao foi entregue: conta como em andamento (inFlight).
      try {
        const rows = await prisma.supplierDocumentAlert.findMany({
          where: { documentId: { in: conflicts.map((c) => c.documentId) } },
          select: { documentId: true, alertCycle: true, milestone: true, status: true },
        });
        const statusByKey = new Map(rows.map((a) => [alertKey(a), a.status]));
        for (const conflict of conflicts) {
          if (statusByKey.get(alertKey(conflict)) !== 'sent') inFlight += 1;
        }
      } catch (error) {
        await this.releaseRunClaims(runId);
        throw error;
      }
    }

    if (claimed.length === 0) {
      return finish(inFlight > 0 ? 'in_progress' : 'already_claimed');
    }

    let delivered = false;
    try {
      const rendered = renderSupplierDocumentExpiry({
        rows: claimed,
        webBaseUrl: mailerEnv.portalUrl.replace(/\/+$/, ''),
      });
      const [to, ...cc] = recipients;
      const milestones: Record<SupplierDocumentAlertMilestone, number> = {
        D30: 0,
        D15: 0,
        D7: 0,
        D0: 0,
        EXPIRED: 0,
      };
      for (const alert of claimed) milestones[alert.milestone] += 1;

      const delivery = await sendAndLog({
        to: { email: to.email, name: to.name || undefined },
        ...(cc.length > 0 ? { cc: cc.map((c) => ({ email: c.email, name: c.name || undefined })) } : {}),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: SUPPLIER_DOCUMENT_EXPIRY_TEMPLATE_KEY,
        templateVars: { runId, documentIds: claimed.map((a) => a.documentId), milestones },
        relatedEntityType: ALERT_RUN_ENTITY_TYPE,
        relatedEntityId: runId,
      });
      delivered = delivery.status === 'sent';
      if (!delivered) {
        logger.error(
          { runId, status: delivery.status, error: delivery.error },
          'Aviso de vencimento de documentos nao enviado; claims liberados para nova tentativa.',
        );
      }
    } catch (error) {
      logger.error(
        { runId, error: errorMessage(error) },
        'Falha ao enviar o aviso de vencimento de documentos; claims liberados para nova tentativa.',
      );
    }

    if (!delivered) {
      await this.releaseRunClaims(runId);
      return finish('send_failed', claimed.length);
    }

    // Daqui em diante o e-mail JA saiu: nunca apagar claim nem falhar a execucao.
    try {
      await prisma.supplierDocumentAlert.updateMany({
        where: { runId, status: 'claimed' },
        data: { status: 'sent', sentAt: now },
      });
      for (const alert of claimed) {
        await AuditLogService.log({
          entityType: AUDIT_ENTITY_TYPE,
          entityId: alert.documentId,
          action: 'expiry_alert_sent',
          performedById: null,
          metadata: {
            milestone: alert.milestone,
            alertCycle: alert.alertCycle,
            runId,
            expiresOn: alert.expiresOn,
          },
        });
      }
    } catch (error) {
      logger.error(
        { runId, error: errorMessage(error) },
        'Aviso de vencimento enviado, mas falhou ao registrar o pos-envio (claims mantidos).',
      );
    }

    if (inFlight > 0) {
      logger.warn(
        { runId, inFlight },
        'Aviso de vencimento enviado; outros marcos seguem em andamento em outra execucao.',
      );
    }
    return finish('sent', claimed.length);
  }

  // Claims "claimed" ha mais de 15 min = execucao morta. Se o MailLog do run mostra
  // envio, marca como sent (evita reenvio); senao apaga e o marco volta a ser elegivel.
  private static async settleOrphans(
    now: Date,
    cutoff: Date,
  ): Promise<{ releasedOrphans: number; recoveredOrphans: number }> {
    const orphanRows = await prisma.supplierDocumentAlert.findMany({
      where: { status: 'claimed', claimedAt: { lt: cutoff } },
      select: { runId: true },
    });
    let releasedOrphans = 0;
    let recoveredOrphans = 0;
    for (const orphanRunId of [...new Set(orphanRows.map((row) => row.runId))]) {
      const log = await prisma.mailLog.findFirst({
        where: {
          templateId: SUPPLIER_DOCUMENT_EXPIRY_TEMPLATE_KEY,
          relatedEntityType: ALERT_RUN_ENTITY_TYPE,
          relatedEntityId: orphanRunId,
          status: 'sent',
        },
        select: { sentAt: true },
      });
      if (log) {
        await prisma.supplierDocumentAlert.updateMany({
          where: { runId: orphanRunId, status: 'claimed' },
          data: { status: 'sent', sentAt: log.sentAt ?? now },
        });
        recoveredOrphans += 1;
      } else {
        await prisma.supplierDocumentAlert.deleteMany({
          where: { runId: orphanRunId, status: 'claimed', claimedAt: { lt: cutoff } },
        });
        releasedOrphans += 1;
      }
    }
    return { releasedOrphans, recoveredOrphans };
  }

  // Se a liberacao falhar so loga: o claim vira orfao e e liberado em 15 min.
  private static async releaseRunClaims(runId: string): Promise<void> {
    try {
      await prisma.supplierDocumentAlert.deleteMany({ where: { runId, status: 'claimed' } });
    } catch (error) {
      logger.error(
        { runId, error: errorMessage(error) },
        'Falha ao liberar os claims do aviso de vencimento; serao liberados como orfaos.',
      );
    }
  }
}
