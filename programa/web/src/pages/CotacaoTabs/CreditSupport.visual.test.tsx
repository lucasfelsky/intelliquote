import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/components/useConfirm';
import { CreditSupportModal } from './CreditSupportModal';
import { CreditSupportPanel } from './CreditSupportPanel';

// F7 (Suite COMEX): painel e modal do Credit Support sem estilo inline; tons dos status, Vencedora, PO enviada e "Proposta do fornecedor mudou"
// (board CotacaoRespostas / ModalCreditSupport). Dados ficticios.

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: mockRole } }),
}));
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

import { api } from '@/api/client';

const response = {
  id: 42, quoteRequestId: 99, supplierId: 7,
  offeredPrice: 100, currency: 'USD', exchangeRate: 5,
  freightCost: 10, insuranceCost: 5, otherFees: 2,
  importDuty: 0, ipi: 0, pis: 0, cofins: 0,
  offeredIncoterm: 'FOB' as const, paymentTermsDays: 30, leadTimeDays: 20,
  notes: null, isWinner: false, totalLandedCost: 600,
  submittedAt: '2026-01-01T12:00:00.000Z', version: 1,
  createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
  supplier: { id: 7, name: '[Fornecedor Demo 01]', country: 'China', status: 'active' as const },
};

const base = {
  quoteResponseId: 42,
  supplier: { id: 7, name: '[Fornecedor Demo 01]', country: 'China' },
  partner: { id: 1, name: '[Parceiro Demo A]' },
  recipientEmails: ['credito@exemplo.invalid'],
  isStale: false,
  isWinner: false,
  purchaseOrderSentAt: null as string | null,
  expiresAt: '2026-10-26T12:00:00.000Z',
  createdAt: '2026-10-12T15:30:00.000Z',
  createdBy: { id: 1, name: '[Nome Sobrenome]' },
  respondedAt: null,
  responseVersion: 1,
  currency: 'USD',
  offeredIncoterm: 'FOB',
  originPort: 'Shanghai',
  originalPaymentTermsDays: 30,
  partnerPaymentTermsDays: null,
  partnerValidityDays: null,
  partnerNotes: null,
  totals: { original: '1000.00', partner: null, markupPercent: null },
  items: [
    {
      quoteRequestItemId: 5, position: 1, productName: '[Item A]', itemCode: 'ITEM-A', unit: 'kg',
      quantity: 100, isUnavailable: false, originPort: null, isDangerousGood: true,
      originalUnitPrice: '10.00', originalTotalPrice: '1000.00',
      partnerUnitPrice: null, partnerTotalPrice: null, markupPercent: null,
    },
    {
      quoteRequestItemId: 6, position: 2, productName: '[Item B]', itemCode: null, unit: 'L',
      quantity: 0, isUnavailable: true, originPort: null, isDangerousGood: false,
      originalUnitPrice: '0.00', originalTotalPrice: '0.00',
      partnerUnitPrice: null, partnerTotalPrice: null, markupPercent: null,
    },
  ],
};

const respondido = {
  ...base, id: 1, status: 'responded', isWinner: true, purchaseOrderSentAt: '2026-10-19T17:05:00.000Z',
  respondedAt: '2026-10-13T10:00:00.000Z', partnerPaymentTermsDays: 90, partnerValidityDays: 15,
  totals: { original: '1000.00', partner: '1100.00', markupPercent: '10.00' },
  items: [{ ...base.items[0]!, partnerUnitPrice: '11.00', partnerTotalPrice: '1100.00', markupPercent: '10.00' }, base.items[1]!],
};
const enviado = { ...base, id: 2, status: 'sent', isStale: true, partner: { id: 2, name: '[Parceiro Demo B]' } };
const expirado = { ...base, id: 3, status: 'expired', partner: { id: 3, name: '[Parceiro Demo C]' } };
const revogado = { ...base, id: 4, status: 'revoked', partner: { id: 4, name: '[Parceiro Demo D]' } };

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <CreditSupportPanel quoteRequestId={99} responses={[response]} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const parceiro = {
  id: 1, name: '[Parceiro Demo A]', taxId: null, website: null, country: 'BR', notes: null, isActive: true,
  createdAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z',
  contacts: [
    { id: 10, name: '[Contato Um]', email: 'um@exemplo.invalid', isPrimary: true, phone: null, position: null },
    { id: 11, name: '[Contato Dois]', email: 'dois@exemplo.invalid', isPrimary: false, phone: null, position: null },
  ],
};

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <CreditSupportModal response={response} quoteRequestId={99} requestCode="QR-2026-0418" onClose={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, dialog: utils.container.querySelector('dialog') as HTMLDialogElement };
}

describe('Credit Support: visual (Suite COMEX, F7)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    mockRole = 'comprador';
  });

  describe('painel', () => {
    beforeEach(() => {
      vi.mocked(api.get).mockImplementation((async () => [respondido, enviado, expirado, revogado]) as typeof api.get);
    });

    it('status: Enviado info, Respondido (sucesso), Expirado muted e Revogado danger, todos com ponto', async () => {
      const { findByRole, getByTestId } = renderPanel();
      await findByRole('heading', { name: 'Credit Support — [Fornecedor Demo 01]' });
      const selo = (id: number, texto: string) => within(getByTestId(`credit-support-request-${id}`)).getByText(texto);
      expect(selo(2, 'Enviado').className).toBe('badge badge--info badge--dot');
      expect(selo(1, 'Respondido').className).toBe('badge badge--dot');
      expect(selo(3, 'Expirado').className).toBe('badge badge--muted badge--dot');
      expect(selo(4, 'Revogado').className).toBe('badge badge--danger badge--dot');
    });

    it('Vencedora em badge--success com o trofeu; "PO enviada" em badge--info com o title de hoje; "Proposta do fornecedor mudou" em badge--warning', async () => {
      const { findByRole, getByTestId } = renderPanel();
      await findByRole('heading', { name: 'Credit Support — [Fornecedor Demo 01]' });
      const cartao1 = within(getByTestId('credit-support-request-1'));
      const vencedora = cartao1.getByText('Vencedora');
      expect(vencedora.classList.contains('badge--success')).toBe(true);
      expect(vencedora.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      const po = cartao1.getByText('PO enviada');
      expect(po.classList.contains('badge--info')).toBe(true);
      expect(po.getAttribute('title')).toContain('Ordem de Compra enviada ao parceiro em');
      expect(within(getByTestId('credit-support-request-2')).getByText('Proposta do fornecedor mudou').classList.contains('badge--warning')).toBe(true);
    });

    it('cada fornecedor e uma secao com h3; os cartoes sao article; "Reenviar" e "Revogar" nao tem estilo inline', async () => {
      const { findByRole, getByTestId, container } = renderPanel();
      await findByRole('heading', { name: 'Credit Support — [Fornecedor Demo 01]' });
      expect(container.querySelector('section.credit-support__grupo > h3')).not.toBeNull();
      expect(getByTestId('credit-support-request-1').tagName).toBe('ARTICLE');
      expect(within(getByTestId('credit-support-request-3')).getByRole('button', { name: 'Reenviar' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    });

    it('"Copiar link" (depois do Reenviar) tem icone; resultado em role=status; nenhum [style] no painel', async () => {
      vi.mocked(api.post).mockResolvedValue({
        id: 3, status: 'sent', expiresAt: '2026-11-03T12:00:00.000Z',
        portalUrl: 'https://portal.exemplo.invalid/credit?token=ficticio',
        recipients: [{ email: 'credito@exemplo.invalid', status: 'sent' }],
      });
      const { findByRole, getByTestId, container } = renderPanel();
      await findByRole('heading', { name: 'Credit Support — [Fornecedor Demo 01]' });
      fireEvent.click(within(getByTestId('credit-support-request-3')).getByRole('button', { name: 'Reenviar' }));
      const copiar = await within(getByTestId('credit-support-request-3')).findByRole('button', { name: 'Copiar link' });
      expect(copiar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(within(getByTestId('credit-support-request-3')).getByRole('status').textContent).toBe('Novo link gerado.');
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
    });
  });

  describe('modal', () => {
    it('"Pre-visualizar e-mail" com o icone eye, ids #cs-* intactos, subtitulo com o codigo e nenhum [style]', async () => {
      vi.mocked(api.get).mockImplementation((async () => [parceiro]) as typeof api.get);
      const { dialog, container } = renderModal();
      await within(dialog).findByText('[Contato Um] — um@exemplo.invalid');
      const preview = within(dialog).getByRole('button', { name: 'Pré-visualizar e-mail' });
      expect(preview.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(within(dialog).getByRole('button', { name: 'Enviar' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      for (const id of ['#cs-partner', '#cs-subject', '#cs-message', '#cs-ttl']) expect(dialog.querySelector(id), id).not.toBeNull();
      expect(dialog.querySelector('.modal-subtitle .credit-support__codigo')?.textContent).toBe('QR-2026-0418');
      expect(dialog.querySelector('.modal-actions .primary-button')).not.toBeNull();
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
    });

    it('resultado: alerta em role=status, destinatarios em lista e "Copiar link" com icone; o rodape continua em .modal-actions', async () => {
      vi.mocked(api.get).mockImplementation((async () => [parceiro]) as typeof api.get);
      vi.mocked(api.post).mockResolvedValue({
        id: 1, status: 'sent', expiresAt: '2026-11-03T12:00:00.000Z',
        portalUrl: 'https://portal.exemplo.invalid/credit?token=ficticio',
        recipients: [{ email: 'um@exemplo.invalid', status: 'sent' }],
      });
      const { dialog, container } = renderModal();
      await within(dialog).findByText('[Contato Um] — um@exemplo.invalid');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
      const alerta = await within(dialog).findByText('Encaminhamento enviado.');
      expect(alerta.getAttribute('role')).toBe('status');
      expect(within(dialog).getByRole('button', { name: 'Copiar link' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(dialog.querySelector('.credit-support-modal__destinos li')).not.toBeNull();
      expect(dialog.querySelector('.modal-body > .modal-actions:last-child .primary-button')).not.toBeNull();
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
    });
  });
});
