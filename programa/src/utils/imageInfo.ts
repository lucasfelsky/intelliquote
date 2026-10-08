// Deteccao minima de imagem PNG/JPEG pelo conteudo (magic bytes) + dimensoes.
// Sem dependencia externa e SEM decodificar o arquivo: o servidor so' guarda e
// reenvia os bytes como anexo inline. SVG, GIF, WebP etc. retornam null (SVG
// por risco de XSS).

export type DetectedImageMime = 'image/png' | 'image/jpeg';

export interface DetectedImage {
  mimeType: DetectedImageMime;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Buffer, signature: number[]): boolean {
  if (buf.length < signature.length) return false;
  return signature.every((byte, index) => buf[index] === byte);
}

function detectPng(buf: Buffer): DetectedImage | null {
  // 8 (assinatura) + 4 (tamanho) + 4 ("IHDR") + 4 (largura) + 4 (altura)
  if (buf.length < 24) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 1 || height < 1) return null;
  return { mimeType: 'image/png', width, height };
}

function isStartOfFrame(marker: number): boolean {
  // SOF0..SOF15, exceto C4 (DHT), C8 (JPG) e CC (DAC).
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function detectJpeg(buf: Buffer): DetectedImage | null {
  let offset = 2; // pula o SOI (FF D8)
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) return null;
    // Bytes de preenchimento FF antes do marcador.
    while (offset < buf.length && buf[offset] === 0xff) offset += 1;
    if (offset >= buf.length) return null;
    const marker = buf[offset];
    offset += 1;

    // Marcadores sem payload (TEM, RSTn, SOI, EOI).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    // Start of scan: dados entropy-coded; SOF ja deveria ter aparecido.
    if (marker === 0xda) return null;

    if (offset + 2 > buf.length) return null;
    const segmentLength = buf.readUInt16BE(offset);
    if (segmentLength < 2) return null;

    if (isStartOfFrame(marker)) {
      // length(2) precision(1) height(2) width(2)
      if (offset + 7 > buf.length) return null;
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (width < 1 || height < 1) return null;
      return { mimeType: 'image/jpeg', width, height };
    }

    offset += segmentLength;
  }
  return null;
}

export function detectImage(buf: Buffer): DetectedImage | null {
  if (!Buffer.isBuffer(buf)) return null;
  if (startsWith(buf, PNG_SIGNATURE)) return detectPng(buf);
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return detectJpeg(buf);
  return null;
}
