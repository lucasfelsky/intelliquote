import { detectImage } from '../utils/imageInfo';
import { SQ_LOGO_IS_PLACEHOLDER, SQ_LOGO_PNG_BASE64 } from './assets/sqLogoPng';

// Logo da SQ Quimica embarcado no e-mail da Ordem de Compra (anexo inline via
// CID). A fonte versionada e' src/mailer/assets/sq-logo-email.png; o modulo
// sqLogoPng.ts (gerado a partir dele) leva os bytes para o dist/ pelo tsc, sem
// mudar o Dockerfile.
export const EMAIL_LOGO_CID = 'sq-logo@intelliquote';
export const EMAIL_LOGO_DISPLAY_HEIGHT = 48;
// CID da imagem de assinatura do usuario (anexo inline do e-mail da PO).
export const EMAIL_SIGNATURE_CID = 'sender-signature@intelliquote';

export function isEmailLogoPlaceholder(): boolean {
  return SQ_LOGO_IS_PLACEHOLDER;
}

export function getEmailLogoBuffer(): Buffer {
  return Buffer.from(SQ_LOGO_PNG_BASE64, 'base64');
}

export function getEmailLogoAttachment(): {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
} {
  return {
    filename: 'sq-logo.png',
    content: getEmailLogoBuffer(),
    contentType: 'image/png',
    cid: EMAIL_LOGO_CID,
  };
}

// O iframe de preview da tela Templates nao resolve `cid:`, entao o preview
// usa data URI.
export function emailLogoDataUri(): string {
  return `data:image/png;base64,${SQ_LOGO_PNG_BASE64}`;
}

// Altura fixa de 48px; a largura sai das dimensoes do IHDR do PNG.
export function emailLogoDisplaySize(): { width: number; height: number } {
  const info = detectImage(getEmailLogoBuffer());
  const height = EMAIL_LOGO_DISPLAY_HEIGHT;
  if (!info || info.height < 1) return { width: height * 2, height };
  return { width: Math.max(1, Math.round((info.width * height) / info.height)), height };
}
