import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_LOGO_CID,
  emailLogoDataUri,
  emailLogoDisplaySize,
  getEmailLogoAttachment,
  getEmailLogoBuffer,
} from '../src/mailer/emailLogo';
import { SQ_LOGO_IS_PLACEHOLDER, SQ_LOGO_PNG_BASE64 } from '../src/mailer/assets/sqLogoPng';
import { detectImage } from '../src/utils/imageInfo';

const PNG_PATH = path.join(__dirname, '..', 'src', 'mailer', 'assets', 'sq-logo-email.png');

describe('logo da SQ no e-mail', () => {
  it('o modulo gerado e o PNG versionado sao byte a byte iguais', () => {
    const file = fs.readFileSync(PNG_PATH);
    expect(Buffer.from(SQ_LOGO_PNG_BASE64, 'base64').equals(file)).toBe(true);
    expect(getEmailLogoBuffer().equals(file)).toBe(true);
  });

  it('o arquivo e um PNG valido dentro dos limites', () => {
    const file = fs.readFileSync(PNG_PATH);
    const info = detectImage(file);
    expect(info?.mimeType).toBe('image/png');
    expect(info!.height).toBeLessThanOrEqual(200);
    expect(info!.width).toBeLessThanOrEqual(800);
    expect(file.length).toBeLessThanOrEqual(60 * 1024);
  });

  it('a flag de placeholder e um booleano explicito', () => {
    expect(typeof SQ_LOGO_IS_PLACEHOLDER).toBe('boolean');
  });

  it('o anexo usa o CID fixo e content-type image/png', () => {
    const att = getEmailLogoAttachment();
    expect(att.cid).toBe(EMAIL_LOGO_CID);
    expect(att.contentType).toBe('image/png');
    expect(att.filename).toBe('sq-logo.png');
    expect(Buffer.isBuffer(att.content)).toBe(true);
  });

  it('o data URI de preview carrega o mesmo base64', () => {
    expect(emailLogoDataUri()).toBe(`data:image/png;base64,${SQ_LOGO_PNG_BASE64}`);
  });

  it('a largura de exibicao respeita altura fixa de 48px e a proporcao do IHDR', () => {
    const info = detectImage(getEmailLogoBuffer())!;
    const size = emailLogoDisplaySize();
    expect(size.height).toBe(48);
    expect(size.width).toBe(Math.round((info.width * 48) / info.height));
  });
});
