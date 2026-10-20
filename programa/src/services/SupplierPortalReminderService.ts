import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import {
  SKIPPED_COMERCIAL_LOOKUP_FAILED,
  SKIPPED_COMERCIAL_RECIPIENT,
  sendAndLog,
} from '../mailer/MailerService';
import {
  QUOTE_REMINDER_TEMPLATE_KEY,
  renderReminderFromTemplate,
} from '../mailer/renderQuoteReminder';
import {
  QUOTE_REMINDER_DIGEST_TEMPLATE_ID,
  renderReminderDigest,
} from '../mailer/renderQuoteReminderDigest';
import { todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { SupplierPortalService } from './SupplierPortalService';
import { CompanyProfileService } from './CompanyProfileService';

// Lembrete DIARIO (seg-sex, calendario de Brasilia) ao fornecedor que ainda nao
// respondeu. Como o token cru NAO e armazenado (so o hash), cada lembrete emite um
// token NOVO com o MESMO deadline do original e revoga os demais do par.
//
// Fluxo:
//   1. Fim de semana em Brasilia: nada e consultado nem enviado.
//   2. Por par (cotacao, contato) com token ativo, paradas na ordem de
//      loadPairStates: sem dispatch por e-mail, cotacao fechada/excluida, prazo da
//      cotacao vencido (data BRT), PO emitida, fornecedor inativo/bloqueado/excluido,
//      vencedor escolhido (qualquer fornecedor da cotacao), fornecedor ja respondeu
//      (portal ou resposta manual do COMEX), idade minima do token (10 h E data BRT
//      anterior) e link aberto nas ultimas 24 h em QUALQUER token ativo do par
//      (esta NAO grava claim: o par volta amanha).
//   3. Resumo UNICO por endereco de e-mail: pares elegiveis do mesmo endereco vao
//      num e-mail so (1 cotacao = template quote_reminder; 2+ = digest).
//   4. Por endereco: checa orcamento de tempo e virada de dia; CLAIM do endereco/dia
//      em SupplierPortalReminderAddress (sha256 do e-mail; P2002 = outro sweep e'
//      dono: pula o endereco inteiro); CLAIM unico por
//      (cotacao, contato, dia) em SupplierPortalReminder (create + P2002); REVALIDA
//      o estado numa consulta nova (claim -> skipped se mudou); token novo -> envio
//      -> revoga os OUTROS tokens ativos do par.
//   5. Falha ANTES do envio ou bloqueio do filtro comercial revoga os tokens novos
//      (nunca sairam do servidor). Falha do transporte (o e-mail pode ter saido) NAO
//      revoga: o claim vira failed e o proximo dia util retenta (data nova = chave
//      nova). Status do claim: claimed | sent | failed | suppressed | skipped
//      (skipped = envio cancelado pela revalidacao; nao retenta no mesmo dia).
export const REMINDER_TIME_ZONE = 'America/Sao_Paulo';
export const REMINDER_MIN_TOKEN_AGE_HOURS = 10;
export const REMINDER_SKIP_IF_SEEN_HOURS = 24;
// Orcamento para INICIAR um novo endereco; o limite duro (antes de cada sendAndLog) cancela
// o envio atrasado (Cloud Run corta em 300 s; o SMTP pode levar minutos).
export const REMINDER_SWEEP_BUDGET_MS = 120_000;
export const REMINDER_SEND_HARD_LIMIT_MS = 240_000;

const HOUR_MS = 3_600_000;

export interface ReminderSweepOptions {
  /** Relogio real em ms (padrao Date.now); injetavel nos testes do orcamento. */
  realNow?: () => number;
}

export interface ReminderSweepResult {
  reminderDate: string;
  weekend: boolean;
  due: number;
  sent: number;
  pairsSent: number;
  skipped: number;
  failed: number;
  suppressed: number;
  skippedNotYet: number;
  skippedRecentlyOpened: number;
  skippedResponded: number;
  skippedQuoteClosed: number;
  skippedPoSent: number;
  skippedSupplierInactive: number;
  skippedAlreadyClaimed: number;
  skippedNoDispatch: number;
  skippedWinnerChosen: number;
  skippedDeadlinePassed: number;
  skippedDuplicateAddress: number;
  /** Enderecos cujo claim do dia ja era de outro sweep (pulados inteiros, sem claims por par). */
  skippedAddressClaimed: number;
  skippedNoActiveToken: number;
  /** Revalidacao: o e-mail atual do contato nao e' mais o do endereco claimado. */
  skippedAddressChanged: number;
  /** Envio cancelado logo antes do sendAndLog (limite duro de tempo ou virada de dia). */
  skippedLateSend: number;
  /** Pares dos e-mails que falharam (due = pairsSent + skipped + pairsFailed + pairsRemaining). */
  pairsFailed: number;
  /** Pares dos enderecos nao processados por orcamento/virada de dia. */
  pairsRemaining: number;
  /** Informativo: pares reprovados na revalidacao (NAO entra na soma de skipped). */
  skippedOnRevalidation: number;
  budgetExhausted: boolean;
  dayChanged: boolean;
  /** E-mails (enderecos) nao processados por orcamento/virada de dia. */
  remaining: number;
  supersededTokens: number;
  revokedTokens: number;
}

// Dia da semana derivado da CHAVE BRT (YYYY-MM-DD), nunca do TZ do processo.
export function isWeekendDateKey(key: string): boolean {
  const day = new Date(`${key}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

// Token com >= 10 h E criado numa data BRT anterior a hoje.
export function isTokenOldEnough(createdAt: Date, now: Date, todayKey: string): boolean {
  return (
    todayKeyInSaoPaulo(createdAt) < todayKey &&
    createdAt.getTime() <= now.getTime() - REMINDER_MIN_TOKEN_AGE_HOURS * HOUR_MS
  );
}

// Link aberto nas ultimas 24 h (estrito: 24 h exatas ja envia).
export function wasOpenedRecently(lastSeenAt: Date | null, now: Date): boolean {
  return lastSeenAt !== null && lastSeenAt.getTime() > now.getTime() - REMINDER_SKIP_IF_SEEN_HOURS * HOUR_MS;
}

function formatDisplayDate(value: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function buildPortalLink(rawToken: string): string {
  const base = mailerEnv.portalUrl.replace(/\/$/, '');
  // Mesmo cache-buster do dispatch (Firebase Hosting cacheia portal.html).
  const v = Date.now();
  return `${base}/portal?token=${encodeURIComponent(rawToken)}&v=${v}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const pairKey = (quoteRequestId: number, supplierContactId: number): string =>
  `${quoteRequestId}:${supplierContactId}`;
const quoteSupplierKey = (quoteRequestId: number, supplierId: number): string =>
  `${quoteRequestId}:${supplierId}`;

type SkipCounter =
  | 'skippedNotYet'
  | 'skippedRecentlyOpened'
  | 'skippedResponded'
  | 'skippedQuoteClosed'
  | 'skippedPoSent'
  | 'skippedSupplierInactive'
  | 'skippedAlreadyClaimed'
  | 'skippedNoDispatch'
  | 'skippedWinnerChosen'
  | 'skippedDeadlinePassed'
  | 'skippedNoActiveToken'
  | 'skippedAddressChanged';

type StopReason =
  | 'no_dispatch'
  | 'quote_closed'
  | 'deadline_passed'
  | 'po_sent'
  | 'supplier_inactive'
  | 'winner_chosen'
  | 'responded'
  | 'not_yet'
  | 'recently_opened'
  | 'already_claimed'
  | 'no_active_token'
  | 'address_changed';

const REASON_COUNTER: Record<StopReason, SkipCounter> = {
  no_dispatch: 'skippedNoDispatch',
  quote_closed: 'skippedQuoteClosed',
  deadline_passed: 'skippedDeadlinePassed',
  po_sent: 'skippedPoSent',
  supplier_inactive: 'skippedSupplierInactive',
  winner_chosen: 'skippedWinnerChosen',
  responded: 'skippedResponded',
  not_yet: 'skippedNotYet',
  recently_opened: 'skippedRecentlyOpened',
  already_claimed: 'skippedAlreadyClaimed',
  no_active_token: 'skippedNoActiveToken',
  address_changed: 'skippedAddressChanged',
};

function emptyResult(reminderDate: string, weekend: boolean): ReminderSweepResult {
  return {
    reminderDate,
    weekend,
    due: 0,
    sent: 0,
    pairsSent: 0,
    skipped: 0,
    failed: 0,
    suppressed: 0,
    skippedNotYet: 0,
    skippedRecentlyOpened: 0,
    skippedResponded: 0,
    skippedQuoteClosed: 0,
    skippedPoSent: 0,
    skippedSupplierInactive: 0,
    skippedAlreadyClaimed: 0,
    skippedNoDispatch: 0,
    skippedWinnerChosen: 0,
    skippedDeadlinePassed: 0,
    skippedDuplicateAddress: 0,
    skippedAddressClaimed: 0,
    skippedNoActiveToken: 0,
    skippedAddressChanged: 0,
    skippedLateSend: 0,
    pairsFailed: 0,
    pairsRemaining: 0,
    skippedOnRevalidation: 0,
    budgetExhausted: false,
    dayChanged: false,
    remaining: 0,
    supersededTokens: 0,
    revokedTokens: 0,
  };
}

function sumSkipped(result: ReminderSweepResult): number {
  return (
    result.skippedNotYet +
    result.skippedRecentlyOpened +
    result.skippedResponded +
    result.skippedQuoteClosed +
    result.skippedPoSent +
    result.skippedSupplierInactive +
    result.skippedAlreadyClaimed +
    result.skippedNoDispatch +
    result.skippedWinnerChosen +
    result.skippedDeadlinePassed +
    result.skippedDuplicateAddress +
    result.skippedAddressClaimed +
    result.skippedNoActiveToken +
    result.skippedAddressChanged +
    result.skippedLateSend
  );
}

const ACTIVE_TOKEN_SELECT = {
  id: true,
  quoteRequestId: true,
  supplierId: true,
  supplierContactId: true,
  createdById: true,
  dispatchEventId: true,
  expiresAt: true,
  createdAt: true,
  lastSeenAt: true,
  supplier: { select: { name: true, status: true, deletedAt: true } },
  supplierContact: { select: { name: true, email: true } },
  quoteRequest: {
    select: {
      requestCode: true,
      productName: true,
      status: true,
      deletedAt: true,
      deadlineAt: true,
      purchaseOrderSentAt: true,
    },
  },
} satisfies Prisma.SupplierPortalTokenSelect;

type ActiveToken = Prisma.SupplierPortalTokenGetPayload<{ select: typeof ACTIVE_TOKEN_SELECT }>;

interface PairState {
  quoteRequestId: number;
  supplierContactId: number;
  tokens: ActiveToken[];
  /** Token ativo mais recente do par. */
  candidate: ActiveToken;
  /** Token mais recente do par com dispatchEventId != null (null = sem dispatch por e-mail). */
  dispatchToken: ActiveToken | null;
  /** Maior lastSeenAt entre TODOS os tokens ativos do par. */
  maxLastSeenAt: Date | null;
  /** null = elegivel; senao o motivo da parada. */
  reason: StopReason | null;
}

interface PairScope {
  quoteRequestIds: number[];
  supplierContactIds: number[];
}

interface LoadedPairs {
  pairs: Map<string, PairState>;
  supersededTokens: number;
}

// Carga + avaliacao das paradas. A passada inicial chama sem `scope` e com o
// pre-filtro de claims do dia; a revalidacao pos-claim chama com `scope`, com o
// instante corrente e SEM o pre-filtro (os claims acabaram de ser gravados).
async function loadPairStates(instant: Date, todayKey: string, scope?: PairScope): Promise<LoadedPairs> {
  const activeTokens = await prisma.supplierPortalToken.findMany({
    where: {
      revokedAt: null,
      respondedAt: null,
      expiresAt: { gt: instant },
      ...(scope
        ? {
            quoteRequestId: { in: scope.quoteRequestIds },
            supplierContactId: { in: scope.supplierContactIds },
          }
        : {}),
    },
    select: ACTIVE_TOKEN_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  // Agrupa por (cotacao, contato); a ordem da query deixa o mais recente primeiro.
  const groups = new Map<string, ActiveToken[]>();
  for (const token of activeTokens) {
    const key = pairKey(token.quoteRequestId, token.supplierContactId);
    const group = groups.get(key);
    if (group) group.push(token);
    else groups.set(key, [token]);
  }

  const pairs = new Map<string, PairState>();
  let supersededTokens = 0;
  for (const [key, tokens] of groups) {
    supersededTokens += tokens.length - 1;
    const candidate = tokens[0];
    const maxLastSeenAt = tokens
      .map((t) => t.lastSeenAt)
      .filter((d): d is Date => d !== null)
      .reduce<Date | null>((max, d) => (max === null || d.getTime() > max.getTime() ? d : max), null);
    pairs.set(key, {
      quoteRequestId: candidate.quoteRequestId,
      supplierContactId: candidate.supplierContactId,
      tokens,
      candidate,
      dispatchToken: tokens.find((t) => t.dispatchEventId !== null) ?? null,
      maxLastSeenAt,
      reason: null,
    });
  }

  // Paradas 1-5 (em memoria).
  const passedStructural: PairState[] = [];
  for (const state of pairs.values()) {
    const { quoteRequest, supplier } = state.candidate;
    if (state.dispatchToken === null) state.reason = 'no_dispatch';
    else if (quoteRequest.status === 'closed' || quoteRequest.deletedAt) state.reason = 'quote_closed';
    else if (quoteRequest.deadlineAt && todayKeyInSaoPaulo(quoteRequest.deadlineAt) < todayKey) {
      // Compara a DATA BRT: o lembrete ainda sai no proprio dia do prazo.
      state.reason = 'deadline_passed';
    } else if (quoteRequest.purchaseOrderSentAt) state.reason = 'po_sent';
    else if (supplier.status !== 'active' || supplier.deletedAt) state.reason = 'supplier_inactive';
    else passedStructural.push(state);
  }

  if (passedStructural.length === 0) return { pairs, supersededTokens };

  const quoteRequestIds = [...new Set(passedStructural.map((s) => s.quoteRequestId))];
  const [respondedTokens, portalResponses, quoteResponses, creditWinners, claims] = await Promise.all([
    // Inclui revogados: rotateTokenForReply deixa respondedAt no token anterior.
    prisma.supplierPortalToken.findMany({
      where: { quoteRequestId: { in: quoteRequestIds }, respondedAt: { not: null } },
      select: { quoteRequestId: true, supplierId: true },
    }),
    prisma.supplierPortalResponse.findMany({
      where: { quoteRequestId: { in: quoteRequestIds }, deletedAt: null },
      select: { quoteRequestId: true, supplierId: true },
    }),
    prisma.quoteResponse.findMany({
      where: { quoteRequestId: { in: quoteRequestIds }, deletedAt: null },
      select: { quoteRequestId: true, supplierId: true, isWinner: true },
    }),
    // Parceiro de Credit Support vencedor tambem encerra a cotacao (o model nao tem deletedAt).
    prisma.creditSupportRequest.findMany({
      where: { quoteRequestId: { in: quoteRequestIds }, isWinner: true },
      select: { quoteRequestId: true },
    }),
    scope
      ? Promise.resolve([] as Array<{ quoteRequestId: number; supplierContactId: number }>)
      : prisma.supplierPortalReminder.findMany({
          where: { reminderDate: todayKey, quoteRequestId: { in: quoteRequestIds } },
          select: { quoteRequestId: true, supplierContactId: true },
        }),
  ]);

  const responded = new Set<string>();
  for (const row of [...respondedTokens, ...portalResponses, ...quoteResponses]) {
    responded.add(quoteSupplierKey(row.quoteRequestId, row.supplierId));
  }
  const winnerQuotes = new Set<number>();
  for (const row of quoteResponses) if (row.isWinner) winnerQuotes.add(row.quoteRequestId);
  for (const row of creditWinners) winnerQuotes.add(row.quoteRequestId);
  const claimedToday = new Set(claims.map((c) => pairKey(c.quoteRequestId, c.supplierContactId)));

  // Paradas 6-10.
  for (const state of passedStructural) {
    const { candidate } = state;
    if (winnerQuotes.has(state.quoteRequestId)) state.reason = 'winner_chosen';
    else if (responded.has(quoteSupplierKey(state.quoteRequestId, candidate.supplierId))) {
      state.reason = 'responded';
    } else if (!isTokenOldEnough(candidate.createdAt, instant, todayKey)) state.reason = 'not_yet';
    // Sem claim: o par volta a ser elegivel amanha.
    else if (wasOpenedRecently(state.maxLastSeenAt, instant)) state.reason = 'recently_opened';
    else if (claimedToday.has(pairKey(state.quoteRequestId, state.supplierContactId))) {
      state.reason = 'already_claimed';
    }
  }

  return { pairs, supersededTokens };
}

interface SendItem {
  quoteRequestId: number;
  supplierContactId: number;
  reminderId: number;
  state: PairState;
  freshToken: { id: number; rawToken: string } | null;
}

// sha256 hex de lower(trim(email)): o e-mail cru nunca vai para o banco nem para o log.
function hashAddress(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail).digest('hex');
}

interface AddressGroup {
  addressHash: string;
  items: PairState[];
}

const byRequestCodeThenContact = (a: PairState, b: PairState): number => {
  const codeA = a.candidate.quoteRequest.requestCode;
  const codeB = b.candidate.quoteRequest.requestCode;
  if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  return a.supplierContactId - b.supplierContactId;
};

// Resumo diario: 1 grupo por endereco normalizado (o e-mail fica so em memoria).
// Mesma cotacao + mesmo fornecedor duas vezes no mesmo endereco: fica o par de candidate
// mais recente. A ordem dos enderecos e' um embaralhamento diario deterministico
// (sha256(addressHash + dia)): quando o orcamento estoura, nao sao sempre os mesmos de fora.
function groupByAddress(eligible: PairState[], todayKey: string, result: ReminderSweepResult): AddressGroup[] {
  const byEmail = new Map<string, Map<string, PairState>>();
  for (const state of eligible) {
    const email = state.candidate.supplierContact.email.trim().toLowerCase();
    let perQuoteSupplier = byEmail.get(email);
    if (!perQuoteSupplier) {
      perQuoteSupplier = new Map();
      byEmail.set(email, perQuoteSupplier);
    }
    const key = quoteSupplierKey(state.quoteRequestId, state.candidate.supplierId);
    const existing = perQuoteSupplier.get(key);
    if (!existing) {
      perQuoteSupplier.set(key, state);
      continue;
    }
    result.skippedDuplicateAddress += 1;
    const newer =
      state.candidate.createdAt.getTime() > existing.candidate.createdAt.getTime() ||
      (state.candidate.createdAt.getTime() === existing.candidate.createdAt.getTime() &&
        state.supplierContactId < existing.supplierContactId);
    if (newer) perQuoteSupplier.set(key, state);
  }

  const groups: Array<AddressGroup & { shuffleKey: string }> = [];
  for (const [email, perQuoteSupplier] of byEmail) {
    const addressHash = hashAddress(email);
    groups.push({
      addressHash,
      items: [...perQuoteSupplier.values()].sort(byRequestCodeThenContact),
      shuffleKey: createHash('sha256').update(`${addressHash}${todayKey}`).digest('hex'),
    });
  }
  return groups
    .sort((a, b) => (a.shuffleKey < b.shuffleKey ? -1 : a.shuffleKey > b.shuffleKey ? 1 : 0))
    .map(({ addressHash, items }) => ({ addressHash, items }));
}

// "Closes on" = menor entre o prazo da cotacao e o expiresAt do token.
function closesOnDate(state: PairState): Date {
  const { deadlineAt } = state.candidate.quoteRequest;
  const { expiresAt } = state.candidate;
  return deadlineAt && deadlineAt.getTime() < expiresAt.getTime() ? deadlineAt : expiresAt;
}

// Contadores somados do resultado local de um endereco no resultado do sweep.
function mergeCounters(target: ReminderSweepResult, local: ReminderSweepResult): void {
  const t = target as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(local)) {
    if (typeof value === 'number') t[key] = (t[key] as number) + value;
  }
}

interface SweepClock {
  elapsed: () => number;
  currentInstant: () => Date;
}

// Ids ja criados/claimados no endereco: permitem o rollback best-effort no catch.
interface AddressContext {
  claimIds: number[];
  freshIds: number[];
}

export class SupplierPortalReminderService {
  static async runReminderSweep(
    now: Date = new Date(),
    options: ReminderSweepOptions = {},
  ): Promise<ReminderSweepResult> {
    const realNow = options.realNow ?? Date.now;
    const startedAt = realNow();
    const clock: SweepClock = {
      elapsed: () => realNow() - startedAt,
      currentInstant: () => new Date(now.getTime() + (realNow() - startedAt)),
    };

    const todayKey = todayKeyInSaoPaulo(now);

    if (isWeekendDateKey(todayKey)) {
      const weekendResult = emptyResult(todayKey, true);
      logger.info({ ...weekendResult }, 'Sweep de lembretes diarios: fim de semana em Brasilia; nada enviado.');
      return weekendResult;
    }

    const result = emptyResult(todayKey, false);

    const initial = await loadPairStates(now, todayKey);
    result.due = initial.pairs.size;
    result.supersededTokens = initial.supersededTokens;

    const eligible: PairState[] = [];
    for (const state of initial.pairs.values()) {
      if (state.reason) result[REASON_COUNTER[state.reason]] += 1;
      else eligible.push(state);
    }

    const addresses = groupByAddress(eligible, todayKey, result);

    if (addresses.length > 0) {
      const profile = await CompanyProfileService.get();

      for (let index = 0; index < addresses.length; index += 1) {
        // Orcamento de tempo e virada de dia: checados antes de CADA e-mail, antes do claim.
        const remaining = addresses.length - index;
        const stopReason: 'budget' | 'day' | null =
          clock.elapsed() >= REMINDER_SWEEP_BUDGET_MS
            ? 'budget'
            : todayKeyInSaoPaulo(clock.currentInstant()) !== todayKey
              ? 'day'
              : null;
        if (stopReason) {
          result.remaining = remaining;
          result.pairsRemaining = addresses.slice(index).reduce((sum, g) => sum + g.items.length, 0);
          if (stopReason === 'budget') result.budgetExhausted = true;
          else result.dayChanged = true;
          logger.warn(
            {
              reminderDate: todayKey,
              ...(stopReason === 'budget' ? { budgetExhausted: true } : { dayChanged: true }),
              remaining,
              pairsRemaining: result.pairsRemaining,
              elapsedMs: clock.elapsed(),
              sent: result.sent,
            },
            stopReason === 'budget'
              ? 'Sweep de lembretes diarios interrompido: orcamento de tempo esgotado; restantes no proximo dia util.'
              : 'Sweep de lembretes diarios interrompido: virada de dia em Brasilia; restantes no proximo dia util.',
          );
          break;
        }

        // Claim por ENDERECO/dia: so um sweep e' dono do endereco (1 e-mail por endereco por dia util).
        const group = addresses[index];
        try {
          await prisma.supplierPortalReminderAddress.create({
            data: { addressHash: group.addressHash, reminderDate: todayKey, status: 'claimed' },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            // Outro sweep ja e' dono do endereco hoje: pula o endereco inteiro, sem claims por par.
            result.skippedAddressClaimed += group.items.length;
            continue;
          }
          throw error;
        }

        // Um erro (ex.: banco) num endereco nao derruba o sweep: marca o endereco como failed e segue.
        const local = emptyResult(todayKey, false);
        const ctx: AddressContext = { claimIds: [], freshIds: [] };
        let outcome: 'sent' | 'failed' | 'skipped';
        try {
          outcome = await SupplierPortalReminderService.processAddress(
            group,
            todayKey,
            now,
            clock,
            profile.companyName,
            local,
            ctx,
          );
          mergeCounters(result, local);
        } catch {
          outcome = 'failed';
          result.failed += 1;
          result.pairsFailed += group.items.length;
          // Logs so com ids (nunca e-mail, nome, texto de erro ou token cru).
          logger.error(
            {
              reminderDate: todayKey,
              reminderIds: ctx.claimIds,
              freshTokenIds: ctx.freshIds,
              requestCodes: group.items.map((i) => i.candidate.quoteRequest.requestCode),
            },
            'Erro ao processar endereco do lembrete diario; endereco marcado como failed.',
          );
          try {
            if (ctx.freshIds.length > 0) {
              await prisma.supplierPortalToken.updateMany({
                where: { id: { in: ctx.freshIds }, revokedAt: null },
                data: { revokedAt: new Date() },
              });
            }
            for (const id of ctx.claimIds) {
              await prisma.supplierPortalReminder.update({
                where: { id },
                data: { status: 'failed', errorMessage: 'address_error' },
              });
            }
          } catch {
            logger.error({ reminderDate: todayKey }, 'Falha no rollback best-effort do endereco com erro.');
          }
        }
        try {
          await prisma.supplierPortalReminderAddress.update({
            where: { addressHash_reminderDate: { addressHash: group.addressHash, reminderDate: todayKey } },
            data: { status: outcome },
          });
        } catch {
          logger.error(
            { reminderDate: todayKey, outcome },
            'Falha ao atualizar o claim por endereco do lembrete diario.',
          );
        }
      }
    }

    result.skipped = sumSkipped(result);

    // Loga sempre (inclusive due = 0): e' o sinal nos logs do Cloud Run de que o job rodou.
    logger.info({ ...result }, 'Sweep de lembretes diarios concluido.');

    return result;
  }

  private static async processAddress(
    group: AddressGroup,
    todayKey: string,
    now: Date,
    clock: SweepClock,
    companyName: string,
    result: ReminderSweepResult,
    ctx: AddressContext,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    // 1. Claims: 1 por par. P2002 tira so esse par; outro erro propaga (o catch do endereco trata).
    const claimed: Array<{ state: PairState; reminderId: number }> = [];
    for (const state of group.items) {
      try {
        const claim = await prisma.supplierPortalReminder.create({
          data: {
            quoteRequestId: state.quoteRequestId,
            supplierContactId: state.supplierContactId,
            reminderDate: todayKey,
            tokenId: state.candidate.id,
            status: 'claimed',
          },
        });
        claimed.push({ state, reminderId: claim.id });
        ctx.claimIds.push(claim.id);
      } catch (error) {
        if (isUniqueViolation(error)) {
          result.skippedAlreadyClaimed += 1;
          continue;
        }
        throw error;
      }
    }
    if (claimed.length === 0) return 'skipped';

    // 2. Revalidacao pos-claim: estado atual, antes de qualquer token novo.
    const revalidated = await loadPairStates(clock.currentInstant(), todayKey, {
      quoteRequestIds: [...new Set(claimed.map((c) => c.state.quoteRequestId))],
      supplierContactIds: [...new Set(claimed.map((c) => c.state.supplierContactId))],
    });
    const items: SendItem[] = [];
    for (const { state, reminderId } of claimed) {
      const fresh = revalidated.pairs.get(pairKey(state.quoteRequestId, state.supplierContactId));
      // O e-mail do contato pode ter sido editado depois da passada inicial: o claim do
      // endereco vale para o e-mail ANTIGO, entao o par nao pode ir neste e-mail.
      const addressChanged =
        !!fresh &&
        fresh.reason === null &&
        hashAddress(fresh.candidate.supplierContact.email.trim().toLowerCase()) !== group.addressHash;
      if (!fresh || fresh.reason !== null || addressChanged) {
        const stop: StopReason = addressChanged ? 'address_changed' : (fresh?.reason ?? 'no_active_token');
        await prisma.supplierPortalReminder.update({
          where: { id: reminderId },
          data: { status: 'skipped', errorMessage: `revalidation:${stop}` },
        });
        result[REASON_COUNTER[stop]] += 1;
        result.skippedOnRevalidation += 1;
        continue;
      }
      items.push({
        quoteRequestId: state.quoteRequestId,
        supplierContactId: state.supplierContactId,
        reminderId,
        state: fresh,
        freshToken: null,
      });
    }
    if (items.length === 0) return 'skipped';

    // 3. Tokens novos (MESMO deadline) + render + envio.
    const first = items[0].state.candidate;
    let deliveryStatus = 'error';
    let deliveryError = '';
    let failedBeforeSend = false;
    let lateReason: 'late_send' | 'day_changed' | null = null;
    try {
      for (const item of items) {
        const { candidate, dispatchToken } = item.state;
        const created = await SupplierPortalService.createToken({
          quoteRequestId: candidate.quoteRequestId,
          supplierId: candidate.supplierId,
          supplierContactId: candidate.supplierContactId,
          createdById: candidate.createdById,
          dispatchEventId: dispatchToken?.dispatchEventId ?? candidate.dispatchEventId,
          expiresAt: candidate.expiresAt,
          reminderSentAt: now,
        });
        item.freshToken = { id: created.id, rawToken: (created as { rawToken?: string }).rawToken ?? '' };
        ctx.freshIds.push(created.id);
      }

      const linkOf = (item: SendItem): string => buildPortalLink(item.freshToken?.rawToken ?? '');
      let rendered: { subject: string; html: string; text: string };
      let templateId: string;
      if (items.length === 1) {
        const { candidate } = items[0].state;
        const closesOn = formatDisplayDate(closesOnDate(items[0].state));
        rendered = await renderReminderFromTemplate({
          subject: `Reminder: quotation for ${candidate.quoteRequest.requestCode} closes on ${closesOn}`,
          contactName: first.supplierContact.name,
          supplierName: candidate.supplier.name,
          requestCode: candidate.quoteRequest.requestCode,
          productName: candidate.quoteRequest.productName ?? '',
          expiresAt: closesOn,
          portalLink: linkOf(items[0]),
          companyName,
        });
        templateId = QUOTE_REMINDER_TEMPLATE_KEY;
      } else {
        rendered = renderReminderDigest({
          contactName: first.supplierContact.name,
          companyName,
          items: items.map((item) => ({
            requestCode: item.state.candidate.quoteRequest.requestCode,
            productName: item.state.candidate.quoteRequest.productName ?? '',
            supplierName: item.state.candidate.supplier.name,
            closesOn: formatDisplayDate(closesOnDate(item.state)),
            portalLink: linkOf(item),
          })),
        });
        templateId = QUOTE_REMINDER_DIGEST_TEMPLATE_ID;
      }

      // Limite duro logo antes do envio: dia virou ou o sweep ja passou de 240 s -> nao envia.
      if (todayKeyInSaoPaulo(clock.currentInstant()) !== todayKey) lateReason = 'day_changed';
      else if (clock.elapsed() >= REMINDER_SEND_HARD_LIMIT_MS) lateReason = 'late_send';

      if (!lateReason) {
        try {
          const delivery = await sendAndLog({
            to: { email: first.supplierContact.email.trim(), name: first.supplierContact.name },
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            templateId,
            templateVars: {
              reminderDate: todayKey,
              count: items.length,
              items: items.map((item) => ({
                tokenId: item.state.candidate.id,
                freshTokenId: item.freshToken?.id ?? null,
                reminderId: item.reminderId,
                requestCode: item.state.candidate.quoteRequest.requestCode,
              })),
            },
            relatedEntityType: 'supplierPortalToken',
            relatedEntityId: String(items[0].state.candidate.id),
          });
          deliveryStatus = delivery.status;
          deliveryError = delivery.error ?? '';
        } catch {
          // O e-mail PODE ter saido: tratado como falha do transporte (sem revogar).
          deliveryStatus = 'error';
        }
      }
    } catch {
      // createToken/render: nada saiu do servidor.
      failedBeforeSend = true;
    }

    const reminderIds = items.map((item) => item.reminderId);
    const requestCodes = items.map((item) => item.state.candidate.quoteRequest.requestCode);
    const freshIds = items.flatMap((item) => (item.freshToken ? [item.freshToken.id] : []));

    if (lateReason) {
      // Nada saiu: revoga os tokens novos e cancela os claims (skipped); o proximo dia util retenta.
      result.skippedLateSend += items.length;
      try {
        if (freshIds.length > 0) {
          await prisma.supplierPortalToken.updateMany({
            where: { id: { in: freshIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        for (const item of items) {
          await prisma.supplierPortalReminder.update({
            where: { id: item.reminderId },
            data: { status: 'skipped', freshTokenId: item.freshToken?.id ?? null, errorMessage: lateReason },
          });
        }
      } catch {
        logger.error({ reminderIds, requestCodes }, 'Falha ao registrar o cancelamento do envio atrasado.');
      }
      logger.warn(
        { reminderIds, requestCodes, lateReason, elapsedMs: clock.elapsed() },
        'Lembrete diario cancelado antes do envio.',
      );
      return 'skipped';
    }

    if (failedBeforeSend || deliveryStatus !== 'sent') {
      const comercialBlock =
        !failedBeforeSend &&
        (deliveryError === SKIPPED_COMERCIAL_RECIPIENT || deliveryError === SKIPPED_COMERCIAL_LOOKUP_FAILED);
      result.failed += 1;
      result.pairsFailed += items.length;
      if (!failedBeforeSend && deliveryError === SKIPPED_COMERCIAL_RECIPIENT) result.suppressed += 1;

      // errorMessage so com codigos fixos: o texto do transporte pode conter o e-mail.
      let claimStatus = 'failed';
      let errorMessage = `delivery_${deliveryStatus}`;
      if (failedBeforeSend) {
        errorMessage = 'prepare_error';
      } else if (comercialBlock) {
        claimStatus = deliveryError === SKIPPED_COMERCIAL_RECIPIENT ? 'suppressed' : 'failed';
        errorMessage = deliveryError;
      }

      try {
        // Tokens novos so sao revogados quando NADA saiu (falha previa ou filtro comercial).
        if ((failedBeforeSend || comercialBlock) && freshIds.length > 0) {
          await prisma.supplierPortalToken.updateMany({
            where: { id: { in: freshIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        for (const item of items) {
          await prisma.supplierPortalReminder.update({
            where: { id: item.reminderId },
            data: { status: claimStatus, freshTokenId: item.freshToken?.id ?? null, errorMessage },
          });
        }
      } catch {
        logger.error({ reminderIds, requestCodes }, 'Falha ao registrar o desfecho do lembrete diario com erro.');
      }
      // Sem e-mail, nome do contato, texto de erro SMTP ou token cru nos logs.
      logger.warn(
        { reminderIds, requestCodes, deliveryStatus: failedBeforeSend ? 'prepare_error' : deliveryStatus },
        'Lembrete diario nao enviado.',
      );
      return 'failed';
    }

    // 4. Enviado. Falhas daqui em diante so logam (o e-mail ja saiu).
    result.sent += 1;
    result.pairsSent += items.length;
    for (const item of items) {
      try {
        const revoked = await prisma.supplierPortalToken.updateMany({
          where: {
            quoteRequestId: item.quoteRequestId,
            supplierContactId: item.supplierContactId,
            revokedAt: null,
            respondedAt: null,
            id: { not: item.freshToken?.id as number },
          },
          data: { revokedAt: new Date() },
        });
        result.revokedTokens += revoked.count;
        await prisma.supplierPortalReminder.update({
          where: { id: item.reminderId },
          data: { status: 'sent', sentAt: now, freshTokenId: item.freshToken?.id ?? null },
        });
      } catch {
        logger.error(
          { reminderId: item.reminderId, requestCode: item.state.candidate.quoteRequest.requestCode },
          'Lembrete diario enviado, mas falhou ao revogar tokens antigos ou atualizar o claim.',
        );
      }
    }
    return 'sent';
  }
}
