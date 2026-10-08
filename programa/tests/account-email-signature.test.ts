import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
    userEmailSignature: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma };
});

import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { userRoutes } from '../src/routes/UserRoutes';
import { hashPassword } from '../src/utils/password';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  userEmailSignature: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  auditLog: { create: ReturnType<typeof vi.fn> };
};

async function loginAs(role: string, id = 7): Promise<string> {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id,
    name: 'Maria Compradora',
    email: 'maria@sqquimica.com',
    passwordHash,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.user.findFirst.mockResolvedValue(user);
  prismaMock.session.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id }));
  const res = await request(app).post('/api/v1/auth/login').send({
    email: 'maria@sqquimica.com',
    password: 'ChangeMe123!',
  });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

function pngBuffer(width: number, height: number, totalSize = 64): Buffer {
  const buf = Buffer.alloc(Math.max(totalSize, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpegBuffer(width: number, height: number): Buffer {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

function imageBody(buf: Buffer, fileType: string, fileName = 'assinatura.png') {
  return {
    fileName,
    contentBase64: buf.toString('base64'),
    fileType,
    fileSize: buf.length,
  };
}

describe('/api/v1/account/email-signature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.userEmailSignature.findUnique.mockResolvedValue(null);
    prismaMock.userEmailSignature.upsert.mockResolvedValue({});
    prismaMock.userEmailSignature.updateMany.mockResolvedValue({ count: 1 });
  });

  it('retorna 401 sem login nas quatro rotas', async () => {
    const png = imageBody(pngBuffer(100, 50), 'image/png');
    expect((await request(app).get('/api/v1/account/email-signature')).status).toBe(401);
    expect(
      (await request(app).put('/api/v1/account/email-signature/text').send({ text: 'x' })).status,
    ).toBe(401);
    expect(
      (await request(app).put('/api/v1/account/email-signature/image').send(png)).status,
    ).toBe(401);
    expect((await request(app).delete('/api/v1/account/email-signature/image')).status).toBe(401);
    expect(prismaMock.userEmailSignature.upsert).not.toHaveBeenCalled();
  });

  it('GET sem registro: image null, texto null e fallbackSignature correto', async () => {
    const cookie = await loginAs('comprador');
    const res = await request(app).get('/api/v1/account/email-signature').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Maria Compradora',
      email: 'maria@sqquimica.com',
      text: null,
      image: null,
      fallbackSignature: 'Best regards,\nMaria Compradora\nmaria@sqquimica.com',
    });
    expect(prismaMock.userEmailSignature.findUnique).toHaveBeenCalledWith({ where: { userId: 7 } });
  });

  it('GET com registro devolve o data URI da imagem e o texto', async () => {
    const cookie = await loginAs('comprador');
    const png = pngBuffer(300, 90, 120);
    prismaMock.userEmailSignature.findUnique.mockResolvedValue({
      userId: 7,
      text: 'Att,\nMaria',
      imageData: png,
      imageMimeType: 'image/png',
      imageWidth: 300,
      imageHeight: 90,
      imageSize: png.length,
    });

    const res = await request(app).get('/api/v1/account/email-signature').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Att,\nMaria');
    expect(res.body.image).toEqual({
      dataUri: `data:image/png;base64,${png.toString('base64')}`,
      mimeType: 'image/png',
      width: 300,
      height: 90,
      size: png.length,
    });
  });

  describe('PUT /text', () => {
    it('grava o texto (com trim), faz upsert so do proprio usuario e audita', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .put('/api/v1/account/email-signature/text')
        .set('Cookie', cookie)
        // userId no corpo e' ignorado: so' req.user.id vale.
        .send({ text: '  Maria Compradora\nSQ Quimica  ', userId: 999 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ text: 'Maria Compradora\nSQ Quimica' });
      expect(prismaMock.userEmailSignature.upsert).toHaveBeenCalledWith({
        where: { userId: 7 },
        create: { userId: 7, text: 'Maria Compradora\nSQ Quimica' },
        update: { text: 'Maria Compradora\nSQ Quimica' },
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
      const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('update_email_signature_text');
      expect(audit.entityType).toBe('user');
      expect(audit.entityId).toBe('7');
    });

    it('texto de 2001 caracteres retorna 400; 2000 passa', async () => {
      const cookie = await loginAs('comprador');
      const tooLong = await request(app)
        .put('/api/v1/account/email-signature/text')
        .set('Cookie', cookie)
        .send({ text: 'a'.repeat(2001) });
      expect(tooLong.status).toBe(400);
      expect(prismaMock.userEmailSignature.upsert).not.toHaveBeenCalled();

      const ok = await request(app)
        .put('/api/v1/account/email-signature/text')
        .set('Cookie', cookie)
        .send({ text: 'a'.repeat(2000) });
      expect(ok.status).toBe(200);
    });

    it('string vazia (ou so espacos) e null gravam null', async () => {
      const cookie = await loginAs('comprador');
      for (const text of ['', '   ', null]) {
        prismaMock.userEmailSignature.upsert.mockClear();
        const res = await request(app)
          .put('/api/v1/account/email-signature/text')
          .set('Cookie', cookie)
          .send({ text });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ text: null });
        expect(prismaMock.userEmailSignature.upsert.mock.calls[0][0].update).toEqual({ text: null });
      }
    });

    it('corpo sem o campo text retorna 400', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .put('/api/v1/account/email-signature/text')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /image', () => {
    it('PNG valido: 200 com width/height, upsert com os bytes e audit sem os bytes', async () => {
      const cookie = await loginAs('comprador');
      const png = pngBuffer(600, 300, 200);
      const res = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(png, 'image/png'));

      expect(res.status).toBe(200);
      expect(res.body.image).toMatchObject({
        mimeType: 'image/png',
        width: 600,
        height: 300,
        size: png.length,
      });
      expect(res.body.image.dataUri.startsWith('data:image/png;base64,')).toBe(true);

      const upsertArgs = prismaMock.userEmailSignature.upsert.mock.calls[0][0];
      expect(upsertArgs.where).toEqual({ userId: 7 });
      expect(Buffer.from(upsertArgs.update.imageData).equals(png)).toBe(true);
      expect(upsertArgs.update).toMatchObject({
        imageMimeType: 'image/png',
        imageWidth: 600,
        imageHeight: 300,
        imageSize: png.length,
      });

      const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('update_email_signature_image');
      expect(audit.metadata).toEqual({
        mimeType: 'image/png',
        width: 600,
        height: 300,
        size: png.length,
      });
      expect(JSON.stringify(audit)).not.toContain(png.toString('base64'));
    });

    it('JPEG valido e aceito', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(jpegBuffer(320, 100), 'image/jpeg', 'a.jpg'));
      expect(res.status).toBe(200);
      expect(res.body.image).toMatchObject({ mimeType: 'image/jpeg', width: 320, height: 100 });
    });

    it('JPEG declarado como PNG retorna 400', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(jpegBuffer(320, 100), 'image/png'));
      expect(res.status).toBe(400);
      expect(prismaMock.userEmailSignature.upsert).not.toHaveBeenCalled();
    });

    it('SVG retorna 400 (declarado como svg ou disfarçado de png)', async () => {
      const cookie = await loginAs('comprador');
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
      const asSvg = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(svg, 'image/svg+xml', 'a.svg'));
      expect(asSvg.status).toBe(400);

      const asPng = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(svg, 'image/png'));
      expect(asPng.status).toBe(400);
      expect(prismaMock.userEmailSignature.upsert).not.toHaveBeenCalled();
    });

    it('GIF com nome .png retorna 400', async () => {
      const cookie = await loginAs('comprador');
      const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(40)]);
      const res = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(gif, 'image/png'));
      expect(res.status).toBe(400);
    });

    it('arquivo maior que 300 KB retorna 400', async () => {
      const cookie = await loginAs('comprador');
      const big = pngBuffer(100, 50, 300 * 1024 + 1);
      const res = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(big, 'image/png'));
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('300 KB');

      // No limite exato passa.
      const edge = pngBuffer(100, 50, 300 * 1024);
      const ok = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send(imageBody(edge, 'image/png'));
      expect(ok.status).toBe(200);
    });

    it('largura 601 ou altura 301 retornam 400 com a mensagem de redimensionar', async () => {
      const cookie = await loginAs('comprador');
      for (const [w, h] of [
        [601, 100],
        [100, 301],
      ]) {
        const res = await request(app)
          .put('/api/v1/account/email-signature/image')
          .set('Cookie', cookie)
          .send(imageBody(pngBuffer(w, h), 'image/png'));
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('600x300');
      }
      expect(prismaMock.userEmailSignature.upsert).not.toHaveBeenCalled();
    });

    it('base64 vazio ou invalido retorna 400', async () => {
      const cookie = await loginAs('comprador');
      const empty = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send({ fileName: 'a.png', contentBase64: '', fileType: 'image/png', fileSize: 0 });
      expect(empty.status).toBe(400);

      const invalid = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send({ fileName: 'a.png', contentBase64: '@@@@!!!!', fileType: 'image/png', fileSize: 6 });
      expect(invalid.status).toBe(400);
      expect(prismaMock.userEmailSignature.upsert).not.toHaveBeenCalled();
    });

    it('aceita o prefixo data URI no base64', async () => {
      const cookie = await loginAs('comprador');
      const png = pngBuffer(100, 50);
      const res = await request(app)
        .put('/api/v1/account/email-signature/image')
        .set('Cookie', cookie)
        .send({
          fileName: 'a.png',
          contentBase64: `data:image/png;base64,${png.toString('base64')}`,
          fileType: 'image/png',
          fileSize: png.length,
        });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /image', () => {
    it('retorna 204, zera as colunas de imagem e audita', async () => {
      const cookie = await loginAs('comprador');
      const res = await request(app)
        .delete('/api/v1/account/email-signature/image')
        .set('Cookie', cookie);

      expect(res.status).toBe(204);
      expect(prismaMock.userEmailSignature.updateMany).toHaveBeenCalledWith({
        where: { userId: 7 },
        data: {
          imageData: null,
          imageMimeType: null,
          imageWidth: null,
          imageHeight: null,
          imageSize: null,
        },
      });
      expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe(
        'delete_email_signature_image',
      );
    });
  });

  it('usuario viewer edita a propria assinatura (texto, imagem e remocao)', async () => {
    const cookie = await loginAs('viewer', 12);

    const text = await request(app)
      .put('/api/v1/account/email-signature/text')
      .set('Cookie', cookie)
      .send({ text: 'Viewer sig' });
    expect(text.status).toBe(200);
    expect(prismaMock.userEmailSignature.upsert.mock.calls[0][0].where).toEqual({ userId: 12 });

    const image = await request(app)
      .put('/api/v1/account/email-signature/image')
      .set('Cookie', cookie)
      .send(imageBody(pngBuffer(100, 50), 'image/png'));
    expect(image.status).toBe(200);

    const del = await request(app)
      .delete('/api/v1/account/email-signature/image')
      .set('Cookie', cookie);
    expect(del.status).toBe(204);
  });

  it('nenhuma rota /account recebe :id (so req.user.id e usado)', () => {
    const paths = (userRoutes as unknown as { stack: Array<{ route?: { path: string } }> }).stack
      .map((layer) => layer.route?.path)
      .filter((p): p is string => typeof p === 'string' && p.startsWith('/account/'));
    expect(paths.sort()).toEqual([
      '/account/email-signature',
      '/account/email-signature/image',
      '/account/email-signature/image',
      '/account/email-signature/text',
    ]);
    expect(paths.some((p) => p.includes(':'))).toBe(false);
  });
});
