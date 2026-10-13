import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriceHistoryModal, EMPTY_HISTORY_MESSAGE } from './PriceHistoryModal';

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
import type { PriceHistoryResult } from '@/services/priceHistory';

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

const columns: PriceHistoryResult['columns'] = [
  { quoteRequestItemId: 5, productName: 'Resina Epóxi', itemCode: 'RES-01', unit: 'KG' },
  { quoteRequestItemId: 6, productName: 'Catalisador Y', itemCode: null, unit: 'KG' },
];

function row(
  id: number,
  recordedAt: string,
  unitA: string,
  unitB: string,
  extra: Partial<PriceHistoryResult['rows'][number]> = {},
): PriceHistoryResult['rows'][number] {
  return {
    id,
    recordedAt,
    source: 'portal',
    actorName: 'Contato <c@forn.test>',
    performedById: null,
    supplierContactId: 9,
    currency: 'USD',
    offeredIncoterm: 'FOB',
    offeredPrice: (Number(unitA) * 4 + Number(unitB) * 2).toFixed(2),
    items: [
      { quoteRequestItemId: 5, unitPrice: unitA, quantity: 4, totalPrice: (Number(unitA) * 4).toFixed(2), isUnavailable: false, incotermPrices: null },
      { quoteRequestItemId: 6, unitPrice: unitB, quantity: 2, totalPrice: (Number(unitB) * 2).toFixed(2), isUnavailable: false, incotermPrices: null },
    ],
    changedItemIds: [],
    changedFields: [],
    ...extra,
  };
}

function mockHistory(result: PriceHistoryResult) {
  vi.mocked(api.get).mockImplementation((async () => result) as typeof api.get);
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <PriceHistoryModal response={response} onClose={onClose} />
    </QueryClientProvider>,
  );
  const dialog = utils.container.querySelector('dialog') as HTMLDialogElement;
  return { ...utils, onClose, dialog };
}

const expectedDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// O titulo do Modal renderiza antes da query resolver: espera a tabela aparecer.
const waitForTable = (dialog: HTMLElement) =>
  waitFor(() => expect(dialog.querySelector('table')).not.toBeNull());

describe('PriceHistoryModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('1. titulo com o fornecedor, 1 coluna por item (codigo ou nome) e data/hora formatadas', async () => {
    mockHistory({ columns, rows: [row(1, '2026-10-01T13:05:00.000Z', '10.00', '20.00')] });
    const { dialog, findByRole } = renderModal();
    expect(await findByRole('heading', { name: 'Histórico de preços — ACME Ltda' })).toBeTruthy();
    await waitForTable(dialog);
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/v1/quote-responses/42/price-history');

    expect(dialog.className).toContain('modal-dialog--xl');
    const headers = Array.from(dialog.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['Data / origem', 'RES-01', 'Catalisador Y', 'Incoterm', 'Total da proposta']);
    expect((dialog.querySelectorAll('thead th')[1] as HTMLElement).title).toBe('Resina Epóxi');

    const firstRow = dialog.querySelector('tbody tr') as HTMLElement;
    expect(within(firstRow).getByText(expectedDate('2026-10-01T13:05:00.000Z'))).toBeTruthy();
    // Data, badge de origem e autor (so o nome; e-mail no title) empilhados na 1a celula (sticky).
    const dateCell = firstRow.querySelector('td') as HTMLElement;
    expect(within(dateCell).getByText('via portal')).toBeTruthy();
    expect(within(dateCell).queryByText('Contato <c@forn.test>')).toBeNull();
    expect(within(dateCell).getByText('Contato').title).toBe('Contato <c@forn.test>');
    expect(firstRow.querySelectorAll('td').length).toBe(5);
    expect(within(firstRow).getByText('10,00 USD')).toBeTruthy();
    expect(within(firstRow).getByText('qtd 4')).toBeTruthy();
    expect(within(firstRow).getByText('80,00 USD')).toBeTruthy();
  });

  it('2. linha 2 destaca so a celula alterada; linha 1 nenhuma', async () => {
    mockHistory({
      columns,
      rows: [
        row(1, '2026-10-01T13:05:00.000Z', '10.00', '20.00'),
        row(2, '2026-10-02T13:05:00.000Z', '12.00', '20.00', { changedItemIds: [5], changedFields: ['offeredPrice'], source: 'manual', actorName: 'Admin' }),
      ],
    });
    const { dialog } = renderModal();
    await waitForTable(dialog);
    const trs = dialog.querySelectorAll('tbody tr');
    expect(trs.length).toBe(2);
    expect(trs[0]!.querySelectorAll('[data-changed="true"]').length).toBe(0);
    const changed = trs[1]!.querySelectorAll('[data-changed="true"]');
    // item alterado + total da proposta (offeredPrice mudou)
    expect(changed.length).toBe(2);
    expect(changed[0]!.textContent).toContain('12,00 USD');
    expect(changed[1]!.textContent).toBe('88,00 USD');
    expect(within(trs[1] as HTMLElement).getByText('manual')).toBeTruthy();
  });

  it('7. incoterm e moeda alterados destacam as celulas Incoterm e Total com o valor anterior', async () => {
    mockHistory({
      columns,
      rows: [
        row(1, '2026-10-01T13:05:00.000Z', '10.00', '20.00'),
        row(2, '2026-10-02T13:05:00.000Z', '10.00', '20.00', {
          offeredIncoterm: 'CIF', currency: 'EUR', changedFields: ['currency', 'offeredIncoterm'],
        }),
      ],
    });
    const { dialog } = renderModal();
    await waitForTable(dialog);
    const trs = dialog.querySelectorAll('tbody tr');
    const cells = trs[1]!.querySelectorAll('td');
    const incotermCell = cells[cells.length - 2] as HTMLElement;
    const totalCell = cells[cells.length - 1] as HTMLElement;
    expect(incotermCell.getAttribute('data-changed')).toBe('true');
    expect(within(incotermCell).getByText('CIF')).toBeTruthy();
    expect(within(incotermCell).getByText('antes: FOB')).toBeTruthy();
    expect(totalCell.getAttribute('data-changed')).toBe('true');
    expect(within(totalCell).getByText('80,00 EUR')).toBeTruthy();
    expect(within(totalCell).getByText('moeda: USD → EUR')).toBeTruthy();
    // Itens sem mudanca de preco nao destacam; linha 1 nada.
    expect(trs[1]!.querySelectorAll('[data-changed="true"]').length).toBe(2);
    expect(trs[0]!.querySelectorAll('[data-changed="true"]').length).toBe(0);
  });

  it('3. item indisponivel mostra o badge e precos alternativos aparecem em texto menor', async () => {
    const base = row(1, '2026-10-01T13:05:00.000Z', '10.00', '0.00');
    base.items[1] = { ...base.items[1]!, isUnavailable: true, quantity: 0 };
    base.items[0] = {
      ...base.items[0]!,
      incotermPrices: [
        { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '40.00' },
        { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '50.00' },
      ],
    };
    mockHistory({ columns, rows: [base] });
    const { dialog } = renderModal();
    await waitForTable(dialog);
    expect(within(dialog).getByText('Indisponível')).toBeTruthy();
    expect(within(dialog).getByText('CIF 12,50 USD')).toBeTruthy();
    expect(within(dialog).queryByText('FOB 10,00 USD')).toBeNull();
  });

  it('4. estado vazio', async () => {
    mockHistory({ columns: [], rows: [] });
    const { dialog, findByText } = renderModal();
    expect(await findByText(EMPTY_HISTORY_MESSAGE)).toBeTruthy();
    expect(dialog.querySelector('table')).toBeNull();
  });

  it('5. erro da API', async () => {
    vi.mocked(api.get).mockImplementation((async () => { throw new Error('falhou'); }) as typeof api.get);
    const { findByRole } = renderModal();
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Não foi possível carregar o histórico');
  });

  it('6. botao Fechar chama onClose', async () => {
    mockHistory({ columns: [], rows: [] });
    const { dialog, onClose, findByText } = renderModal();
    await findByText(EMPTY_HISTORY_MESSAGE);
    const buttons = within(dialog).getAllByRole('button', { name: 'Fechar' });
    buttons[buttons.length - 1]!.click();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
