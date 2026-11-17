import { Prisma } from '@prisma/client';
import {
  INDENT_MAILBOX,
  INDENT_MAX_SUPPLIER_EMAILS,
  INDENT_SEND_MAX_ATTACHMENT_BYTES,
  INDENT_TEMPLATE_REQUEST,
  INDENT_TOKEN_TTL_DAYS,
} from '../constants/indentPortal';
import { mailerEnv } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import type { MailAttachment } from '../mailer/Mailer';
import { SKIPPED_COMERCIAL_LOOKUP_FAILED, SKIPPED_COMERCIAL_RECIPIENT, sendAndLog } from '../mailer/MailerService';
import {
  buildIndentPortalLink,
  buildIndentSubject,
  renderIndentQuoteRequest,
  type IndentMailKindName,
} from '../mailer/renderIndentQuoteRequest';
import { HttpError } from '../utils/http';
import {
  buildClientTerms,
  buildIndentExposureProfile,
  findClientLeak,
  hasForbiddenBuyerPhrase,
  type IndentExposureProfile,
} from '../utils/indentExposure';
import { formatQuoteRef } from '../utils/indentQuote';
import type { IndentSendInput } from '../validators/indentPortal';
import { AuditLogService } from './AuditLogService';
import {
  WRITE_ROLES,
  loadQuoteDetail,
  loadQuoteWithAccepted,
  serializeDetail,
  type QuoteDetailRow,
} from './IndentQuoteService';
import { assertActionAllowed, lockIndentQuote, type LockedQuote } from './IndentQuoteWorkflowService';
import type { IndentActor } from './IndentRequestService';
import { generateToken } from './SupplierPortalService';

// IQ Indent PR 4a-1: envio da cotacao ao fornecedor por e-mail (template Indent em ingles), reenvio do link e estado da secao
// "Portal do fornecedor". Toda mutacao roda em $transaction com `lockIndentQuote` (solicitacao -> cotacao). O token CRU vive so em
// memoria ate o `sendAndLog`: nunca em MailLog.templateVars, IndentMailLog, AuditLog nem logger.

const ENTITY_TYPE = 'indent_quote';
// Envio faz ~25-30 idas ao banco (3 raw, leituras pesadas, ate 10 inserts, updates e AuditLog): folga para cold start do Cloud SQL.
const TX_OPTIONS = { timeout: 15000, maxWait: 10000 };
const ERROR_MAX = 500;

const PORT_LEAK_MESSAGE = 'O porto de destino identifica o cliente. Informe só o porto.';
const MESSAGE_LEAK_MESSAGE =
  'A mensagem cita o cliente ou diz que a SQ é a compradora. Remova antes de enviar: este fornecedor não tem parceria firmada.';
const NO_PARTNERSHIP_CLIENT_MESSAGE = 'Este fornecedor não tem parceria firmada: o nome do cliente não pode ser exibido.';
const ATTACHMENT_CONFIRM_MESSAGE = 'Confirme que conferiu que o arquivo não cita o cliente.';
const NOT_PDF_MESSAGE = 'Envie só arquivos PDF.';
const ATTACHMENTS_TOO_LARGE_MESSAGE = 'Os anexos passam de 10 MB.';
const SENT_WITHOUT_EMAIL_MESSAGE = 'Esta cotação foi marcada como enviada sem e-mail: não há link para reenviar.';
const NO_EMAIL_SENT_MESSAGE = 'Nenhum e-mail foi enviado; a cotação voltou para rascunho.';
const NO_EMAIL_RESENT_MESSAGE = 'Nenhum e-mail foi reenviado; os links anteriores continuam valendo.';

export interface IndentSendRecipientResult {
  email: string;
  status: 'sent' | 'queued' | 'failed' | 'suppressed';
  error?: string;
}

export interface IndentSendResult {
  allFailed: boolean;
  message: string | null;
  results: IndentSendRecipientResult[];
  quote: ReturnType<typeof serializeDetail>;
}

interface DecodedAttachment {
  fileName: string;
  content: Buffer;
}

interface Dispatch {
  email: string;
  rawToken: string;
  tokenId: number;
  mailLogId: number;
  expiresAt: Date;
}

interface Prepared {
  ref: string;
  subject: string;
  kind: IndentMailKindName;
  profile: IndentExposureProfile;
  dispatches: Dispatch[];
  mail: {
    processNumber: string;
    revision: number;
    destinationPort: string;
    incoterm: string;
    message: string | null;
    endCustomer: string | null;
    items: Array<{ name: string; cas: string | null; quantityKg: string }>;
  };
  oldTokenIds: number[]; // reenvio: tokens ativos antes do reenvio, com o e-mail de cada um
  oldTokenEmails: Map<number, string>;
}

type ClientIdentity = { name: string; cnpj: string | null };

function trimError(text: string): string {
  return text.slice(0, ERROR_MAX);
}

function itemName(item: QuoteDetailRow['items'][number]): string {
  return item.requestItem.product?.name ?? item.requestItem.description;
}

function sanitizeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '').trim();
  const base = cleaned.replace(/\.pdf$/i, '').trim().slice(0, 116).trim();
  return `${base || 'anexo'}.pdf`;
}

// Anexos da Compras: base64 valido, `%PDF-` e soma <= 10 MB. Sem persistencia (so seguem no e-mail).
function decodeAttachments(input: IndentSendInput['attachments']): DecodedAttachment[] {
  const files = input ?? [];
  const estimated = files.reduce((sum, file) => sum + Math.floor((file.contentBase64.length * 3) / 4), 0);

  if (estimated > INDENT_SEND_MAX_ATTACHMENT_BYTES + 8) {
    throw new HttpError(400, ATTACHMENTS_TOO_LARGE_MESSAGE, 'attachments');
  }

  let total = 0;
  const decoded = files.map((file) => {
    const compact = file.contentBase64.replace(/\s+/g, '');

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      throw new HttpError(400, NOT_PDF_MESSAGE, 'attachments');
    }

    const content = Buffer.from(compact, 'base64');

    if (content.length < 5 || content.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new HttpError(400, NOT_PDF_MESSAGE, 'attachments');
    }

    total += content.length;
    return { fileName: sanitizeFileName(file.fileName), content };
  });

  if (total > INDENT_SEND_MAX_ATTACHMENT_BYTES) {
    throw new HttpError(400, ATTACHMENTS_TOO_LARGE_MESSAGE, 'attachments');
  }

  return decoded;
}

interface ContentCheck {
  mode: 'send' | 'resend';
  quoteId: number;
  supplier: { hasPartnership: boolean };
  client: ClientIdentity;
  subject: string;
  items: Array<{ name: string; cas: string | null }>;
  destinationPort: string;
  message: string | null;
  showClientName: boolean;
  attachmentNames: string[];
  attachmentsConfirmed: boolean;
}

// Regras de conteudo (todas ANTES de qualquer gravacao). No envio sao 400 com `path` (a tela marca o campo); no reenvio, 422.
function checkContent(check: ContentCheck): void {
  const reject = (message: string, path: string) =>
    check.mode === 'send' ? new HttpError(400, message, path) : new HttpError(422, message);
  const terms = buildClientTerms(check.client);
  const { hasPartnership } = check.supplier;

  if (check.showClientName && !hasPartnership) {
    throw reject(NO_PARTNERSHIP_CLIENT_MESSAGE, 'showClientName');
  }
  if (findClientLeak({ destinationPort: check.destinationPort }, terms)) {
    throw reject(PORT_LEAK_MESSAGE, 'destinationPort');
  }
  if (hasPartnership) {
    return;
  }
  if (check.message && (findClientLeak({ message: check.message }, terms) || hasForbiddenBuyerPhrase(check.message))) {
    throw reject(MESSAGE_LEAK_MESSAGE, 'message');
  }
  if (check.mode === 'send' && check.attachmentNames.length > 0 && !check.attachmentsConfirmed) {
    throw reject(ATTACHMENT_CONFIRM_MESSAGE, 'attachmentsConfirmed');
  }

  // Sentinela: nenhum campo que sai para o fornecedor pode citar o cliente. O log leva so a CHAVE, nunca o valor.
  const fields: Record<string, string | null> = {
    subject: check.subject,
    firstItemName: check.items[0]?.name ?? null,
    destinationPort: check.destinationPort,
    message: check.message,
  };
  check.items.forEach((item, index) => {
    fields[`items[${index}].name`] = item.name;
    fields[`items[${index}].cas`] = item.cas;
  });
  check.attachmentNames.forEach((name, index) => {
    fields[`attachments[${index}].fileName`] = name;
  });

  const leakField = findClientLeak(fields, terms);

  if (leakField) {
    logger.warn({ quoteId: check.quoteId, field: leakField }, 'Sentinela do Indent barrou o envio: o conteudo identifica o cliente.');
    throw new HttpError(
      422,
      `O conteúdo do e-mail identifica o cliente (campo: ${leakField}). Revise o item ou o porto antes de enviar.`,
    );
  }
}

async function loadSupplierAndClient(tx: Prisma.TransactionClient, quote: QuoteDetailRow) {
  const supplier = await tx.indentSupplier.findUnique({
    where: { id: quote.supplierId },
    select: { id: true, name: true, hasPartnership: true, isActive: true, contactEmails: true },
  });

  if (!supplier) {
    throw new HttpError(404, 'Fornecedor não encontrado.');
  }
  if (!supplier.isActive) {
    throw new HttpError(409, 'Este fornecedor está inativo no Indent.');
  }

  const clientId = quote.request.client?.id;

  if (!clientId) {
    throw new HttpError(409, 'Vincule o cliente antes de enviar.');
  }

  const client = await tx.indentClient.findUnique({ where: { id: clientId }, select: { name: true, cnpj: true } });

  if (!client) {
    throw new HttpError(409, 'Vincule o cliente antes de enviar.');
  }

  return { supplier, client };
}

function assertSendable(quote: QuoteDetailRow): string {
  const processNumber = quote.request.processNumber;

  if (!processNumber) {
    throw new HttpError(409, 'Digite a referência da solicitação antes de enviar.');
  }
  if (!quote.request.client) {
    throw new HttpError(409, 'Vincule o cliente antes de enviar.');
  }
  if (quote.items.length === 0) {
    throw new HttpError(409, 'A cotação não tem itens.');
  }

  return processNumber;
}

function mailItems(quote: QuoteDetailRow) {
  return quote.items.map((item) => ({
    name: itemName(item),
    cas: item.requestItem.product?.cas ?? null,
    quantityKg: new Prisma.Decimal(item.requestItem.quantityKg as Prisma.Decimal.Value).toFixed(3),
  }));
}

// Um token e um IndentMailLog `queued` por destinatario (dentro da transacao). O token cru volta so em memoria.
async function createDispatches(
  tx: Prisma.TransactionClient,
  args: {
    quote: QuoteDetailRow;
    recipients: string[];
    profile: IndentExposureProfile;
    destinationPort: string;
    message: string | null;
    kind: IndentMailKindName;
    subject: string;
    attachmentNames: string[];
    attachmentsConfirmed: boolean;
    user: IndentActor;
    now: Date;
  },
): Promise<Dispatch[]> {
  const dispatches: Dispatch[] = [];

  for (const email of args.recipients) {
    const { rawToken, tokenHash, expiresAt } = generateToken(INDENT_TOKEN_TTL_DAYS);
    const token = await tx.indentPortalToken.create({
      data: {
        quoteId: args.quote.id,
        supplierId: args.quote.supplierId,
        recipientEmail: email,
        tokenHash,
        expiresAt,
        showClientName: args.profile.showClient,
        destinationPort: args.destinationPort,
        message: args.message,
        createdById: args.user.id,
      },
      select: { id: true },
    });
    const mailLog = await tx.indentMailLog.create({
      data: {
        quoteId: args.quote.id,
        tokenId: token.id,
        kind: args.kind,
        toEmail: email,
        subject: args.subject,
        templateId: INDENT_TEMPLATE_REQUEST,
        status: 'queued',
        hasPartnership: args.profile.hasPartnership,
        showClientName: args.profile.showClient,
        attachmentNames: args.attachmentNames,
        ...(args.attachmentsConfirmed ? { attachmentsConfirmedAt: args.now, attachmentsConfirmedById: args.user.id } : {}),
        sentById: args.user.id,
      },
      select: { id: true },
    });
    dispatches.push({ email, rawToken, tokenId: token.id, mailLogId: mailLog.id, expiresAt });
  }

  return dispatches;
}

// Depois do commit: envia, atualiza cada IndentMailLog e devolve o resultado por destinatario.
async function deliver(prepared: Prepared, attachments: DecodedAttachment[], quoteId: number): Promise<IndentSendRecipientResult[]> {
  const mailAttachments: MailAttachment[] = attachments.map((file) => ({
    filename: file.fileName,
    content: file.content,
    contentType: 'application/pdf',
  }));

  const settled = await Promise.allSettled(
    // async: uma falha ao renderizar vira `failed` so daquele destinatario (o commit ja aconteceu).
    prepared.dispatches.map(async (dispatch) => {
      const rendered = renderIndentQuoteRequest({
        ...prepared.mail,
        subject: prepared.subject,
        portalLink: buildIndentPortalLink(dispatch.rawToken),
        expiresAt: dispatch.expiresAt,
      });

      return sendAndLog({
        to: { email: dispatch.email },
        replyTo: { email: INDENT_MAILBOX, name: 'SQ Quimica Indent' },
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: INDENT_TEMPLATE_REQUEST,
        templateVars: {
          quoteId,
          ref: prepared.ref,
          kind: prepared.kind,
          hasPartnership: prepared.profile.hasPartnership,
          showClientName: prepared.profile.showClient,
        },
        relatedEntityType: ENTITY_TYPE,
        relatedEntityId: String(quoteId),
        ...(mailAttachments.length > 0 ? { attachments: mailAttachments } : {}),
      });
    }),
  );

  const results: IndentSendRecipientResult[] = settled.map((outcome, index) => {
    const email = prepared.dispatches[index].email;

    if (outcome.status === 'rejected') {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      return { email, status: 'failed', error: trimError(reason) };
    }

    const { status, error } = outcome.value;

    if (status === 'failed') {
      const skipped = error === SKIPPED_COMERCIAL_RECIPIENT || error === SKIPPED_COMERCIAL_LOOKUP_FAILED;
      return { email, status: skipped ? 'suppressed' : 'failed', error: trimError(error ?? 'Falha no envio.') };
    }

    return { email, status: status === 'queued' ? 'queued' : 'sent' };
  });

  await Promise.all(
    results.map(async (result, index) => {
      const providerMessageId =
        settled[index].status === 'fulfilled'
          ? ((settled[index] as PromiseFulfilledResult<{ providerMessageId: string }>).value.providerMessageId || null)
          : null;

      try {
        await prisma.indentMailLog.update({
          where: { id: prepared.dispatches[index].mailLogId },
          data: {
            status: result.status,
            providerMessageId,
            errorMessage: result.error ? trimError(result.error) : null,
            sentAt: result.status === 'sent' ? new Date() : null,
          },
        });
      } catch (error) {
        logger.error(
          { quoteId, mailLogId: prepared.dispatches[index].mailLogId, reason: error instanceof Error ? error.message : String(error) },
          'Falha ao atualizar o IndentMailLog apos o envio.',
        );
      }
    }),
  );

  return results;
}

const isDelivered = (result: IndentSendRecipientResult) => result.status === 'sent' || result.status === 'queued';

async function reloadDetail(quoteId: number, role: string) {
  return loadQuoteDetail(prisma, quoteId, WRITE_ROLES.includes(role));
}

export class IndentDispatchService {
  // Leitura (sem trava) para o modal "Enviar ao fornecedor".
  static async getSendContext(quoteId: number, _role: string) {
    const { row: quote, accepted } = await loadQuoteWithAccepted(prisma, quoteId);
    assertActionAllowed('send', { quote, accepted });

    const supplier = await prisma.indentSupplier.findUnique({
      where: { id: quote.supplierId },
      select: { id: true, name: true, hasPartnership: true, contactEmails: true },
    });
    const items = mailItems(quote);
    const processNumber = quote.request.processNumber ?? '';
    const firstItemName = items[0]?.name ?? '';

    return {
      processRef: formatQuoteRef(quote.request.processNumber, quote.revision),
      kind: (quote.revision > 1 ? 'REVISION' : 'REQUEST') as 'REQUEST' | 'REVISION',
      subject: buildIndentSubject(processNumber, quote.revision, firstItemName),
      fromDisplay: mailerEnv.smtp.from || mailerEnv.smtp.user || '',
      replyTo: INDENT_MAILBOX,
      supplier: {
        id: quote.supplier.id,
        name: quote.supplier.name,
        hasPartnership: supplier?.hasPartnership ?? quote.supplier.hasPartnership,
        contactEmails: supplier?.contactEmails ?? [],
      },
      clientName: quote.request.client?.name ?? null,
      destinationPort: quote.destination,
      firstItemName,
    };
  }

  // RASCUNHO -> ENVIADA por e-mail (novo pedido ou revisao R2+).
  static async send(
    quoteId: number,
    input: IndentSendInput,
    user: IndentActor,
    role: string,
    now: Date = new Date(),
  ): Promise<IndentSendResult> {
    const attachments = decodeAttachments(input.attachments); // fora da transacao: so valida e decodifica

    const prepared = await prisma.$transaction(async (tx): Promise<Prepared> => {
      const locked: LockedQuote = await lockIndentQuote(tx, quoteId);
      assertActionAllowed('send', locked);
      const { quote } = locked;
      const processNumber = assertSendable(quote);
      const { supplier, client } = await loadSupplierAndClient(tx, quote);

      const items = mailItems(quote);
      const kind: IndentMailKindName = quote.revision > 1 ? 'REVISION' : 'REQUEST';
      const subject = buildIndentSubject(processNumber, quote.revision, items[0].name);
      const attachmentNames = attachments.map((file) => file.fileName);

      checkContent({
        mode: 'send',
        quoteId,
        supplier,
        client,
        subject,
        items,
        destinationPort: input.destinationPort,
        message: input.message,
        showClientName: input.showClientName,
        attachmentNames,
        attachmentsConfirmed: input.attachmentsConfirmed === true,
      });

      const known = new Set(supplier.contactEmails);
      const added = input.saveToSupplier ? input.recipients.filter((email) => !known.has(email)) : [];

      if (added.length > 0 && supplier.contactEmails.length + added.length > INDENT_MAX_SUPPLIER_EMAILS) {
        throw new HttpError(
          400,
          `O cadastro do fornecedor já tem ${INDENT_MAX_SUPPLIER_EMAILS} e-mails; desmarque "Salvar no cadastro".`,
          'saveToSupplier',
        );
      }

      const profile = buildIndentExposureProfile(supplier, input.showClientName);
      const ref = formatQuoteRef(processNumber, quote.revision);

      if (quote.revision > 1) {
        await tx.indentPortalToken.updateMany({
          where: {
            revokedAt: null,
            quote: { requestId: quote.requestId, supplierId: quote.supplierId, revision: { lt: quote.revision } },
          },
          data: { revokedAt: now, revokedReason: 'superseded' },
        });
      }

      const dispatches = await createDispatches(tx, {
        quote,
        recipients: input.recipients,
        profile,
        destinationPort: input.destinationPort,
        message: input.message,
        kind,
        subject,
        attachmentNames,
        attachmentsConfirmed: input.attachmentsConfirmed === true && attachmentNames.length > 0,
        user,
        now,
      });

      if (added.length > 0) {
        const after = [...supplier.contactEmails, ...added];
        await tx.indentSupplier.update({ where: { id: supplier.id }, data: { contactEmails: after } });
        await AuditLogService.log(
          {
            entityType: 'indent_supplier',
            entityId: supplier.id,
            action: 'indent_supplier.contact_emails_added',
            performedById: user.id,
            beforeData: { contactEmails: supplier.contactEmails },
            afterData: { contactEmails: after },
            metadata: { quoteId, ref },
          },
          tx,
        );
      }

      await tx.indentQuote.update({ where: { id: quoteId }, data: { status: 'ENVIADA', sentAt: now } });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: quoteId,
          action: 'indent_quote.sent',
          performedById: user.id,
          beforeData: { status: quote.status },
          afterData: { status: 'ENVIADA' },
          metadata: {
            via: 'email',
            ref,
            kind,
            recipients: input.recipients,
            hasPartnership: profile.hasPartnership,
            showClientName: profile.showClient,
            attachmentNames,
          },
        },
        tx,
      );

      return {
        ref,
        subject,
        kind,
        profile,
        dispatches,
        oldTokenIds: [],
        oldTokenEmails: new Map(),
        mail: {
          processNumber,
          revision: quote.revision,
          destinationPort: input.destinationPort,
          incoterm: quote.incoterm,
          message: input.message,
          endCustomer: profile.showClient ? client.name : null,
          items,
        },
      };
    }, TX_OPTIONS);

    const results = await deliver(prepared, attachments, quoteId);
    const failedTokenIds = prepared.dispatches.filter((_, index) => !isDelivered(results[index])).map((dispatch) => dispatch.tokenId);
    const allFailed = results.every((result) => !isDelivered(result));

    if (allFailed) {
      await IndentDispatchService.compensateSend(quoteId, failedTokenIds, user, prepared.ref, now);
    } else if (failedTokenIds.length > 0) {
      await prisma.indentPortalToken.updateMany({
        where: { id: { in: failedTokenIds } },
        data: { revokedAt: now, revokedReason: 'send_failed' },
      });
    }

    return {
      allFailed,
      message: allFailed ? NO_EMAIL_SENT_MESSAGE : null,
      results,
      quote: await reloadDetail(quoteId, role),
    };
  }

  // Todos os destinatarios falharam: a cotacao volta a RASCUNHO (se nada mudou desde o envio) e os links deste envio sao revogados.
  // O `contactEmails` salvo NAO e desfeito.
  // Numa revisao (R2+), os tokens da versao anterior (`superseded` no envio) NAO sao reabertos: o plano manda assim e a R1 ja foi respondida/REVISADA.
  private static async compensateSend(quoteId: number, tokenIds: number[], user: IndentActor, ref: string, now: Date) {
    await prisma.$transaction(async (tx) => {
      const { quote } = await lockIndentQuote(tx, quoteId);
      const response = await tx.indentPortalResponse.findUnique({ where: { quoteId }, select: { id: true } });

      if (quote.status === 'ENVIADA' && quote.respondedAt === null && !response) {
        await tx.indentQuote.update({ where: { id: quoteId }, data: { status: 'RASCUNHO', sentAt: null } });
      }

      await tx.indentPortalToken.updateMany({
        where: { id: { in: tokenIds } },
        data: { revokedAt: now, revokedReason: 'send_failed' },
      });
      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: quoteId,
          action: 'indent_quote.send_failed',
          performedById: user.id,
          beforeData: { status: quote.status },
          afterData: { status: quote.status === 'ENVIADA' && quote.respondedAt === null && !response ? 'RASCUNHO' : quote.status },
          metadata: { ref },
        },
        tx,
      );
    }, TX_OPTIONS);
  }

  // Reenvio do link (R10): cria tokens novos e so revoga os antigos DEPOIS, para quem recebeu. Todos falharam: 502 e os links antigos valem.
  static async resend(quoteId: number, user: IndentActor, role: string, now: Date = new Date()): Promise<IndentSendResult> {
    const prepared = await prisma.$transaction(async (tx): Promise<Prepared> => {
      const locked: LockedQuote = await lockIndentQuote(tx, quoteId);
      assertActionAllowed('resend', locked);
      const { quote } = locked;
      const processNumber = assertSendable(quote);

      if ((quote._count?.portalTokens ?? 0) === 0) {
        throw new HttpError(409, SENT_WITHOUT_EMAIL_MESSAGE);
      }

      const { supplier, client } = await loadSupplierAndClient(tx, quote);
      const active = await tx.indentPortalToken.findMany({
        where: { quoteId, revokedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, recipientEmail: true, destinationPort: true, message: true, showClientName: true },
      });

      if (active.length === 0) {
        throw new HttpError(409, SENT_WITHOUT_EMAIL_MESSAGE);
      }

      const latest = active[0];
      const recipients = Array.from(new Set(active.map((token) => token.recipientEmail)));
      const items = mailItems(quote);
      const subject = buildIndentSubject(processNumber, quote.revision, items[0].name);
      // Perfil recalculado com a parceria ATUAL: parceria desligada depois do envio some com o nome do cliente.
      const profile = buildIndentExposureProfile(supplier, latest.showClientName);

      checkContent({
        mode: 'resend',
        quoteId,
        supplier,
        client,
        subject,
        items,
        destinationPort: latest.destinationPort,
        message: latest.message,
        showClientName: false,
        attachmentNames: [],
        attachmentsConfirmed: false,
      });

      const ref = formatQuoteRef(processNumber, quote.revision);
      const dispatches = await createDispatches(tx, {
        quote,
        recipients,
        profile,
        destinationPort: latest.destinationPort,
        message: latest.message,
        kind: 'RESEND',
        subject,
        attachmentNames: [],
        attachmentsConfirmed: false,
        user,
        now,
      });

      await AuditLogService.log(
        {
          entityType: ENTITY_TYPE,
          entityId: quoteId,
          action: 'indent_quote.resent',
          performedById: user.id,
          metadata: { via: 'email', ref, recipients, hasPartnership: profile.hasPartnership, showClientName: profile.showClient },
        },
        tx,
      );

      return {
        ref,
        subject,
        kind: 'RESEND',
        profile,
        dispatches,
        oldTokenIds: active.map((token) => token.id),
        oldTokenEmails: new Map(active.map((token) => [token.id, token.recipientEmail])),
        mail: {
          processNumber,
          revision: quote.revision,
          destinationPort: latest.destinationPort,
          incoterm: quote.incoterm,
          message: latest.message,
          endCustomer: profile.showClient ? client.name : null,
          items,
        },
      };
    }, TX_OPTIONS);

    const results = await deliver(prepared, [], quoteId);
    const delivered = new Set(results.filter(isDelivered).map((result) => result.email));
    const failedTokenIds = prepared.dispatches.filter((_, index) => !isDelivered(results[index])).map((dispatch) => dispatch.tokenId);
    const supersededIds = prepared.oldTokenIds.filter((id) => delivered.has(prepared.oldTokenEmails.get(id) ?? ''));

    if (supersededIds.length > 0) {
      await prisma.indentPortalToken.updateMany({
        where: { id: { in: supersededIds }, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'resend' },
      });
    }
    if (failedTokenIds.length > 0) {
      await prisma.indentPortalToken.updateMany({
        where: { id: { in: failedTokenIds } },
        data: { revokedAt: now, revokedReason: 'send_failed' },
      });
    }

    const allFailed = delivered.size === 0;

    return {
      allFailed,
      message: allFailed ? NO_EMAIL_RESENT_MESSAGE : null,
      results,
      quote: await reloadDetail(quoteId, role),
    };
  }

  // Estado da secao "Portal do fornecedor" (leitura, sem trava).
  static async getPortalState(quoteId: number, role: string) {
    const detail = await loadQuoteDetail(prisma, quoteId, WRITE_ROLES.includes(role));
    const [tokens, mails, lastSent, response, attachments] = await Promise.all([
      prisma.indentPortalToken.findMany({
        where: { quoteId },
        select: { recipientEmail: true, revokedAt: true, expiresAt: true, lastSeenAt: true },
      }),
      prisma.indentMailLog.findMany({
        where: { quoteId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          kind: true,
          toEmail: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          sentAt: true,
          attachmentNames: true,
        },
      }),
      prisma.indentMailLog.findFirst({
        where: { quoteId, status: { in: ['sent', 'queued'] }, sentAt: { not: null } },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
      prisma.indentPortalResponse.findUnique({ where: { quoteId }, select: { version: true, submittedAt: true } }),
      prisma.indentPortalAttachment.findMany({
        where: { quoteId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, fileName: true, fileSize: true, createdAt: true },
      }),
    ]);

    const active = tokens.filter((token) => token.revokedAt === null);
    const maxDate = (dates: Array<Date | null>): Date | null =>
      dates.reduce<Date | null>((best, date) => (date && (!best || date > best) ? date : best), null);

    const state =
      response || detail.respondedAt
        ? 'RESPONDIDO'
        : detail.status === 'RASCUNHO'
          ? 'NAO_ENVIADO'
          : tokens.length === 0
            ? 'MARCADA_SEM_EMAIL'
            : 'AGUARDANDO';

    return {
      state,
      lastSentAt: lastSent?.sentAt ?? null,
      recipients: Array.from(new Set(active.map((token) => token.recipientEmail))),
      lastAccessAt: maxDate(tokens.map((token) => token.lastSeenAt)),
      expiresAt: maxDate(active.map((token) => token.expiresAt)),
      canResend: detail.allowedActions.includes('resend'),
      mails,
      response: response
        ? { version: response.version, submittedAt: response.submittedAt, via: 'portal' as const }
        : detail.respondedAt
          ? { version: null, submittedAt: detail.respondedAt, via: 'manual' as const }
          : null,
      attachments,
    };
  }
}
