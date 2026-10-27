import type { SupplierDocumentMime } from '../constants/supplierDocuments';

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
