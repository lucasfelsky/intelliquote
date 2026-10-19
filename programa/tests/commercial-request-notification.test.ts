// Aviso a Equipe COMEX de nova solicitacao do comercial (PR1).
//   - destinatarios: INTELLIQUOTE_COMEX_CC_LIST + dispatchCc do perfil, dedup case-insensitive
//   - lista propria commercialRequestNotifyEmails preenchida: vai SO para ela (sem env/dispatchCc);
//     vazia: fallback acima; usuario comercial e removido nos dois casos
//   - lista vazia: nao envia e nao lanca
//   - sendAndLog falhando: servico engole (nunca falha a criacao)
//   - sem linha no banco: fallback de arquivo renderiza solicitante e itens; HTML escapa observacoes
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getComexCcListMock, sendAndLogMock, companyProfileGetMock } = vi.hoisted(() => ({
  getComexCcListMock: vi.fn(),
  sendAndLogMock: vi.fn(),
  companyProfileGetMock: vi.fn(),
}));

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: sendAndLogMock,
  getComexCcList: getComexCcListMock,
  getMailer: vi.fn(),
}));

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: {
    // Sem linha no banco (template sem seed) -> fallback de arquivo.
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../src/services/CompanyProfileService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/CompanyProfileService')>();
  return {
    ...original,
    CompanyProfileService: { get: companyProfileGetMock },
  };
});

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    commercialRequest: { findUnique: vi.fn() },
    // loadComercialEmails (filtro no envio): por padrao ninguem e comercial.
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { prisma } from '../src/lib/prisma';
import { EmailTemplateService } from '../src/services/EmailTemplateService';
import { CommercialRequestNotificationService } from '../src/services/CommercialRequestNotificationService';

const findUniqueMock = prisma.commercialRequest.findUnique as unknown as ReturnType<typeof vi.fn>;
const comercialUsersMock = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;
const templateGetMock = EmailTemplateService.get as unknown as ReturnType<typeof vi.fn>;

function requestFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    customerName: 'ACME Ltda',
    notes: 'Entrega urgente',
    requestedBy: { name: 'Ana Comercial' },
    items: [
      {
        quantity: 5,
        unit: 'KG',
        targetPrice: null,
        targetCurrency: null,
        catalogItem: { commercialName: 'Resina X' },
      },
      {
        quantity: 2,
        unit: 'TON',
        targetPrice: { toFixed: () => '12.50' },
        targetCurrency: 'USD',
        catalogItem: { commercialName: 'Solvente Y' },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  comercialUsersMock.mockResolvedValue([]);
  templateGetMock.mockResolvedValue(null);
  getComexCcListMock.mockReturnValue([
    { email: 'comex1@sqquimica.com', name: 'COMEX 1' },
    { email: 'Comex2@sqquimica.com' },
  ]);
  companyProfileGetMock.mockResolvedValue({
    dispatchCc: JSON.stringify(['COMEX1@sqquimica.com', 'financeiro@sqquimica.com']),
  });
  findUniqueMock.mockResolvedValue(requestFixture());
  sendAndLogMock.mockResolvedValue({});
});

describe('CommercialRequestNotificationService', () => {
  it('envia para a lista COMEX + dispatchCc com dedup case-insensitive (to = 1o, cc = resto)', async () => {
    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to).toEqual({ email: 'comex1@sqquimica.com', name: 'COMEX 1' });
    expect(args.cc.map((c: { email: string }) => c.email.toLowerCase())).toEqual([
      'comex2@sqquimica.com',
      'financeiro@sqquimica.com',
    ]);
    expect(args.templateId).toBe('commercial_request_created');
    expect(args.relatedEntityType).toBe('commercial_request');
    expect(args.relatedEntityId).toBe('7');
    expect(args.subject).toBe('[IntelliQuote] Nova solicitação do comercial #7 — Ana Comercial');
  });

  it('quem estava no dispatchCc e virou comercial nao recebe o aviso (filtro no envio, case-insensitive)', async () => {
    comercialUsersMock.mockResolvedValue([{ email: 'Financeiro@SQQuimica.com' }]);

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    expect(comercialUsersMock.mock.calls[0][0].where).toEqual({ role: { name: 'comercial' } });
    const args = sendAndLogMock.mock.calls[0][0];
    const all = [args.to, ...args.cc].map((r: { email: string }) => r.email.toLowerCase());
    expect(all).toEqual(['comex1@sqquimica.com', 'comex2@sqquimica.com']);
  });

  it('lista propria preenchida: vai SO para ela (sem env nem dispatchCc), to = 1o, cc = resto, dedup', async () => {
    companyProfileGetMock.mockResolvedValue({
      dispatchCc: JSON.stringify(['COMEX1@sqquimica.com', 'financeiro@sqquimica.com']),
      commercialRequestNotifyEmails: JSON.stringify([
        'gestor@sqquimica.com',
        'Compras@sqquimica.com',
        'GESTOR@sqquimica.com',
      ]),
    });

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to).toEqual({ email: 'gestor@sqquimica.com' });
    expect(args.cc).toEqual([{ email: 'Compras@sqquimica.com' }]);
    const all = [args.to, ...args.cc].map((r: { email: string }) => r.email.toLowerCase());
    expect(all).not.toContain('comex1@sqquimica.com');
    expect(all).not.toContain('comex2@sqquimica.com');
    expect(all).not.toContain('financeiro@sqquimica.com');
    expect(getComexCcListMock).not.toHaveBeenCalled();
  });

  it('lista propria vazia ([]): cai no comportamento atual (env + dispatchCc)', async () => {
    companyProfileGetMock.mockResolvedValue({
      dispatchCc: JSON.stringify(['financeiro@sqquimica.com']),
      commercialRequestNotifyEmails: '[]',
    });

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    const args = sendAndLogMock.mock.calls[0][0];
    const all = [args.to, ...args.cc].map((r: { email: string }) => r.email.toLowerCase());
    expect(all).toEqual([
      'comex1@sqquimica.com',
      'comex2@sqquimica.com',
      'financeiro@sqquimica.com',
    ]);
  });

  it('lista propria com e-mail de usuario comercial: o comercial e removido (case-insensitive)', async () => {
    companyProfileGetMock.mockResolvedValue({
      dispatchCc: '[]',
      commercialRequestNotifyEmails: JSON.stringify(['vendas@sqquimica.com', 'gestor@sqquimica.com']),
    });
    comercialUsersMock.mockResolvedValue([{ email: 'Vendas@SQQuimica.com' }]);

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to).toEqual({ email: 'gestor@sqquimica.com' });
    expect(args.cc).toEqual([]);
  });

  it('lista propria so com comercial: nao envia e NAO cai no fallback (nao amplia o publico)', async () => {
    companyProfileGetMock.mockResolvedValue({
      dispatchCc: JSON.stringify(['financeiro@sqquimica.com']),
      commercialRequestNotifyEmails: JSON.stringify(['vendas@sqquimica.com']),
    });
    comercialUsersMock.mockResolvedValue([{ email: 'vendas@sqquimica.com' }]);

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('se todos os destinatarios forem comercial: nao envia', async () => {
    getComexCcListMock.mockReturnValue([{ email: 'x@sqquimica.com' }]);
    companyProfileGetMock.mockResolvedValue({ dispatchCc: null });
    comercialUsersMock.mockResolvedValue([{ email: 'x@sqquimica.com' }]);

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('fallback de arquivo renderiza solicitante, itens, observacoes e link', async () => {
    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    const args = sendAndLogMock.mock.calls[0][0];
    expect(templateGetMock).toHaveBeenCalledWith('commercial_request_created', 'pt');
    expect(args.html).toContain('Ana Comercial');
    expect(args.html).toContain('ACME Ltda');
    expect(args.html).toContain('Resina X — 5 KG');
    expect(args.html).toContain('Solvente Y — 2 TON — alvo 12.50 USD');
    expect(args.html).toContain('Entrega urgente');
    expect(args.html).toContain('/solicitacoes');
    expect(args.text).toContain('Ana Comercial');
    expect(args.text).toContain('Resina X — 5 KG');
    expect(args.text).toContain('/solicitacoes');
  });

  it('sem cliente e sem observacoes: as sections somem', async () => {
    findUniqueMock.mockResolvedValue(requestFixture({ customerName: null, notes: null }));

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.html).not.toContain('Cliente:');
    expect(args.html).not.toContain('Observações:');
    expect(args.text).not.toContain('Cliente:');
    expect(args.text).not.toContain('Observações:');
  });

  it('HTML escapa <script> vindo das observacoes', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({ notes: '<script>alert(1)</script>', customerName: '<b>x</b>' }),
    );

    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.html).not.toContain('<script>');
    expect(args.html).toContain('&lt;script&gt;');
    expect(args.html).not.toContain('<b>x</b>');
  });

  it('lista de destinatarios vazia: nao envia e nao lanca', async () => {
    getComexCcListMock.mockReturnValue([]);
    companyProfileGetMock.mockResolvedValue({ dispatchCc: null });

    await expect(
      CommercialRequestNotificationService.notifyComexOfNewRequest(7),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('sendAndLog rejeitando: nao lanca', async () => {
    sendAndLogMock.mockRejectedValue(new Error('SMTP down'));

    await expect(
      CommercialRequestNotificationService.notifyComexOfNewRequest(7),
    ).resolves.toBeUndefined();
  });

  it('solicitacao inexistente: nao envia e nao lanca', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      CommercialRequestNotificationService.notifyComexOfNewRequest(7),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('erro de banco: nao lanca', async () => {
    findUniqueMock.mockRejectedValue(new Error('DB down'));

    await expect(
      CommercialRequestNotificationService.notifyComexOfNewRequest(7),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });
});
