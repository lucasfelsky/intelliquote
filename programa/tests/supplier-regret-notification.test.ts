// F8 (backlog 2026-07-12): aviso de "nao selecionado" aos perdedores.
//   - happy path: N fornecedores perdedores -> N e-mails; vencedor NAO recebe
//   - dedup por fornecedor (varias respostas do mesmo supplier = 1 e-mail)
//   - fornecedor sem contato: conta como failed, nao derruba os demais
//   - sem perdedores: nao envia
//   - request inexistente: retorna zerado sem lancar
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getMailer: vi.fn(),
}));

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: { get: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../src/services/CompanyProfileService', () => ({
  CompanyProfileService: { get: vi.fn().mockResolvedValue({ companyName: 'SQ Quimica' }) },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    quoteRequest: { findUnique: vi.fn() },
    quoteResponse: { findMany: vi.fn() },
    supplierContact: { findFirst: vi.fn() },
  },
}));

import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { SupplierRegretNotificationService } from '../src/services/SupplierRegretNotificationService';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;
const requestFindUnique = prisma.quoteRequest.findUnique as unknown as ReturnType<typeof vi.fn>;
const responseFindMany = prisma.quoteResponse.findMany as unknown as ReturnType<typeof vi.fn>;
const contactFindFirst = prisma.supplierContact.findFirst as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  requestFindUnique.mockResolvedValue({ requestCode: 'QR-2026-042', productName: 'PI-TPO' });
  contactFindFirst.mockImplementation(({ where }: { where: { supplierId: number } }) =>
    Promise.resolve({
      id: where.supplierId * 10,
      name: `Contato ${where.supplierId}`,
      email: `c${where.supplierId}@fornecedor.example`,
      isPrimary: true,
    }),
  );
});

describe('SupplierRegretNotificationService.notifyLosers', () => {
  it('happy path: envia para cada fornecedor perdedor (dedup por supplier)', async () => {
    responseFindMany.mockResolvedValue([
      { supplierId: 2, supplier: { name: 'Beta' } },
      { supplierId: 2, supplier: { name: 'Beta' } }, // versao repetida -> dedup
      { supplierId: 3, supplier: { name: 'Gamma' } },
    ]);

    const result = await SupplierRegretNotificationService.notifyLosers(5);

    expect(result).toEqual({ losers: 2, sent: 2, failed: 0 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(2);
    // where do findMany garante que so' pega isWinner=false / nao deletado.
    expect(responseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { quoteRequestId: 5, isWinner: false, deletedAt: null },
      }),
    );
    const emails = sendAndLogMock.mock.calls.map((c) => c[0].to.email);
    expect(emails).toContain('c2@fornecedor.example');
    expect(emails).toContain('c3@fornecedor.example');
    const first = sendAndLogMock.mock.calls[0][0];
    expect(first.templateId).toBe('quote_regret');
    expect(first.subject).toContain('QR-2026-042');
    // Tom neutro — nao expoe preco vencedor.
    expect(first.text).not.toMatch(/\d+[.,]\d{2}/);
  });

  it('fornecedor sem contato: failed parcial, nao derruba os demais', async () => {
    responseFindMany.mockResolvedValue([
      { supplierId: 2, supplier: { name: 'Beta' } },
      { supplierId: 3, supplier: { name: 'Gamma' } },
    ]);
    contactFindFirst.mockImplementation(({ where }: { where: { supplierId: number } }) =>
      where.supplierId === 3
        ? Promise.resolve(null)
        : Promise.resolve({ id: 20, name: 'Contato 2', email: 'c2@fornecedor.example', isPrimary: true }),
    );

    const result = await SupplierRegretNotificationService.notifyLosers(5);

    expect(result).toEqual({ losers: 2, sent: 1, failed: 1 });
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
  });

  it('sem perdedores: nao envia nada', async () => {
    responseFindMany.mockResolvedValue([]);

    const result = await SupplierRegretNotificationService.notifyLosers(5);

    expect(result).toEqual({ losers: 0, sent: 0, failed: 0 });
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('request inexistente: retorna zerado sem lancar', async () => {
    requestFindUnique.mockResolvedValue(null);

    await expect(SupplierRegretNotificationService.notifyLosers(999)).resolves.toEqual({
      losers: 0,
      sent: 0,
      failed: 0,
    });
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('erro inesperado no findMany: engolido (nunca lanca)', async () => {
    responseFindMany.mockRejectedValue(new Error('DB down'));

    await expect(SupplierRegretNotificationService.notifyLosers(5)).resolves.toEqual({
      losers: 0,
      sent: 0,
      failed: 0,
    });
  });
});
