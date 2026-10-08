import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import CotacaoDetalhe from './CotacaoDetalhe';

const authState = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: authState.role } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/services/dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/dispatch')>();
  return {
    ...actual,
    previewDispatch: vi.fn(),
    sendDispatch: vi.fn(),
    listPortalTokens: vi.fn(),
    generatePortalTokens: vi.fn(),
    revokePortalToken: vi.fn(),
    regeneratePortalToken: vi.fn(),
  };
});

import { api } from '@/api/client';
import {
  previewDispatch,
  sendDispatch,
  listPortalTokens,
  revokePortalToken,
  regeneratePortalToken,
  type DispatchPreviewResult,
  type DispatchSendResult,
  type PortalTokenListItem,
} from '@/services/dispatch';

const quoteFixture = {
  id: 1,
  requestCode: 'RFQ-001',
  productName: 'Produto X',
  quantity: 100,
  description: 'Descricao da cotacao',
  desiredIncoterm: ['FOB'],
  destinationPort: 'Santos',
  originPort: 'Shanghai',
  currency: 'USD',
  deadlineAt: null,
  status: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  createdById: 1,
  items: [
    {
      id: 10,
      quoteRequestId: 1,
      itemCode: null,
      productName: 'Produto X',
      description: null,
      quantity: 50,
      unit: 'KG',
      targetPrice: null,
      notes: null,
      desiredIncoterm: null,
      destinationPort: null,
      catalogItemId: 3,
      catalogItem: {
        id: 3,
        commercialName: 'Produto X',
        marketName: 'PX',
        familyId: 1,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  quoteResponses: [],
};

const catalogFixture = [
  {
    id: 150,
    commercialName: 'Item Cento e Cinquenta',
    marketName: 'IC150',
    isActive: true,
    family: { id: 1, name: 'Monômero' },
  },
];

const getImpl = async (path: string, params?: Record<string, string>): Promise<unknown> => {
  if (path.startsWith('/v1/quote-requests/')) return quoteFixture;
  if (path === '/api/v1/company-profile') return { dispatchCc: [] };
  if (path === '/v1/suppliers') {
    return [
      {
        id: 5,
        name: 'ACME Ltda',
        status: 'active',
        families: [{ id: 1, name: 'Monômero' }],
      },
    ];
  }
  if (path === '/v1/supplier-contacts') {
    return { bySupplier: { '5': [{ id: 10, name: 'Contato', email: 'c@acme.com', isPrimary: true }] } };
  }
  if (path === '/v1/catalog-items') {
    const search = params?.search?.trim().toLowerCase();
    const list = search
      ? catalogFixture.filter((c) => c.commercialName.toLowerCase().includes(search))
      : params?.family === '1'
        ? catalogFixture
        : [];
    return { data: list, pagination: { totalItems: list.length } };
  }
  if (path === '/v1/item-families') {
    return { data: [{ id: 1, name: 'Monômero', isActive: true }] };
  }
  return [];
};

const previewFixture: DispatchPreviewResult = {
  recipientCount: 1,
  recipients: [
    {
      supplierContactId: 10,
      supplierId: 5,
      supplierName: 'ACME Ltda',
      contactName: 'Contato',
      contactEmail: 'c@acme.com',
      ccCount: 0,
      cc: [],
    },
  ],
  preview: { subject: 'Assunto teste', html: '<p>oi</p>', text: 'oi' },
  cc: [],
  companyCc: [],
};

const sendFixture: DispatchSendResult = {
  dispatchEventId: 1,
  status: 'completed',
  recipientsCount: 1,
  sentCount: 1,
  failedCount: 0,
  results: [{ supplierContactId: 10, status: 'sent', dispatchEventId: 1 }],
};

const tokenFixture: PortalTokenListItem = {
  id: 99,
  supplier: { id: 5, name: 'ACME Ltda' },
  contact: { id: 10, name: 'Contato', email: 'c@acme.com' },
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revokedAt: null,
  firstSeenAt: null,
  lastSeenAt: null,
  accessCount: 0,
  respondedAt: null,
  createdAt: new Date().toISOString(),
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cotacoes/1']}>
        <ConfirmProvider>
          <Routes>
            <Route path="/cotacoes/:id" element={<CotacaoDetalhe />} />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function dialogByTitle(container: HTMLElement, title: string): HTMLDialogElement {
  const found = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(
    (d) => d.querySelector('.modal-header h2')?.textContent === title,
  );
  if (!found) throw new Error(`dialog "${title}" não encontrado`);
  return found;
}

async function openDispatchToPreview(container: HTMLElement, getByRole: ReturnType<typeof render>['getByRole']) {
  fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
  const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
  await waitFor(() => within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
  await waitFor(() => within(dialog).getByLabelText('Assunto'));
  return dialog;
}

describe('CotacaoDetalhe', () => {
  beforeEach(() => {
    authState.role = 'admin';
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(api.get).mockImplementation(getImpl as unknown as typeof api.get);

    vi.mocked(previewDispatch).mockReset();
    vi.mocked(sendDispatch).mockReset();
    vi.mocked(listPortalTokens).mockReset();
    vi.mocked(revokePortalToken).mockReset();
    vi.mocked(regeneratePortalToken).mockReset();

    vi.mocked(previewDispatch).mockResolvedValue(previewFixture);
    vi.mocked(sendDispatch).mockResolvedValue(sendFixture);
    vi.mocked(listPortalTokens).mockResolvedValue([]);
    vi.mocked(revokePortalToken).mockResolvedValue({ ok: true });
  });

  it('1. load limpo: 5 dialogs no container, os 4 da página fechados', async () => {
    const { container, findByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelectorAll('dialog').length).toBe(5);
    for (const title of [
      'Enviar cotação para fornecedores',
      'Links do portal',
      'Novo item',
      'Editar cotação',
    ]) {
      expect(dialogByTitle(container, title).open).toBe(false);
    }
  });

  it('2. Modal C abre pela aba Itens: título "Novo item", tamanho wide, sem título duplicado', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    expect(dialog.open).toBe(true);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).toContain('modal-dialog--wide');
    expect(dialog.querySelectorAll('h2').length).toBe(1);
  });

  describe('aviso de reagrupamento de POs (aba Itens)', () => {
    const groupedQuote = (dispatchEvents: number) => ({
      ...quoteFixture,
      purchaseOrders: [
        { id: 7, quoteRequestId: 1, label: 'PO 1', position: 1, createdAt: '', updatedAt: '' },
        { id: 8, quoteRequestId: 1, label: 'PO 2', position: 2, createdAt: '', updatedAt: '' },
      ],
      items: [{ ...quoteFixture.items[0], purchaseOrderId: 7 }],
      quoteResponses: [],
      _count: { dispatchEvents },
    });
    const useQuote = (dispatchEvents: number) => {
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) =>
        path.startsWith('/v1/quote-requests/')
          ? groupedQuote(dispatchEvents)
          : getImpl(path, params)) as unknown as typeof api.get);
    };

    it('3a. cotação já enviada (sem respostas) mostra o aviso', async () => {
      useQuote(1);
      const { findByRole, findByText } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(await findByRole('tab', { name: 'Itens' }));
      expect(await findByText(/reagrupar POs não altera/)).toBeTruthy();
    });

    it('3b. cotação sem envio e sem respostas não mostra o aviso', async () => {
      useQuote(0);
      const { findByRole, findAllByText, queryByText } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(await findByRole('tab', { name: 'Itens' }));
      expect((await findAllByText('PO 1')).length).toBeGreaterThan(0);
      expect(queryByText(/reagrupar POs não altera/)).toBeNull();
    });
  });

  describe('DG vem das respostas dos fornecedores (aba Itens)', () => {
    const quoteWithResponses = (responseItems: Array<Record<string, unknown>>[]) => ({
      ...quoteFixture,
      quoteResponses: responseItems.map((items, index) => ({
        id: 500 + index,
        supplierId: 5,
        offeredPrice: 10,
        currency: 'USD',
        offeredIncoterm: 'FOB',
        items,
      })),
    });
    const useQuote = (quote: unknown) => {
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) =>
        path.startsWith('/v1/quote-requests/') ? quote : getImpl(path, params)) as unknown as typeof api.get);
    };
    const dgCellText = (table: HTMLElement) => {
      const bodyRow = within(table).getAllByRole('row')[1]!;
      return bodyRow.querySelectorAll('td')[6]?.textContent;
    };

    it('3d. selo DG quando uma resposta ativa marcou o item e ela nao esta indisponivel', async () => {
      useQuote(
        quoteWithResponses([
          [{ quoteRequestItemId: 10, isDangerousGood: true, isUnavailable: false }],
          [{ quoteRequestItemId: 10, isDangerousGood: true, isUnavailable: true }],
          [{ quoteRequestItemId: 10, isDangerousGood: false, isUnavailable: false }],
        ]),
      );
      const { findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(getByRole('tab', { name: 'Itens' }));
      const table = getByRole('table');
      expect(dgCellText(table)).toBe('DG');
      expect(table.querySelector('.badge--danger')?.getAttribute('title')).toBe(
        'Informado como DG por 1 fornecedor',
      );
    });

    it('3e. sem resposta marcando DG (mesmo com DG legado no catalogo) a coluna mostra "—"', async () => {
      useQuote({
        ...quoteWithResponses([[{ quoteRequestItemId: 10, isDangerousGood: false, isUnavailable: false }]]),
        items: [
          {
            ...quoteFixture.items[0],
            catalogItem: { ...quoteFixture.items[0]!.catalogItem, isDangerousGood: true },
          },
        ],
      });
      const { findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(getByRole('tab', { name: 'Itens' }));
      expect(dgCellText(getByRole('table'))).toBe('—');
    });
  });

  it('3. Modal C em edição: título dinâmico, item atual só leitura (sem busca), quantidade preenchida', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    const table = getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Editar' }));
    const dialog = dialogByTitle(container, 'Editar item');
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Produto X');
    expect(within(dialog).queryByPlaceholderText('Buscar item do catálogo...')).toBeNull();
    const qtyInput = within(dialog).getByLabelText('Quantidade *') as HTMLInputElement;
    expect(qtyInput.value).toBe('50');
  });

  it('3c. Novo item: busca server-side acha item além do teto de 100 e cria com catalogItemId', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 99 });
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    fireEvent.change(within(dialog).getByPlaceholderText('Buscar item do catálogo...'), {
      target: { value: 'cento' },
    });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/v1/catalog-items',
        expect.objectContaining({ search: 'cento', pageSize: '100' }),
      ),
    );
    const itemButton = await within(dialog).findByRole('button', { name: 'Item Cento e Cinquenta' });
    fireEvent.click(itemButton);
    fireEvent.change(within(dialog).getByLabelText('Quantidade *'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/v1/quote-requests/1/items',
        expect.objectContaining({ catalogItemId: 150, quantity: 5 }),
      ),
    );
  });

  it('3d. Novo item: modo navegar mostra a pasta fechada e carrega os itens da família ao abrir', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    const folder = await within(dialog).findByRole('button', { name: 'Monômero' });
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(within(dialog).queryByRole('button', { name: 'Item Cento e Cinquenta' })).toBeNull();
    fireEvent.click(folder);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/v1/catalog-items',
        expect.objectContaining({ family: '1' }),
      ),
    );
    expect(await within(dialog).findByRole('button', { name: 'Item Cento e Cinquenta' })).toBeTruthy();
  });

  it('3e. Edição salva o item atual (catalogItemId 3) mesmo fora de qualquer página do catálogo', async () => {
    vi.mocked(api.put).mockResolvedValue({ id: 10 });
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(within(getByRole('table')).getByRole('button', { name: 'Editar' }));
    const dialog = dialogByTitle(container, 'Editar item');
    fireEvent.change(within(dialog).getByLabelText('Quantidade *'), { target: { value: '60' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/v1/quote-request-items/10',
        expect.objectContaining({ catalogItemId: 3, quantity: 60 }),
      ),
    );
  });

  it('3f. Novo item não faz mais a carga de catálogo com pageSize 200', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    await within(dialog).findByRole('button', { name: 'Monômero' });
    const catalogCalls = vi
      .mocked(api.get)
      .mock.calls.filter(
        ([path, params]) =>
          path === '/v1/catalog-items' && (params as Record<string, string> | undefined)?.pageSize === '200',
      );
    expect(catalogCalls).toHaveLength(0);
  });

  describe('polish do modal de item (edição)', () => {
    async function openEdit(patch: { quote?: Record<string, unknown>; item?: Record<string, unknown> } = {}) {
      const fixture = {
        ...quoteFixture,
        ...patch.quote,
        items: [{ ...quoteFixture.items[0], ...patch.item }],
      };
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) => {
        if (path.startsWith('/v1/quote-requests/')) return fixture;
        return getImpl(path, params);
      }) as unknown as typeof api.get);
      const utils = renderPage();
      await utils.findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(utils.getByRole('tab', { name: 'Itens' }));
      fireEvent.click(within(utils.getByRole('table')).getByRole('button', { name: 'Editar' }));
      return { ...utils, dialog: dialogByTitle(utils.container, 'Editar item') };
    }

    it('3g. edição usa largura padrão, rótulo "Item" e ações como filhas diretas do form', async () => {
      const { dialog } = await openEdit();
      expect(dialog.className).not.toContain('modal-dialog--wide');
      expect(dialog.querySelector('.item-picker__current')?.textContent).toContain('Item');
      expect(dialog.querySelector('form > .modal-actions')).not.toBeNull();
    });

    it('3h. porto do item igual ao da cotação aparece como herdado (checkbox marcado, sem campo)', async () => {
      const { dialog } = await openEdit({ item: { destinationPort: 'Santos' } });
      const checkbox = within(dialog).getByLabelText('Usar o porto da cotação (Santos)') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      expect(dialog.querySelector('#itemPort')).toBeNull();
    });

    it('3i. comparação do porto ignora caixa e espaços nas pontas', async () => {
      const { dialog } = await openEdit({ item: { destinationPort: ' santos ' } });
      const checkbox = within(dialog).getByLabelText('Usar o porto da cotação (Santos)') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      expect(dialog.querySelector('#itemPort')).toBeNull();
    });

    it('3j. porto diferente do da cotação aparece como override (checkbox desmarcado, campo preenchido)', async () => {
      const { dialog } = await openEdit({ item: { destinationPort: 'Paranaguá' } });
      const checkbox = within(dialog).getByLabelText('Usar o porto da cotação (Santos)') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect((dialog.querySelector('#itemPort') as HTMLInputElement).value).toBe('Paranaguá');
    });

    it('3k. salvar com porto herdado envia destinationPort null', async () => {
      vi.mocked(api.put).mockResolvedValue({ id: 10 });
      const { dialog } = await openEdit({ item: { destinationPort: 'Santos' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
      await waitFor(() =>
        expect(api.put).toHaveBeenCalledWith(
          '/v1/quote-request-items/10',
          expect.objectContaining({ destinationPort: null }),
        ),
      );
    });

    it('3l. cotação com 2 incoterms usa o plural no rótulo do checkbox', async () => {
      const { dialog } = await openEdit({ quote: { desiredIncoterm: ['FOB', 'CIF'] } });
      expect(within(dialog).getByLabelText('Usar os INCOTERMS da cotação (FOB / CIF)')).toBeTruthy();
    });

    it('3m. foco inicial na edição vai para Quantidade', async () => {
      await openEdit();
      await waitFor(() => expect(document.activeElement?.id).toBe('itemQuantity'));
    });
  });

  it('4. Modal C cancela: fecha e não chama api.post', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    expect(dialog.open).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog.open).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('5. Guard do Modal D: #qrCurrency ausente no load, presente após abrir "Editar"', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelector('#qrCurrency')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const currencyInput = container.querySelector('#qrCurrency') as HTMLInputElement | null;
    expect(currencyInput).not.toBeNull();
    expect(currencyInput?.value).toBe('USD');
  });

  it('6. Modal D fecha e limpa editForm: × fecha o dialog e remove #qrCurrency do DOM', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const dialog = dialogByTitle(container, 'Editar cotação');
    expect(dialog.open).toBe(true);
    fireEvent.click(within(dialog).getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
    expect(container.querySelector('#qrCurrency')).toBeNull();
  });

  it('7. Modal A abre wide, com subtítulo e h2 único', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    expect(dialog.open).toBe(true);
    expect(dialog.className).toContain('modal-dialog--wide');
    expect(dialog.textContent).toContain('RFQ-001');
    expect(dialog.textContent).toContain('Produto X');
    expect(dialog.querySelectorAll('h2').length).toBe(1);
  });

  it('8. Guard do Modal A: .dispatcher-list ausente no load, presente com o dispatch aberto', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelector('.dispatcher-list')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
    await waitFor(() => expect(container.querySelector('.dispatcher-list')).not.toBeNull());
  });

  it('9. fluxo select -> preview: previewDispatch chamado com o contato selecionado', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dialog = await openDispatchToPreview(container, getByRole);
    expect(previewDispatch).toHaveBeenCalledWith(1, [10], { subject: '', message: '', expiresInDays: 7 });
    const subjectInput = within(dialog).getByLabelText('Assunto') as HTMLInputElement;
    expect(subjectInput.value).toBe('Assunto teste');
  });

  describe('lista de fornecedores do envio (backend limita pageSize a 100)', () => {
    const makeSuppliers = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        id: 1000 + from + i,
        name: `Fornecedor ${String(from + i).padStart(3, '0')}`,
        status: 'active',
        families: [],
      }));

    it('9i. percorre todas as páginas: lista fornecedor da 2ª página e nenhuma chamada usa pageSize > 100', async () => {
      const baseImpl = getImpl;
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/suppliers') {
          const page = Number(params?.page ?? '1');
          const pagination = (p: number) => ({ page: p, pageSize: 100, totalItems: 130, totalPages: 2 });
          if (page === 1) return { data: makeSuppliers(1, 100), pagination: pagination(1) };
          if (page === 2) return { data: makeSuppliers(101, 130), pagination: pagination(2) };
          return { data: [], pagination: pagination(page) };
        }
        return baseImpl(path, params);
      }) as unknown as typeof api.get);

      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
      const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
      await waitFor(() => expect(within(dialog).getByText('Fornecedor 130')).toBeTruthy());
      expect(within(dialog).getByText('Fornecedor 001')).toBeTruthy();
      expect(within(dialog).getByText('Fornecedor 101')).toBeTruthy();

      const supplierCalls = vi
        .mocked(api.get)
        .mock.calls.filter(([path]) => path === '/v1/suppliers')
        .map(([, params]) => params as Record<string, string>);
      expect(supplierCalls.map((p) => p.page)).toEqual(['1', '2']);
      for (const p of supplierCalls) {
        expect(p.status).toBe('active');
        expect(Number(p.pageSize)).toBeLessThanOrEqual(100);
      }
    });

    it('9j. lista simples (formato legado) é consumida numa única chamada', async () => {
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
      const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
      await waitFor(() => expect(within(dialog).getByText('ACME Ltda')).toBeTruthy());
      const supplierCalls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/v1/suppliers');
      expect(supplierCalls).toHaveLength(1);
    });
  });

  describe('lista de fornecedores do envio: totalPages, lotes de contatos e erro', () => {
    const makeSuppliers = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        id: 1000 + from + i,
        name: `Fornecedor ${String(from + i).padStart(3, '0')}`,
        status: 'active',
        families: [],
      }));

    const openDispatch = async () => {
      const utils = renderPage();
      await utils.findByRole('heading', { name: 'RFQ-001' });
      fireEvent.click(utils.getByRole('button', { name: 'Enviar cotacao' }));
      return { ...utils, dialog: dialogByTitle(utils.container, 'Enviar cotação para fornecedores') };
    };

    it('9k. totalPages=3: carrega as 3 páginas e lista fornecedores de todas', async () => {
      const baseImpl = getImpl;
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/suppliers') {
          const page = Number(params?.page ?? '1');
          const pagination = { page, pageSize: 100, totalItems: 250, totalPages: 3 };
          if (page === 1) return { data: makeSuppliers(1, 100), pagination };
          if (page === 2) return { data: makeSuppliers(101, 200), pagination };
          return { data: makeSuppliers(201, 250), pagination };
        }
        return baseImpl(path, params);
      }) as unknown as typeof api.get);

      const { dialog } = await openDispatch();
      await waitFor(() => expect(within(dialog).getByText('Fornecedor 250')).toBeTruthy());
      expect(within(dialog).getByText('Fornecedor 001')).toBeTruthy();
      expect(within(dialog).getByText('Fornecedor 150')).toBeTruthy();
      const pages = vi
        .mocked(api.get)
        .mock.calls.filter(([path]) => path === '/v1/suppliers')
        .map(([, params]) => (params as Record<string, string>).page);
      expect(pages).toEqual(['1', '2', '3']);
    });

    it('9l. sem totalPages e sempre página cheia: atinge o guarda e mostra estado de erro (sem lista parcial)', async () => {
      const baseImpl = getImpl;
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/suppliers') {
          const page = Number(params?.page ?? '1');
          const from = (page - 1) * 100 + 1;
          return { data: makeSuppliers(from, from + 99) };
        }
        return baseImpl(path, params);
      }) as unknown as typeof api.get);

      const { dialog } = await openDispatch();
      await waitFor(() =>
        expect(within(dialog).getByText('Não foi possível carregar os fornecedores.')).toBeTruthy(),
      );
      expect(within(dialog).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
      expect(within(dialog).queryByText('Nenhum fornecedor ativo')).toBeNull();
      expect(within(dialog).queryByText('Fornecedor 001')).toBeNull();
    });

    it('9m. 250 fornecedores: contatos buscados em 3 lotes (<=100 ids) e todos selecionáveis', async () => {
      const baseImpl = getImpl;
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/suppliers') {
          const page = Number(params?.page ?? '1');
          const pagination = { page, pageSize: 100, totalItems: 250, totalPages: 3 };
          const from = (page - 1) * 100 + 1;
          return { data: makeSuppliers(from, Math.min(from + 99, 250)), pagination };
        }
        if (path === '/v1/supplier-contacts') {
          const ids = String(params?.supplierIds ?? '').split(',').map(Number);
          const bySupplier: Record<string, unknown[]> = {};
          for (const sid of ids) {
            bySupplier[String(sid)] = [
              { id: sid * 10, name: `Contato ${sid}`, email: `c${sid}@x.com`, isPrimary: true },
            ];
          }
          return { bySupplier };
        }
        return baseImpl(path, params);
      }) as unknown as typeof api.get);

      const { dialog } = await openDispatch();
      await waitFor(() => expect(within(dialog).getByText('Fornecedor 250')).toBeTruthy());
      await waitFor(() => {
        const calls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/v1/supplier-contacts');
        expect(calls).toHaveLength(3);
      });
      const batches = vi
        .mocked(api.get)
        .mock.calls.filter(([path]) => path === '/v1/supplier-contacts')
        .map(([, params]) => String((params as Record<string, string>).supplierIds).split(','));
      expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
      expect(new Set(batches.flat()).size).toBe(250);

      // Contatos de todos os lotes mesclados: seleciona fornecedor do 1º e do 3º lote.
      const rowOf = (name: string) => within(dialog).getByText(name).closest('label') as HTMLElement;
      for (const name of ['Fornecedor 001', 'Fornecedor 250']) {
        await waitFor(() => expect(within(rowOf(name)).getAllByRole('checkbox').length).toBeGreaterThan(0));
        fireEvent.click(within(rowOf(name)).getByRole('checkbox'));
      }
      await waitFor(() => expect(within(dialog).getByText('2 destinatario(s) selecionado(s)')).toBeTruthy());
    });

    it('9n. erro ao carregar fornecedores: mensagem + "Tentar de novo" refaz a query', async () => {
      const baseImpl = getImpl;
      let failing = true;
      vi.mocked(api.get).mockImplementation((async (path: string, params?: Record<string, string>) => {
        if (path === '/v1/suppliers' && failing) throw new Error('falha de rede');
        return baseImpl(path, params);
      }) as unknown as typeof api.get);

      const { dialog } = await openDispatch();
      await waitFor(() =>
        expect(within(dialog).getByText('Não foi possível carregar os fornecedores.')).toBeTruthy(),
      );
      expect(within(dialog).queryByText('Nenhum fornecedor ativo')).toBeNull();

      failing = false;
      fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar de novo' }));
      await waitFor(() => expect(within(dialog).getByText('ACME Ltda')).toBeTruthy());
      expect(within(dialog).queryByText('Não foi possível carregar os fornecedores.')).toBeNull();
    });
  });

  describe('chave "Equipe COMEX em cópia só no primeiro e-mail"', () => {
    const CHECKBOX_NAME = 'Equipe COMEX em cópia só no primeiro e-mail';

    async function confirmSend(container: HTMLElement, dialog: HTMLDialogElement) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar agora' }));
      const confirmDialog = dialogByTitle(container, 'Confirmar ação');
      await waitFor(() => expect(confirmDialog.open).toBe(true));
      fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
    }

    it('a) checkbox aparece ligada ao chegar no preview', async () => {
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      const checkbox = within(dialog).getByRole('checkbox', { name: CHECKBOX_NAME }) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('b) enviar manda comexCcFirstOnly: true e o passo "sent" indica a linha com cópia COMEX', async () => {
      vi.mocked(sendDispatch).mockResolvedValueOnce({
        ...sendFixture,
        results: [{ supplierContactId: 10, status: 'sent', dispatchEventId: 1, comexCc: true }],
      });
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      await confirmSend(container, dialog);
      await waitFor(() =>
        expect(sendDispatch).toHaveBeenCalledWith(
          1,
          [10],
          expect.objectContaining({ comexCcFirstOnly: true }),
        ),
      );
      await waitFor(() => expect(dialog.textContent).toContain('cópia COMEX'));
    });

    it('c) desmarcar e enviar manda comexCcFirstOnly: false', async () => {
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      fireEvent.click(within(dialog).getByRole('checkbox', { name: CHECKBOX_NAME }));
      expect(
        (within(dialog).getByRole('checkbox', { name: CHECKBOX_NAME }) as HTMLInputElement).checked,
      ).toBe(false);
      await confirmSend(container, dialog);
      await waitFor(() =>
        expect(sendDispatch).toHaveBeenCalledWith(
          1,
          [10],
          expect.objectContaining({ comexCcFirstOnly: false }),
        ),
      );
    });

    it('d) desmarcar, fechar e reabrir: volta ligada', async () => {
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      fireEvent.click(within(dialog).getByRole('checkbox', { name: CHECKBOX_NAME }));
      expect(
        (within(dialog).getByRole('checkbox', { name: CHECKBOX_NAME }) as HTMLInputElement).checked,
      ).toBe(false);
      fireEvent.click(within(dialog).getByLabelText('Fechar'));
      expect(dialog.open).toBe(false);

      const reopened = await openDispatchToPreview(container, getByRole);
      expect(
        (within(reopened).getByRole('checkbox', { name: CHECKBOX_NAME }) as HTMLInputElement).checked,
      ).toBe(true);
    });
  });

  describe('preview ao vivo no passo preview', () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    function previewWith(html: string): DispatchPreviewResult {
      return { ...previewFixture, preview: { subject: 'Assunto teste', html, text: 'oi' } };
    }

    function frameOf(dialog: HTMLDialogElement) {
      return dialog.querySelector('iframe[title="preview-email"]') as HTMLIFrameElement;
    }

    it('9b. sem editar nada: previewDispatch e chamado so 1x (sem refresh duplicado)', async () => {
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      await openDispatchToPreview(container, getByRole);
      await sleep(900);
      expect(previewDispatch).toHaveBeenCalledTimes(1);
    });

    it('9c. editar a mensagem atualiza o preview apos o debounce de 600 ms', async () => {
      vi.mocked(previewDispatch)
        .mockResolvedValueOnce(previewWith('<p>antigo</p>'))
        .mockResolvedValue(previewWith('<p>novo</p>'));
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      expect(frameOf(dialog).getAttribute('srcdoc')).toContain('antigo');

      fireEvent.change(within(dialog).getByLabelText('Mensagem adicional para o fornecedor'), {
        target: { value: 'Nova msg' },
      });
      expect(previewDispatch).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(previewDispatch).toHaveBeenCalledTimes(2));
      expect(previewDispatch).toHaveBeenLastCalledWith(1, [10], {
        subject: 'Assunto teste',
        message: 'Nova msg',
        expiresInDays: 7,
      });
      await waitFor(() => expect(frameOf(dialog).getAttribute('srcdoc')).toContain('novo'));
    });

    it('9d. resposta fora de ordem: a mais antiga nao sobrescreve a mais nova', async () => {
      let resolveOld: (value: DispatchPreviewResult) => void = () => undefined;
      const oldPromise = new Promise<DispatchPreviewResult>((resolve) => {
        resolveOld = resolve;
      });
      vi.mocked(previewDispatch)
        .mockResolvedValueOnce(previewFixture)
        .mockReturnValueOnce(oldPromise)
        .mockResolvedValue(previewWith('<p>NEW</p>'));
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      const textarea = within(dialog).getByLabelText('Mensagem adicional para o fornecedor');

      fireEvent.change(textarea, { target: { value: 'a' } });
      await waitFor(() => expect(previewDispatch).toHaveBeenCalledTimes(2));
      fireEvent.change(textarea, { target: { value: 'ab' } });
      await waitFor(() => expect(previewDispatch).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(frameOf(dialog).getAttribute('srcdoc')).toContain('NEW'));

      resolveOld(previewWith('<p>OLD</p>'));
      await sleep(100);
      expect(frameOf(dialog).getAttribute('srcdoc')).toContain('NEW');
      expect(frameOf(dialog).getAttribute('srcdoc')).not.toContain('OLD');
    });

    it('9e. refresh com erro: aviso nao bloqueante, iframe mantido e envio usa os campos atuais', async () => {
      vi.mocked(previewDispatch)
        .mockResolvedValueOnce(previewWith('<p>ultimo-bom</p>'))
        .mockRejectedValue(new Error('falhou'));
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);

      fireEvent.change(within(dialog).getByLabelText('Mensagem adicional para o fornecedor'), {
        target: { value: 'Nova msg' },
      });
      await waitFor(() => expect(dialog.textContent).toContain('Não foi possível atualizar o preview'));
      expect(frameOf(dialog).getAttribute('srcdoc')).toContain('ultimo-bom');
      const sendButton = within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement;
      expect(sendButton.disabled).toBe(false);

      fireEvent.click(sendButton);
      const confirmDialog = dialogByTitle(container, 'Confirmar ação');
      await waitFor(() => expect(confirmDialog.open).toBe(true));
      fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
      await waitFor(() =>
        expect(sendDispatch).toHaveBeenCalledWith(1, [10], {
          subject: 'Assunto teste',
          message: 'Nova msg',
          expiresInDays: 7,
          comexCcFirstOnly: true,
        }),
      );
    });

    it('9f. sem editar: "Enviar agora" habilitado e sem indicador de atualizacao', async () => {
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      const sendButton = within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement;
      expect(sendButton.disabled).toBe(false);
      expect(dialog.textContent).not.toContain('Atualizando preview');
    });

    it('9g. editar desabilita "Enviar agora" no debounce e na requisicao; habilita quando o preview novo chega', async () => {
      let resolveNew: (value: DispatchPreviewResult) => void = () => undefined;
      const newPromise = new Promise<DispatchPreviewResult>((resolve) => {
        resolveNew = resolve;
      });
      vi.mocked(previewDispatch)
        .mockResolvedValueOnce(previewWith('<p>antigo</p>'))
        .mockReturnValueOnce(newPromise);
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);
      const sendButton = () =>
        within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement;
      expect(sendButton().disabled).toBe(false);

      fireEvent.change(within(dialog).getByLabelText('Mensagem adicional para o fornecedor'), {
        target: { value: 'Nova msg' },
      });
      // Debounce pendente: nenhuma requisicao nova ainda, mas ja desabilitado + indicador.
      expect(previewDispatch).toHaveBeenCalledTimes(1);
      expect(sendButton().disabled).toBe(true);
      expect(dialog.textContent).toContain('Atualizando preview');

      // Requisicao da key atual em andamento.
      await waitFor(() => expect(previewDispatch).toHaveBeenCalledTimes(2));
      expect(sendButton().disabled).toBe(true);
      expect(dialog.textContent).toContain('Atualizando preview');

      resolveNew(previewWith('<p>novo</p>'));
      await waitFor(() => expect(sendButton().disabled).toBe(false));
      expect(frameOf(dialog).getAttribute('srcdoc')).toContain('novo');
      expect(dialog.textContent).not.toContain('Atualizando preview');
    });

    it('9h. refresh com erro libera "Enviar agora" e remove o indicador', async () => {
      vi.mocked(previewDispatch)
        .mockResolvedValueOnce(previewWith('<p>ultimo-bom</p>'))
        .mockRejectedValue(new Error('falhou'));
      const { container, findByRole, getByRole } = renderPage();
      await findByRole('heading', { name: 'RFQ-001' });
      const dialog = await openDispatchToPreview(container, getByRole);

      fireEvent.change(within(dialog).getByLabelText('Mensagem adicional para o fornecedor'), {
        target: { value: 'Nova msg' },
      });
      expect(
        (within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await waitFor(() => expect(dialog.textContent).toContain('Não foi possível atualizar o preview'));
      expect(
        (within(dialog).getByRole('button', { name: 'Enviar agora' }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(dialog.textContent).not.toContain('Atualizando preview');
    });
  });

  it('10. EMPILHAMENTO Dispatch + Tokens: os dois dialogs abertos ao mesmo tempo', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dispatchDialog = await openDispatchToPreview(container, getByRole);

    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Enviar agora' }));
    const confirmDialog = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmDialog.open).toBe(true));
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(sendDispatch).toHaveBeenCalledWith(1, [10], {
        subject: 'Assunto teste',
        message: '',
        expiresInDays: 7,
        comexCcFirstOnly: true,
      }),
    );

    await waitFor(() => within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));
    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));

    const tokensDialog = dialogByTitle(container, 'Links do portal');
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);
    await waitFor(() => expect(listPortalTokens).toHaveBeenCalledWith(1));
  });

  it('11. EMPILHAMENTO triplo + confirm() de dentro do modal de cima', async () => {
    vi.mocked(listPortalTokens).mockResolvedValue([tokenFixture]);

    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dispatchDialog = await openDispatchToPreview(container, getByRole);

    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Enviar agora' }));
    const confirmDialog = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmDialog.open).toBe(true));
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(sendDispatch).toHaveBeenCalled());

    await waitFor(() => within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));
    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));
    const tokensDialog = dialogByTitle(container, 'Links do portal');
    await waitFor(() => expect(listPortalTokens).toHaveBeenCalledWith(1));

    await waitFor(() => within(tokensDialog).getByRole('button', { name: 'Revogar' }));
    fireEvent.click(within(tokensDialog).getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(confirmDialog.open).toBe(true));
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(revokePortalToken).toHaveBeenCalledWith(99));
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);
  });

  it('11b. "Gerar novo link": confirma, chama regeneratePortalToken e copia o portalUrl', async () => {
    vi.mocked(listPortalTokens).mockResolvedValue([tokenFixture]);
    vi.mocked(regeneratePortalToken).mockResolvedValue({
      id: 100,
      portalUrl: 'https://portal.test/portal?token=novo&v=1',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      supplier: { id: 5, name: 'ACME Ltda' },
      contact: { id: 10, name: 'Contato', email: 'c@acme.com' },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Links do portal' }));
    const tokensDialog = dialogByTitle(container, 'Links do portal');
    await waitFor(() => within(tokensDialog).getByRole('button', { name: 'Gerar novo link' }));
    expect(within(tokensDialog).queryByRole('button', { name: 'Copiar link' })).toBeNull();

    fireEvent.click(within(tokensDialog).getByRole('button', { name: 'Gerar novo link' }));
    const confirmDialog = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmDialog.open).toBe(true));
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(regeneratePortalToken).toHaveBeenCalledWith(99));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://portal.test/portal?token=novo&v=1'),
    );
  });

  it('12. #tokensExpires controlado: reflete alteração feita em #dispatchExpires sem remontar', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dispatchDialog = await openDispatchToPreview(container, getByRole);

    fireEvent.click(getByRole('button', { name: 'Links do portal' }));
    const tokensDialog = dialogByTitle(container, 'Links do portal');
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);

    const tokensExpiresInput = within(tokensDialog).getByLabelText('Validade (dias)') as HTMLInputElement;
    expect(tokensExpiresInput.value).toBe('7');

    const dispatchExpiresInput = within(dispatchDialog).getByLabelText(
      'Validade do link (dias)',
    ) as HTMLInputElement;
    fireEvent.change(dispatchExpiresInput, { target: { value: '30' } });

    expect(tokensExpiresInput.value).toBe('30');
  });

  it('13. gestor: abre "Links do portal", vê "Gerar novo link" e não vê "Gerar para todos os fornecedores"', async () => {
    authState.role = 'gestor';
    vi.mocked(listPortalTokens).mockResolvedValue([tokenFixture]);

    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Links do portal' }));
    const tokensDialog = dialogByTitle(container, 'Links do portal');
    await waitFor(() => within(tokensDialog).getByRole('button', { name: 'Gerar novo link' }));

    expect(within(tokensDialog).queryByRole('button', { name: 'Gerar para todos os fornecedores' })).toBeNull();
    expect(within(tokensDialog).queryByLabelText('Validade (dias)')).toBeNull();
  });

  it('14. viewer: botão "Links do portal" ausente', async () => {
    authState.role = 'viewer';

    const { findByRole, queryByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });

    expect(queryByRole('button', { name: 'Links do portal' })).toBeNull();
  });
});
