import { describe, expect, it } from 'vitest';
import { detectImage } from '../src/utils/imageInfo';

function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; // bit depth
  buf[25] = 6; // RGBA
  return buf;
}

function jpegWithSof(marker: number, width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  // APP0 (JFIF) so' para exercitar o salto de segmentos.
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x00,
  ]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = marker;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([soi, app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe('detectImage', () => {
  it('detecta PNG e le as dimensoes do IHDR', () => {
    expect(detectImage(pngHeader(192, 96))).toEqual({
      mimeType: 'image/png',
      width: 192,
      height: 96,
    });
  });

  it('detecta JPEG com SOF0 e le as dimensoes', () => {
    expect(detectImage(jpegWithSof(0xc0, 600, 300))).toEqual({
      mimeType: 'image/jpeg',
      width: 600,
      height: 300,
    });
  });

  it('aceita JPEG progressivo (SOF2)', () => {
    expect(detectImage(jpegWithSof(0xc2, 320, 100))).toEqual({
      mimeType: 'image/jpeg',
      width: 320,
      height: 100,
    });
  });

  it('ignora C4 (DHT) como se fosse SOF', () => {
    // Um segmento C4 com payload nao e' quadro; sem SOF depois, retorna null.
    const soi = Buffer.from([0xff, 0xd8]);
    const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]);
    expect(detectImage(Buffer.concat([soi, dht, Buffer.from([0xff, 0xd9])]))).toBeNull();
  });

  it('rejeita GIF mesmo com nome .png', () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(20)]);
    expect(detectImage(gif)).toBeNull();
  });

  it('rejeita SVG', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    expect(detectImage(svg)).toBeNull();
  });

  it('rejeita WebP', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
    expect(detectImage(webp)).toBeNull();
  });

  it('rejeita buffers truncados e vazios', () => {
    expect(detectImage(Buffer.alloc(0))).toBeNull();
    expect(detectImage(pngHeader(10, 10).subarray(0, 20))).toBeNull();
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(detectImage(jpegWithSof(0xc0, 10, 10).subarray(0, 14))).toBeNull();
  });

  it('rejeita PNG com dimensao zero ou sem IHDR', () => {
    expect(detectImage(pngHeader(0, 10))).toBeNull();
    const noIhdr = pngHeader(10, 10);
    noIhdr.write('IDAT', 12, 'ascii');
    expect(detectImage(noIhdr)).toBeNull();
  });
});
