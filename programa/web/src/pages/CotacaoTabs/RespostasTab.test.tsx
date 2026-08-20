import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RespostasTab } from './RespostasTab';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/services/quoteResponses', () => ({
  listQuoteResponses: vi.fn(),
  createQuoteResponse: vi.fn(),
  deleteQuoteResponse: vi.fn(),
  INCOTERMS: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  messageOf: (e: unknown) => String(e),
}));
vi.mock('@/services/dispatch', () => ({
  previewQuoteResponseReply: vi.fn(),
  replyToQuoteResponse: vi.fn(),
  getTargetPriceHistory: vi.fn(),
}));

import { api } from '@/api/client';
import { listQuoteResponses, createQuoteResponse } from '@/services/quoteResponses';
import { previewQuoteResponseReply, getTargetPriceHistory } from '@/services/dispatch';

const response = {
  id: 42, quoteRequestId: 99, supplierId: 7,
  offeredPrice: 100, currency: 'USD', exchangeRate: 5,
  freightCost: 10, insuranceCost: 5, otherFees: 2,
  importDuty: 0, ipi: 0, pis: 0, cofins: 0,
  offeredIncoterm: 'FOB' as const, paymentTermsDays: 30, leadTimeDays: 20,
  notes: null, isWinner: false, totalLandedCost: 600,
  submittedAt: '2026-01-01T12:00:00.000Z', version: 1,
  createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
  targetPrice: 90, source: 'manual' as const,
  supplier: { id: 7, name: 'ACME Ltda', country: 'BR', status: 'active' as const },
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RespostasTab
        quoteRequestId={99}
        quoteRequestStatus="open"
        quoteRequestCurrency="USD"
        productName="Produto X"
        requestCode="RFQ-001"
      />
    </QueryClientProvider>
  );
}

function getDialogs(container: HTMLElement): [HTMLDialogElement, HTMLDialogElement, HTMLDialogElement] {
  const dialogs = Array.from(container.querySelectorAll('dialog')) as HTMLDialogElement[];
  if (dialogs.length !== 3) throw new Error(`esperado 3 dialogs, achei ${dialogs.length}`);
  return [dialogs[0]!, dialogs[1]!, dialogs[2]!]; // ordem do JSX: [0] = formulário, [1] = responder, [2] = itens
}

describe('RespostasTab', () => {
  beforeEach(() => {
    vi.mocked(listQuoteResponses).mockReset();
    vi.mocked(createQuoteResponse).mockReset();
    vi.mocked(previewQuoteResponseReply).mockReset();
    vi.mocked(getTargetPriceHistory).mockReset();
    vi.mocked(api.get).mockReset();

    vi.mocked(listQuoteResponses).mockResolvedValue([response]);
    vi.mocked(api.get).mockResolvedValue([{ id: 7, name: 'ACME Ltda', status: 'active', country: 'BR' }]);
    vi.mocked(getTargetPriceHistory).mockResolvedValue([]);
    vi.mocked(previewQuoteResponseReply).mockResolvedValue({
      to: 'x@acme.com',
      cc: [],
      subject: 's',
      html: '<p>oi</p>',
      text: 'oi',
    });
  });

  it('1. todos fechados no load', async () => {
    const { container, findByText } = renderTab();
    await findByText('ACME Ltda');
    expect(container.querySelectorAll('dialog').length).toBe(3);
    const [dialogA, dialogB, dialogC] = getDialogs(container);
    expect(dialogA.open).toBe(false);
    expect(dialogB.open).toBe(false);
    expect(dialogC.open).toBe(false);
  });

  it('2. "+ Nova resposta" abre o modal A', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Nova resposta' }));
    const [dialogA] = getDialogs(container);
    expect(dialogA.open).toBe(true);
    const heading = dialogA.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Nova resposta');
  });

  it('3. clicar no nome do fornecedor abre o pop-up de itens com fallback (resposta manual sem items)', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
    const [, , dialogC] = getDialogs(container);
    expect(dialogC.open).toBe(true);
    const heading = dialogC.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Itens — ACME Ltda');
    const rows = within(dialogC).getAllByRole('row');
    // 1 linha de cabeçalho + 1 linha de fallback (resposta sem QuoteResponseItem)
    expect(rows.length).toBe(2);
    expect(within(dialogC).getByText('Produto X')).toBeTruthy();
    expect(within(dialogC).getAllByText('100,00 USD').length).toBe(2);
  });

  it('3b. pop-up de itens usa response.items quando presentes', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([{
      ...response,
      items: [{
        id: 1, quoteResponseId: 42, quoteRequestItemId: 5,
        unitPrice: 10, quantity: 4, totalPrice: 40, leadTimeDays: 15,
        notes: null, productName: 'Resina Epóxi',
      }],
    }]);
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
    const [, , dialogC] = getDialogs(container);
    expect(within(dialogC).getByText('Resina Epóxi')).toBeTruthy();
    expect(within(dialogC).getByText('40,00 USD')).toBeTruthy();
  });

  it('4. modal A é wide', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Nova resposta' }));
    const [dialogA] = getDialogs(container);
    expect(dialogA.className).toContain('modal-dialog--wide');
  });

  it('5. modal A sem título duplicado', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Nova resposta' }));
    const [dialogA] = getDialogs(container);
    expect(dialogA.querySelectorAll('h2').length).toBe(1);
  });

  it('6. "Cancelar" do modal A fecha e não submete', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Nova resposta' }));
    const [dialogA] = getDialogs(container);
    expect(dialogA.open).toBe(true);
    fireEvent.click(within(dialogA).getByRole('button', { name: 'Cancelar' }));
    expect(dialogA.open).toBe(false);
    expect(createQuoteResponse).not.toHaveBeenCalled();
  });

  it('7. "Responder" abre o modal B: título dinâmico + wide + dispara o preview', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const [, dialogB] = getDialogs(container);
    expect(dialogB.open).toBe(true);
    const heading = dialogB.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Responder ACME Ltda');
    expect(dialogB.className).toContain('modal-dialog--wide');
    await waitFor(() =>
      expect(previewQuoteResponseReply).toHaveBeenCalledWith(42, {
        subject: 'Produto X - SQ QUIMICA - ACME Ltda',
        message: '',
        targetPrice: 90,
      })
    );
  });

  it('8. fallback do nome quando supplier é undefined', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([{ ...response, supplier: undefined }]);
    const { container, findByText, getByRole } = renderTab();
    await findByText('Fornecedor #7');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const [, dialogB] = getDialogs(container);
    const heading = dialogB.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Responder Fornecedor #7');
  });

  it('9. guard de null do modal B: children só existem depois de abrir', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    const [, dialogBClosed] = getDialogs(container);
    expect(dialogBClosed.querySelector('#replySubject')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const [, dialogBOpen] = getDialogs(container);
    expect(dialogBOpen.querySelector('#replySubject')).not.toBeNull();
  });

  it('10. query gated + botão × do componente compartilhado', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    expect(getTargetPriceHistory).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(getTargetPriceHistory).toHaveBeenCalledWith(42));
    const [, dialogB] = getDialogs(container);
    fireEvent.click(within(dialogB).getByLabelText('Fechar'));
    expect(dialogB.open).toBe(false);
  });

  it('11. tabela dentro de .table-wrapper e acoes com --nowrap', async () => {
    const { container, findByText } = renderTab();
    await findByText('ACME Ltda');
    const table = container.querySelector('table.table');
    expect(table?.parentElement?.classList.contains('table-wrapper')).toBe(true);
    expect(container.querySelector('.row-actions')?.classList.contains('row-actions--nowrap')).toBe(true);
  });
});
