import fs from 'fs';
import path from 'path';
import { EmailTemplateService } from '../services/EmailTemplateService';
import { logger } from '../lib/logger';
import { escapeHtml } from './renderQuoteDispatch';

export const PO_TEMPLATE_KEY = 'quote_po';
export const PO_DEFAULT_LOCALE = 'en';

const CANDIDATE_PATHS = [
  path.join(__dirname, 'templates', 'quote-po.en.html'),
  path.join(__dirname, '..', '..', 'src', 'mailer', 'templates', 'quote-po.en.html'),
  path.join(process.cwd(), 'dist', 'src', 'mailer', 'templates', 'quote-po.en.html'),
  path.join(process.cwd(), 'src', 'mailer', 'templates', 'quote-po.en.html'),
];

function resolveTemplatePath(): string {
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return CANDIDATE_PATHS[0];
}

const TEMPLATE_PATH = resolveTemplatePath();

export function loadFileTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

export interface QuotePoVars {
  subject: string;
  requestCode: string;
  supplierContactName: string;
  // Contato do despachante/forwarder, digitado na hora no modal "Enviar
  // Ordem de Compra". Texto livre (pode ter varias linhas) -- renderizado no
  // HTML com escape + \n->br (mesmo tratamento de injectReplyCustomMessage).
  // No corpo texto puro (DB textBody customizado), o placeholder equivalente
  // e' {{forwarderInfoText}} (sem br) -- mesmo padrao itemsRows/itemsText do
  // quote_reply.
  forwarderInfo: string;
  // Porto de destino resolvido a nivel da COTACAO (quoteRequest.destinationPort
  // -> primeiro item com destinationPort -> 'as agreed'). Renderizado via
  // {{destinationPort}} generico (escapeHtml) no HTML.
  destinationPort: string;
  // Mensagem opcional digitada no modal. Aparece logo abaixo de "Dear all,"
  // via {{message}} (HTML) / {{messageText}} (texto puro).
  message?: string;
  // Remetente (usuario logado) -- usado so' no fallback da assinatura
  // ("Best regards," + nome + e-mail).
  senderName?: string;
  senderEmail?: string;
  // Texto da assinatura definido pelo usuario em "Minha conta" (opcional).
  // O placeholder {{senderSignatureText}} renderiza a assinatura COMPOSTA em
  // texto puro, nao este campo cru.
  signatureText?: string | null;
  // Imagem da assinatura: src inline (cid: ou data URI png/jpeg) + dimensoes.
  signatureImageSrc?: string;
  signatureImageWidth?: number;
  signatureImageHeight?: number;
  // Logo da SQ no cabecalho: src inline (cid: ou data URI png) + largura de
  // exibicao (a altura e' fixa em 48px).
  companyLogoSrc?: string;
  companyLogoWidth?: number;
}

export const PO_CUSTOM_MESSAGE_SLOT = '<!--CUSTOM_MESSAGE_SLOT-->';
const PO_LOGO_DISPLAY_HEIGHT = 48;
const PO_SIGNATURE_FALLBACK_GREETING = 'Best regards,';

// Somente fontes inline seguras entram em <img src>. Qualquer outra coisa
// (javascript:, http(s) externo, data: de outro tipo) e' descartada.
const SAFE_LOGO_SRC = /^(?:cid:[A-Za-z0-9._@-]{1,100}|data:image\/png;base64,[A-Za-z0-9+/=]+)$/;
const SAFE_SIGNATURE_SRC =
  /^(?:cid:[A-Za-z0-9._@-]{1,100}|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+)$/;

function isSafeLogoSrc(src: unknown): src is string {
  return typeof src === 'string' && SAFE_LOGO_SRC.test(src);
}

function isSafeSignatureSrc(src: unknown): src is string {
  return typeof src === 'string' && SAFE_SIGNATURE_SRC.test(src);
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.round(value)
    : null;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function renderForwarderInfoHtml(value: string): string {
  if (!value) return '';
  return escapeHtml(value).replace(/\n/g, '<br />');
}

function trimmedMessage(vars: QuotePoVars): string {
  return typeof vars.message === 'string' ? vars.message.trim() : '';
}

function renderMessageHtml(vars: QuotePoVars): string {
  const message = trimmedMessage(vars);
  if (!message) return '';
  const safe = escapeHtml(normalizeNewlines(message)).replace(/\n/g, '<br />');
  return `<p style="margin:0 0 12px 0;">${safe}</p>`;
}

function renderMessageText(vars: QuotePoVars): string {
  const message = trimmedMessage(vars);
  return message ? `${normalizeNewlines(message)}\r\n\r\n` : '';
}

function renderCompanyLogoHtml(vars: QuotePoVars): string {
  if (!isSafeLogoSrc(vars.companyLogoSrc)) return '';
  const width = positiveInt(vars.companyLogoWidth);
  const widthAttr = width ? ` width="${width}"` : '';
  // Logo "SQ Quimica" branco com fundo transparente, direto sobre o cabecalho
  // navy (sem chip branco). alt em branco para quando o cliente bloqueia imagens.
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
                    <tr>
                      <td><img src="${escapeHtml(vars.companyLogoSrc)}" height="${PO_LOGO_DISPLAY_HEIGHT}"${widthAttr} alt="SQ Quimica" style="display:block;border:0;color:#ffffff;font-weight:bold;font-size:18px;" /></td>
                    </tr>
                  </table>`;
}

export interface PoSenderSignature {
  // Texto da assinatura ja escapado, com <br />. Quando so' ha imagem, vem o
  // cumprimento "Best regards,".
  htmlText: string;
  // Assinatura composta em texto puro (sem a imagem).
  plainText: string;
  // true quando a imagem deve ser renderizada apos o texto.
  showImage: boolean;
}

// Composicao da assinatura:
//   texto + imagem -> HTML: texto, imagem | texto puro: texto
//   so' texto      -> HTML: texto         | texto puro: texto
//   so' imagem     -> HTML: "Best regards," + imagem | texto puro: "Best regards,\nnome\ne-mail"
//   nenhum         -> "Best regards,\nnome\ne-mail" nos dois
export function buildPoSenderSignature(input: {
  name?: string | null;
  email?: string | null;
  text?: string | null;
  hasImage: boolean;
}): PoSenderSignature {
  const text = typeof input.text === 'string' ? normalizeNewlines(input.text).trim() : '';
  const fallbackLines = [
    PO_SIGNATURE_FALLBACK_GREETING,
    (input.name ?? '').trim(),
    (input.email ?? '').trim(),
  ].filter((line) => line.length > 0);
  const fallbackHtml = fallbackLines.map((line) => escapeHtml(line)).join('<br />');
  const fallbackPlain = fallbackLines.join('\r\n');

  if (text) {
    return {
      htmlText: escapeHtml(text).replace(/\n/g, '<br />'),
      plainText: text.replace(/\n/g, '\r\n'),
      showImage: input.hasImage,
    };
  }
  if (input.hasImage) {
    return {
      htmlText: escapeHtml(PO_SIGNATURE_FALLBACK_GREETING),
      plainText: fallbackPlain,
      showImage: true,
    };
  }
  return { htmlText: fallbackHtml, plainText: fallbackPlain, showImage: false };
}

function composeSignature(vars: QuotePoVars): { signature: PoSenderSignature; imageHtml: string } {
  const signatureSrc = isSafeSignatureSrc(vars.signatureImageSrc) ? vars.signatureImageSrc : null;
  const signature = buildPoSenderSignature({
    name: vars.senderName,
    email: vars.senderEmail,
    text: vars.signatureText,
    hasImage: signatureSrc !== null,
  });
  let imageHtml = '';
  if (signature.showImage && signatureSrc) {
    const width = positiveInt(vars.signatureImageWidth);
    const height = positiveInt(vars.signatureImageHeight);
    const dims = `${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}`;
    const alt = escapeHtml((vars.senderName ?? '').trim());
    imageHtml = `<img src="${escapeHtml(signatureSrc)}"${dims} alt="${alt}" style="display:block;border:0;max-width:100%;height:auto;" />`;
  }
  return { signature, imageHtml };
}

function renderSenderSignatureHtml(vars: QuotePoVars): string {
  const { signature, imageHtml } = composeSignature(vars);
  const textBlock = signature.htmlText
    ? `<div style="margin:0 0 8px 0;">${signature.htmlText}</div>`
    : '';
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
              <tr>
                <td style="padding:8px 32px 16px 32px;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#1F2933;">${textBlock}${imageHtml}</td>
              </tr>
            </table>`;
}

function renderSenderSignatureText(vars: QuotePoVars): string {
  return `${composeSignature(vars).signature.plainText}\r\n\r\n`;
}

// Bloco da mensagem no formato antigo (tabela propria), usado so' para
// templates do banco que ainda dependem do marcador <!--CUSTOM_MESSAGE_SLOT-->.
function renderLegacyMessageBlock(vars: QuotePoVars): string {
  const message = trimmedMessage(vars);
  if (!message) return '';
  const safe = escapeHtml(normalizeNewlines(message)).replace(/\n/g, '<br />');
  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff;">
      <tr>
        <td style="padding:0 32px 16px 32px;font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#1F2933;">${safe}</td>
      </tr>
    </table>`;
}

export function renderPoSections(template: string, vars: QuotePoVars): string {
  const out = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    const hasValue = value !== undefined && value !== null && String(value).trim().length > 0;
    return hasValue ? body : '';
  });

  return out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    if (trimmed === 'forwarderInfo') return renderForwarderInfoHtml(vars.forwarderInfo);
    if (trimmed === 'forwarderInfoText') return vars.forwarderInfo ?? '';
    if (trimmed === 'companyLogo') return renderCompanyLogoHtml(vars);
    if (trimmed === 'message') return renderMessageHtml(vars);
    if (trimmed === 'messageText') return renderMessageText(vars);
    if (trimmed === 'senderSignature') return renderSenderSignatureHtml(vars);
    if (trimmed === 'senderSignatureText') return renderSenderSignatureText(vars);
    const value = (vars as unknown as Record<string, unknown>)[trimmed];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

export function renderPoPlainText(vars: QuotePoVars): string {
  const message = trimmedMessage(vars);
  const body = [
    'Dear all,',
    '',
    ...(message ? [normalizeNewlines(message).replace(/\n/g, '\r\n'), ''] : []),
    'Attached is our PO. We look forward to receiving the PI soon.',
    'Please inform estimated cargo delivery date:',
    '',
    'Please note the original BL copies should be issued at destination, please coordinate with our forwarder accordingly',
    '',
    'SHIPPING INSTRUCTION:',
    'LABEL: Consider small labels and neutral package with the description according to our PO.',
    'PALLETS: Goods must be sent on pallets. Consider using processed wooden pallet, plastic pallet or treated and certificate (with stamp and original certificate in English). If you cannot provide pallet, please ask the agent to do so.',
    "*Pallets size must have no more than 112CM in order to be loaded on a 40'NOR.",
    '',
    'SHIPPING DOCUMENTS:',
    'Please make sure to include all the data below on both Invoice and Packing list;',
    '',
    "- SQ QUIMICA's complete information including tax number: CNPJ: 14.111.367/0001-97;",
    "- SQ QUIMICA's Internal Product Code followed by Product Description on the Invoice according to our PO;",
    "- Exporter's TAX ID/TIN NUMBER must be mentioned on shipper's info;",
    '- Port of Destination: as agreed.',
    '- CBM; N.W and G.W per Package and TOTAL; Pallet Weight;',
    '- Quantity of pallets and packages with description (Pallets and other types: Bags, drums, etc.);',
    '- HS CODE/NCM (according to our PO);',
    '- Manufacturer information (If same as exporter, please inform it on the Invoice) including TAX ID/TIN NUMBER;',
    '- Country of Origin, Acquisition and Provenance;',
    '- Bank Info: Swift Code, Bank Address and Beneficiary IS MANDATORY ON INVOICE',
    '',
    'CERTIFICATE OF ANALYSIS.',
    'Please make sure to include all the data below on every COA;',
    '',
    "- Product's name according to INVOICE;",
    '- Batches/Lot numbers;',
    '- Shipped quantity for every Batch/Lot;',
    '- Manufacturing date and Expiring/Validity date',
    '- All data must be digital (handwritten will no longer be accepted).',
    '',
    `Port of Destination: ${vars.destinationPort || 'as agreed'}`,
    '',
    "Here below is the forwarder's contact info:",
    vars.forwarderInfo || '',
  ].join('\r\n');
  return `${body}\r\n\r\n${composeSignature(vars).signature.plainText}`;
}

export interface RenderedQuotePo {
  subject: string;
  html: string;
  text: string;
  source: 'database' | 'fallback';
}

function hasPlaceholder(template: string, key: string): boolean {
  return new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`).test(template);
}

// Renderiza o HTML de um template (arquivo ou banco) com a regra de
// compatibilidade para templates antigos/customizados:
//  - com {{message}} / {{senderSignature}}: o conteudo entra no placeholder;
//  - sem placeholder mas com <!--CUSTOM_MESSAGE_SLOT-->: o slot recebe a
//    mensagem (formato antigo) e/ou a assinatura que faltarem;
//  - sem placeholder e sem slot: o conteudo nao entra no HTML (logger.warn).
export function renderPoHtmlFromTemplate(htmlTemplate: string, vars: QuotePoVars): string {
  const hasMessagePlaceholder = hasPlaceholder(htmlTemplate, 'message');
  const hasSignaturePlaceholder = hasPlaceholder(htmlTemplate, 'senderSignature');
  const hasSlot = htmlTemplate.includes(PO_CUSTOM_MESSAGE_SLOT);

  let html = renderPoSections(htmlTemplate, vars);

  if (hasSlot) {
    const slotContent =
      (hasMessagePlaceholder ? '' : renderLegacyMessageBlock(vars)) +
      (hasSignaturePlaceholder ? '' : renderSenderSignatureHtml(vars));
    // Replacer em funcao: o conteudo do usuario pode conter "$&" etc.
    html = html.replace(PO_CUSTOM_MESSAGE_SLOT, () => slotContent);
  } else {
    if (!hasMessagePlaceholder && trimmedMessage(vars)) {
      logger.warn(
        { templateKey: PO_TEMPLATE_KEY },
        'Template quote_po sem {{message}} nem <!--CUSTOM_MESSAGE_SLOT-->: a mensagem do modal nao entrou no HTML.',
      );
    }
    if (!hasSignaturePlaceholder) {
      logger.warn(
        { templateKey: PO_TEMPLATE_KEY },
        'Template quote_po sem {{senderSignature}} nem <!--CUSTOM_MESSAGE_SLOT-->: a assinatura nao entrou no HTML.',
      );
    }
  }
  return html;
}

// Mesma regra de compatibilidade para o corpo texto puro: sem
// {{messageText}} a mensagem e' prefixada; sem {{senderSignatureText}} a
// assinatura vai para o fim.
export function renderPoTextFromTemplate(textTemplate: string, vars: QuotePoVars): string {
  const hasMessagePlaceholder = hasPlaceholder(textTemplate, 'messageText');
  const hasSignaturePlaceholder = hasPlaceholder(textTemplate, 'senderSignatureText');

  let text = renderPoSections(textTemplate, vars);
  if (!hasMessagePlaceholder) text = `${renderMessageText(vars)}${text}`;
  if (!hasSignaturePlaceholder) {
    text = `${text}\r\n\r\n${composeSignature(vars).signature.plainText}`;
  }
  return text;
}

// Envio real via SMTP (sendAndLog) do botao "Enviar Ordem de Compra" na
// Comparacao -- so' e' habilitado para a proposta vencedora (isWinner).
// Editavel via Templates.tsx (mesmo mecanismo do quote_dispatch/quote_reply),
// key = "quote_po".
//
// Precedencia do assunto: subjectOverride (assunto digitado no modal, usado
// literalmente) > assunto do template do banco renderizado > vars.subject.
export async function renderPoFromTemplate(
  vars: QuotePoVars,
  locale: string = PO_DEFAULT_LOCALE,
  subjectOverride?: string,
): Promise<RenderedQuotePo> {
  const dbTemplate = await EmailTemplateService.get(PO_TEMPLATE_KEY, locale);
  const override = subjectOverride?.trim();
  const subject = override
    ? override
    : dbTemplate?.subject
      ? renderPoSections(dbTemplate.subject, vars)
      : vars.subject;
  const varsForRender = { ...vars, subject };

  if (dbTemplate) {
    const html = renderPoHtmlFromTemplate(dbTemplate.htmlBody, varsForRender);
    const text = dbTemplate.textBody
      ? renderPoTextFromTemplate(dbTemplate.textBody, varsForRender)
      : renderPoPlainText(varsForRender);
    return { html, text, subject, source: 'database' };
  }

  const html = renderPoHtmlFromTemplate(loadFileTemplate(), varsForRender);
  const text = renderPoPlainText(varsForRender);
  return { html, text, subject, source: 'fallback' };
}
