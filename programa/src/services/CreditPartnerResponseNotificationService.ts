import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailerEnv } from '../config/env';
import { sendAndLog } from '../mailer/MailerService';
import {
  CREDIT_PARTNER_RESPONSE_RECEIVED_TEMPLATE_KEY,
  renderCreditPartnerResponseReceivedFromTemplate,
} from '../mailer/renderCreditPartnerResponseReceived';
import {
  CREDIT_SUPPORT_ENTITY_TYPE,
  dedupeCc,
  loadComexCc,
  markupPercent,
} from './CreditSupportService';

interface InternalUser {
  name: string;
  email: string;
  isActive: boolean;
}

interface Recipient {
  email: string;
  name: string;
}

// Mesma regra de texto de indisponiveis do aviso do fornecedor.
function formatItemsCount(total: number, unavailable: number): string {
  if (unavailable <= 0) return String(total);
  if (unavailable >= total) {
    return total === 1
      ? `${total} (temporariamente indisponível)`
      : `${total} (todos temporariamente indisponíveis)`;
  }
  return `${total} (${unavailable} temporariamente ${unavailable > 1 ? 'indisponíveis' : 'indisponível'})`;
}

function formatMarkup(markup: string | null): string {
  if (markup === null) return '';
  return Number(markup) >= 0 ? `+${markup}%` : `${markup}%`;
}

// PR5 (Credit Support): avisa os compradores quando o parceiro de credito
// responde (ou revisa) pelo portal publico. Destinatarios: quem encaminhou o
// pedido + criador da cotacao (sem repetir, ignorando inativo/sem e-mail) e
// copia COMEX (mesma regra do envio). sendAndLog aceita um unico `to`, entao
// o 1o usuario vai em To e o 2o + COMEX em CC (um unico e-mail / MailLog).
//
// Regras de robustez:
// - NUNCA lanca: falha aqui nao pode falhar o submit do parceiro.
// - Chamado APOS a transacao do submit (dados ja commitados).
// - Recebe so' o id do pedido: nenhum token/link do portal do parceiro entra
//   no e-mail nem no log.
export class CreditPartnerResponseNotificationService {
  static async notifyBuyerOfPartnerResponse(input: {
    requestId: number;
    version: number;
    revised: boolean;
  }): Promise<void> {
    try {
      const request = await prisma.creditSupportRequest.findUnique({
        where: { id: input.requestId },
        select: {
          id: true,
          currency: true,
          originalPaymentTermsDays: true,
          originalTotalPrice: true,
          partnerPaymentTermsDays: true,
          partnerValidityDays: true,
          partnerNotes: true,
          partnerTotalPrice: true,
          createdBy: { select: { name: true, email: true, isActive: true } },
          quoteRequest: {
            select: {
              id: true,
              requestCode: true,
              productName: true,
              createdBy: { select: { name: true, email: true, isActive: true } },
            },
          },
          creditPartner: { select: { name: true } },
          supplier: { select: { name: true } },
          items: { select: { isUnavailable: true } },
        },
      });

      if (!request) {
        logger.warn(
          { creditSupportRequestId: input.requestId },
          'Aviso de resposta do parceiro de crédito sem pedido encontrado.',
        );
        return;
      }

      const candidates: Recipient[] = [];
      const seen = new Set<string>();
      const usersInOrder: Array<InternalUser | null | undefined> = [
        request.createdBy,
        request.quoteRequest.createdBy,
      ];
      for (const user of usersInOrder) {
        const email = user?.email?.trim();
        if (!user || user.isActive === false || !email) continue;
        const lower = email.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        candidates.push({ email, name: user.name });
      }

      if (candidates.length === 0) {
        logger.info(
          { creditSupportRequestId: input.requestId },
          'Sem comprador ativo para avisar sobre resposta do parceiro de crédito.',
        );
        return;
      }

      const [to, secondUser] = candidates;

      // Problema no perfil da empresa nao pode impedir o aviso aos compradores.
      let comexCc: Recipient[] = [];
      try {
        comexCc = await loadComexCc();
      } catch (error) {
        logger.warn(
          {
            creditSupportRequestId: input.requestId,
            reason: error instanceof Error ? error.message : String(error),
          },
          'Falha ao carregar cópia COMEX do aviso de resposta do parceiro de crédito.',
        );
      }
      const ccList = dedupeCc(secondUser ? [secondUser, ...comexCc] : comexCc, to.email);

      const requestCode = request.quoteRequest.requestCode;
      const partnerName = request.creditPartner.name;
      const supplierName = request.supplier.name;
      const revisionLabel = input.revised ? `revisão v${input.version}` : '';
      const base = mailerEnv.portalUrl.replace(/\/$/, '');
      const unavailable = request.items.filter((item) => item.isUnavailable).length;
      const partnerTotal = request.partnerTotalPrice;
      const markup = markupPercent(partnerTotal, request.originalTotalPrice);

      const rendered = await renderCreditPartnerResponseReceivedFromTemplate({
        subject: input.revised
          ? `[IntelliQuote] ${partnerName} revisou a resposta de crédito da cotação ${requestCode} (v${input.version})`
          : `[IntelliQuote] ${partnerName} respondeu ao pedido de crédito da cotação ${requestCode}`,
        buyerName: to.name,
        partnerName,
        supplierName,
        requestCode,
        productName: request.quoteRequest.productName ?? '',
        currency: request.currency,
        partnerTotal: partnerTotal ? partnerTotal.toFixed(2) : '',
        originalTotal: request.originalTotalPrice.toFixed(2),
        markupLabel: formatMarkup(markup),
        partnerPaymentTermsDays:
          request.partnerPaymentTermsDays === null ? '' : String(request.partnerPaymentTermsDays),
        originalPaymentTermsDays: String(request.originalPaymentTermsDays),
        validityDays:
          request.partnerValidityDays === null ? '' : String(request.partnerValidityDays),
        itemsCount: formatItemsCount(request.items.length, unavailable),
        notes: request.partnerNotes ?? '',
        revisionLabel,
        quoteUrl: `${base}/cotacoes/${request.quoteRequest.id}`,
      });

      await sendAndLog({
        to,
        ...(ccList.length > 0 ? { cc: ccList } : {}),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateId: CREDIT_PARTNER_RESPONSE_RECEIVED_TEMPLATE_KEY,
        templateVars: {
          creditSupportRequestId: input.requestId,
          quoteRequestId: request.quoteRequest.id,
          requestCode,
          partnerName,
          supplierName,
          revised: input.revised,
          version: input.version,
        },
        relatedEntityType: CREDIT_SUPPORT_ENTITY_TYPE,
        relatedEntityId: String(input.requestId),
      });
    } catch (error) {
      logger.error(
        {
          creditSupportRequestId: input.requestId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Falha ao avisar o comprador sobre resposta do parceiro de crédito.',
      );
    }
  }
}
