// Aviso ao SOLICITANTE (comercial) a cada mudanca de status feita pelo COMEX (PR2).
//   - `to` = e-mail do solicitante, SEM cc, com o opt-out allowComercialRecipients
//   - recusa mostra o motivo (escapado); atendida nunca traz preco nem fornecedor
//   - solicitante inativo / status pending: nao envia; falhas nunca lancam
//   - o opt-out fica restrito a UM arquivo / UMA ocorrencia em src/
import fs from 'fs';
import path from 'path';
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
  EmailTemplateService: { get: vi.fn().mockResolvedValue(null) },
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
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { prisma } from '../src/lib/prisma';
import { EmailTemplateService } from '../src/services/EmailTemplateService';
import { CommercialRequestNotificationService } from '../src/services/CommercialRequestNotificationService';

const findUniqueMock = prisma.commercialRequest.findUnique as unknown as ReturnType<typeof vi.fn>;
const templateGetMock = EmailTemplateService.get as unknown as ReturnType<typeof vi.fn>;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    status: 'quoting',
    rejectionReason: null,
    requestedBy: { name: 'Ana Comercial', email: 'ana@sqquimica.com', isActive: true },
    quoteRequest: { requestCode: 'QR-20261020-ABC123', deletedAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  templateGetMock.mockResolvedValue(null);
  findUniqueMock.mockResolvedValue(row());
  sendAndLogMock.mockResolvedValue({});
  getComexCcListMock.mockReturnValue([{ email: 'comex1@sqquimica.com' }]);
  companyProfileGetMock.mockResolvedValue({ dispatchCc: JSON.stringify([]) });
});

describe('notifyRequesterOfStatusChange', () => {
  it('envia ao solicitante, sem cc, com o opt-out do guard', async () => {
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.to).toEqual({ email: 'ana@sqquimica.com', name: 'Ana Comercial' });
    expect('cc' in input).toBe(false);
    expect(input.allowComercialRecipients).toBe(true);
    expect(input.templateId).toBe('commercial_request_status_changed');
    expect(input.templateVars).toEqual({
      requestId: 9,
      status: 'quoting',
      quoteCode: 'QR-20261020-ABC123',
    });
    expect(input.relatedEntityType).toBe('commercial_request');
    expect(input.relatedEntityId).toBe('9');
    expect(input.subject).toBe('[IntelliQuote] Solicitação #9 — Em cotação');
    expect(input.html).toContain('Sua solicitação #9 entrou em cotação.');
    expect(input.html).toContain('QR-20261020-ABC123');
    expect(input.html).toContain('/solicitacoes');
  });

  it('recusa inclui o motivo no HTML e no texto', async () => {
    findUniqueMock.mockResolvedValue(
      row({ status: 'rejected', rejectionReason: 'Fora do portfolio atual' }),
    );
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.subject).toContain('Recusada');
    expect(input.html).toContain('Fora do portfolio atual');
    expect(input.text).toContain('Fora do portfolio atual');
    expect(input.html).toContain('foi recusada');
  });

  it('motivo com HTML e escapado', async () => {
    findUniqueMock.mockResolvedValue(
      row({ status: 'rejected', rejectionReason: '<script>alert(1)</script>' }),
    );
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.html).not.toContain('<script>');
    expect(input.html).toContain('&lt;script&gt;');
  });

  it('atendida nao carrega preco, fornecedor nem a nota de atendimento', async () => {
    findUniqueMock.mockResolvedValue(row({ status: 'fulfilled', fulfillmentNote: 'segredo interno' }));
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    const input = sendAndLogMock.mock.calls[0][0];
    const everything = `${input.subject}\n${input.html}\n${input.text}`.toLowerCase();
    expect(input.subject).toContain('Atendida');
    expect(everything).toContain('foi atendida');
    expect(everything).not.toContain('fornecedor');
    expect(everything).not.toContain('supplier');
    expect(everything).not.toContain('segredo interno');
    expect(everything).not.toMatch(/\busd\b|\beur\b|preço final|preco final/);
    // o select nunca pede a nota
    expect(JSON.stringify(findUniqueMock.mock.calls[0][0].select)).not.toContain('fulfillmentNote');
  });

  it('A4: usa o status/codigo/motivo que a acao gravou, nao o estado atual do banco', async () => {
    // banco ja avancou para fulfilled, mas a acao que dispara este aviso gravou "quoting"
    findUniqueMock.mockResolvedValue(row({ status: 'fulfilled' }));
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9, {
      status: 'quoting',
      quoteCode: 'QR-GRAVADO',
      rejectionReason: null,
    });

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.subject).toContain('Em cotação');
    expect(input.html).toContain('entrou em cotação');
    expect(input.html).toContain('QR-GRAVADO');
    expect(input.html).not.toContain('QR-20261020-ABC123');
    expect(input.templateVars).toEqual({ requestId: 9, status: 'quoting', quoteCode: 'QR-GRAVADO' });
  });

  it('A4: motivo da recusa vem da acao, nao do banco', async () => {
    findUniqueMock.mockResolvedValue(row({ status: 'rejected', rejectionReason: 'motivo velho' }));
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9, {
      status: 'rejected',
      quoteCode: null,
      rejectionReason: 'Motivo novo',
    });

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.html).toContain('Motivo novo');
    expect(input.html).not.toContain('motivo velho');
    expect(input.html).not.toContain('QR-20261020-ABC123');
  });

  it('A4: status pending informado pela acao -> nao envia', async () => {
    findUniqueMock.mockResolvedValue(row({ status: 'quoting' }));
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9, { status: 'pending' });
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('cotacao excluida: sem codigo no aviso', async () => {
    findUniqueMock.mockResolvedValue(
      row({ quoteRequest: { requestCode: 'QR-X', deletedAt: new Date() } }),
    );
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.html).not.toContain('QR-X');
    expect(input.templateVars.quoteCode).toBe('');
  });

  it('solicitante inativo -> nao envia', async () => {
    findUniqueMock.mockResolvedValue(
      row({ requestedBy: { name: 'Ana', email: 'ana@sqquimica.com', isActive: false } }),
    );
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('solicitante sem e-mail -> nao envia', async () => {
    findUniqueMock.mockResolvedValue(
      row({ requestedBy: { name: 'Ana', email: '', isActive: true } }),
    );
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('status pending -> nao envia', async () => {
    findUniqueMock.mockResolvedValue(row({ status: 'pending' }));
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('solicitacao inexistente -> nao envia e nao lanca', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(
      CommercialRequestNotificationService.notifyRequesterOfStatusChange(9),
    ).resolves.toBeUndefined();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('sendAndLog rejeitando -> nao lanca', async () => {
    sendAndLogMock.mockRejectedValue(new Error('SMTP down'));
    await expect(
      CommercialRequestNotificationService.notifyRequesterOfStatusChange(9),
    ).resolves.toBeUndefined();
  });

  it('consulta ao banco falhando -> nao lanca', async () => {
    findUniqueMock.mockRejectedValue(new Error('db down'));
    await expect(
      CommercialRequestNotificationService.notifyRequesterOfStatusChange(9),
    ).resolves.toBeUndefined();
  });

  it('usa o template do banco quando existe linha', async () => {
    templateGetMock.mockResolvedValue({
      subject: 'Solicitacao {{requestId}}: {{statusLabel}}',
      htmlBody: '<p>{{statusMessage}}</p>',
      textBody: null,
    });
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.subject).toBe('Solicitacao 9: Em cotação');
    expect(input.html).toBe('<p>Sua solicitação #9 entrou em cotação.</p>');
    expect(templateGetMock).toHaveBeenCalledWith('commercial_request_status_changed', 'pt');
  });

  it('fallback do arquivo quando EmailTemplateService.get devolve null', async () => {
    templateGetMock.mockResolvedValue(null);
    await CommercialRequestNotificationService.notifyRequesterOfStatusChange(9);

    const input = sendAndLogMock.mock.calls[0][0];
    expect(input.html).toContain('<!doctype html>');
    expect(input.text).toContain('Sua solicitação #9 entrou em cotação.');
  });
});

describe('opt-out allowComercialRecipients (estrutural)', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('a string do opt-out aparece em EXATAMENTE 1 arquivo de src/, 1 ocorrencia', () => {
    const srcDir = path.join(__dirname, '..', 'src');
    const needle = 'allowComercialRecipients: true';
    const hits: Array<{ file: string; count: number }> = [];
    for (const file of walk(srcDir)) {
      const count = fs.readFileSync(file, 'utf8').split(needle).length - 1;
      if (count > 0) hits.push({ file: path.relative(srcDir, file).replace(/\\/g, '/'), count });
    }
    expect(hits).toEqual([{ file: 'services/CommercialRequestNotificationService.ts', count: 1 }]);
  });

  it('notifyComexOfNewRequest continua chamando sendAndLog SEM o opt-out', async () => {
    findUniqueMock.mockResolvedValue({
      id: 7,
      customerName: 'ACME',
      notes: null,
      requestedBy: { name: 'Ana' },
      items: [
        {
          quantity: 1,
          unit: 'KG',
          targetPrice: null,
          targetCurrency: null,
          catalogItem: { commercialName: 'Resina X' },
        },
      ],
    });
    await CommercialRequestNotificationService.notifyComexOfNewRequest(7);

    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
    expect(sendAndLogMock.mock.calls[0][0].allowComercialRecipients).toBeUndefined();
  });
});
