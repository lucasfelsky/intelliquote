import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { pipedriveEnv, type PipedriveEnv } from '../config/env';
import { logger } from '../lib/logger';
import {
  dealStageEnteredAt,
  findFieldOptions,
  getPipedriveClient,
  PipedriveAuthError,
  PipedriveError,
  PipedriveNotFoundError,
  PipedriveRateLimitError,
  PipedriveUnavailableError,
  readCustomFieldText,
  type PdDeal,
  type PdOrganization,
  type PipedriveClient,
} from '../lib/pipedriveClient';
import { prisma } from '../lib/prisma';
import { isValidCnpj, normalizeCnpj } from '../utils/cnpj';
import { cleanProposedName } from '../utils/commercialItemName';
import { formatProcessNumber } from '../utils/indentProcessNumber';
import { NOTE_MAX_ITEMS, selectItemsNote, type NoteCatalogProduct, type ParsedDealNote } from '../utils/indentPipedriveNote';
import { parseDealTitle, type ParsedDealTitle } from '../utils/indentPipedriveTitle';
import { AuditLogService } from './AuditLogService';
import { IndentIntegrationConfigService } from './IndentIntegrationConfigService';

// Sincronizacao Pipedrive -> IQ Indent (PR 5a.2). SO LEITURA no CRM (o cliente so faz GET); aqui so se escreve em tabelas Indent*.
// Ordem de travas: advisory do negocio -> sequencia do ano (`lockYearAndBump`, mesmo padrao do PR 2). Logs: so ids e contadores.

type SyncSource = 'WEBHOOK' | 'SWEEP' | 'MANUAL';

export type SweepOutcome =
  | 'run_ok'
  | 'in_progress'
  | 'rate_limited'
  | 'budget_low'
  | 'auth_failed'
  | 'config_mismatch'
  | 'not_configured'
  | 'error';

export interface SweepSummary {
  outcome: SweepOutcome;
  processed: number;
  created: number;
  errors: number;
  /** Negocios malformados da lista (sem id/add_time): pulados e somados em `errors` da tela. */
  skipped: number;
  /** Negocios que ficaram para a proxima execucao (orcamento de tempo ou parada antecipada). */
  missed: number;
  stoppedBy: 'time_budget' | null;
  durationMs: number;
}

export interface SweepOptions {
  source: SyncSource;
  /** Orcamento de tempo da execucao: 240 s no job, 50 s no botao "Sincronizar agora". */
  budgetMs: number;
  client?: PipedriveClient;
  env?: PipedriveEnv;
  now?: Date;
  /** Relogio em ms (injetavel nos testes do orcamento de tempo). */
  clock?: () => number;
}

export interface DealOutcome {
  dealId: number;
  /** Resultado principal (o 1o de `results`); `unchanged` = nada relevante mudou. */
  result: string;
  results: string[];
  created: boolean;
  requestId: number | null;
}

export interface ProcessContext {
  source: SyncSource;
  client: PipedriveClient;
  env: PipedriveEnv;
  now: Date;
  pipelineId: number;
  stageId: number;
  /** Caches da execucao (uma chamada por id). */
  cache: {
    owners: Map<number, string | null>;
    orgs: Map<number, PdOrganization | null>;
    dealTypeLabels: Map<string, string> | null;
    catalog: NoteCatalogProduct[] | null;
  };
}

const NOTE_REFRESH_MINUTES = 60;
const LOW_BUDGET_RATIO = 0.1;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_DEPARTED_PER_SWEEP = 100;
const TX_TIMEOUT_MS = 20_000;
const MAX_DESCRIPTION = 300;

const ENTITY_TYPE = 'indent_request';
const REQUEST_SELECT = {
  id: true,
  processNumber: true,
  status: true,
  clientId: true,
  noteHash: true,
  ownerName: true,
  dealTitle: true,
  dealType: true,
  referenceAlert: true,
  stageEnteredAt: true,
  pipedriveDealId: true,
  items: { select: { id: true, source: true, confirmed: true, position: true } },
} satisfies Prisma.IndentRequestSelect;

type RequestRow = Prisma.IndentRequestGetPayload<{ select: typeof REQUEST_SELECT }>;
type MirrorRow = Prisma.IndentPipedriveDealGetPayload<{ include: { request: { select: typeof REQUEST_SELECT } } }>;

interface NoteState {
  noteId: number;
  text: string;
  hash: string;
  parsed: ParsedDealNote;
}

interface Prepared {
  deal: PdDeal;
  title: ParsedDealTitle;
  entered: Date;
  /** Organizacoes candidatas (so quando pode haver criacao de solicitacao). */
  orgs: PdOrganization[];
  orgIds: number[] | null;
  /** Nome do proprietario quando precisa gravar (criacao ou proprietario mudou); `null` = nao precisa. */
  ownerName: string | null;
  /** `undefined` = campo de tipo de negocio nao configurado (nao mexe). */
  dealType: string | null | undefined;
  note: NoteState | null;
  startedAt: number;
}

interface MirrorState {
  currentRevision: number | null;
  revisionHistory: unknown;
  inSourceStage: boolean;
  stageEnteredAt: Date | null;
  ownerId: number | null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cutoffOf(since: string): Date {
  // O Brasil nao tem horario de verao desde 2019: BRT = UTC-3.
  return new Date(`${since}T00:00:00-03:00`);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof PipedriveError) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return 'unexpected';
}

function revisionHistoryOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function problemAlert(title: ParsedDealTitle): string | null {
  switch (title.problem) {
    case 'multiple_numbers':
      return 'O título do negócio tem mais de um número NNN/AA.';
    case 'year_out_of_range':
      return 'O ano do número no título do negócio está fora do esperado.';
    case 'invalid_number':
      return 'O número no título do negócio é inválido.';
    default:
      return null;
  }
}

function lockDeal(tx: Prisma.TransactionClient, dealId: number): Promise<unknown> {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`indent_pipedrive_deal:${dealId}`}))`;
}

export class IndentPipedriveSyncService {
  /**
   * Numero vindo do Pipedrive: trava a linha do ano (mesma sequencia do PR 2), sobe `lastNumber` para o maior e devolve a
   * solicitacao que ja usa o numero (ou `null`). Chamar SEMPRE depois do advisory do negocio (ordem de travas).
   */
  static async lockYearAndBump(
    tx: Prisma.TransactionClient,
    year: number,
    seq: number,
  ): Promise<{ id: number; processNumber: string | null } | null> {
    await tx.$executeRaw`INSERT INTO "IndentSequence"("year", "lastNumber", "updatedAt") VALUES (${year}, 0, now()) ON CONFLICT ("year") DO NOTHING`;
    await tx.$queryRaw`SELECT "lastNumber" FROM "IndentSequence" WHERE "year" = ${year} FOR UPDATE`;
    await tx.$executeRaw`UPDATE "IndentSequence" SET "lastNumber" = GREATEST("lastNumber", ${seq}), "updatedAt" = now() WHERE "year" = ${year}`;

    return tx.indentRequest.findUnique({
      where: { processNumber: formatProcessNumber(year, seq) },
      select: { id: true, processNumber: true },
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Varredura
  // ------------------------------------------------------------------------------------------------------------

  static async runSweep(options: SweepOptions): Promise<SweepSummary> {
    const env = options.env ?? pipedriveEnv;
    const now = options.now ?? new Date();
    const clock = options.clock ?? Date.now;
    const startedAt = clock();
    const summary: SweepSummary = {
      outcome: 'run_ok',
      processed: 0,
      created: 0,
      errors: 0,
      skipped: 0,
      missed: 0,
      stoppedBy: null,
      durationMs: 0,
    };
    const finish = (outcome: SweepOutcome): SweepSummary => {
      summary.outcome = outcome;
      summary.durationMs = Math.max(0, clock() - startedAt);
      return summary;
    };

    let client: PipedriveClient;
    try {
      if (!env.configured && !options.client) {
        return finish('not_configured');
      }
      client = options.client ?? getPipedriveClient();
    } catch {
      return finish('not_configured');
    }

    const config = await IndentIntegrationConfigService.get(env);

    if (config.pipelineId === null || config.stageId === null) {
      return finish('not_configured');
    }

    const claimed = await prisma.$executeRaw`UPDATE "IndentIntegrationConfig" SET "sweepLockedUntil" = now() + interval '5 minutes' WHERE "id" = 1 AND ("sweepLockedUntil" IS NULL OR "sweepLockedUntil" < now())`;

    if (claimed === 0) {
      await IndentPipedriveSyncService.recordRunEvent(options.source, 'in_progress', null, clock() - startedAt);
      logger.info({ source: options.source, outcome: 'in_progress' }, 'Pipedrive: varredura ja em andamento.');
      return finish('in_progress');
    }

    const ctx: ProcessContext = {
      source: options.source,
      client,
      env,
      now,
      pipelineId: config.pipelineId,
      stageId: config.stageId,
      cache: { owners: new Map(), orgs: new Map(), dealTypeLabels: null, catalog: null },
    };
    let outcome: SweepOutcome = 'run_ok';
    let errorCode: string | null = null;
    let unexpected: unknown = null;

    try {
      outcome = await IndentPipedriveSyncService.sweepBody(ctx, config, summary, options.budgetMs, startedAt, clock);
    } catch (error) {
      if (error instanceof PipedriveAuthError) {
        outcome = 'auth_failed';
        logger.error({ source: options.source }, 'Pipedrive: o token foi recusado (auth_failed).');
      } else if (error instanceof PipedriveRateLimitError) {
        outcome = 'rate_limited';
      } else if (error instanceof PipedriveError) {
        outcome = 'error';
        errorCode = error.code;
      } else {
        outcome = 'error';
        errorCode = errorCodeOf(error);
        unexpected = error;
        logger.error({ source: options.source, errorCode }, 'Pipedrive: erro inesperado na varredura.');
      }
    }

    const durationMs = Math.max(0, clock() - startedAt);

    try {
      await IndentPipedriveSyncService.finalizeRun(ctx, outcome, summary, errorCode, durationMs);
    } catch (error) {
      logger.error({ source: options.source, errorCode: errorCodeOf(error) }, 'Pipedrive: falha ao gravar o resultado da varredura.');
    } finally {
      await prisma.$executeRaw`UPDATE "IndentIntegrationConfig" SET "sweepLockedUntil" = NULL WHERE "id" = 1`.catch(() => undefined);
    }

    logger.info(
      {
        source: options.source,
        outcome,
        processed: summary.processed,
        created: summary.created,
        errors: summary.errors + summary.skipped,
        durationMs,
      },
      'Pipedrive: varredura concluida.',
    );

    if (unexpected) {
      throw unexpected;
    }

    return finish(outcome);
  }

  private static async sweepBody(
    ctx: ProcessContext,
    config: { pipelineName: string | null; stageName: string | null },
    summary: SweepSummary,
    budgetMs: number,
    startedAt: number,
    clock: () => number,
  ): Promise<SweepOutcome> {
    const { client } = ctx;
    const verified = await IndentIntegrationConfigService.verifyStage(client, {
      pipelineId: ctx.pipelineId,
      stageId: ctx.stageId,
      stageName: config.stageName,
    });

    if (!verified.matches) {
      logger.error({ pipelineId: ctx.pipelineId, stageId: ctx.stageId }, 'Pipedrive: funil ou coluna nao conferem (config_mismatch).');
      return 'config_mismatch';
    }

    if (!config.pipelineName) {
      await IndentPipedriveSyncService.rememberPipelineName(ctx);
    }

    const listing = await client.listDealsInStage({ pipelineId: ctx.pipelineId, stageId: ctx.stageId, status: 'open' });
    summary.skipped = listing.skipped;

    const listedIds = listing.deals.map((deal) => deal.id);
    const mirrors = await prisma.indentPipedriveDeal.findMany({
      where: { dealId: { in: listedIds } },
      select: {
        dealId: true,
        dealUpdateTime: true,
        noteCheckedAt: true,
        inSourceStage: true,
        request: { select: { status: true } },
      },
    });
    const mirrorByDeal = new Map(mirrors.map((mirror) => [mirror.dealId, mirror]));
    const unchangedIds: number[] = [];
    let consecutiveFailures = 0;
    let stopped: SweepOutcome | null = null;

    const shouldStop = (): SweepOutcome | null => {
      if (clock() - startedAt >= budgetMs) {
        summary.stoppedBy = 'time_budget';
        return 'run_ok';
      }
      const state = client.getRateLimitState();
      if (
        state.dailyTokensLimit !== null &&
        state.dailyTokensLimit > 0 &&
        state.dailyTokensRemaining !== null &&
        state.dailyTokensRemaining < state.dailyTokensLimit * LOW_BUDGET_RATIO
      ) {
        return 'budget_low';
      }
      return null;
    };

    const handle = async (target: PdDeal | number): Promise<boolean> => {
      try {
        const result = await IndentPipedriveSyncService.processDeal(target, ctx);
        summary.processed += 1;
        if (result.created) summary.created += 1;
        consecutiveFailures = 0;
        return true;
      } catch (error) {
        if (error instanceof PipedriveAuthError || error instanceof PipedriveRateLimitError) {
          throw error;
        }
        const dealId = typeof target === 'number' ? target : target.id;
        const code = errorCodeOf(error);
        summary.errors += 1;
        consecutiveFailures += 1;
        logger.warn({ dealId, result: 'error', errorCode: code }, 'Pipedrive: falha ao processar o negocio.');
        await IndentPipedriveSyncService.recordEvent(prisma, {
          source: ctx.source,
          dealId,
          result: 'error',
          errorCode: code,
        }).catch(() => undefined);
        return consecutiveFailures < MAX_CONSECUTIVE_FAILURES;
      }
    };

    for (const [index, deal] of listing.deals.entries()) {
      stopped = shouldStop();
      if (stopped) {
        summary.missed += listing.deals.length - index;
        break;
      }

      const mirror = mirrorByDeal.get(deal.id);
      const noteRefreshDue =
        mirror?.request?.status === 'NOVA' &&
        (!mirror.noteCheckedAt || ctx.now.getTime() - mirror.noteCheckedAt.getTime() > NOTE_REFRESH_MINUTES * 60_000);

      if (
        mirror &&
        mirror.inSourceStage &&
        mirror.dealUpdateTime !== null &&
        mirror.dealUpdateTime.getTime() === deal.updateTime.getTime() &&
        !noteRefreshDue
      ) {
        unchangedIds.push(deal.id);
        continue;
      }

      if (!(await handle(deal))) {
        stopped = 'error';
        summary.missed += listing.deals.length - index - 1;
        break;
      }
    }

    if (unchangedIds.length > 0) {
      await prisma.indentPipedriveDeal.updateMany({ where: { dealId: { in: unchangedIds } }, data: { lastSeenAt: ctx.now } });
    }

    // Negocios do espelho que sumiram da lista (saiu da coluna, ganho, perdido ou apagado): relê um a um.
    if (!stopped && !listing.truncated) {
      const departed = await prisma.indentPipedriveDeal.findMany({
        where: { inSourceStage: true, dealId: { notIn: listedIds } },
        select: { dealId: true },
        orderBy: { dealId: 'asc' },
        take: MAX_DEPARTED_PER_SWEEP,
      });

      for (const [index, row] of departed.entries()) {
        stopped = shouldStop();
        if (stopped) {
          summary.missed += departed.length - index;
          break;
        }
        if (!(await handle(row.dealId))) {
          stopped = 'error';
          summary.missed += departed.length - index - 1;
          break;
        }
      }
    }

    return stopped ?? 'run_ok';
  }

  private static async rememberPipelineName(ctx: ProcessContext): Promise<void> {
    try {
      const pipeline = (await ctx.client.listPipelines()).find((entry) => entry.id === ctx.pipelineId);
      if (pipeline) {
        await prisma.indentIntegrationConfig.updateMany({ where: { id: 1 }, data: { pipelineName: pipeline.name } });
      }
    } catch (error) {
      if (error instanceof PipedriveAuthError || error instanceof PipedriveRateLimitError) {
        throw error;
      }
      // So o rotulo da tela: sem o nome do funil a varredura segue.
    }
  }

  private static async finalizeRun(
    ctx: ProcessContext,
    outcome: SweepOutcome,
    summary: SweepSummary,
    errorCode: string | null,
    durationMs: number,
  ): Promise<void> {
    const budget = ctx.client.getRateLimitState();
    const ok = outcome === 'run_ok';

    await prisma.indentIntegrationConfig.update({
      where: { id: 1 },
      data: {
        connectionStatus: ok ? 'ok' : outcome,
        connectionCheckedAt: ctx.now,
        ...(budget.dailyTokensRemaining !== null ? { dailyTokensRemaining: Math.trunc(budget.dailyTokensRemaining) } : {}),
        ...(budget.dailyTokensLimit !== null ? { dailyTokensLimit: Math.trunc(budget.dailyTokensLimit) } : {}),
        ...(ok
          ? {
              lastSyncAt: ctx.now,
              lastSyncSource: ctx.source,
              lastSyncNewDeals: summary.created,
              lastSyncErrors: summary.errors + summary.skipped,
              lastSyncMissed: summary.missed,
            }
          : {}),
      },
    });

    await IndentPipedriveSyncService.recordRunEvent(ctx.source, outcome, errorCode, durationMs);
  }

  private static recordRunEvent(source: SyncSource, outcome: SweepOutcome, errorCode: string | null, durationMs: number) {
    return IndentPipedriveSyncService.recordEvent(prisma, {
      source,
      result: outcome === 'run_ok' ? 'run_ok' : outcome,
      errorCode,
      durationMs: Math.max(0, Math.trunc(durationMs)),
    });
  }

  private static async recordEvent(
    client: Prisma.TransactionClient | typeof prisma,
    data: {
      source: SyncSource;
      result: string;
      dealId?: number | null;
      requestId?: number | null;
      errorCode?: string | null;
      durationMs?: number | null;
    },
  ): Promise<void> {
    await client.indentPipedriveEvent.create({
      data: {
        source: data.source,
        result: data.result,
        dealId: data.dealId ?? null,
        requestId: data.requestId ?? null,
        errorCode: data.errorCode ?? null,
        durationMs: data.durationMs ?? null,
      },
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Um negocio
  // ------------------------------------------------------------------------------------------------------------

  /** `PdDeal` (da lista, ja lido nesta execucao) ou id (relê o negocio na API: saiu da coluna, webhook). */
  static async processDeal(input: PdDeal | number, ctx: ProcessContext): Promise<DealOutcome> {
    const startedAt = Date.now();
    let deal: PdDeal;

    if (typeof input === 'number') {
      try {
        deal = await ctx.client.getDeal(input);
      } catch (error) {
        if (error instanceof PipedriveNotFoundError) {
          return IndentPipedriveSyncService.markNotFound(input, ctx);
        }
        throw error;
      }
    } else {
      deal = input;
    }

    if (deal.isDeleted || deal.status === 'deleted') {
      return IndentPipedriveSyncService.markNotFound(deal.id, ctx);
    }

    const inSource = deal.pipelineId === ctx.pipelineId && deal.stageId === ctx.stageId && deal.status === 'open';

    if (!inSource) {
      return IndentPipedriveSyncService.leaveStage(deal, ctx);
    }

    const mirror = await prisma.indentPipedriveDeal.findUnique({
      where: { dealId: deal.id },
      include: { request: { select: REQUEST_SELECT } },
    });

    if (mirror?.dealUpdateTime && deal.updateTime.getTime() < mirror.dealUpdateTime.getTime()) {
      return IndentPipedriveSyncService.simple(ctx, deal.id, 'ignored_stale', mirror.requestId, true);
    }

    const entered = dealStageEnteredAt(deal);

    if (!mirror && ctx.env.syncSince && entered.getTime() < cutoffOf(ctx.env.syncSince).getTime()) {
      // Sem espelho: nada e gravado alem do evento (1 por negocio, para a varredura de 10 em 10 min nao inundar a tabela).
      const already = await prisma.indentPipedriveEvent.findFirst({
        where: { dealId: deal.id, result: 'ignored_before_cutoff' },
        select: { id: true },
      });
      return IndentPipedriveSyncService.simple(ctx, deal.id, 'ignored_before_cutoff', null, already === null);
    }

    // Leituras na API FORA da transacao (a transacao so toca o banco).
    const needsClient = !mirror || mirror.requestId === null;
    const orgs = needsClient ? await IndentPipedriveSyncService.fetchCandidateOrgs(deal, ctx) : [];
    const needsOwner = !mirror?.request || mirror.ownerId !== deal.ownerId;
    const ownerName = needsOwner ? await IndentPipedriveSyncService.ownerNameFor(deal.ownerId, ctx) : null;
    const dealType = await IndentPipedriveSyncService.dealTypeFor(deal, ctx);
    const notes = await ctx.client.listDealNotes(deal.id);
    const catalog = await IndentPipedriveSyncService.loadCatalog(ctx);
    const selected = selectItemsNote(notes, { comexUserId: ctx.env.comexUserId ?? null, catalog });
    const note: NoteState | null = selected
      ? { noteId: selected.note.id, text: selected.text, hash: sha256(selected.text), parsed: selected.parsed }
      : null;

    const prepared: Prepared = {
      deal,
      title: parseDealTitle(deal.title, ctx.now),
      entered,
      orgs,
      orgIds: needsClient ? orgs.map((org) => org.id) : null,
      ownerName: needsOwner ? (ownerName ?? (deal.ownerId !== null ? `Proprietário #${deal.ownerId}` : 'Proprietário não informado')) : null,
      dealType,
      note,
      startedAt,
    };

    return prisma.$transaction((tx) => IndentPipedriveSyncService.applyDeal(tx, ctx, prepared), { timeout: TX_TIMEOUT_MS });
  }

  private static async simple(
    ctx: ProcessContext,
    dealId: number,
    result: string,
    requestId: number | null,
    record: boolean,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<DealOutcome> {
    if (record) {
      await IndentPipedriveSyncService.recordEvent(db, { source: ctx.source, dealId, requestId, result });
    }
    logger.info({ dealId, result }, 'Pipedrive: negocio processado.');
    return { dealId, result, results: [result], created: false, requestId };
  }

  /** Fora da coluna de origem (saiu, ganho, perdido): so o espelho muda; a solicitacao fica intacta. */
  private static async leaveStage(deal: PdDeal, ctx: ProcessContext): Promise<DealOutcome> {
    return prisma.$transaction(async (tx) => {
      await lockDeal(tx, deal.id);
      const mirror = await tx.indentPipedriveDeal.findUnique({
        where: { dealId: deal.id },
        select: { inSourceStage: true, dealUpdateTime: true, requestId: true },
      });

      if (!mirror) {
        return IndentPipedriveSyncService.simple(ctx, deal.id, 'ignored_stage', null, true, tx);
      }
      if (mirror.dealUpdateTime && deal.updateTime.getTime() < mirror.dealUpdateTime.getTime()) {
        return IndentPipedriveSyncService.simple(ctx, deal.id, 'ignored_stale', mirror.requestId, true, tx);
      }

      await tx.indentPipedriveDeal.update({
        where: { dealId: deal.id },
        data: {
          title: deal.title,
          pipelineId: deal.pipelineId,
          stageId: deal.stageId,
          inSourceStage: false,
          ...(mirror.inSourceStage ? { leftStageAt: ctx.now } : {}),
          dealUpdateTime: deal.updateTime,
          lastSeenAt: ctx.now,
        },
      });

      return IndentPipedriveSyncService.simple(
        ctx,
        deal.id,
        mirror.inSourceStage ? 'left_stage' : 'ignored_stage',
        mirror.requestId,
        mirror.inSourceStage,
        tx,
      );
    });
  }

  /** 404/apagado: marca o espelho (solicitacao intacta). Sem espelho nao ha o que marcar. */
  private static async markNotFound(dealId: number, ctx: ProcessContext): Promise<DealOutcome> {
    return prisma.$transaction(async (tx) => {
      await lockDeal(tx, dealId);
      const mirror = await tx.indentPipedriveDeal.findUnique({ where: { dealId }, select: { requestId: true, notFoundAt: true } });

      if (!mirror) {
        return IndentPipedriveSyncService.simple(ctx, dealId, 'not_found', null, false, tx);
      }

      await tx.indentPipedriveDeal.update({
        where: { dealId },
        data: { notFoundAt: ctx.now, inSourceStage: false, lastSeenAt: ctx.now },
      });

      return IndentPipedriveSyncService.simple(ctx, dealId, 'not_found', mirror.requestId, mirror.notFoundAt === null, tx);
    });
  }

  private static async fetchCandidateOrgs(deal: PdDeal, ctx: ProcessContext): Promise<PdOrganization[]> {
    const ids: number[] = [];

    if (deal.orgId !== null) {
      ids.push(deal.orgId);
    }

    if (deal.personId !== null) {
      try {
        const person = await ctx.client.getPerson(deal.personId);
        if (person.orgId !== null && !ids.includes(person.orgId)) {
          ids.push(person.orgId);
        }
      } catch (error) {
        if (!(error instanceof PipedriveNotFoundError)) {
          throw error;
        }
      }
    }

    const orgs: PdOrganization[] = [];

    for (const id of ids) {
      if (!ctx.cache.orgs.has(id)) {
        try {
          ctx.cache.orgs.set(id, await ctx.client.getOrganization(id, ctx.env.orgCnpjFieldKey ?? null));
        } catch (error) {
          if (!(error instanceof PipedriveNotFoundError)) {
            throw error;
          }
          ctx.cache.orgs.set(id, null);
        }
      }
      const org = ctx.cache.orgs.get(id);
      if (org) {
        orgs.push(org);
      }
    }

    return orgs;
  }

  private static async ownerNameFor(ownerId: number | null, ctx: ProcessContext): Promise<string | null> {
    if (ownerId === null) {
      return null;
    }
    if (!ctx.cache.owners.has(ownerId)) {
      try {
        const user = await ctx.client.getUser(ownerId);
        ctx.cache.owners.set(ownerId, user.name.trim() || null);
      } catch (error) {
        if (!(error instanceof PipedriveNotFoundError)) {
          throw error;
        }
        ctx.cache.owners.set(ownerId, null);
      }
    }
    return ctx.cache.owners.get(ownerId) ?? null;
  }

  /** Rotulo do "Tipo de Negocio" (opcoes de `/v1/dealFields`, 1 chamada por execucao); `undefined` = campo nao configurado. */
  private static async dealTypeFor(deal: PdDeal, ctx: ProcessContext): Promise<string | null | undefined> {
    const key = ctx.env.dealTypeFieldKey;

    if (!key) {
      return undefined;
    }

    const optionId = readCustomFieldText(deal.customFields, key);

    if (optionId === null) {
      return null;
    }

    if (ctx.cache.dealTypeLabels === null) {
      try {
        const options = findFieldOptions(await ctx.client.listDealFields(), key);
        ctx.cache.dealTypeLabels = new Map(options.map((option) => [String(option.id), option.label]));
      } catch (error) {
        if (error instanceof PipedriveAuthError || error instanceof PipedriveRateLimitError) {
          throw error;
        }
        ctx.cache.dealTypeLabels = new Map();
      }
    }

    return ctx.cache.dealTypeLabels.get(optionId) ?? null;
  }

  private static async loadCatalog(ctx: ProcessContext): Promise<NoteCatalogProduct[]> {
    ctx.cache.catalog ??= await prisma.indentProduct.findMany({
      where: { isActive: true },
      select: { id: true, name: true, acronym: true, synonyms: true },
    });
    return ctx.cache.catalog;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Aplicacao (dentro da transacao, com o advisory do negocio)
  // ------------------------------------------------------------------------------------------------------------

  private static async applyDeal(tx: Prisma.TransactionClient, ctx: ProcessContext, p: Prepared): Promise<DealOutcome> {
    const { deal } = p;
    await lockDeal(tx, deal.id);

    const mirror = await tx.indentPipedriveDeal.findUnique({
      where: { dealId: deal.id },
      include: { request: { select: REQUEST_SELECT } },
    });

    if (mirror?.dealUpdateTime && deal.updateTime.getTime() < mirror.dealUpdateTime.getTime()) {
      await IndentPipedriveSyncService.recordEvent(tx, { source: ctx.source, dealId: deal.id, requestId: mirror.requestId, result: 'ignored_stale' });
      return { dealId: deal.id, result: 'ignored_stale', results: ['ignored_stale'], created: false, requestId: mirror.requestId };
    }

    // Defesa: solicitacao ja ligada a este negocio sem espelho (espelho perdido).
    const known: RequestRow | null =
      mirror?.request ??
      (await tx.indentRequest.findUnique({ where: { pipedriveDealId: deal.id }, select: REQUEST_SELECT }));

    if (known) {
      return IndentPipedriveSyncService.applyKnown(tx, ctx, p, known, mirror, mirror !== null, []);
    }

    return IndentPipedriveSyncService.applyUnknown(tx, ctx, p, mirror);
  }

  /** Negocio desconhecido: revisao liga a solicitacao base; sem revisao cria (ou cria em "Referencia pendente"). */
  private static async applyUnknown(
    tx: Prisma.TransactionClient,
    ctx: ProcessContext,
    p: Prepared,
    mirror: MirrorRow | null,
  ): Promise<DealOutcome> {
    const { deal, title } = p;
    const number = title.processNumber;

    if (title.revision !== null && number) {
      const base = await tx.indentRequest.findUnique({ where: { processNumber: number }, select: REQUEST_SELECT });

      if (base) {
        // Revisao de uma solicitacao que ja existe: liga o espelho a ela, sem criar (revision_linked).
        const entry = { revision: title.revision, title: deal.title, detectedAt: ctx.now.toISOString() };
        await tx.indentRequest.update({
          where: { id: base.id },
          data: { revisionAlertAt: ctx.now, ...(base.pipedriveDealId === null ? { pipedriveDealId: deal.id } : {}) },
        });
        await AuditLogService.log(
          {
            entityType: ENTITY_TYPE,
            entityId: base.id,
            action: 'indent_request.pipedrive_revision_linked',
            performedById: null,
            metadata: { source: 'pipedrive', dealId: deal.id, revision: title.revision },
          },
          tx,
        );
        const state: MirrorState = {
          currentRevision: title.revision,
          revisionHistory: [entry],
          inSourceStage: true,
          stageEnteredAt: p.entered,
          ownerId: deal.ownerId,
        };
        return IndentPipedriveSyncService.applyKnown(tx, ctx, p, base, state, mirror !== null, ['revision_linked']);
      }
    }

    let processNumber: string | null = null;
    let year: number | null = null;
    let seq: number | null = null;
    let referenceAlert: string | null = problemAlert(title);
    const results: string[] = ['created'];

    if (title.revision !== null) {
      referenceAlert = number
        ? `Revisão R${title.revision} sem solicitação base no IQ Indent (título: ${number}).`
        : (problemAlert(title) ?? `Revisão R${title.revision} sem solicitação base no IQ Indent (sem número no título).`);
    } else if (number && title.year !== null && title.seq !== null) {
      const holder = await IndentPipedriveSyncService.lockYearAndBump(tx, title.year, title.seq);

      if (holder) {
        referenceAlert = `O número ${number} já pertence à solicitação ${holder.processNumber ?? number}.`;
        results[0] = 'duplicate_number';
      } else {
        processNumber = number;
        year = title.year;
        seq = title.seq;
      }
    }

    const match = await IndentPipedriveSyncService.resolveClient(tx, p.orgs, deal.id);
    const items = (p.note?.parsed.items ?? []).slice(0, NOTE_MAX_ITEMS);
    const created = await tx.indentRequest.create({
      data: {
        processNumber,
        processYear: year,
        processSeq: seq,
        origin: 'PIPEDRIVE',
        pipedriveDealId: deal.id,
        dealTitle: deal.title,
        clientId: match.clientId,
        ownerName: p.ownerName ?? 'Proprietário não informado',
        status: 'NOVA',
        stageEnteredAt: p.entered,
        rawNote: p.note?.text ?? null,
        dealType: p.dealType ?? null,
        noteHash: p.note?.hash ?? null,
        noteIncoterm: p.note?.parsed.incoterm ?? null,
        noteDestination: p.note?.parsed.destination ?? null,
        noteSupplierHint: p.note?.parsed.supplierHint ?? null,
        referenceAlert,
        revisionAlertAt: title.revision !== null ? ctx.now : null,
        items: {
          create: items.map((item, position) => ({
            productId: item.productId,
            description: cleanProposedName(item.text).slice(0, MAX_DESCRIPTION),
            quantityKg: item.quantityKg ?? 0,
            confirmed: false,
            source: 'NOTE',
            noteLine: item.line,
            position,
          })),
        },
      },
      select: { id: true },
    });

    if (match.clientId === null) {
      await IndentPipedriveSyncService.ensurePendingOrg(tx, created.id, deal.id, match.candidates);
    }

    await AuditLogService.log(
      {
        entityType: ENTITY_TYPE,
        entityId: created.id,
        action: 'indent_request.pipedrive_created',
        performedById: null,
        afterData: {
          processNumber,
          origin: 'PIPEDRIVE',
          clientId: match.clientId,
          itemCount: items.length,
          referencePending: processNumber === null,
        },
        metadata: { source: 'pipedrive', dealId: deal.id },
      },
      tx,
    );

    const revisionEntry =
      title.revision !== null ? [{ revision: title.revision, title: deal.title, detectedAt: ctx.now.toISOString() }] : [];
    await IndentPipedriveSyncService.writeMirror(tx, ctx, p, mirror !== null, created.id, {
      currentRevision: title.revision,
      revisionHistory: revisionEntry,
      stageEnteredAt: p.entered,
      leftStageAt: null,
    });

    return IndentPipedriveSyncService.conclude(tx, ctx, p, created.id, results, true);
  }

  /** Negocio conhecido: nunca cria; atualiza titulo, revisao, referencia, nota e entrada na coluna. */
  private static async applyKnown(
    tx: Prisma.TransactionClient,
    ctx: ProcessContext,
    p: Prepared,
    request: RequestRow,
    mirror: MirrorState | null,
    mirrorExists: boolean,
    results: string[],
  ): Promise<DealOutcome> {
    const { deal, title } = p;
    const data: Prisma.IndentRequestUpdateInput = {};
    const changed: string[] = [];
    const mirrorExtra: { currentRevision: number | null; revisionHistory: unknown; stageEnteredAt: Date | null; leftStageAt: Date | null } = {
      currentRevision: mirror?.currentRevision ?? null,
      revisionHistory: mirror?.revisionHistory ?? [],
      stageEnteredAt: mirror?.stageEnteredAt ?? p.entered,
      leftStageAt: null,
    };

    // Titulo e cadastro do negocio.
    if (request.dealTitle !== deal.title) {
      data.dealTitle = deal.title;
      changed.push('dealTitle');
    }
    if (p.dealType !== undefined && request.dealType !== p.dealType) {
      data.dealType = p.dealType;
      changed.push('dealType');
    }
    // Solicitacao lancada a mao (ligada por revisao) mantem o responsavel do IQ.
    if (!results.includes('revision_linked') && p.ownerName !== null && request.ownerName !== p.ownerName) {
      data.ownerName = p.ownerName;
      changed.push('ownerName');
    }

    // Revisao: "R<n>" novo no titulo do MESMO negocio (R<n> que some mantem a revisao atual).
    if (title.revision !== null && title.revision !== (mirror?.currentRevision ?? null)) {
      mirrorExtra.currentRevision = title.revision;
      mirrorExtra.revisionHistory = [
        ...revisionHistoryOf(mirror?.revisionHistory),
        { revision: title.revision, title: deal.title, detectedAt: ctx.now.toISOString() },
      ];
      data.revisionAlertAt = ctx.now;
      results.push('revision_detected');
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: request.id,
          action: 'indent_request.pipedrive_revision',
          performedById: null,
          metadata: { source: 'pipedrive', dealId: deal.id, revision: title.revision },
        },
        tx,
      );
    }

    // Volta para a coluna: atualiza a entrada; o status da solicitacao NAO muda (P3).
    const reentered =
      mirror !== null &&
      (!mirror.inSourceStage || (mirror.stageEnteredAt !== null && p.entered.getTime() > mirror.stageEnteredAt.getTime()));
    if (reentered) {
      mirrorExtra.stageEnteredAt = p.entered;
      results.push('stage_reentered');
      if (request.status === 'NOVA' || request.status === 'COTACAO') {
        data.stageEnteredAt = p.entered;
        changed.push('stageEnteredAt');
      }
    }

    // Referencia (numero do processo).
    const reference = await IndentPipedriveSyncService.referenceUpdate(tx, request, title);
    if (reference.processNumber !== undefined) {
      data.processNumber = reference.processNumber;
      data.processYear = reference.processYear;
      data.processSeq = reference.processSeq;
      changed.push('processNumber');
      results.push('reference_filled');
    }
    if (reference.alert !== undefined && reference.alert !== request.referenceAlert) {
      data.referenceAlert = reference.alert;
      changed.push('referenceAlert');
      if (reference.duplicate) {
        results.push('duplicate_number');
      }
    }

    // Nota do negocio (decisao 21).
    const noteResult = await IndentPipedriveSyncService.applyNote(tx, ctx, request, p, data);
    results.push(...noteResult);

    if (Object.keys(data).length > 0) {
      await tx.indentRequest.update({ where: { id: request.id }, data });
    }

    if (changed.length > 0) {
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: request.id,
          action: 'indent_request.pipedrive_updated',
          performedById: null,
          metadata: { source: 'pipedrive', dealId: deal.id, changed },
        },
        tx,
      );
    }

    await IndentPipedriveSyncService.writeMirror(tx, ctx, p, mirrorExists, request.id, mirrorExtra);

    return IndentPipedriveSyncService.conclude(tx, ctx, p, request.id, results, false);
  }

  /** Numero do titulo x numero da solicitacao: preenche "Referencia pendente" ou alerta divergencia (nunca troca numero existente). */
  private static async referenceUpdate(
    tx: Prisma.TransactionClient,
    request: RequestRow,
    title: ParsedDealTitle,
  ): Promise<{
    processNumber?: string;
    processYear?: number;
    processSeq?: number;
    alert?: string | null;
    duplicate?: boolean;
  }> {
    const number = title.processNumber;

    if (request.processNumber === null) {
      if (number && title.year !== null && title.seq !== null) {
        const holder = await IndentPipedriveSyncService.lockYearAndBump(tx, title.year, title.seq);

        if (!holder) {
          return { processNumber: number, processYear: title.year, processSeq: title.seq, alert: null };
        }
        return { alert: `O número ${number} já pertence à solicitação ${holder.processNumber ?? number}.`, duplicate: true };
      }
      const alert = problemAlert(title);
      return alert ? { alert } : {};
    }

    if (number && number !== request.processNumber) {
      return { alert: `O título do negócio aponta para ${number}, diferente da solicitação ${request.processNumber}.` };
    }
    if (number === request.processNumber) {
      return { alert: null };
    }
    return {};
  }

  /** Nota: `rawNote`/`noteHash` sempre atualizados; NOVA sem item confirmado troca os itens da nota; senao so alerta. */
  private static async applyNote(
    tx: Prisma.TransactionClient,
    ctx: ProcessContext,
    request: RequestRow,
    p: Prepared,
    data: Prisma.IndentRequestUpdateInput,
  ): Promise<string[]> {
    const note = p.note;

    if (!note || note.hash === request.noteHash) {
      return [];
    }

    data.rawNote = note.text;
    data.noteHash = note.hash;
    data.noteIncoterm = note.parsed.incoterm;
    data.noteDestination = note.parsed.destination;
    data.noteSupplierHint = note.parsed.supplierHint;

    const hasConfirmed = request.items.some((item) => item.confirmed);

    if (request.status === 'NOVA' && !hasConfirmed) {
      const kept = request.items.filter((item) => !(item.source === 'NOTE' && !item.confirmed));
      const basePosition = kept.reduce((max, item) => Math.max(max, item.position), -1) + 1;
      const items = note.parsed.items.slice(0, NOTE_MAX_ITEMS);

      await tx.indentRequestItem.deleteMany({ where: { requestId: request.id, source: 'NOTE', confirmed: false } });
      if (items.length > 0) {
        await tx.indentRequestItem.createMany({
          data: items.map((item, index) => ({
            requestId: request.id,
            productId: item.productId,
            description: cleanProposedName(item.text).slice(0, MAX_DESCRIPTION),
            quantityKg: item.quantityKg ?? 0,
            confirmed: false,
            source: 'NOTE',
            noteLine: item.line,
            position: basePosition + index,
          })),
        });
      }
      data.noteChangedAt = null;
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: request.id,
          action: 'indent_request.note_replaced',
          performedById: null,
          metadata: { source: 'pipedrive', dealId: p.deal.id, itemCount: items.length },
        },
        tx,
      );
      return ['note_replaced'];
    }

    // Depois da confirmacao (ou da cotacao): os itens ficam intactos e a tela mostra o alerta. Sem nota anterior nao ha o que comparar.
    if (request.noteHash !== null) {
      data.noteChangedAt = ctx.now;
      return ['note_changed'];
    }

    return [];
  }

  /** Espelho do negocio (upsert por `dealId`). */
  private static async writeMirror(
    tx: Prisma.TransactionClient,
    ctx: ProcessContext,
    p: Prepared,
    exists: boolean,
    requestId: number,
    extra: { currentRevision: number | null; revisionHistory: unknown; stageEnteredAt: Date | null; leftStageAt: Date | null },
  ): Promise<void> {
    const { deal } = p;
    const common = {
      requestId,
      title: deal.title,
      parsedNumber: p.title.processNumber,
      currentRevision: extra.currentRevision,
      revisionHistory: extra.revisionHistory as Prisma.InputJsonValue,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      inSourceStage: true,
      stageEnteredAt: extra.stageEnteredAt,
      dealUpdateTime: deal.updateTime,
      ownerId: deal.ownerId,
      noteId: p.note?.noteId ?? null,
      noteHash: p.note?.hash ?? null,
      noteCheckedAt: ctx.now,
      leftStageAt: extra.leftStageAt,
      notFoundAt: null,
      lastSeenAt: ctx.now,
    };
    const orgIds = p.orgIds !== null ? { orgIds: p.orgIds } : {};

    if (exists) {
      await tx.indentPipedriveDeal.update({ where: { dealId: deal.id }, data: { ...common, ...orgIds } });
    } else {
      await tx.indentPipedriveDeal.create({
        data: { dealId: deal.id, ...common, orgIds: p.orgIds ?? (deal.orgId !== null ? [deal.orgId] : []) },
      });
    }
  }

  /** Evento do negocio (1 linha por resultado relevante; nada quando so o espelho mudou) e log so com ids. */
  private static async conclude(
    tx: Prisma.TransactionClient,
    ctx: ProcessContext,
    p: Prepared,
    requestId: number,
    results: string[],
    created: boolean,
  ): Promise<DealOutcome> {
    const unique = Array.from(new Set(results));
    const relevant = unique.length > 0 ? unique : ['unchanged'];
    const durationMs = Math.max(0, Date.now() - p.startedAt);

    if (unique.length > 0) {
      for (const result of unique) {
        await IndentPipedriveSyncService.recordEvent(tx, {
          source: ctx.source,
          dealId: p.deal.id,
          requestId,
          result,
          durationMs,
        });
      }
    }

    logger.info({ dealId: p.deal.id, result: relevant[0] }, 'Pipedrive: negocio processado.');
    return { dealId: p.deal.id, result: relevant[0] as string, results: relevant, created, requestId };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Cliente (decisao 16): organizacao do negocio e da pessoa de contato; nunca casa por nome
  // ------------------------------------------------------------------------------------------------------------

  private static async resolveClient(
    tx: Prisma.TransactionClient,
    orgs: PdOrganization[],
    dealId: number,
  ): Promise<{ clientId: number | null; candidates: Array<{ orgId: number; name: string; cnpj: string | null; city: string | null }> }> {
    const candidates = orgs.map((org) => {
      const digits = org.cnpjRaw ? normalizeCnpj(org.cnpjRaw) : '';
      return { orgId: org.id, name: org.name, cnpj: digits !== '' && isValidCnpj(digits) ? digits : null, city: org.city };
    });

    // Varias candidatas (negocio x pessoa de contato) ou nenhuma: quem decide e a fila de vinculo.
    if (orgs.length !== 1) {
      return { clientId: null, candidates };
    }

    const org = orgs[0] as PdOrganization;
    const candidate = candidates[0] as (typeof candidates)[number];
    const byOrg = await tx.indentClient.findUnique({ where: { pipedriveOrgId: org.id }, select: { id: true, isActive: true } });

    if (byOrg?.isActive) {
      return { clientId: byOrg.id, candidates };
    }

    if (candidate.cnpj) {
      const byCnpj = await tx.indentClient.findFirst({
        where: { cnpj: candidate.cnpj, isActive: true },
        select: { id: true, pipedriveOrgId: true },
      });

      if (byCnpj) {
        if (byCnpj.pipedriveOrgId === null && !byOrg) {
          await tx.indentClient.update({ where: { id: byCnpj.id }, data: { pipedriveOrgId: org.id } });
          await AuditLogService.log(
            {
              entityType: 'indent_client',
              entityId: byCnpj.id,
              action: 'indent_client.pipedrive_org_linked',
              performedById: null,
              afterData: { pipedriveOrgId: org.id },
              metadata: { source: 'pipedrive', dealId },
            },
            tx,
          );
        } else if (byCnpj.pipedriveOrgId !== org.id) {
          logger.warn({ clientId: byCnpj.id, orgId: org.id, dealId }, 'Pipedrive: cliente casado por CNPJ ja tem outra organizacao vinculada.');
        }
        return { clientId: byCnpj.id, candidates };
      }
    }

    return { clientId: null, candidates };
  }

  /** Uma pendencia ABERTA por solicitacao (trava de linha da solicitacao, padrao do CommercialRequestAttachmentService). */
  private static async ensurePendingOrg(
    tx: Prisma.TransactionClient,
    requestId: number,
    dealId: number,
    candidates: Array<{ orgId: number; name: string; cnpj: string | null; city: string | null }>,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "IndentRequest" WHERE id = ${requestId} FOR NO KEY UPDATE`;
    const open = await tx.indentPendingOrg.findFirst({ where: { requestId, status: 'OPEN' }, select: { id: true } });

    if (!open) {
      await tx.indentPendingOrg.create({
        data: { requestId, dealId, candidates: candidates as unknown as Prisma.InputJsonValue },
      });
    }
  }
}
