import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CotacaoNova from './CotacaoNova';

const routerState = vi.hoisted(() => ({ search: '', navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => routerState.navigate,
  useSearchParams: () => [new URLSearchParams(routerState.search)],
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

const families = [
  { id: 1, name: 'Químicos' },
  { id: 2, name: 'Materiais' },
];

const familyItemsById: Record<number, unknown[]> = {
  1: [
    {
      id: 1,
      commercialName: 'Soda Cáustica',
      marketName: 'NaOH',
      family: { id: 1, name: 'Químicos' },
    },
  ],
  2: [
    {
      id: 2,
      commercialName: 'Fibra de Vidro',
      marketName: 'FDV',
      family: { id: 2, name: 'Materiais' },
    },
  ],
};

const allItemsFlat = Object.values(familyItemsById).flat() as Array<{
  id: number;
  commercialName: string;
  marketName: string;
  family: { id: number; name: string };
}>;

function mockApiGet(url: string, params?: Record<string, unknown>): Promise<unknown> {
  if (url === '/v1/item-families') {
    return Promise.resolve({ data: families });
  }
  if (url === '/v1/catalog-items') {
    if (params && typeof params.search === 'string' && params.search) {
      const term = params.search.toLowerCase();
      const filtered = allItemsFlat.filter(
        (it) =>
          it.commercialName.toLowerCase().includes(term) ||
          it.marketName.toLowerCase().includes(term) ||
          it.family.name.toLowerCase().includes(term),
      );
      return Promise.resolve({
        data: filtered,
        pagination: { page: 1, pageSize: 100, totalItems: filtered.length, totalPages: 1 },
      });
    }
    if (params && params.family !== undefined) {
      const famId = Number(params.family);
      const items = familyItemsById[famId] ?? [];
      return Promise.resolve({
        data: items,
        pagination: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
      });
    }
  }
  if (url === '/v1/quote-requests/code-availability') {
    return Promise.resolve({ requestCode: params?.requestCode, available: true });
  }
  return Promise.resolve({ data: [] });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CotacaoNova />
    </QueryClientProvider>
  );
}

function getDialog(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog');
  if (!dialog) throw new Error('dialog não encontrado no container');
  return dialog;
}

async function goToStep2(getByRole: any) {
  fireEvent.click(getByRole('button', { name: 'Próximo' }));
  await waitFor(() => {
    const button = getByRole('button', { name: 'Adicionar item' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
}

describe('CotacaoNova', () => {
  beforeEach(() => {
    routerState.search = '';
    routerState.navigate.mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockImplementation(mockApiGet as any);
  });

  it('1. fechado no load (step 1): existe exatamente 1 dialog e dialog.open é false', async () => {
    const { container, findByText } = renderPage();
    await findByText('Crie uma cotação e, opcionalmente, adicione itens iniciais.');
    expect(container.querySelectorAll('dialog').length).toBe(1);
    const dialog = getDialog(container);
    expect(dialog.open).toBe(false);
  });

  it('2. step 2 + clique em "Adicionar item": abre com título "Adicionar item do catálogo"', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Adicionar item do catálogo');
  });

  it('3. título dinâmico de edição: selecionar via família expandida e depois clicar em Editar mostra "Editar item"', async () => {
    const { container, getByRole, getByLabelText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const dialog = getDialog(container);
    // Famílias carregam lazy (só quando o modal abre): esperar aparecerem.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Químicos/ })).toBeTruthy();
    });
    // Pasta fechada por padrão: item ainda não está no DOM.
    expect(within(dialog).queryByRole('button', { name: 'Soda Cáustica' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Soda Cáustica' }));
    fireEvent.change(getByLabelText('Quantidade *'), { target: { value: '10' } });
    fireEvent.click(getByRole('button', { name: 'Adicionar' }));

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const reopenedDialog = getDialog(container);
    expect(reopenedDialog.querySelector('.modal-header h2')?.textContent).toBe('Editar item');
  });

  it('3b. edição do rascunho: largura padrão e ações como filhas diretas do form', async () => {
    const { container, getByRole, getByLabelText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const dialog = getDialog(container);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Químicos/ })).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Soda Cáustica' }));
    fireEvent.change(getByLabelText('Quantidade *'), { target: { value: '10' } });
    fireEvent.click(getByRole('button', { name: 'Adicionar' }));

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const reopenedDialog = getDialog(container);
    expect(reopenedDialog.querySelector('.modal-header h2')?.textContent).toBe('Editar item');
    expect(reopenedDialog.className).not.toContain('modal-dialog--wide');
    expect(reopenedDialog.querySelector('form > .modal-actions')).not.toBeNull();
  });

  it('4. tamanho wide: className contém modal-dialog--wide', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).toContain('modal-dialog--wide');
  });

  it('5. sem título duplicado: escopado ao dialog (a página já tem <h2>Itens do catálogo</h2>)', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.querySelectorAll('h2').length).toBe(1);
    expect(dialog.querySelector('.modal-body h2')).toBeNull();
  });

  it('6. reabrir zera: busca vazia e pastas fechadas de novo após Cancelar', async () => {
    const { container, getByRole, getByPlaceholderText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const dialog = getDialog(container);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Químicos/ })).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });

    const searchInput = getByPlaceholderText('Buscar item do catálogo...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'soda' } });
    expect(searchInput.value).toBe('soda');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const reopenedSearchInput = getByPlaceholderText('Buscar item do catálogo...') as HTMLInputElement;
    expect(reopenedSearchInput.value).toBe('');

    const reopenedDialog = getDialog(container);
    await waitFor(() => {
      expect(within(reopenedDialog).getByRole('button', { name: /Químicos/ })).toBeTruthy();
    });
    // Pasta fechada de novo: o item não reaparece sem um novo clique.
    expect(within(reopenedDialog).queryByRole('button', { name: 'Soda Cáustica' })).toBeNull();
  });

  it('A. busca por família: digitar "químicos" dispara a query global com search e mostra resultados agrupados', async () => {
    const { container, getByRole, getByPlaceholderText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const dialog = getDialog(container);
    const searchInput = getByPlaceholderText('Buscar item do catálogo...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'químicos' } });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/v1/catalog-items',
        expect.objectContaining({ search: 'químicos' }),
      );
    });

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });
  });

  it('B. resultados exibem só o nome comercial: "NaOH" (marketName) não aparece no dialog', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const dialog = getDialog(container);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Químicos/ })).toBeTruthy();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });
    expect(within(dialog).queryByText(/NaOH/)).toBeNull();
  });

  it('C. modo navegar: todas as famílias aparecem como pastas fechadas; expandir dispara a query 1x (recolher/reexpandir usa cache)', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));

    const dialog = getDialog(container);
    // As duas famílias aparecem como pastas mesmo sem busca (endpoint sem paginação).
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Químicos/ })).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: /Materiais/ })).toBeTruthy();
    });
    // Itens ocultos até expandir a pasta.
    expect(within(dialog).queryByRole('button', { name: 'Soda Cáustica' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Fibra de Vidro' })).toBeNull();

    const callsBeforeExpand = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(callsBeforeExpand);
    expect(api.get).toHaveBeenCalledWith(
      '/v1/catalog-items',
      expect.objectContaining({ family: '1' }),
    );

    // Recolher: item some da tela.
    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    expect(within(dialog).queryByRole('button', { name: 'Soda Cáustica' })).toBeNull();

    // Reexpandir: reaparece sem novo fetch (staleTime do TanStack).
    const callsBeforeReexpand = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: /Químicos/ }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Soda Cáustica' })).toBeTruthy();
    });
    expect(vi.mocked(api.get).mock.calls.length).toBe(callsBeforeReexpand);
  });

  it('7. botão × fecha o modal', async () => {
    const { container, getByRole, getByLabelText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    fireEvent.click(getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
  });
});

// Cotacao criada a partir de uma solicitacao do comercial (PR2): ?fromCommercialRequest=ID
describe('CotacaoNova a partir de solicitacao do comercial', () => {
  const COMMERCIAL_REQUEST = {
    id: 9,
    status: 'pending',
    customerName: 'ACME Ltda',
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-19T12:00:00.000Z',
    statusChangedAt: null,
    requestedBy: { id: 3, name: 'Ana', email: 'ana@x.com' },
    statusChangedBy: null,
    quoteRequest: null,
    items: [
      {
        id: 91,
        catalogItemId: 10,
        commercialName: 'Resina X',
        marketName: 'RX-100',
        dbcorpCode: null,
        quantity: 5,
        unit: 'KG',
        targetPrice: '10.50',
        targetCurrency: 'EUR',
        quoteRequestItemId: null,
      },
      {
        id: 92,
        catalogItemId: 11,
        commercialName: 'Solvente Y',
        marketName: 'SY-1',
        dbcorpCode: null,
        quantity: 2,
        unit: 'TON',
        targetPrice: null,
        targetCurrency: null,
        quoteRequestItemId: null,
      },
    ],
  };

  function mockCommercialRequest(row: unknown | Error) {
    vi.mocked(api.get).mockImplementation(((url: string, params?: Record<string, unknown>) => {
      if (url === '/api/v1/commercial-requests/9') {
        return row instanceof Error ? Promise.reject(row) : Promise.resolve(row);
      }
      return mockApiGet(url, params);
    }) as any);
  }

  beforeEach(() => {
    routerState.search = 'fromCommercialRequest=9';
    routerState.navigate.mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('pre-preenche itens, moeda e descricao e mostra o banner de vinculo', async () => {
    mockCommercialRequest(COMMERCIAL_REQUEST);
    const { findByText, getByRole, getByLabelText, getByText } = renderPage();

    expect(await findByText('Vinculada à solicitação #9 do comercial')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests/9');
    // moeda comum dos itens com alvo (EUR)
    expect((getByLabelText('Moeda *') as HTMLInputElement).value).toBe('EUR');
    // R3: o nome do cliente (ACME Ltda) NUNCA vai para a descricao: chegaria ao fornecedor.
    const descriptionValue = (getByLabelText('Descrição') as HTMLTextAreaElement).value;
    expect(descriptionValue).toBe('Solicitação do comercial #9');
    expect(descriptionValue).not.toContain('ACME');

    await goToStep2(getByRole);
    expect(getByText('Resina X')).toBeTruthy();
    expect(getByText('Solvente Y')).toBeTruthy();
    expect(getByRole('columnheader', { name: 'Preço-alvo' })).toBeTruthy();
    expect(getByText('10,50 EUR')).toBeTruthy();
  });

  it('POST /v1/quote-requests leva commercialRequestIds e items e nao faz POST em /items', async () => {
    mockCommercialRequest(COMMERCIAL_REQUEST);
    vi.mocked(api.post).mockResolvedValue({ id: 50, requestCode: 'QR-50' });
    const { findByText, getByRole } = renderPage();
    await findByText('Vinculada à solicitação #9 do comercial');
    await goToStep2(getByRole);

    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, any>];
    expect(path).toBe('/v1/quote-requests');
    expect(body.commercialRequestIds).toEqual([9]);
    expect(body.currency).toBe('EUR');
    expect(body.items).toEqual([
      { catalogItemId: 10, quantity: 5, unit: 'KG', targetPrice: 10.5, notes: null },
      { catalogItemId: 11, quantity: 2, unit: 'TON', targetPrice: null, notes: null },
    ]);
    await waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith('/cotacoes/50'));
    expect(
      vi.mocked(api.post).mock.calls.some(([url]) => String(url).includes('/items')),
    ).toBe(false);
  });

  it('A3: editar a linha (mesmo item) mantem o preco-alvo', async () => {
    mockCommercialRequest(COMMERCIAL_REQUEST);
    vi.mocked(api.post).mockResolvedValue({ id: 50 });
    const { findByText, getByRole, getAllByRole, getByLabelText, getByText } = renderPage();
    await findByText('Vinculada à solicitação #9 do comercial');
    await goToStep2(getByRole);

    fireEvent.click(getAllByRole('button', { name: 'Editar' })[0] as HTMLElement);
    fireEvent.change(getByLabelText('Quantidade *'), { target: { value: '8' } });
    fireEvent.click(getByRole('button', { name: 'Salvar alterações' }));

    expect(getByText('10,50 EUR')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, any>];
    expect(body.items[0]).toMatchObject({ catalogItemId: 10, quantity: 8, targetPrice: 10.5 });
  });

  it('alvo so vai junto quando a moeda do alvo e a da cotacao', async () => {
    mockCommercialRequest(COMMERCIAL_REQUEST);
    vi.mocked(api.post).mockResolvedValue({ id: 50 });
    const { findByText, getByRole, getByLabelText } = renderPage();
    await findByText('Vinculada à solicitação #9 do comercial');

    fireEvent.change(getByLabelText('Moeda *'), { target: { value: 'USD' } });
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, any>];
    expect(body.items[0].targetPrice).toBeNull();
  });

  it('solicitacao que nao esta mais pendente: alerta e cotacao comum, sem commercialRequestIds', async () => {
    mockCommercialRequest({ ...COMMERCIAL_REQUEST, status: 'quoting' });
    vi.mocked(api.post).mockResolvedValue({ id: 51 });
    const { findByRole, getByRole, queryByText } = renderPage();

    const alert = await findByRole('alert');
    expect(alert.textContent).toBe('Solicitação #9 não pode mais ser vinculada (status Em cotação).');
    expect(queryByText(/Vinculada à solicitação/)).toBeNull();

    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, any>];
    expect(body).not.toHaveProperty('commercialRequestIds');
    expect(body).not.toHaveProperty('items');
  });

  it('solicitacao inexistente (404): alerta e segue como Nova cotacao comum', async () => {
    mockCommercialRequest(new Error('HTTP 404'));
    const { findByRole } = renderPage();

    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Solicitação #9 não pode mais ser vinculada');
  });

  it('sem a query, nada e consultado e os testes de sempre seguem valendo', async () => {
    routerState.search = '';
    vi.mocked(api.get).mockImplementation(mockApiGet as any);
    const { findByText } = renderPage();
    await findByText('Crie uma cotação e, opcionalmente, adicione itens iniciais.');
    expect(
      vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('commercial-requests')),
    ).toBe(false);
  });

  it('com vinculo e sem itens: nao envia e pede ao menos um item', async () => {
    mockCommercialRequest({ ...COMMERCIAL_REQUEST, items: [] });
    const { findByText, getByRole } = renderPage();
    await findByText('Vinculada à solicitação #9 do comercial');
    await goToStep2(getByRole);

    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));
    expect(await findByText('Inclua ao menos um item para vincular a solicitação.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

// Checagem do codigo no passo 1 + volta ao passo 1 quando o servidor rejeita o codigo.
describe('CotacaoNova: codigo informado ja em uso', () => {
  const AVAILABILITY_URL = '/v1/quote-requests/code-availability';
  const availabilityCalls = () =>
    vi.mocked(api.get).mock.calls.filter(([url]) => url === AVAILABILITY_URL);

  beforeEach(() => {
    routerState.search = '';
    routerState.navigate.mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockImplementation(mockApiGet as any);
  });

  it('codigo vazio: "Próximo" nao consulta a disponibilidade e segue ao passo 2', async () => {
    const { getByRole } = renderPage();
    await goToStep2(getByRole);
    expect(availabilityCalls()).toHaveLength(0);
  });

  it('codigo digitado e ocupado: fica no passo 1 com a mensagem especifica', async () => {
    vi.mocked(api.get).mockImplementation(((url: string, params?: Record<string, unknown>) =>
      url === AVAILABILITY_URL
        ? Promise.resolve({ requestCode: params?.requestCode, available: false })
        : mockApiGet(url, params)) as any);
    const { getByRole, getByLabelText, findByText, queryByRole } = renderPage();

    fireEvent.change(getByLabelText('Código'), { target: { value: ' abc-1 ' } });
    fireEvent.click(getByRole('button', { name: 'Próximo' }));

    expect(await findByText('O código ABC-1 já está em uso por outra cotação.')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith(AVAILABILITY_URL, { requestCode: 'abc-1' });
    expect(queryByRole('button', { name: 'Adicionar item' })).toBeNull();
  });

  it('codigo digitado e livre: vai ao passo 2', async () => {
    const { getByRole, getByLabelText } = renderPage();

    fireEvent.change(getByLabelText('Código'), { target: { value: 'ABC-2' } });
    await goToStep2(getByRole);

    expect(availabilityCalls()).toHaveLength(1);
  });

  it('checagem com erro: nao bloqueia e vai ao passo 2 (o servidor decide no "Criar cotação")', async () => {
    vi.mocked(api.get).mockImplementation(((url: string, params?: Record<string, unknown>) =>
      url === AVAILABILITY_URL ? Promise.reject(new Error('HTTP 500')) : mockApiGet(url, params)) as any);
    const { getByRole, getByLabelText } = renderPage();

    fireEvent.change(getByLabelText('Código'), { target: { value: 'ABC-3' } });
    await goToStep2(getByRole);

    expect(availabilityCalls()).toHaveLength(1);
  });

  // api.get de disponibilidade fica pendente ate o teste resolver manualmente.
  function mockPendingAvailability() {
    let resolveAvailability: (value: { requestCode: string; available: boolean }) => void = () => {};
    const pending = new Promise<{ requestCode: string; available: boolean }>((resolve) => {
      resolveAvailability = resolve;
    });
    vi.mocked(api.get).mockImplementation(((url: string, params?: Record<string, unknown>) =>
      url === AVAILABILITY_URL ? pending : mockApiGet(url, params)) as any);
    return resolveAvailability;
  }

  it('durante a checagem: "Próximo" fica desabilitado, reenvio nao duplica a consulta e available:false reabilita no passo 1', async () => {
    const resolveAvailability = mockPendingAvailability();
    const { getByRole, getByLabelText, findByText, queryByRole } = renderPage();

    fireEvent.change(getByLabelText('Código'), { target: { value: 'ABC-5' } });
    const nextButton = getByRole('button', { name: 'Próximo' }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(false);
    fireEvent.click(nextButton);

    await waitFor(() => expect(nextButton.disabled).toBe(true));
    expect(availabilityCalls()).toHaveLength(1);

    // Clique em botao desabilitado e ignorado; o submit direto do form exercita o guard de handleNextStep.
    fireEvent.click(nextButton);
    const form = nextButton.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(availabilityCalls()).toHaveLength(1);
    expect(nextButton.disabled).toBe(true);

    resolveAvailability({ requestCode: 'ABC-5', available: false });

    expect(await findByText('O código ABC-5 já está em uso por outra cotação.')).toBeTruthy();
    await waitFor(() => expect(nextButton.disabled).toBe(false));
    expect(queryByRole('button', { name: 'Adicionar item' })).toBeNull();
    expect(getByRole('button', { name: 'Próximo' })).toBeTruthy();
    expect(availabilityCalls()).toHaveLength(1);
  });

  it('durante a checagem: reenvio nao duplica a consulta e available:true segue ao passo 2', async () => {
    const resolveAvailability = mockPendingAvailability();
    const { getByRole, getByLabelText } = renderPage();

    fireEvent.change(getByLabelText('Código'), { target: { value: 'ABC-6' } });
    const nextButton = getByRole('button', { name: 'Próximo' }) as HTMLButtonElement;
    fireEvent.click(nextButton);

    await waitFor(() => expect(nextButton.disabled).toBe(true));
    fireEvent.submit(nextButton.closest('form') as HTMLFormElement);
    expect(availabilityCalls()).toHaveLength(1);

    resolveAvailability({ requestCode: 'ABC-6', available: true });

    await waitFor(() => {
      const addButton = getByRole('button', { name: 'Adicionar item' }) as HTMLButtonElement;
      expect(addButton.disabled).toBe(false);
    });
    expect(availabilityCalls()).toHaveLength(1);
  });

  it('POST rejeitado com path requestCode: volta ao passo 1 com a mensagem do servidor', async () => {
    const message = 'O código ABC-4 já está em uso por outra cotação.';
    vi.mocked(api.post).mockRejectedValue(
      Object.assign(new Error('HTTP 409'), { body: { message, path: 'requestCode' } }),
    );
    const { getByRole, getByLabelText, findByText, queryByRole } = renderPage();

    fireEvent.change(getByLabelText('Código'), { target: { value: 'ABC-4' } });
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));

    expect(await findByText(message)).toBeTruthy();
    expect(queryByRole('button', { name: 'Criar cotação' })).toBeNull();
    expect(getByRole('button', { name: 'Próximo' })).toBeTruthy();
    expect((getByLabelText('Código') as HTMLInputElement).value).toBe('ABC-4');
  });

  it('POST rejeitado por outro motivo: continua no passo 2 com o erro de envio', async () => {
    vi.mocked(api.post).mockRejectedValue(
      Object.assign(new Error('HTTP 500'), { body: { message: 'Falha qualquer.' } }),
    );
    const { getByRole, findByText } = renderPage();

    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));

    expect(await findByText('Falha qualquer.')).toBeTruthy();
    expect(getByRole('button', { name: 'Criar cotação' })).toBeTruthy();
  });
});
