import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';
import {
  CR_ATTACHMENT_JSON_BODY_LIMIT_BYTES,
  CR_ATTACHMENT_MAX_FILE_BYTES,
} from '../src/constants/commercialRequestAttachments';

// So roda com RUN_DB_TESTS=true (scripts/test-critical-local.mjs: Postgres embutido com TODAS as migrations).
const testDbSkip = process.env.RUN_DB_TESTS !== 'true' ? it.skip : it;
const runId = `cr-att-db-${Date.now()}`;

// Fixtures sinteticas em memoria (nenhum arquivo real).
function pdfBytes(marker = 'a'): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`);
}
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

function body(
  bytes: Buffer,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'TDS',
    fileName: 'tds.pdf',
    mimeType: 'application/pdf',
    contentBase64: bytes.toString('base64'),
    ...overrides,
  };
}

describe('Anexos tecnicos da solicitacao de desenvolvimento (DB)', () => {
  const userIds: number[] = [];
  let ownerCookies: string[] = [];
  let otherCookies: string[] = [];
  let compradorCookies: string[] = [];
  let viewerCookies: string[] = [];
  let ownerId: number;

  async function createUser(roleName: string, label: string) {
    const role =
      roleName === 'comercial'
        ? await prisma.role.findUniqueOrThrow({ where: { name: roleName } })
        : await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName } });
    const user = await prisma.user.create({
      data: {
        name: `${label} ${runId}`,
        email: `${label}-${runId}@intelliquote.local`,
        passwordHash: await hashPassword('Test1234!'),
        roleId: role.id,
      },
    });
    userIds.push(user.id);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test1234!' });
    return { user, cookies: login.headers['set-cookie'] as unknown as string[] };
  }

  // Solicitacao de desenvolvimento (item novo) do comercial dono.
  async function newDevRequest(): Promise<number> {
    const response = await request(app)
      .post('/api/v1/commercial-requests')
      .set('Cookie', ownerCookies)
      .send({ items: [{ proposedName: `Item Novo ${runId} ${Math.random()}`, quantity: 5, unit: 'KG' }] });
    expect(response.status).toBe(201);
    expect(response.body.isDevelopment).toBe(true);
    return response.body.id as number;
  }

  function upload(requestId: number, payload: Record<string, unknown>, cookies = ownerCookies) {
    return request(app)
      .post(`/api/v1/commercial-requests/${requestId}/attachments`)
      .set('Cookie', cookies)
      .send(payload);
  }

  function download(requestId: number, attachmentId: number, cookies: string[]) {
    return request(app)
      .get(`/api/v1/commercial-requests/${requestId}/attachments/${attachmentId}/download`)
      .set('Cookie', cookies);
  }

  function remove(requestId: number, attachmentId: number, cookies = ownerCookies) {
    return request(app)
      .delete(`/api/v1/commercial-requests/${requestId}/attachments/${attachmentId}`)
      .set('Cookie', cookies);
  }

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    const owner = await createUser('comercial', 'comercial');
    ownerCookies = owner.cookies;
    ownerId = owner.user.id;
    otherCookies = (await createUser('comercial', 'outro-comercial')).cookies;
    compradorCookies = (await createUser('comprador', 'comprador')).cookies;
    viewerCookies = (await createUser('viewer', 'viewer')).cookies;
  });

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== 'true') return;

    await prisma.auditLog.deleteMany({ where: { performedById: { in: userIds } } });
    await prisma.commercialRequest.deleteMany({ where: { requestedById: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  testDbSkip('dono, pendente, desenvolvimento: PDF tds.pdf kind TDS -> 201 com metadados e sem conteudo', async () => {
    const requestId = await newDevRequest();
    const bytes = pdfBytes('ok');

    const response = await upload(requestId, body(bytes));

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(
      ['createdAt', 'fileName', 'fileSize', 'id', 'kind', 'mimeType'].sort(),
    );
    expect(response.body).toMatchObject({
      kind: 'TDS',
      fileName: 'tds.pdf',
      mimeType: 'application/pdf',
      fileSize: bytes.length,
    });
    expect(JSON.stringify(response.body)).not.toContain('contentBase64');

    const row = await prisma.commercialRequestAttachment.findUniqueOrThrow({
      where: { id: response.body.id },
      include: { file: true },
    });
    expect(row.uploadedById).toBe(ownerId);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(row.file!.data).equals(bytes)).toBe(true);
  });

  testDbSkip('magic bytes PNG declarados como PDF -> 400 "conteudo nao corresponde"', async () => {
    const requestId = await newDevRequest();

    const response = await upload(requestId, body(PNG_BYTES));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/nao corresponde ao tipo/);
    expect(await prisma.commercialRequestAttachment.count({ where: { commercialRequestId: requestId } })).toBe(0);
  });

  testDbSkip('bytes MZ (exe) declarados como PDF -> 400 "tipo nao permitido"', async () => {
    const requestId = await newDevRequest();

    const response = await upload(requestId, body(EXE_BYTES));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Tipo de arquivo nao permitido/);
  });

  testDbSkip('PDF real com nome tds.pdf.exe -> 400 "extensao nao corresponde"', async () => {
    const requestId = await newDevRequest();

    const response = await upload(requestId, body(pdfBytes(), { fileName: 'tds.pdf.exe' }));

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/extensao/);
    expect(await prisma.commercialRequestAttachment.count({ where: { commercialRequestId: requestId } })).toBe(0);
  });

  testDbSkip('nome ../../segredo/tds.pdf -> 201 e fileName sanitizado no banco', async () => {
    const requestId = await newDevRequest();

    const response = await upload(requestId, body(pdfBytes('path'), { fileName: '../../segredo/tds.pdf' }));

    expect(response.status).toBe(201);
    const row = await prisma.commercialRequestAttachment.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(row.fileName).toBe('tds.pdf');
  });

  testDbSkip('arquivo maior que 10 MB -> 400; corpo acima do limite do parser -> 413 JSON', async () => {
    const requestId = await newDevRequest();
    const big = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(CR_ATTACHMENT_MAX_FILE_BYTES, 0x20),
    ]);

    const tooBig = await upload(requestId, body(big));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toMatch(/10MB/);

    const huge = await upload(requestId, body(pdfBytes(), { contentBase64: 'A'.repeat(CR_ATTACHMENT_JSON_BODY_LIMIT_BYTES + 10) }));
    expect(huge.status).toBe(413);
    expect(huge.headers['content-type']).toMatch(/json/);
    expect(huge.body.message).toMatch(/10MB/);
    expect(await prisma.commercialRequestAttachment.count({ where: { commercialRequestId: requestId } })).toBe(0);
  });

  testDbSkip('arquivo vazio e base64 invalido -> 400', async () => {
    const requestId = await newDevRequest();

    expect((await upload(requestId, body(Buffer.alloc(0), { contentBase64: '=' }))).status).toBe(400);
    expect((await upload(requestId, body(pdfBytes(), { contentBase64: '@@@' }))).status).toBe(400);
    // String vazia: o Zod recusa antes de decodificar.
    expect((await upload(requestId, body(pdfBytes(), { contentBase64: '' }))).status).toBe(400);
  });

  testDbSkip('6o anexo -> 409; mesmo arquivo 2x -> 409', async () => {
    const requestId = await newDevRequest();

    for (let i = 0; i < 5; i += 1) {
      const response = await upload(requestId, body(pdfBytes(`n${i}`), { fileName: `tds-${i}.pdf` }));
      expect(response.status).toBe(201);
    }
    const sixth = await upload(requestId, body(pdfBytes('n5'), { fileName: 'tds-5.pdf' }));
    expect(sixth.status).toBe(409);
    expect(sixth.body.message).toMatch(/maximo de 5/);

    const dupRequestId = await newDevRequest();
    expect((await upload(dupRequestId, body(pdfBytes('dup')))).status).toBe(201);
    const duplicate = await upload(dupRequestId, body(pdfBytes('dup'), { fileName: 'outro-nome.pdf', kind: 'MSDS' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/ja foi anexado/);
  });

  testDbSkip('envios simultaneos: o teto de 5 vale mesmo em paralelo (lock da solicitacao)', async () => {
    const requestId = await newDevRequest();

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        upload(requestId, body(pdfBytes(`par${i}`), { fileName: `par-${i}.pdf` })),
      ),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    expect(await prisma.commercialRequestAttachment.count({ where: { commercialRequestId: requestId } })).toBe(5);
  });

  testDbSkip('outro comercial: upload, download e delete -> 404 (nao vaza existencia)', async () => {
    const requestId = await newDevRequest();
    const created = await upload(requestId, body(pdfBytes('own')));
    expect(created.status).toBe(201);
    const attachmentId = created.body.id as number;

    const otherUpload = await upload(requestId, body(pdfBytes('intruso')), otherCookies);
    const otherDownload = await download(requestId, attachmentId, otherCookies);
    const otherDelete = await remove(requestId, attachmentId, otherCookies);
    const missingUpload = await upload(2147483000, body(pdfBytes('x')), ownerCookies);

    expect(otherUpload.status).toBe(404);
    expect(otherDownload.status).toBe(404);
    expect(otherDelete.status).toBe(404);
    // Mesma resposta de uma solicitacao que nao existe.
    expect(missingUpload.status).toBe(404);
    expect(otherUpload.body.message).toBe(missingUpload.body.message);
    expect(await prisma.commercialRequestAttachment.count({ where: { id: attachmentId } })).toBe(1);
  });

  testDbSkip('comprador, viewer e dono baixam byte a byte; Cache-Control no-store', async () => {
    const requestId = await newDevRequest();
    const bytes = Buffer.concat([pdfBytes('dl'), Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])]);
    const created = await upload(requestId, body(bytes));
    expect(created.status).toBe(201);

    for (const cookies of [compradorCookies, viewerCookies, ownerCookies]) {
      const response = await download(requestId, created.body.id, cookies);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.fileName).toBe('tds.pdf');
      expect(response.body.mimeType).toBe('application/pdf');
      expect(Buffer.from(response.body.contentBase64, 'base64').equals(bytes)).toBe(true);
    }
  });

  testDbSkip('attachmentId de outra solicitacao no path -> 404 (download e delete)', async () => {
    const requestA = await newDevRequest();
    const requestB = await newDevRequest();
    const created = await upload(requestA, body(pdfBytes('a-only')));
    expect(created.status).toBe(201);

    expect((await download(requestB, created.body.id, ownerCookies)).status).toBe(404);
    expect((await download(requestB, created.body.id, compradorCookies)).status).toBe(404);
    expect((await remove(requestB, created.body.id)).status).toBe(404);
    expect(await prisma.commercialRequestAttachment.count({ where: { id: created.body.id } })).toBe(1);
  });

  testDbSkip('solicitacao nao-desenvolvimento -> 409; solicitacao quoting -> 409 no upload e no delete', async () => {
    const catalog = await prisma.catalogItem.create({
      data: { commercialName: `Catalogo ${runId}`, marketName: `CAT-${runId}` },
    });
    try {
      const plain = await request(app)
        .post('/api/v1/commercial-requests')
        .set('Cookie', ownerCookies)
        .send({ items: [{ catalogItemId: catalog.id, quantity: 1, unit: 'KG' }] });
      expect(plain.status).toBe(201);
      expect(plain.body.isDevelopment).toBe(false);
      const refused = await upload(plain.body.id, body(pdfBytes('plain')));
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/desenvolvimento/);

      const requestId = await newDevRequest();
      const created = await upload(requestId, body(pdfBytes('quoting')));
      expect(created.status).toBe(201);
      await prisma.commercialRequest.update({ where: { id: requestId }, data: { status: 'quoting' } });

      expect((await upload(requestId, body(pdfBytes('depois')))).status).toBe(409);
      expect((await remove(requestId, created.body.id)).status).toBe(409);
      expect(await prisma.commercialRequestAttachment.count({ where: { id: created.body.id } })).toBe(1);
      // COMEX continua baixando depois que a solicitacao sai de pendente.
      expect((await download(requestId, created.body.id, compradorCookies)).status).toBe(200);

      await prisma.commercialRequest.deleteMany({ where: { id: plain.body.id } });
    } finally {
      await prisma.commercialRequestItem.deleteMany({ where: { catalogItemId: catalog.id } });
      await prisma.catalogItem.delete({ where: { id: catalog.id } });
    }
  });

  testDbSkip('delete do dono pendente -> 204 e a linha do arquivo some (cascade)', async () => {
    const requestId = await newDevRequest();
    const created = await upload(requestId, body(pdfBytes('del')));
    expect(created.status).toBe(201);
    expect(
      await prisma.commercialRequestAttachmentFile.count({ where: { attachmentId: created.body.id } }),
    ).toBe(1);

    const response = await remove(requestId, created.body.id);

    expect(response.status).toBe(204);
    expect(await prisma.commercialRequestAttachment.count({ where: { id: created.body.id } })).toBe(0);
    expect(
      await prisma.commercialRequestAttachmentFile.count({ where: { attachmentId: created.body.id } }),
    ).toBe(0);
  });

  testDbSkip('AuditLog do upload e do delete: ids, tipo e tamanho; sem nome do arquivo, hash nem conteudo', async () => {
    const requestId = await newDevRequest();
    const secretName = `segredo-${runId}.pdf`;
    const bytes = pdfBytes('audit');
    const created = await upload(requestId, body(bytes, { fileName: secretName }));
    expect(created.status).toBe(201);
    expect((await remove(requestId, created.body.id)).status).toBe(204);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'commercial_request_attachment', entityId: String(created.body.id) },
      orderBy: { id: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual(['create', 'delete']);
    const row = await prisma.commercialRequestAttachment.findFirst({ where: { id: created.body.id } });
    expect(row).toBeNull();
    for (const log of logs) {
      const serialized = JSON.stringify([log.beforeData, log.afterData, log.metadata]);
      expect(serialized).not.toContain('segredo');
      expect(serialized).not.toContain('.pdf');
      expect(serialized).not.toContain('sha256');
      expect(serialized).not.toContain(bytes.toString('base64'));
    }
    expect(logs[0].afterData).toEqual({
      commercialRequestId: requestId,
      kind: 'TDS',
      mimeType: 'application/pdf',
      fileSize: bytes.length,
    });
  });

  testDbSkip('GET /mine e GET /commercial-requests trazem attachments[] sem data/contentBase64/sha256', async () => {
    const requestId = await newDevRequest();
    const created = await upload(requestId, body(pdfBytes('list'), { kind: 'MSDS', fileName: 'msds.pdf' }));
    expect(created.status).toBe(201);

    const mine = await request(app).get('/api/v1/commercial-requests/mine').set('Cookie', ownerCookies);
    const comex = await request(app).get('/api/v1/commercial-requests').set('Cookie', compradorCookies);
    const detail = await request(app).get(`/api/v1/commercial-requests/${requestId}`).set('Cookie', compradorCookies);

    expect(mine.status).toBe(200);
    expect(comex.status).toBe(200);
    expect(detail.status).toBe(200);
    const mineRow = mine.body.data.find((r: { id: number }) => r.id === requestId);
    const comexRow = comex.body.data.find((r: { id: number }) => r.id === requestId);
    for (const row of [mineRow, comexRow, detail.body]) {
      expect(row.attachments).toHaveLength(1);
      expect(Object.keys(row.attachments[0]).sort()).toEqual(
        ['createdAt', 'fileName', 'fileSize', 'id', 'kind', 'mimeType'].sort(),
      );
      expect(row.attachments[0]).toMatchObject({ kind: 'MSDS', fileName: 'msds.pdf' });
    }
    for (const row of [mineRow, comexRow, detail.body]) {
      const json = JSON.stringify(row);
      expect(json).not.toContain('contentBase64');
      expect(json).not.toContain('sha256');
      expect(json).not.toContain('"data"');
    }
  });
});
