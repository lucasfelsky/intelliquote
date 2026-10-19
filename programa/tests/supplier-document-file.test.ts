import { describe, expect, it } from 'vitest';
import {
  SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH,
  SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH,
} from '../src/constants/supplierDocuments';
import {
  decodeStrictBase64,
  detectDocumentMime,
  sanitizeDocumentFileName,
} from '../src/utils/supplierDocumentFile';
import { supplierDocumentCreateSchema } from '../src/validators/supplierDocuments';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('conteudo')]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('supplierDocumentFile', () => {
  it('detecta PDF, PNG e JPEG pelos magic bytes', () => {
    expect(detectDocumentMime(pdf)).toBe('application/pdf');
    expect(detectDocumentMime(png)).toBe('image/png');
    expect(detectDocumentMime(jpeg)).toBe('image/jpeg');
  });

  it('texto puro, vazio e SVG resultam em null', () => {
    expect(detectDocumentMime(Buffer.from('apenas texto'))).toBeNull();
    expect(detectDocumentMime(Buffer.alloc(0))).toBeNull();
    expect(detectDocumentMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('bytes de PNG nao sao detectados como PDF', () => {
    expect(detectDocumentMime(png)).not.toBe('application/pdf');
  });

  it('decodeStrictBase64 decodifica base64 valido', () => {
    expect(decodeStrictBase64(pdf.toString('base64')).equals(pdf)).toBe(true);
  });

  it('aceita prefixo data-URL', () => {
    const input = `data:application/pdf;base64,${pdf.toString('base64')}`;
    expect(decodeStrictBase64(input).equals(pdf)).toBe(true);
  });

  it('rejeita caractere fora do alfabeto base64', () => {
    expect(() => decodeStrictBase64('JVBERi0x$$$')).toThrow();
    expect(() => decodeStrictBase64('abc def')).toThrow();
  });

  describe('sanitizeDocumentFileName', () => {
    it('mantem nome normal', () => {
      expect(sanitizeDocumentFileName('Licenca 2026.pdf', 'application/pdf')).toBe('Licenca 2026.pdf');
    });

    it('fica so com o basename, sem / \\ nem ..', () => {
      expect(sanitizeDocumentFileName('../../etc/passwd.pdf', 'application/pdf')).toBe('passwd.pdf');
      expect(sanitizeDocumentFileName('C:\\docs\\cert.png', 'image/png')).toBe('cert.png');
      expect(sanitizeDocumentFileName('a..b.pdf', 'application/pdf')).toBe('a.b.pdf');
    });

    it('remove caracteres de controle', () => {
      expect(sanitizeDocumentFileName('rela\u0000to\r\n\u007frio.pdf', 'application/pdf')).toBe(
        'relatorio.pdf',
      );
    });

    it('limita o tamanho preservando a extensao', () => {
      const result = sanitizeDocumentFileName(`${'a'.repeat(400)}.pdf`, 'application/pdf');
      expect(result.length).toBe(SUPPLIER_DOCUMENT_FILE_NAME_MAX_LENGTH);
      expect(result.endsWith('.pdf')).toBe(true);
    });

    it('vazio apos limpar cai em documento.<ext> pelo tipo detectado', () => {
      expect(sanitizeDocumentFileName('../', 'application/pdf')).toBe('documento.pdf');
      expect(sanitizeDocumentFileName('\\\\', 'image/png')).toBe('documento.png');
      expect(sanitizeDocumentFileName('\u0000', 'image/jpeg')).toBe('documento.jpg');
      expect(sanitizeDocumentFileName('...', 'application/pdf')).toBe('documento.pdf');
    });
  });

  describe('validator contentBase64', () => {
    const base = {
      supplierId: 1,
      name: 'Doc',
      expiresOn: '2027-01-01',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
    };

    it('rejeita acima do maximo (antes de decodificar) e aceita no limite', () => {
      const tooBig = supplierDocumentCreateSchema.safeParse({
        ...base,
        contentBase64: 'A'.repeat(SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH + 1),
      });
      expect(tooBig.success).toBe(false);
      expect(tooBig.error?.issues[0]?.message).toContain('10MB');

      const atLimit = supplierDocumentCreateSchema.safeParse({
        ...base,
        contentBase64: 'A'.repeat(SUPPLIER_DOCUMENT_BASE64_MAX_LENGTH),
      });
      expect(atLimit.success).toBe(true);
    });
  });
});
