import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import { getComexCcList, sendAndLog } from '../mailer/MailerService';
import {
  COMMERCIAL_REQUEST_CREATED_TEMPLATE_KEY,
  renderCommercialRequestCreatedFromTemplate,
} from '../mailer/renderCommercialRequestCreated';
import {
  COMMERCIAL_REQUEST_STATUS_CHANGED_TEMPLATE_KEY,
  renderCommercialRequestStatusChangedFromTemplate,
} from '../mailer/renderCommercialRequestStatusChanged';
import {
  CompanyProfileService,
  excludeComercialRecipients,
  readCommercialRequestNotifyEmails,
  readDispatchCc,
} from './CompanyProfileService';

interface Recipient {
  email: string;
  name?: string;
}

// Destinatarios: se o perfil da empresa tem a lista propria do aviso
// (commercialRequestNotifyEmails), vai SO para ela. Vazia: lista COMEX do
// ambiente + CC padrao do perfil (comportamento anterior). Em ambos os casos,
// dedup case-insensitive e sem usuarios `comercial`. Primeiro vira `to`; o resto, `cc`.
async function resolveRecipients(): Promise<Recipient[]> {
  const profile = await CompanyProfileService.get();
  const notifyEmails = readCommercialRequestNotifyEmails(profile);
  const candidates: Recipient[] =
    notifyEmails.length > 0
      ? notifyEmails.map((email) => ({ email }))
      : [...getComexCcList(), ...readDispatchCc(profile).map((email) => ({ email }))];

  // Quem estava na lista (dispatchCc ou lista propria) e depois virou `comercial` nao recebe o aviso interno.
  const eligible = await excludeComercialRecipients(candidates);

  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const candidate of eligible) {
    const key = candidate.email?.trim().toLowerCase();
    if (!key || !key.includes('@') || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: candidate.email.trim(), ...(candidate.name ? { name: candidate.name } : {}) });
  }
  return out;
}

// Aviso a Equipe COMEX de nova solicitacao do comercial.
//
// Regras de robustez (mesmo padrao de SupplierResponseNotificationService):
// - NUNCA lanca: falha aqui nao pode falhar a criacao da solicitacao.
// - Chamado APOS o commit da transacao.
export class CommercialRequestNotificationService {
  static async notifyComexOfNewRequest(requestId: number): Promise<void> {
    try {
      const request = await prisma.commercialRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          customerName: true,
          notes: true,
          requestedBy: { select: { name: true } },
          items: {
            orderBy: { id: 'asc' },
            select: {
              quantity: true,
              unit: true,
              targetPrice: true,
              targetCurrency: true,
              catalogItem: { select: { commercialName: true } },
            },
          },
        },
      });

      if (!request) {
        logger.warn({ requestId }, 'Solicitacao do comercial nao encontrada para o aviso.');
        return;
      }

      const recipients = await resolveRecipients();
      if (recipients.length === 0) {
        logger.warn(
          { requestId },
          'Nenhum destinatario COMEX configurado; aviso de solicitacao do comercial nao enviado.',
        );
        return;
      }

      const itemsSummary = request.items
        .map((item) => {
          const hasPrice = item.targetPrice !== null && item.targetPrice !== undefined;
          const target = hasPrice
            ? ` — alvo ${formatPrice(item.targetPrice)} ${item.targetCurrency ?? ''}`.trimEnd()
            : '';
          return `${item.catalogItem.commercialName} — ${item.quantity} ${item.unit}${target}`;
        })
        .join('\n');

      const requesterName = request.requestedBy.name;
      const base = mailerEnv.portalUrl.replace(/\/$/, '');

      const rendered = await renderCommercialRequestCreatedFromTemplate({
        subject: `[IntelliQuote] Nova solicitação do comercial #${request.id} — ${requesterName}`,
        requesterName,
        requestId: request.id,
        customerName: request.customerName ?? '',
        itemsSummary,
        notes: request.notes ?? '',
        requestsUrl: `${base}/solicitacoes`,
      });

      const [to, ...cc] = recipients;
      await sendAndLog({
        to,
        cc,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: COMMERCIAL_REQUEST_CREATED_TEMPLATE_KEY,
        templateVars: {
          requestId: request.id,
          requesterName,
          itemsCount: request.items.length,
        },
        relatedEntityType: 'commercial_request',
        relatedEntityId: String(request.id),
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao avisar a Equipe COMEX sobre solicitacao do comercial.',
      );
    }
  }

  // Aviso ao SOLICITANTE (comercial) a cada mudanca de status feita pelo COMEX.
  // Nunca lanca (mesma regra do aviso ao COMEX); chamado APOS o commit.
  // Conteudo: status, codigo da cotacao e motivo da recusa. NUNCA preco, fornecedor,
  // parceiro, fulfillmentNote nem nome de mercado.
  //
  // `change` = o que a acao acabou de gravar (status, codigo da cotacao, motivo). Quando vem,
  // o e-mail usa estes valores e NAO o estado atual do banco: duas mudancas rapidas nao geram
  // dois e-mails do mesmo status. Sem `change`, le o estado atual.
  static async notifyRequesterOfStatusChange(
    requestId: number,
    change?: {
      status: string;
      quoteCode?: string | null;
      rejectionReason?: string | null;
    },
  ): Promise<void> {
    try {
      const request = await prisma.commercialRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          status: true,
          rejectionReason: true,
          requestedBy: { select: { name: true, email: true, isActive: true } },
          quoteRequest: { select: { requestCode: true, deletedAt: true } },
        },
      });

      if (!request) {
        logger.warn({ requestId }, 'Solicitacao do comercial nao encontrada para o aviso de status.');
        return;
      }

      const effectiveStatus = change?.status ?? request.status;
      const status = STATUS_COPY[effectiveStatus];
      if (!status) return; // pending: nada a avisar.

      const email = request.requestedBy.email?.trim();
      if (!request.requestedBy.isActive || !email || !email.includes('@')) {
        logger.warn(
          { requestId },
          'Solicitante inativo ou sem e-mail; aviso de status da solicitacao nao enviado.',
        );
        return;
      }

      const quoteCode =
        change !== undefined
          ? (change.quoteCode ?? '')
          : request.quoteRequest && request.quoteRequest.deletedAt === null
            ? request.quoteRequest.requestCode
            : '';
      const rejectionReason =
        effectiveStatus === 'rejected'
          ? ((change !== undefined ? change.rejectionReason : request.rejectionReason) ?? '')
          : '';
      const base = mailerEnv.portalUrl.replace(/\/$/, '');
      const statusMessage = status.message(request.id);

      const rendered = await renderCommercialRequestStatusChangedFromTemplate({
        subject: `[IntelliQuote] Solicitação #${request.id} — ${status.label}`,
        requestId: request.id,
        statusLabel: status.label,
        statusMessage,
        quoteCode,
        rejectionReason,
        requestsUrl: `${base}/solicitacoes`,
      });

      // ATENCAO: este e o UNICO uso permitido do opt-out allowComercialRecipients. O opt-out
      // pula o applyComercialGuard INTEIRO; a garantia de que ninguem indevido recebe e
      // estrutural: so o solicitante vai em `to` e NUNCA se passa `cc`.
      await sendAndLog({
        to: { email, name: request.requestedBy.name },
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: COMMERCIAL_REQUEST_STATUS_CHANGED_TEMPLATE_KEY,
        templateVars: { requestId: request.id, status: effectiveStatus, quoteCode },
        relatedEntityType: 'commercial_request',
        relatedEntityId: String(request.id),
        allowComercialRecipients: true,
      });
    } catch (error) {
      logger.error(
        {
          requestId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao avisar o solicitante sobre a mudanca de status da solicitacao.',
      );
    }
  }
}

const STATUS_COPY: Record<string, { label: string; message: (id: number) => string }> = {
  quoting: { label: 'Em cotação', message: (id) => `Sua solicitação #${id} entrou em cotação.` },
  fulfilled: {
    label: 'Atendida',
    message: (id) => `Sua solicitação #${id} foi atendida. Consulte o resultado no IntelliQuote.`,
  },
  rejected: { label: 'Recusada', message: (id) => `Sua solicitação #${id} foi recusada.` },
};

function formatPrice(value: unknown): string {
  if (value && typeof value === 'object' && 'toFixed' in value) {
    return (value as { toFixed: (digits: number) => string }).toFixed(2);
  }
  return String(value);
}
