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
vi.mock('@/services/quoteResponses', async (importOriginal) => {
  // Helpers puros de origem vem do modulo real; o resto segue mockado.
  const actual = await importOriginal<typeof import('@/services/quoteResponses')>();
  return {
  effectiveOriginPort: actual.effectiveOriginPort,
  isOriginOverride: actual.isOriginOverride,
  listQuoteResponses: vi.fn(),
  createQuoteResponse: vi.fn(),
  deleteQuoteResponse: vi.fn(),
  INCOTERMS: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  messageOf: (e: unknown) => String(e),
  };
});
vi.mock('@/services/dispatch', () => ({
  previewQuoteResponseReply: vi.fn(),
  replyToQuoteResponse: vi.fn(),
  getTargetPriceHistory: vi.fn(),
}));

import { api } from '@/api/client';
import { listQuoteResponses, createQuoteResponse } from '@/services/quoteResponses';
import { previewQuoteResponseReply, replyToQuoteResponse, getTargetPriceHistory } from '@/services/dispatch';

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

// Resposta multi-item (2 QuoteResponseItem) -- usada nos testes de target
// price POR ITEM da modal "Responder".
const multiItemResponse = {
  ...response,
  id: 43,
  items: [
    {
      id: 501, quoteResponseId: 43, quoteRequestItemId: 5,
      unitPrice: 10, quantity: 4, totalPrice: 40, leadTimeDays: 15,
      notes: null, productName: 'Resina Epóxi', targetPrice: null,
    },
    {
      id: 502, quoteResponseId: 43, quoteRequestItemId: 6,
      unitPrice: 20, quantity: 2, totalPrice: 40, leadTimeDays: 10,
      notes: null, productName: 'Catalisador Y', targetPrice: null,
    },
  ],
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
    vi.mocked(replyToQuoteResponse).mockReset();
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

  it('3c. normalizeResponse repassa incotermPrices e o pop-up mostra a coluna (2 incoterms)', async () => {
    const actual = await vi.importActual<typeof import('@/services/quoteResponses')>(
      '@/services/quoteResponses',
    );
    const normalized = actual.normalizeResponse({
      ...response,
      items: [{
        id: 1, quoteResponseId: 42, quoteRequestItemId: 5,
        unitPrice: '10.00', quantity: 4, totalPrice: '40.00', leadTimeDays: 15,
        notes: null, quoteRequestItem: { productName: 'Resina Epóxi' },
        incotermPrices: [
          { incoterm: 'FOB', unitPrice: '10.00', totalPrice: '40.00' },
          { incoterm: 'CIF', unitPrice: '12.50', totalPrice: '50.00' },
        ],
      }],
    });
    expect(normalized.items?.[0]?.incotermPrices).toHaveLength(2);

    vi.mocked(listQuoteResponses).mockResolvedValue([normalized]);
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
    const [, , dialogC] = getDialogs(container);
    expect(within(dialogC).getByText('Preços por incoterm')).toBeTruthy();
    expect(within(dialogC).getByText('FOB: 10,00 USD · CIF: 12,50 USD')).toBeTruthy();
  });

  it('3d. item legado (incotermPrices nulo) normaliza para null e o pop-up fica sem a coluna', async () => {
    const actual = await vi.importActual<typeof import('@/services/quoteResponses')>(
      '@/services/quoteResponses',
    );
    const normalized = actual.normalizeResponse({
      ...response,
      items: [{
        id: 1, quoteResponseId: 42, quoteRequestItemId: 5,
        unitPrice: '10.00', quantity: 4, totalPrice: '40.00', leadTimeDays: 15,
        notes: null, quoteRequestItem: { productName: 'Resina Epóxi' },
        incotermPrices: null,
      }],
    });
    expect(normalized.items?.[0]?.incotermPrices).toBeNull();

    vi.mocked(listQuoteResponses).mockResolvedValue([normalized]);
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
    const [, , dialogC] = getDialogs(container);
    expect(within(dialogC).getByText('Resina Epóxi')).toBeTruthy();
    expect(within(dialogC).queryByText('Preços por incoterm')).toBeNull();
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

  it('12. modal Responder com resposta multi-item usa campo por item (nao o campo unico) e dispara preview com itemTargets', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([multiItemResponse]);
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const [, dialogB] = getDialogs(container);
    expect(dialogB.open).toBe(true);

    // Campo unico nao existe; um input por item existe.
    expect(dialogB.querySelector('#replyTargetPrice')).toBeNull();
    expect(dialogB.querySelector('#replyItemTarget-501')).not.toBeNull();
    expect(dialogB.querySelector('#replyItemTarget-502')).not.toBeNull();
    expect(within(dialogB).getByText('Resina Epóxi')).toBeTruthy();
    expect(within(dialogB).getByText('Catalisador Y')).toBeTruthy();

    await waitFor(() =>
      expect(previewQuoteResponseReply).toHaveBeenCalledWith(43, {
        subject: 'Produto X - SQ QUIMICA - ACME Ltda',
        message: '',
        itemTargets: [
          { quoteResponseItemId: 501, targetPrice: null },
          { quoteResponseItemId: 502, targetPrice: null },
        ],
      })
    );
  });

  it('13. Enviar e-mail em resposta multi-item manda itemTargets preenchidos (nao targetPrice agregado)', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([multiItemResponse]);
    vi.mocked(replyToQuoteResponse).mockResolvedValue({ status: 'sent', to: 'x@acme.com', cc: [] });
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const [, dialogB] = getDialogs(container);

    fireEvent.change(within(dialogB).getByLabelText('Resina Epóxi'), { target: { value: '8.5' } });
    fireEvent.change(within(dialogB).getByLabelText('Catalisador Y'), { target: { value: '18' } });

    fireEvent.click(within(dialogB).getByRole('button', { name: 'Enviar e-mail' }));

    await waitFor(() =>
      expect(replyToQuoteResponse).toHaveBeenCalledWith(43, {
        subject: 'Produto X - SQ QUIMICA - ACME Ltda',
        message: '',
        itemTargets: [
          { quoteResponseItemId: 501, targetPrice: 8.5 },
          { quoteResponseItemId: 502, targetPrice: 18 },
        ],
      })
    );
  });
  describe('origem do fornecedor (informativa)', () => {
    const originItems = [
      {
        id: 601, quoteResponseId: 44, quoteRequestItemId: 5,
        unitPrice: 10, quantity: 4, totalPrice: 40, leadTimeDays: 15,
        notes: null, productName: 'Resina Epóxi', originPort: null,
      },
      {
        id: 602, quoteResponseId: 44, quoteRequestItemId: 6,
        unitPrice: 20, quantity: 2, totalPrice: 40, leadTimeDays: 10,
        notes: null, productName: 'Catalisador Y', originPort: 'Ningbo',
      },
    ];

    it('14. mostra "Origem: Shanghai" e o badge "1 item de outra origem"', async () => {
      vi.mocked(listQuoteResponses).mockResolvedValue([
        { ...response, id: 44, originPort: 'Shanghai', items: originItems },
      ]);
      const { findByText } = renderTab();
      await findByText('Origem: Shanghai');
      await findByText('1 item de outra origem');
    });

    it('15. pop-up de itens: coluna Origem (herdado sem badge; override com "difere da geral")', async () => {
      vi.mocked(listQuoteResponses).mockResolvedValue([
        { ...response, id: 44, originPort: 'Shanghai', items: originItems },
      ]);
      const { container, findByText, getByRole } = renderTab();
      await findByText('ACME Ltda');
      fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
      const [, , dialogC] = getDialogs(container);
      expect(within(dialogC).getByRole('columnheader', { name: 'Origem' })).toBeTruthy();
      const rows = within(dialogC).getAllByRole('row');
      const inherited = rows.find((row) => row.textContent?.includes('Resina Epóxi'))!;
      const overridden = rows.find((row) => row.textContent?.includes('Catalisador Y'))!;
      expect(inherited.textContent).toContain('Shanghai');
      expect(inherited.textContent).not.toContain('difere da geral');
      expect(overridden.textContent).toContain('Ningbo');
      expect(overridden.textContent).toContain('difere da geral');
    });

    it('16. resposta legada (tudo null): "Origem: —", sem badge e sem coluna Origem', async () => {
      vi.mocked(listQuoteResponses).mockResolvedValue([
        {
          ...response, id: 45, originPort: null,
          items: originItems.map((item) => ({ ...item, originPort: null })),
        },
      ]);
      const { container, findByText, getByRole, queryByText } = renderTab();
      await findByText('Origem: —');
      expect(queryByText(/de outra origem/)).toBeNull();
      fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
      const [, , dialogC] = getDialogs(container);
      expect(within(dialogC).queryByRole('columnheader', { name: 'Origem' })).toBeNull();
    });

    it('17. normalizeResponse mapeia originPort geral e do item (ausente -> null)', async () => {
      const actual = await vi.importActual<typeof import('@/services/quoteResponses')>(
        '@/services/quoteResponses',
      );
      const normalized = actual.normalizeResponse({
        ...response,
        originPort: ' Shanghai ',
        items: [
          { id: 1, quoteResponseId: 42, quoteRequestItemId: 5, unitPrice: '1', quantity: 1, totalPrice: '1', originPort: 'Ningbo' },
          { id: 2, quoteResponseId: 42, quoteRequestItemId: 6, unitPrice: '1', quantity: 1, totalPrice: '1' },
        ],
      });
      expect(normalized.originPort).toBe('Shanghai');
      expect(normalized.items?.map((item) => item.originPort)).toEqual(['Ningbo', null]);
      expect(actual.normalizeResponse({ ...response }).originPort).toBeNull();
      expect(actual.isOriginOverride('shanghai', 'Shanghai ')).toBe(false);
      expect(actual.isOriginOverride('Ningbo', 'Shanghai')).toBe(true);
      expect(actual.isOriginOverride('Ningbo', null)).toBe(true);
      expect(actual.effectiveOriginPort(null, 'Shanghai')).toBe('Shanghai');
      expect(actual.effectiveOriginPort(' Ningbo ', 'Shanghai')).toBe('Ningbo');
    });
  });
});

describe('RespostasTab - item temporariamente indisponivel', () => {
  const unavailableItems = (allUnavailable: boolean) => [
    {
      id: 701, quoteResponseId: 46, quoteRequestItemId: 5,
      unitPrice: allUnavailable ? 0 : 10, quantity: allUnavailable ? 0 : 4,
      totalPrice: allUnavailable ? 0 : 40, leadTimeDays: allUnavailable ? null : 15,
      notes: null, productName: 'Resina Epóxi', targetPrice: null,
      isUnavailable: allUnavailable,
    },
    {
      id: 702, quoteResponseId: 46, quoteRequestItemId: 6,
      unitPrice: 0, quantity: 0, totalPrice: 0, leadTimeDays: null,
      notes: null, productName: 'Catalisador Y', targetPrice: null,
      isUnavailable: true,
    },
  ];

  beforeEach(() => {
    vi.mocked(listQuoteResponses).mockReset();
    vi.mocked(previewQuoteResponseReply).mockReset();
    vi.mocked(replyToQuoteResponse).mockReset();
    vi.mocked(getTargetPriceHistory).mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue([{ id: 7, name: 'ACME Ltda', status: 'active', country: 'BR' }]);
    vi.mocked(getTargetPriceHistory).mockResolvedValue([]);
    vi.mocked(previewQuoteResponseReply).mockResolvedValue({
      to: 'x@acme.com', cc: [], subject: 's', html: '<p>oi</p>', text: 'oi',
    });
  });

  it('18. badge na linha: "1 item indisponível" (parcial) e "Todos os itens indisponíveis"', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      { ...response, id: 46, items: unavailableItems(false) },
    ]);
    const first = renderTab();
    await first.findByText('1 item indisponível');
    first.unmount();

    vi.mocked(listQuoteResponses).mockResolvedValue([
      { ...response, id: 46, items: unavailableItems(true) },
    ]);
    const second = renderTab();
    await second.findByText('Todos os itens indisponíveis');
  });

  it('19. resposta sem item indisponivel nao mostra badge de indisponibilidade', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([multiItemResponse]);
    const { findByText, queryByText } = renderTab();
    await findByText('ACME Ltda');
    expect(queryByText(/indisponíve/)).toBeNull();
  });

  it('20. pop-up de itens: item indisponivel mostra "—" nos valores e o badge "Temporariamente indisponível"', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      { ...response, id: 46, items: unavailableItems(false) },
    ]);
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'ACME Ltda' }));
    const [, , dialogC] = getDialogs(container);
    const bodyRows = within(dialogC).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    // disponivel: valores normais
    expect(within(bodyRows[0]!).getByText('40,00 USD')).toBeTruthy();
    expect(within(bodyRows[0]!).queryByText('Temporariamente indisponível')).toBeNull();
    // indisponivel: sem 0,00 USD; "—" em qtd/preco/total/lead time e badge junto ao produto
    expect(within(bodyRows[1]!).getByText('Temporariamente indisponível')).toBeTruthy();
    expect(within(bodyRows[1]!).queryByText('0,00 USD')).toBeNull();
    const cells = Array.from(bodyRows[1]!.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells.slice(1)).toEqual(['—', '—', '—', '—']);
  });

  it('21. modal Responder multi-item: alvo do item indisponivel desabilitado e fora do payload do preview/envio', async () => {
    vi.mocked(listQuoteResponses).mockResolvedValue([
      { ...response, id: 46, items: unavailableItems(false) },
    ]);
    vi.mocked(replyToQuoteResponse).mockResolvedValue({ status: 'sent', to: 'x@acme.com', cc: [] });
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const [, dialogB] = getDialogs(container);

    const unavailableInput = dialogB.querySelector('#replyItemTarget-702') as HTMLInputElement;
    expect(unavailableInput.disabled).toBe(true);
    expect((dialogB.querySelector('#replyItemTarget-701') as HTMLInputElement).disabled).toBe(false);
    expect(within(dialogB).getByText('Catalisador Y (temporariamente indisponível)')).toBeTruthy();

    await waitFor(() =>
      expect(previewQuoteResponseReply).toHaveBeenCalledWith(46, {
        subject: 'Produto X - SQ QUIMICA - ACME Ltda',
        message: '',
        itemTargets: [{ quoteResponseItemId: 701, targetPrice: null }],
      })
    );

    fireEvent.change(dialogB.querySelector('#replyItemTarget-701') as HTMLInputElement, { target: { value: '8.5' } });
    fireEvent.click(within(dialogB).getByRole('button', { name: 'Enviar e-mail' }));
    await waitFor(() =>
      expect(replyToQuoteResponse).toHaveBeenCalledWith(46, {
        subject: 'Produto X - SQ QUIMICA - ACME Ltda',
        message: '',
        itemTargets: [{ quoteResponseItemId: 701, targetPrice: 8.5 }],
      })
    );
  });

  it('22. normalizeResponse mapeia isUnavailable por item (ausente -> false)', async () => {
    const actual = await vi.importActual<typeof import('@/services/quoteResponses')>(
      '@/services/quoteResponses',
    );
    const normalized = actual.normalizeResponse({
      ...response,
      items: [
        { id: 1, quoteResponseId: 42, quoteRequestItemId: 5, unitPrice: '0', quantity: 0, totalPrice: '0', isUnavailable: true },
        { id: 2, quoteResponseId: 42, quoteRequestItemId: 6, unitPrice: '1', quantity: 1, totalPrice: '1' },
      ],
    });
    expect(normalized.items?.map((item) => item.isUnavailable)).toEqual([true, false]);
  });
});
