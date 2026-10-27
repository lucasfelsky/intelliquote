import type { SupplierDocumentMime } from '../constants/supplierDocuments';
import { sanitizeDocumentFileName } from './supplierDocumentFile';

// Caracteres bidi (LRM/RLM, LRE..RLO, isolates) e zero-width (ZWSP..ZWJ, BOM): invisiveis ou que
// invertem a exibicao ("evil<RLO>txt.pdf" aparece como "evilfdp.txt"). O util compartilhado com
// os Documentos do fornecedor so remove controles; aqui o anexo da solicitacao remove tambem estes.
const BIDI_AND_ZERO_WIDTH = /[​-‏‪-‮⁦-⁩﻿]/g;

// Nome seguro do anexo da solicitacao: sem bidi/zero-width + sanitizacao dos Documentos do fornecedor
// (basename, sem controles, tamanho maximo, "documento.<ext>" se ficar vazio).
export function sanitizeAttachmentFileName(raw: string, mime: SupplierDocumentMime): string {
  return sanitizeDocumentFileName(raw.replace(BIDI_AND_ZERO_WIDTH, ''), mime);
}

const EXTENSIONS_BY_MIME: Record<SupplierDocumentMime, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
};

// A extensao FINAL do nome precisa bater com o tipo detectado pelos magic bytes.
// "tds.pdf.exe" (extensao dupla), nome sem extensao e extensao de outro tipo recusam.
export function extensionMatchesMime(fileName: string, mime: SupplierDocumentMime): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) {
    return false;
  }
  const extension = fileName.slice(dot + 1).toLowerCase();
  return EXTENSIONS_BY_MIME[mime].includes(extension);
}
