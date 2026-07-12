// F1 (backlog 2026-07-12): aviso ao comprador quando o fornecedor responde
// pelo portal. Testa o SupplierResponseNotificationService isolado:
//   - happy path (novo envio): e-mail pro comprador com fornecedor + codigo
//   - revisao: assunto/corpo marcam a revisao vN
//   - token inexistente / comprador inativo: nao envia, nao lanca
//   - sendAndLog falhando: servico engole (nunca pode falhar o submit)
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getMailer: vi.fn(),
}));

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: {
    // Sem customizacao no banco -> renderer cai no fallback de arquivo
    // (supplier-response-received.pt.html), que e' o que validamos aqui.
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    supplierPortalToken: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../src/lib/prisma';
import { sendAndLog } from '../src/mailer/MailerService';
import { SupplierResponseNotificationService } from '../src/services/SupplierResponseNotificationService';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;
const findUniqueMock = prisma.supplierPortalToken.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

function tokenFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    createdBy: { name: 'Lucas Comprador', email: 'lucas@sqquimica.com', isActive: true },
    supplier: { name: 'Shanghai Chem Co.' },
    supplierContact: { name: 'Li Wei' },
    quoteRequest: { requestCode: 'QR-2026-042', productName: 'PI-TPO' },
    ...overrides,
  };
}

const BASE_INPUT = {
  tokenId: 42,
  totalPrice: '12500.00',
  currency: 'USD',
  itemsCount: 3,
  version: 1,
  revised: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SupplierResponseNotificationService', () => {
  it('happy path: envia e-mail ao comprador com fornecedor e codigo da cotacao', async () => {
    findUniqueMock.mockResolvedValue(tokenFixture());

    await SupplierResponseNotificationService.notifyBuyerOfSupplierResponse(BASE_INPUT);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to).toEqual({ email: 'lucas@sqquimica.com', name: 'Lucas Comprador' });
    expect(args.subject).toContain('Shanghai Chem Co.');
    expect(args.subject).toContain('QR-2026-042');
    expect(args.subject).toContain('Nova resposta');
    expect(args.templateId).toBe('supplier_response_received');
    expect(args.html).toContain('Shanghai Chem Co.');
    expect(args.html).toContain('12500.00');
    expect(args.text).toContain('Olá, Lucas Comprador.');
    expect(args.text).toContain('QR-2026-042');
    // Sem revisao: a section nao aparece.
    expect(args.html).not.toContain('revisão');
  });

  it('revisao: assunto e corpo marcam a revisao vN', async () => {
    findUniqueMock.mockResolvedValue(tokenFixture());

    await SupplierResponseNotificationService.notifyBuyerOfSupplierResponse({
      ...BASE_INPUT,
      version: 3,
      revised: true,
    });

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.subject).toContain('revisou');
    expect(args.html).toContain('revisão v3');
    expect(args.text).toContain('revisão v3');
  });

  it('token inexistente: nao envia e nao lanca', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      SupplierResponseNotificationService.notifyBuyerOfSupplierResponse(BASE_INPUT),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('comprador inativo: nao envia', async () => {
    findUniqueMock.mockResolvedValue(
      tokenFixture({
        createdBy: { name: 'Ex Comprador', email: 'ex@sqquimica.com', isActive: false },
      }),
    );

    await SupplierResponseNotificationService.notifyBuyerOfSupplierResponse(BASE_INPUT);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('sendAndLog falhando: servico engole o erro (submit nunca falha por causa do aviso)', async () => {
    findUniqueMock.mockResolvedValue(tokenFixture());
    sendAndLogMock.mockRejectedValue(new Error('SMTP down'));

    await expect(
      SupplierResponseNotificationService.notifyBuyerOfSupplierResponse(BASE_INPUT),
    ).resolves.toBeUndefined();
  });

  it('findUnique falhando: servico engole o erro', async () => {
    findUniqueMock.mockRejectedValue(new Error('DB down'));

    await expect(
      SupplierResponseNotificationService.notifyBuyerOfSupplierResponse(BASE_INPUT),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });
});
