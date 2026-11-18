import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ItemPriceHistoryModal,
  EMPTY_ITEM_HISTORY_MESSAGE,
  NO_CATALOG_MESSAGE,
  TRUNCATED_MESSAGE,
  formatVariation,
} from './ItemPriceHistoryModal';

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
import type { ItemPriceHistoryEntry, ItemPriceHistoryResult } from '@/services/itemPriceHistory';

function entry(over: Partial<ItemPriceHistoryEntry> = {}): ItemPriceHistoryEntry {
  return {
    recordedAt: '2026-10-14T13:05:00.000Z',
    quoteRequestId: 1,
    requestCode: 'COT-0001',
    isCurrentQuote: true,
    supplierId: 7,
    supplierName: 'ACME Ltda',
    source: 'portal',
    incoterm: 'FOB',
    currency: 'USD',
    unit: 'KG',
    quantity: 1500,
    unitPrice: '5.50',
    incotermPrices: [],
    variationPct: 10,
    ...over,
  };
}

function result(over: Partial<ItemPriceHistoryResult> = {}): ItemPriceHistoryResult {
  return {
    item: { id: 7, catalogItemId: 55, name: 'Ácido cítrico', marketName: 'Citric Acid', unit: 'KG' },
    linkedBy: 'catalogItemId',
    entries: [],
    truncated: false,
    ...over,
  };
}

function mockHistory(data: ItemPriceHistoryResult) {
  vi.mocked(api.get).mockImplementation((async () => data) as typeof api.get);
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <ItemPriceHistoryModal item={{ id: 7, name: 'Ácido cítrico' }} onClose={onClose} />
    </QueryClientProvider>,
  );
  const dialog = utils.container.querySelector('dialog') as HTMLDialogElement;
  return { ...utils, onClose, dialog };
}

const expectedDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

describe('ItemPriceHistoryModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('chama a API do item, mostra título, linhas, data, origem, preço e variação com sinal', async () => {
    mockHistory(
      result({
        entries: [
          entry(),
          entry({
            recordedAt: '2026-10-12T10:00:00.000Z',
            quoteRequestId: 2,
            requestCode: 'COT-0002',
            isCurrentQuote: false,
            source: 'manual',
            unitPrice: '5.00',
            variationPct: null,
            incotermPrices: [{ incoterm: 'CIF', unitPrice: '5.80', totalPrice: null }],
          }),
        ],
      }),
    );
    const { dialog, findByRole } = renderModal();

    expect(await findByRole('heading', { name: 'Histórico de preço — Ácido cítrico' })).toBeTruthy();
    await waitFor(() => expect(dialog.querySelector('table')).not.toBeNull());
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/v1/quote-request-items/7/price-history');
    expect(dialog.className).toContain('modal-dialog--xl');

    const headers = Array.from(dialog.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['Data', 'Cotação', 'Fornecedor', 'Origem', 'Incoterm', 'Moeda', 'Preço unitário', 'Variação']);

    const rows = dialog.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    expect(within(first).getByText(expectedDate('2026-10-14T13:05:00.000Z'))).toBeTruthy();
    expect(within(first).getByText('esta cotação')).toBeTruthy();
    expect(within(first).getByText('ACME Ltda')).toBeTruthy();
    expect(within(first).getByText('via portal')).toBeTruthy();
    expect(within(first).getByText('5,50 USD')).toBeTruthy();
    expect(within(first).getByText('+10,00%')).toBeTruthy();

    const second = rows[1] as HTMLElement;
    expect(within(second).getByText('COT-0002')).toBeTruthy();
    expect(within(second).getByText('manual')).toBeTruthy();
    expect(within(second).getByText('CIF 5,80 USD')).toBeTruthy();
    expect(second.querySelectorAll('td')[7]!.textContent).toBe('—');
    expect(dialog.textContent).not.toContain(NO_CATALOG_MESSAGE);
  });

  it('item sem catálogo mostra o aviso de vínculo', async () => {
    mockHistory(
      result({
        linkedBy: 'quoteRequestItem',
        item: { id: 7, catalogItemId: null, name: 'Ácido cítrico', marketName: null, unit: 'KG' },
        entries: [entry()],
      }),
    );
    const { dialog } = renderModal();

    await waitFor(() => expect(dialog.textContent).toContain(NO_CATALOG_MESSAGE));
  });

  it('sem linhas mostra o estado vazio', async () => {
    mockHistory(result());
    const { dialog } = renderModal();

    await waitFor(() => expect(dialog.textContent).toContain(EMPTY_ITEM_HISTORY_MESSAGE));
    expect(dialog.querySelector('table')).toBeNull();
  });

  it('truncado mostra o aviso do teto', async () => {
    mockHistory(result({ entries: [entry()], truncated: true }));
    const { dialog } = renderModal();

    await waitFor(() => expect(dialog.textContent).toContain(TRUNCATED_MESSAGE));
  });

  it('erro da API mostra alerta', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('falhou'));
    const { dialog } = renderModal();

    await waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('falhou'));
  });

  it('Fechar chama onClose', async () => {
    mockHistory(result());
    const { dialog, onClose } = renderModal();
    await waitFor(() => expect(dialog.textContent).toContain(EMPTY_ITEM_HISTORY_MESSAGE));

    const buttons = within(dialog).getAllByRole('button', { name: 'Fechar' });
    buttons[buttons.length - 1]!.click();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('formatVariation', () => {
  it('sinal textual, menos tipográfico e traço', () => {
    expect(formatVariation(3.2)).toBe('+3,20%');
    expect(formatVariation(-1.05)).toBe('−1,05%');
    expect(formatVariation(0)).toBe('0,00%');
    expect(formatVariation(null)).toBe('—');
  });
});
