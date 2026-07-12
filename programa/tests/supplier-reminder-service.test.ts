// F5 (backlog 2026-07-12): lembrete pre-deadline. Testa o sweep isolado:
//   - happy path: claim -> token novo (MESMO deadline) -> email -> revoga original
//   - claim perdido (outra replica ganhou): pula sem enviar
//   - fora da janela / ja respondido: nao entra na query (filtrado no where)
//   - cotacao fechada: pula
//   - SMTP falhando: original NAO e' revogado (fornecedor mantem link valido)
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getMailer: vi.fn(),
}));

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../src/services/CompanyProfileService', () => ({
  CompanyProfileService: {
    get: vi.fn().mockResolvedValue({ companyName: 'SQ Quimica' }),
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    supplierPortalToken: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mockar o SupplierPortalService inteiro: o createToken REAL gera um raw
// token aleatorio (nao armazenado), o que impediria asserts do link.
vi.mock('../src/services/SupplierPortalService', () => ({
  SupplierPortalService: {
    createToken: vi.fn(),
  },
}));

import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { SupplierPortalService } from '../src/services/SupplierPortalService';
import { SupplierPortalReminderService } from '../src/services/SupplierPortalReminderService';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;
const findManyMock = prisma.supplierPortalToken.findMany as unknown as ReturnType<typeof vi.fn>;
const updateManyMock = prisma.supplierPortalToken.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const updateMock = prisma.supplierPortalToken.update as unknown as ReturnType<typeof vi.fn>;
const createMock = SupplierPortalService.createToken as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date('2026-07-13T09:00:00');
const EXPIRES = new Date('2026-07-14T18:00:00'); // dentro da janela de 48h

function dueToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    quoteRequestId: 5,
    supplierId: 2,
    supplierContactId: 9,
    createdById: 1,
    dispatchEventId: 33,
    expiresAt: EXPIRES,
    supplier: { name: 'Shanghai Chem Co.' },
    supplierContact: { name: 'Li Wei', email: 'li@shanghaichem.example' },
    quoteRequest: { requestCode: 'QR-2026-042', productName: 'PI-TPO', status: 'open' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue({
    id: 88,
    expiresAt: EXPIRES,
    rawToken: 'fresh-raw-token-1234567890',
  });
  updateMock.mockResolvedValue({});
});

describe('SupplierPortalReminderService.runReminderSweep', () => {
  it('happy path: claim -> token novo com MESMO deadline -> email -> revoga original', async () => {
    findManyMock.mockResolvedValue([dueToken()]);
    updateManyMock.mockResolvedValue({ count: 1 });

    const result = await SupplierPortalReminderService.runReminderSweep(NOW, 48);

    expect(result).toEqual({ due: 1, sent: 1, skipped: 0, failed: 0 });

    // Claim atomico no original.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 7, reminderSentAt: null, revokedAt: null },
      data: { reminderSentAt: NOW },
    });

    // Token novo preserva o deadline e nasce com reminderSentAt.
    const createArgs = createMock.mock.calls[0][0];
    expect(createArgs.expiresAt).toEqual(EXPIRES);
    expect(createArgs.reminderSentAt).toEqual(NOW);
    expect(createArgs.quoteRequestId).toBe(5);
    expect(createArgs.supplierContactId).toBe(9);
    expect(createArgs.createdById).toBe(1);

    // Email pro contato com link novo e prazo.
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const mail = sendAndLogMock.mock.calls[0][0];
    expect(mail.to.email).toBe('li@shanghaichem.example');
    expect(mail.subject).toContain('QR-2026-042');
    expect(mail.subject.toLowerCase()).toContain('reminder');
    expect(mail.text).toContain('fresh-raw-token-1234567890');
    expect(mail.html).toContain('fresh-raw-token-1234567890');
    expect(mail.templateId).toBe('quote_reminder');

    // Original revogado SO no final.
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('claim perdido (outra replica ganhou): pula sem enviar', async () => {
    findManyMock.mockResolvedValue([dueToken()]);
    updateManyMock.mockResolvedValue({ count: 0 });

    const result = await SupplierPortalReminderService.runReminderSweep(NOW, 48);

    expect(result).toEqual({ due: 1, sent: 0, skipped: 1, failed: 0 });
    expect(createMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('cotacao fechada: pula sem claim', async () => {
    findManyMock.mockResolvedValue([
      dueToken({ quoteRequest: { requestCode: 'QR-X', productName: '', status: 'closed' } }),
    ]);

    const result = await SupplierPortalReminderService.runReminderSweep(NOW, 48);

    expect(result).toEqual({ due: 1, sent: 0, skipped: 1, failed: 0 });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('SMTP falhando: conta como failed e NAO revoga o original', async () => {
    findManyMock.mockResolvedValue([dueToken()]);
    updateManyMock.mockResolvedValue({ count: 1 });
    sendAndLogMock.mockRejectedValue(new Error('SMTP down'));

    const result = await SupplierPortalReminderService.runReminderSweep(NOW, 48);

    expect(result).toEqual({ due: 1, sent: 0, skipped: 0, failed: 1 });
    // Revogacao do original NAO aconteceu — fornecedor segue com link valido.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('sem tokens na janela: retorna zerado sem tocar em nada', async () => {
    findManyMock.mockResolvedValue([]);

    const result = await SupplierPortalReminderService.runReminderSweep(NOW, 48);

    expect(result).toEqual({ due: 0, sent: 0, skipped: 0, failed: 0 });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('a query da janela usa os filtros certos (sem respondido/revogado/ja-lembrado)', async () => {
    findManyMock.mockResolvedValue([]);

    await SupplierPortalReminderService.runReminderSweep(NOW, 48);

    const where = findManyMock.mock.calls[0][0].where;
    expect(where.respondedAt).toBeNull();
    expect(where.revokedAt).toBeNull();
    expect(where.reminderSentAt).toBeNull();
    expect(where.expiresAt.gt).toEqual(NOW);
    expect(where.expiresAt.lte).toEqual(new Date('2026-07-15T09:00:00'));
  });
});
