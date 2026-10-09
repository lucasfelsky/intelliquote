import { mailerEnv } from '../config/env';

// Link publico do portal do fornecedor a partir do token CRU (so' existe em
// memoria do request: nunca em MailLog.templateVars, AuditLog nem logger).
// Compartilhado pelo dispatch (envio inicial / regenerar link) e pelo e-mail
// de resposta ao fornecedor (`quote_reply`).
export function buildPortalLink(rawToken: string): string {
  const base = mailerEnv.portalUrl.replace(/\/$/, '');
  // Cache-buster: garante que o navegador sempre busca a versao mais recente
  // do portal.html quando o fornecedor clica no link do e-mail (Firebase
  // Hosting e agressivo no cache desse asset).
  const v = Date.now();
  if (rawToken === '__preview__') {
    return `${base}/portal/preview?token=PREVIEW&v=${v}`;
  }
  return `${base}/portal?token=${encodeURIComponent(rawToken)}&v=${v}`;
}
