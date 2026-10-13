// PR5 (Credit Support): aviso ao comprador quando o parceiro de credito
// responde (ou revisa) pelo portal. Testa o servico isolado:
//   - destinatarios: To = quem encaminhou; CC = criador da cotacao + COMEX
//   - dedupe (mesma pessoa, caixa alta, env x perfil), inativo/null/sem e-mail
//   - nunca lanca; nunca vaza token/link do portal do parceiro
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mailer/MailerService', () => ({
  sendAndLog: vi.fn(),
  getComexCcList: vi.fn(),
  getMailer: vi.fn(),
}));

vi.mock('../src/services/EmailTemplateService', () => ({
  EmailTemplateService: {
    get: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    creditSupportRequest: {
      findUnique: vi.fn(),
    },
    companyProfile: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../src/lib/prisma';
import { getComexCcList, sendAndLog } from '../src/mailer/MailerService';
import { EmailTemplateService } from '../src/services/EmailTemplateService';
import { CreditPartnerResponseNotificationService } from '../src/services/CreditPartnerResponseNotificationService';

const sendAndLogMock = sendAndLog as unknown as ReturnType<typeof vi.fn>;
const comexCcMock = getComexCcList as unknown as ReturnType<typeof vi.fn>;
const templateGetMock = EmailTemplateService.get as unknown as ReturnType<typeof vi.fn>;
const findUniqueMock = prisma.creditSupportRequest.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const profileMock = prisma.companyProfile.findUnique as unknown as ReturnType<typeof vi.fn>;

const FORWARDER = { name: 'Lucas Comprador', email: 'lucas@sqquimica.com', isActive: true };
const QUOTE_OWNER = { name: 'Maria Criadora', email: 'maria@sqquimica.com', isActive: true };

function requestFixture(
  overrides: Record<string, unknown> = {},
  quoteOverrides: Record<string, unknown> = {},
) {
  return {
    id: 77,
    currency: 'USD',
    originalPaymentTermsDays: 60,
    originalTotalPrice: new Prisma.Decimal('80.00'),
    partnerPaymentTermsDays: 120,
    partnerValidityDays: 30,
    partnerNotes: 'Sujeito a aprovacao de credito.',
    partnerTotalPrice: new Prisma.Decimal('83.50'),
    createdBy: FORWARDER,
    quoteRequest: {
      id: 9,
      requestCode: 'QR-2026-042',
      productName: 'PI-TPO',
      createdBy: QUOTE_OWNER,
      ...quoteOverrides,
    },
    creditPartner: { name: 'Banco Alfa' },
    supplier: { name: 'Shanghai Chem Co.' },
    items: [{ isUnavailable: false }, { isUnavailable: false }],
    ...overrides,
  };
}

const BASE_INPUT = { requestId: 77, version: 1, revised: false };

function ccEmails(args: { cc: Array<{ email: string }> }): string[] {
  return args.cc.map((c) => c.email);
}

async function notify(input = BASE_INPUT) {
  await CreditPartnerResponseNotificationService.notifyBuyerOfPartnerResponse(input);
}

beforeEach(() => {
  vi.clearAllMocks();
  sendAndLogMock.mockReset();
  sendAndLogMock.mockResolvedValue(undefined);
  templateGetMock.mockReset();
  templateGetMock.mockResolvedValue(null);
  findUniqueMock.mockReset();
  comexCcMock.mockReset();
  comexCcMock.mockReturnValue([{ email: 'comex@sqquimica.com', name: 'COMEX' }]);
  profileMock.mockReset();
  profileMock.mockResolvedValue({ id: 1, dispatchCc: '["extra@sqquimica.com"]' });
});

describe('CreditPartnerResponseNotificationService', () => {
  it('(a) happy path: To = quem encaminhou; CC = criador da cotacao e depois COMEX', async () => {
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify();

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to).toEqual({ email: 'lucas@sqquimica.com', name: 'Lucas Comprador' });
    expect(ccEmails(args)).toEqual([
      'maria@sqquimica.com',
      'comex@sqquimica.com',
      'extra@sqquimica.com',
    ]);
    expect(args.templateId).toBe('credit_partner_response_received');
    expect(args.relatedEntityType).toBe('credit_support_request');
    expect(args.relatedEntityId).toBe('77');
    expect(args.templateVars).toMatchObject({
      creditSupportRequestId: 77,
      quoteRequestId: 9,
      requestCode: 'QR-2026-042',
      revised: false,
      version: 1,
    });
    expect(args.subject).toBe(
      '[IntelliQuote] Banco Alfa respondeu ao pedido de crédito da cotação QR-2026-042',
    );
    for (const expected of [
      'Banco Alfa',
      'Shanghai Chem Co.',
      'QR-2026-042',
      'PI-TPO',
      '83.50',
      '80.00',
      '+4.38%',
      '120 dias',
      '60 dias',
      '30 dias',
      'Sujeito a aprovacao de credito.',
      '/cotacoes/9',
    ]) {
      expect(args.html).toContain(expected);
    }
    expect(args.text.startsWith('Olá, ')).toBe(true);
    expect(args.text).toContain('Olá, Lucas Comprador.');
    expect(args.text).toContain('/cotacoes/9');
    expect(args.html).not.toContain('revisão');
  });

  it('(b) mesma pessoa encaminhou e criou a cotacao: CC so com a COMEX', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({}, { createdBy: { ...FORWARDER, email: 'LUCAS@sqquimica.com' } }),
    );

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to.email).toBe('lucas@sqquimica.com');
    expect(ccEmails(args)).toEqual(['comex@sqquimica.com', 'extra@sqquimica.com']);
  });

  it.each([
    ['null', null],
    ['inativo', { ...QUOTE_OWNER, isActive: false }],
    ['sem e-mail', { ...QUOTE_OWNER, email: '' }],
  ])('(c) criador da cotacao %s: CC so com a COMEX', async (_label, owner) => {
    findUniqueMock.mockResolvedValue(requestFixture({}, { createdBy: owner }));

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to.email).toBe('lucas@sqquimica.com');
    expect(ccEmails(args)).toEqual(['comex@sqquimica.com', 'extra@sqquimica.com']);
  });

  it('(d) quem encaminhou inativo e criador ativo: To = criador, sem o criador no CC', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({ createdBy: { ...FORWARDER, isActive: false } }),
    );

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.to).toEqual({ email: 'maria@sqquimica.com', name: 'Maria Criadora' });
    expect(ccEmails(args)).not.toContain('maria@sqquimica.com');
    expect(ccEmails(args)).not.toContain('lucas@sqquimica.com');
    expect(args.text).toContain('Olá, Maria Criadora.');
  });

  it('(e) os dois usuarios invalidos: nao envia e nao lanca (COMEX sozinha nao dispara)', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({ createdBy: { ...FORWARDER, isActive: false } }, { createdBy: null }),
    );

    await expect(
      CreditPartnerResponseNotificationService.notifyBuyerOfPartnerResponse(BASE_INPUT),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('(f) dedupe da COMEX: e-mail do To em MAIUSCULAS e duplicata env x perfil sao removidos', async () => {
    comexCcMock.mockReturnValue([
      { email: 'LUCAS@SQQUIMICA.COM', name: 'Lucas' },
      { email: 'comex@sqquimica.com', name: 'COMEX' },
    ]);
    profileMock.mockResolvedValue({
      id: 1,
      dispatchCc: '["COMEX@sqquimica.com","maria@SQQUIMICA.com"]',
    });
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(ccEmails(args)).toEqual(['maria@sqquimica.com', 'comex@sqquimica.com']);
  });

  it('(g) falha ao ler o perfil da empresa: envia mesmo assim, sem copia COMEX', async () => {
    profileMock.mockRejectedValue(new Error('DB down'));
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify();

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const args = sendAndLogMock.mock.calls[0][0];
    expect(ccEmails(args)).toEqual(['maria@sqquimica.com']);
  });

  it('sem 2o usuario e sem COMEX: cc omitido', async () => {
    comexCcMock.mockReturnValue([]);
    profileMock.mockResolvedValue({ id: 1, dispatchCc: null });
    findUniqueMock.mockResolvedValue(requestFixture({}, { createdBy: null }));

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect('cc' in args).toBe(false);
  });

  it('(h) revisao: assunto, html e texto marcam "revisão v2"', async () => {
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify({ requestId: 77, version: 2, revised: true });

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.subject).toContain('revisou');
    expect(args.subject).toContain('(v2)');
    expect(args.html).toContain('revisão v2');
    expect(args.text).toContain('revisão v2');
    expect(args.templateVars).toMatchObject({ revised: true, version: 2 });
  });

  it('(i) sem validade e sem notas: as secoes somem', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({ partnerValidityDays: null, partnerNotes: null }),
    );

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.html).not.toContain('Validade');
    expect(args.html).not.toContain('Observações do parceiro');
    expect(args.text).not.toContain('Validade');
    expect(args.text).not.toContain('Observações do parceiro');
  });

  it('(j) notas com <script> saem escapadas no html', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({ partnerNotes: '<script>alert(1)</script>' }),
    );

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.html).not.toContain('<script>');
    expect(args.html).toContain('&lt;script&gt;');
  });

  it('(k) itens indisponiveis: itemsCount vira texto com a quantidade', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({
        items: [{ isUnavailable: true }, { isUnavailable: false }, { isUnavailable: false }],
      }),
    );
    await notify();
    expect(sendAndLogMock.mock.calls[0][0].text).toContain(
      'Itens: 3 (1 temporariamente indisponível)',
    );

    sendAndLogMock.mockClear();
    findUniqueMock.mockResolvedValue(
      requestFixture({ items: [{ isUnavailable: true }, { isUnavailable: true }] }),
    );
    await notify();
    expect(sendAndLogMock.mock.calls[0][0].text).toContain(
      'Itens: 2 (todos temporariamente indisponíveis)',
    );
  });

  it('markup negativo: "-5.00%" sem sinal duplicado', async () => {
    findUniqueMock.mockResolvedValue(
      requestFixture({ partnerTotalPrice: new Prisma.Decimal('76.00') }),
    );

    await notify();

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.html).toContain('-5.00%');
    expect(args.html).not.toContain('+-5.00%');
  });

  it('(l) override do banco com assunto proprio: o assunto do banco prevalece', async () => {
    templateGetMock.mockResolvedValue({
      subject:
        'Crédito {{partnerName}} / {{requestCode}}{{#revisionLabel}} [{{revisionLabel}}]{{/revisionLabel}}',
      htmlBody: '<p>{{partnerName}} {{quoteUrl}}</p>',
      textBody: '',
      isActive: false,
    });
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify({ requestId: 77, version: 2, revised: true });

    const args = sendAndLogMock.mock.calls[0][0];
    expect(args.subject).toBe('Crédito Banco Alfa / QR-2026-042 [revisão v2]');
    expect(args.html).toContain('<p>Banco Alfa ');
    expect(args.html).toContain('/cotacoes/9');
    expect(templateGetMock).toHaveBeenCalledWith('credit_partner_response_received', 'pt');
  });

  it('(m) registro inexistente, sendAndLog rejeitando ou findUnique rejeitando: nao lanca', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(
      CreditPartnerResponseNotificationService.notifyBuyerOfPartnerResponse(BASE_INPUT),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();

    findUniqueMock.mockResolvedValue(requestFixture());
    sendAndLogMock.mockRejectedValue(new Error('SMTP down'));
    await expect(
      CreditPartnerResponseNotificationService.notifyBuyerOfPartnerResponse(BASE_INPUT),
    ).resolves.toBeUndefined();

    findUniqueMock.mockRejectedValue(new Error('DB down'));
    await expect(
      CreditPartnerResponseNotificationService.notifyBuyerOfPartnerResponse(BASE_INPUT),
    ).resolves.toBeUndefined();
  });

  it('(n) o findUnique nao pede campos sensiveis do pedido', async () => {
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify();

    const query = JSON.stringify(findUniqueMock.mock.calls[0][0]);
    expect(query).not.toContain('tokenHash');
    expect(query).not.toContain('submitterIp');
    expect(query).not.toContain('submitterUserAgent');
    expect(query).not.toContain('recipientEmails');
  });

  it('(o) o payload do sendAndLog nao carrega link/token do portal do parceiro', async () => {
    findUniqueMock.mockResolvedValue(requestFixture());

    await notify();

    const serialized = JSON.stringify(sendAndLogMock.mock.calls[0][0]);
    expect(serialized).not.toContain('portal/credit');
    expect(serialized).not.toContain('token=');
  });
});
