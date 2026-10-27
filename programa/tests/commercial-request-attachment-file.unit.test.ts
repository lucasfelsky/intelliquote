import { describe, expect, it } from 'vitest';
import { extensionMatchesMime } from '../src/utils/commercialRequestAttachmentFile';
import { sanitizeDocumentFileName } from '../src/utils/supplierDocumentFile';

describe('extensionMatchesMime', () => {
  it('extensao final igual ao tipo (sem diferenciar maiusculas)', () => {
    expect(extensionMatchesMime('tds.pdf', 'application/pdf')).toBe(true);
    expect(extensionMatchesMime('TDS.PDF', 'application/pdf')).toBe(true);
    expect(extensionMatchesMime('foto.jpeg', 'image/jpeg')).toBe(true);
    expect(extensionMatchesMime('foto.JPG', 'image/jpeg')).toBe(true);
    expect(extensionMatchesMime('logo.png', 'image/png')).toBe(true);
  });

  it('extensao dupla, sem extensao e extensao de outro tipo: recusa', () => {
    expect(extensionMatchesMime('tds.pdf.exe', 'application/pdf')).toBe(false);
    expect(extensionMatchesMime('tds.exe.pdf.png', 'application/pdf')).toBe(false);
    expect(extensionMatchesMime('tds', 'application/pdf')).toBe(false);
    expect(extensionMatchesMime('tds.', 'application/pdf')).toBe(false);
    expect(extensionMatchesMime('tds.png', 'application/pdf')).toBe(false);
    expect(extensionMatchesMime('foto.jpg', 'image/png')).toBe(false);
  });
});

describe('sanitizeDocumentFileName (reuso dos documentos do fornecedor)', () => {
  it('remove path traversal (barra e contrabarra)', () => {
    expect(sanitizeDocumentFileName('../../etc/tds.pdf', 'application/pdf')).toBe('tds.pdf');
    expect(sanitizeDocumentFileName('..\\..\\x\\msds.pdf', 'application/pdf')).toBe('msds.pdf');
  });

  it('remove caracteres de controle', () => {
    expect(sanitizeDocumentFileName('td\u0000s\u001f.pdf', 'application/pdf')).toBe('tds.pdf');
  });

  it('nome vazio apos limpar usa o tipo detectado', () => {
    expect(sanitizeDocumentFileName('../', 'application/pdf')).toBe('documento.pdf');
  });
});
