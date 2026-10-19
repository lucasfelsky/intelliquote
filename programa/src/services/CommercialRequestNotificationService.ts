import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import { getComexCcList, sendAndLog } from '../mailer/MailerService';
import {
  COMMERCIAL_REQUEST_CREATED_TEMPLATE_KEY,
  renderCommercialRequestCreatedFromTemplate,
} from '../mailer/renderCommercialRequestCreated';
import {
  CompanyProfileService,
  excludeComercialRecipients,
  readDispatchCc,
} from './CompanyProfileService';

interface Recipient {
  email: string;
  name?: string;
}

// Destinatarios = lista COMEX do ambiente + CC padrao do perfil da empresa,
// dedup case-insensitive. Primeiro vira `to`; o resto vai em `cc`.
async function resolveRecipients(): Promise<Recipient[]> {
  const profile = await CompanyProfileService.get();
  const candidates: Recipient[] = [
    ...getComexCcList(),
    ...readDispatchCc(profile).map((email) => ({ email })),
  ];

  // Quem estava no dispatchCc e depois virou `comercial` nao recebe o aviso interno.
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
}

function formatPrice(value: unknown): string {
  if (value && typeof value === 'object' && 'toFixed' in value) {
    return (value as { toFixed: (digits: number) => string }).toFixed(2);
  }
  return String(value);
}
