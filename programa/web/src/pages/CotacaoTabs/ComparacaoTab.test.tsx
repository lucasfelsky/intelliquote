import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComparacaoTab } from './ComparacaoTab';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/services/quoteResponses', () => ({
  listComparisons: vi.fn(),
  executeComparison: vi.fn(),
  approveAward: vi.fn(),
  closeQuoteRequest: vi.fn(),
  messageOf: (e: unknown) => String(e),
}));
vi.mock('@/services/dispatch', () => ({
  previewQuoteResponseReply: vi.fn(),
  replyToQuoteResponse: vi.fn(),
}));

import { listComparisons } from '@/services/quoteResponses';
import { previewQuoteResponseReply } from '@/services/dispatch';

const winner = {
  supplierId: 7,
  quoteResponseId: 42,
  supplier: { id: 7, name: 'ACME Ltda' },
  contact: { name: 'Contato', email: 'x@acme.com' },
  isWinner: true,
  offeredPrice: 100,
  offeredIncoterm: 'FOB' as const,
  paymentTermsDays: 30,
  exchangeRate: 5,
  freightCost: 10,
  insuranceCost: 5,
  otherFees: 2,
  importDutyRate: 0.1,
  ipiRate: 0.05,
  pisRate: 0.02,
  cofinsRate: 0.03,
  cifValue: 500,
  importDutyAmount: 50,
  ipiAmount: 25,
  pisCofinsAmount: 15,
  totalLandedCost: 600,
  priceScore: 50,
  paymentTermsScore: 30,
  incotermScore: 20,
  totalScore: 100,
};

const record = {
  id: 1,
  quoteRequestId: 99,
  executedById: 1,
  executedBy: { id: 1, name: 'Admin', email: 'a@b.c' },
  priceWeight: 1,
  paymentTermsWeight: 1,
  incotermWeight: 1,
  winnerQuoteResponseId: 42,
  createdAt: '2026-01-01T12:00:00.000Z',
  approvalStatus: 'approved',
  results: [winner],
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComparacaoTab
        quoteRequestId={99}
        quoteRequestStatus="closed"
        productName="Produto X"
        requestCode="RFQ-001"
      />
    </QueryClientProvider>
  );
}

function getDialog(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog');
  if (!dialog) throw new Error('dialog não encontrado no container');
  return dialog;
}

describe('ComparacaoTab', () => {
  beforeEach(() => {
    vi.mocked(listComparisons).mockReset();
    vi.mocked(previewQuoteResponseReply).mockReset();
    vi.mocked(listComparisons).mockResolvedValue({ quoteRequestId: 99, comparisons: [record] });
    vi.mocked(previewQuoteResponseReply).mockResolvedValue({
      to: 'x@acme.com',
      cc: [],
      subject: 's',
      html: '<p>oi</p>',
      text: 'oi',
    });
  });

  it('1. replyTarget === null não quebra: exatamente 1 dialog fechado, sem throw', async () => {
    const { container, findByText } = renderTab();
    await findByText('ACME Ltda');
    expect(container.querySelectorAll('dialog').length).toBe(1);
    const dialog = getDialog(container);
    expect(dialog.open).toBe(false);
  });

  it('2. abre com título dinâmico e wide ao clicar em "Responder"', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Responder ACME Ltda');
    expect(dialog.className).toContain('modal-dialog--wide');
  });

  it('3. fallback do nome quando supplier é undefined', async () => {
    vi.mocked(listComparisons).mockResolvedValue({
      quoteRequestId: 99,
      comparisons: [{ ...record, results: [{ ...winner, supplier: undefined }] }],
    });
    const { container, findByText, getByRole } = renderTab();
    await findByText('Fornecedor #7');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const dialog = getDialog(container);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Responder Fornecedor #7');
  });

  it('4. fecha pelo botão × do componente compartilhado', async () => {
    const { container, findByText, getByRole, getByLabelText } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    fireEvent.click(getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
  });

  it('5. openReplyModal intacto: assunto default e disparo do preview ao abrir', async () => {
    const { findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(previewQuoteResponseReply).toHaveBeenCalledTimes(1));
    expect(previewQuoteResponseReply).toHaveBeenCalledWith(42, {
      subject: 'Produto X - SQ QUIMICA - ACME Ltda',
      message: '',
    });
  });
});
