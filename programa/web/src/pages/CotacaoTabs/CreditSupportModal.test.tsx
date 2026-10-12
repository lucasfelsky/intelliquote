import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CreditSupportModal } from './CreditSupportModal';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import { api, ApiError } from '@/api/client';

function partner(id: number, name: string, contacts: { id: number; name: string; email: string; isPrimary: boolean }[]) {
  return {
    id,
    name,
    taxId: null,
    website: null,
    country: 'BR',
    notes: null,
    isActive: true,
    createdAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
    contacts: contacts.map((c) => ({ ...c, phone: null, position: null })),
  };
}

const bancoAlfa = partner(1, 'Banco Alfa', [
  { id: 11, name: 'Ana', email: 'ana@alfa.com', isPrimary: false },
  { id: 10, name: 'Bruno', email: 'bruno@alfa.com', isPrimary: true },
]);
const bancoBeta = partner(2, 'Banco Beta', [
  { id: 20, name: 'Carla', email: 'carla@beta.com', isPrimary: true },
]);

const response = {
  id: 42, quoteRequestId: 99, supplierId: 7,
  offeredPrice: 100, currency: 'USD', exchangeRate: 5,
  freightCost: 10, insuranceCost: 5, otherFees: 2,
  importDuty: 0, ipi: 0, pis: 0, cofins: 0,
  offeredIncoterm: 'FOB' as const, paymentTermsDays: 30, leadTimeDays: 20,
  notes: null, isWinner: false, totalLandedCost: 600,
  submittedAt: '2026-01-01T12:00:00.000Z', version: 1,
  createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
  supplier: { id: 7, name: 'ACME Ltda', country: 'BR', status: 'active' as const },
};

const sendResult = {
  id: 1,
  status: 'sent',
  expiresAt: '2026-10-26T12:00:00.000Z',
  portalUrl: 'https://intelliquote.portal-comex.com/portal/credit?token=RAW',
  recipients: [{ email: 'bruno@alfa.com', status: 'sent' }],
};

function mockPartners(rows: unknown[]) {
  vi.mocked(api.get).mockImplementation((async () => rows) as typeof api.get);
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <CreditSupportModal response={response} quoteRequestId={99} requestCode="RFQ-001" onClose={onClose} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const dialog = utils.container.querySelector('dialog') as HTMLDialogElement;
  return { ...utils, onClose, dialog, qc };
}

describe('CreditSupportModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('1. um parceiro ativo: select ja com ele e contato principal marcado', async () => {
    mockPartners([bancoAlfa]);
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    expect((dialog.querySelector('#cs-partner') as HTMLSelectElement).value).toBe('1');
    const checks = Array.from(dialog.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(checks.map((c) => c.checked)).toEqual([false, true]);
    expect(within(dialog).getByText('Padrão')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Credit Support — ACME Ltda' })).toBeTruthy();
  });

  it('2. zero parceiros: aviso com link para /empresa e "Enviar" desabilitado', async () => {
    mockPartners([]);
    const { dialog } = renderModal();
    await within(dialog).findByText(/Nenhum parceiro de crédito ativo/);
    const link = within(dialog).getByRole('link', { name: 'Empresa' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/empresa');
    expect((within(dialog).getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Pré-visualizar e-mail' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('3. dois parceiros: "Enviar" sem selecao mostra erro local e nao chama a API', async () => {
    mockPartners([bancoAlfa, bancoBeta]);
    const { dialog } = renderModal();
    await within(dialog).findByRole('option', { name: 'Banco Beta' });
    expect((dialog.querySelector('#cs-partner') as HTMLSelectElement).value).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    expect(within(dialog).getByText('Selecione o parceiro de crédito.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('4. envio feliz: body minimo (sem subject/message vazios) e tela de resultado com o link', async () => {
    mockPartners([bancoAlfa]);
    vi.mocked(api.post).mockResolvedValue(sendResult);
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/quote-responses/42/credit-support', {
        creditPartnerId: 1,
        contactIds: [10],
        ttlDays: 14,
      }),
    );
    await within(dialog).findByText('Encaminhamento enviado.');
    const input = within(dialog).getByLabelText('Link do portal do parceiro') as HTMLInputElement;
    expect(input.value).toBe(sendResult.portalUrl);
    expect(within(dialog).getByText('Enviado')).toBeTruthy();
    expect(dialog.querySelector('#cs-partner')).toBeNull();
  });

  it('5. assunto, mensagem e ttl 30 preenchidos entram no body', async () => {
    mockPartners([bancoAlfa]);
    vi.mocked(api.post).mockResolvedValue(sendResult);
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    fireEvent.change(dialog.querySelector('#cs-subject')!, { target: { value: 'Assunto X' } });
    fireEvent.change(dialog.querySelector('#cs-message')!, { target: { value: 'Mensagem Y' } });
    fireEvent.change(dialog.querySelector('#cs-ttl')!, { target: { value: '30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/quote-responses/42/credit-support', {
        creditPartnerId: 1,
        contactIds: [10],
        subject: 'Assunto X',
        message: 'Mensagem Y',
        ttlDays: 30,
      }),
    );
  });

  it('6. "Pré-visualizar e-mail" chama /credit-support/preview e renderiza o iframe', async () => {
    mockPartners([bancoAlfa]);
    vi.mocked(api.post).mockResolvedValue({
      subject: 'Credit Support RFQ-001',
      html: '<p>preview</p>',
      text: 'preview',
      partner: { id: 1, name: 'Banco Alfa' },
      recipients: [{ email: 'bruno@alfa.com', name: 'Bruno' }],
      cc: ['comex@sq.com'],
      items: 2,
    });
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pré-visualizar e-mail' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/quote-responses/42/credit-support/preview', {
        creditPartnerId: 1,
        contactIds: [10],
        ttlDays: 14,
      }),
    );
    const iframe = await waitFor(() => {
      const el = dialog.querySelector('iframe[title="preview-credit-support-email"]');
      if (!el) throw new Error('iframe ausente');
      return el as HTMLIFrameElement;
    });
    expect(iframe.getAttribute('srcdoc')).toBe('<p>preview</p>');
    expect(within(dialog).getByText('Credit Support RFQ-001')).toBeTruthy();
    expect(within(dialog).getByText(/CC: comex@sq.com/)).toBeTruthy();
  });

  it('7. "Copiar link" usa navigator.clipboard e vira "Link copiado!"', async () => {
    mockPartners([bancoAlfa]);
    vi.mocked(api.post).mockResolvedValue(sendResult);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await within(dialog).findByText('Encaminhamento enviado.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sendResult.portalUrl));
    await within(dialog).findByRole('button', { name: 'Link copiado!' });
  });

  it('8. ApiError com { message } do servidor aparece no alert', async () => {
    mockPartners([bancoAlfa]);
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Cotacao fechada' }));
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    const alert = await within(dialog).findByText('Cotacao fechada');
    expect(alert.className).toContain('alert--error');
  });

  it('9. ttlDays fora de 1..60: erro local, sem chamada', async () => {
    mockPartners([bancoAlfa]);
    const { dialog } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    fireEvent.change(dialog.querySelector('#cs-ttl')!, { target: { value: '61' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    expect(within(dialog).getByText('Validade entre 1 e 60 dias.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('10. sem contato marcado: erro local, sem chamada; "Fechar" no resultado chama onClose', async () => {
    mockPartners([bancoAlfa]);
    vi.mocked(api.post).mockResolvedValue(sendResult);
    const { dialog, onClose } = renderModal();
    await within(dialog).findByText('Bruno — bruno@alfa.com');
    const checks = Array.from(dialog.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    fireEvent.click(checks[1]!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    expect(within(dialog).getByText('Selecione ao menos um contato.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(checks[0]!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await within(dialog).findByText('Encaminhamento enviado.');
    expect(api.post).toHaveBeenCalledWith('/v1/quote-responses/42/credit-support', {
      creditPartnerId: 1,
      contactIds: [11],
      ttlDays: 14,
    });
    // O "x" do cabecalho do Modal tambem tem aria-label "Fechar": mira o botao de acao.
    fireEvent.click(dialog.querySelector('.modal-actions .primary-button')!);
    expect(onClose).toHaveBeenCalled();
  });
});
