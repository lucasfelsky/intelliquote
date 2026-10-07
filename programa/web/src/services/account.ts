import { api } from '@/api/client';

// Limites espelhados do backend (UserController). A pre-checagem no cliente e'
// so' UX: quem valida de verdade e' o backend.
export const SIGNATURE_IMAGE_MAX_BYTES = 300 * 1024;
export const SIGNATURE_IMAGE_MAX_WIDTH = 600;
export const SIGNATURE_IMAGE_MAX_HEIGHT = 300;
export const SIGNATURE_TEXT_MAX_LENGTH = 2000;

export type SignatureImageType = 'image/png' | 'image/jpeg';

export interface SignatureImage {
  dataUri: string;
  mimeType: SignatureImageType;
  width: number;
  height: number;
  size: number;
}

export interface EmailSignature {
  name: string;
  email: string;
  text: string | null;
  image: SignatureImage | null;
  /** Texto usado no e-mail quando nao ha texto nem imagem cadastrados. */
  fallbackSignature: string;
}

export function getEmailSignature(): Promise<EmailSignature> {
  return api.get<EmailSignature>('/v1/account/email-signature');
}

export function saveEmailSignatureText(text: string | null): Promise<{ text: string | null }> {
  return api.put<{ text: string | null }>('/v1/account/email-signature/text', { text });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      // data:<mime>;base64,<conteudo> -> so' o conteudo.
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadEmailSignatureImage(file: File): Promise<{ image: SignatureImage }> {
  const contentBase64 = await readFileAsBase64(file);
  return api.put<{ image: SignatureImage }>('/v1/account/email-signature/image', {
    fileName: file.name,
    contentBase64,
    fileType: file.type,
    fileSize: file.size,
  });
}

export function deleteEmailSignatureImage(): Promise<void> {
  return api.del<void>('/v1/account/email-signature/image');
}

/** Pre-checagem de UX: tipo e tamanho (as dimensoes sao checadas com Image). */
export function precheckSignatureFile(file: File): string | null {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    return 'Use uma imagem PNG ou JPEG.';
  }
  if (file.size > SIGNATURE_IMAGE_MAX_BYTES) {
    return 'A imagem excede o limite de 300 KB.';
  }
  return null;
}

export function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
