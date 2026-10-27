import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock } = vi.hoisted(() => ({
  txMock: {
    $queryRaw: vi.fn(),
    commercialRequest: { findUnique: vi.fn() },
    commercialRequestAttachment: { count: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: { $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txMock)) },
}));

vi.mock('../src/services/AuditLogService', () => ({
  AuditLogService: { log: vi.fn().mockResolvedValue(undefined) },
}));

import { CommercialRequestAttachmentService } from '../src/services/CommercialRequestAttachmentService';
import { sanitizeAttachmentFileName } from '../src/utils/commercialRequestAttachmentFile';

// Controles de direcao/invisiveis que o util compartilhado dos Documentos do fornecedor nao remove.
const RLO = '‮';
const ZWSP = '​';
const BOM = '﻿';
const LRI = '⁦';
const PDI = '⁩';

describe('sanitizeAttachmentFileName (bidi e zero-width)', () => {
  it('remove RLO/LRO/embeddings/isolates (U+202A-202E, U+2066-2069)', () => {
    expect(sanitizeAttachmentFileName(`evil${RLO}txt.pdf`, 'application/pdf')).toBe('eviltxt.pdf');
    expect(sanitizeAttachmentFileName('a‪b‬c‭d.pdf', 'application/pdf')).toBe('abcd.pdf');
    expect(sanitizeAttachmentFileName(`${LRI}tds${PDI}.pdf`, 'application/pdf')).toBe('tds.pdf');
  });

  it('remove zero-width, LRM/RLM e BOM (U+200B-200F, U+FEFF)', () => {
    expect(sanitizeAttachmentFileName(`${BOM}td${ZWSP}s‌‍‎‏.pdf`, 'application/pdf')).toBe(
      'tds.pdf',
    );
  });

  it('mantem acentos e a limpeza padrao (controles e path traversal)', () => {
    expect(sanitizeAttachmentFileName('Ficha Técnica ção.pdf', 'application/pdf')).toBe('Ficha Técnica ção.pdf');
    expect(sanitizeAttachmentFileName('../x/td\u0000s.pdf', 'application/pdf')).toBe('tds.pdf');
  });

  it('nome so de invisiveis usa o nome padrao pelo tipo', () => {
    expect(sanitizeAttachmentFileName(`${ZWSP}${RLO}${BOM}`, 'application/pdf')).toBe('documento.pdf');
  });
});

describe('CommercialRequestAttachmentService.upload grava o nome sem bidi/zero-width', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.$queryRaw.mockResolvedValue([]);
    txMock.commercialRequest.findUnique.mockResolvedValue({
      requestedById: 42,
      status: 'pending',
      isDevelopment: true,
    });
    txMock.commercialRequestAttachment.count.mockResolvedValue(0);
    txMock.commercialRequestAttachment.create.mockImplementation(
      async ({ data }: { data: { fileName: string } }) => ({
        id: 1,
        kind: 'TDS',
        fileName: data.fileName,
        mimeType: 'application/pdf',
        fileSize: 15,
        createdAt: new Date(),
      }),
    );
  });

  it('evil<RLO>txt.pdf entra como eviltxt.pdf (extensao final continua pdf)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');

    await CommercialRequestAttachmentService.upload(
      7,
      {
        kind: 'TDS',
        fileName: `evil${RLO}txt${ZWSP}.pdf`,
        mimeType: 'application/pdf',
        contentBase64: pdf.toString('base64'),
      },
      { id: 42, role: 'comercial' },
    );

    const data = txMock.commercialRequestAttachment.create.mock.calls[0][0].data;
    expect(data.fileName).toBe('eviltxt.pdf');
    expect(data.fileName).not.toMatch(/[​-‏‪-‮⁦-⁩﻿]/);
  });
});
