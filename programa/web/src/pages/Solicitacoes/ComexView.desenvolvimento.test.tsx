import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
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

// Dados 100% sinteticos.
const DEV_ROW = {
  id: 9,
  status: 'pending',
  customerName: null,
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  statusChangedAt: null,
  isDevelopment: true,
  requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
  statusChangedBy: null,
  quoteRequest: null,
  items: [
    {
      id: 91,
      catalogItemId: 10,
      commercialName: 'Resina X',
      isNewItem: false,
      notes: null,
      proposedName: null,
      marketName: 'RX-100',
      dbcorpCode: null,
      quantity: 5,
      unit: 'KG',
      targetPrice: null,
      targetCurrency: null,
      quoteRequestItemId: null,
    },
    {
      id: 92,
      catalogItemId: null,
      commercialName: 'Aditivo Novo',
      isNewItem: true,
      notes: 'aplicação em tintas',
      proposedName: 'Aditivo Novo',
      marketName: null,
      dbcorpCode: null,
      quantity: 2,
      unit: 'KG',
      targetPrice: null,
      targetCurrency: null,
      quoteRequestItemId: null,
    },
  ],
};

const PICKER_ITEM = { id: 20, commercialName: 'Aditivo Catalogado', marketName: 'ADT-1', family: null };

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi(row: unknown = DEV_ROW) {
  vi.mocked(api.get).mockImplementation((async (path: string) => {
    if (path === '/api/v1/commercial-requests') return page([row]);
    if (path === '/api/v1/commercial-requests/requesters') return [{ id: 3, name: 'Ana Comercial' }];
    if (path === '/v1/item-families') return { data: [] };
    if (path === '/v1/catalog-items') return page([PICKER_ITEM]);
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/solicitacoes']}>
        <Routes>
          <Route path="*" element={<Solicitacoes />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function expandItems() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ver itens' }));
}

beforeEach(() => {
  mockRole = 'comprador';
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

describe('ComexView - solicitacao de desenvolvimento', () => {
  it('mostra os selos "Desenvolvimento" e "Item novo" e o cliente nao informado', async () => {
    renderPage();
    await screen.findByText('Ana Comercial', { selector: 'td' });

    expect(screen.getByText('Desenvolvimento', { selector: 'span.badge' })).toBeTruthy();
    expect(screen.getByText('Cliente não informado')).toBeTruthy();

    await expandItems();
    expect(screen.getByText('Item novo', { selector: 'span.badge' })).toBeTruthy();
    expect(screen.getByText('aplicação em tintas')).toBeTruthy();
  });

  it('marketName nulo renderiza "—" na linha do item novo', async () => {
    renderPage();
    await expandItems();

    const row = screen.getAllByText('Aditivo Novo', { selector: 'td' })[0]?.closest('tr') as HTMLElement;
    const marketCell = within(row).getByText('—', { selector: 'td[data-label="Nome de mercado"]' });
    expect(marketCell).toBeTruthy();
  });

  it('"Criar cotação" e "Vincular a cotação" ficam desabilitados com item sem vinculo', async () => {
    renderPage();
    await screen.findByText('Ana Comercial', { selector: 'td' });

    const criar = screen.getByRole('button', { name: 'Criar cotação' }) as HTMLButtonElement;
    const vincular = screen.getByRole('button', { name: 'Vincular a cotação' }) as HTMLButtonElement;
    expect(criar.disabled).toBe(true);
    expect(vincular.disabled).toBe(true);
    expect(criar.title).toBe('Vincule os itens novos ao catálogo antes de cotar');
    expect(screen.getAllByText('Vincule os itens novos ao catálogo antes de cotar').length).toBeGreaterThan(0);
  });

  it('com todos os itens vinculados as acoes de cotacao voltam a ficar habilitadas', async () => {
    mockApi({
      ...DEV_ROW,
      items: [DEV_ROW.items[0], { ...DEV_ROW.items[1], catalogItemId: 20, marketName: 'ADT-1' }],
    });
    renderPage();
    await screen.findByText('Ana Comercial', { selector: 'td' });

    expect((screen.getByRole('button', { name: 'Criar cotação' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Vincular a cotação' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Vincular ao catálogo" escolhe um item existente e faz POST .../items/:itemId/catalog', async () => {
    vi.mocked(api.post).mockResolvedValue(DEV_ROW);
    renderPage();
    await expandItems();

    fireEvent.click(screen.getByRole('button', { name: 'Vincular ao catálogo' }));
    // A busca ja abre com o nome digitado pelo comercial.
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/v1/catalog-items', { search: 'Aditivo Novo', pageSize: '100' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Aditivo Catalogado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/commercial-requests/9/items/92/catalog', {
      catalogItemId: 20,
    });
  });

  it('"Cadastrar e vincular" faz POST /v1/catalog-items e depois o vinculo', async () => {
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path === '/v1/catalog-items') {
        return { id: 77, commercialName: 'Aditivo Novo', marketName: 'ADT-NOVO', family: null };
      }
      return DEV_ROW;
    }) as typeof api.post);
    renderPage();
    await expandItems();

    fireEvent.click(screen.getByRole('button', { name: 'Vincular ao catálogo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar e vincular' }));
    expect((screen.getByLabelText('Nome comercial *') as HTMLInputElement).value).toBe('Aditivo Novo');
    expect((screen.getByRole('button', { name: 'Cadastrar e vincular', hidden: false, pressed: true }) as HTMLButtonElement)).toBeTruthy();

    const submit = screen
      .getAllByRole('button', { name: 'Cadastrar e vincular' })
      .find((button) => (button as HTMLButtonElement).type === 'submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Nome de mercado *'), { target: { value: 'ADT-NOVO' } });
    fireEvent.change(screen.getByLabelText('NCM (opcional)'), { target: { value: '12345678' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      '/v1/catalog-items',
      { commercialName: 'Aditivo Novo', marketName: 'ADT-NOVO', ncm: '12345678' },
    ]);
    expect(vi.mocked(api.post).mock.calls[1]).toEqual([
      '/api/v1/commercial-requests/9/items/92/catalog',
      { catalogItemId: 77 },
    ]);
  });

  it('falha no vinculo depois do cadastro mostra o erro e deixa o item criado selecionado', async () => {
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path === '/v1/catalog-items') {
        return { id: 77, commercialName: 'Aditivo Novo', marketName: 'ADT-NOVO', family: null };
      }
      throw new Error('Este item do catalogo ja esta nesta solicitacao.');
    }) as typeof api.post);
    renderPage();
    await expandItems();

    fireEvent.click(screen.getByRole('button', { name: 'Vincular ao catálogo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar e vincular' }));
    fireEvent.change(screen.getByLabelText('Nome de mercado *'), { target: { value: 'ADT-NOVO' } });
    const submit = screen
      .getAllByRole('button', { name: 'Cadastrar e vincular' })
      .find((button) => (button as HTMLButtonElement).type === 'submit') as HTMLButtonElement;
    fireEvent.click(submit);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('O item foi cadastrado no catálogo, mas o vínculo falhou');
    // Voltou para "Selecionar existente" com o item recem-criado selecionado.
    expect(await screen.findByText('Aditivo Novo', { selector: 'strong' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Vincular' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('item ja vinculado mostra "Trocar vínculo"', async () => {
    mockApi({
      ...DEV_ROW,
      items: [{ ...DEV_ROW.items[1], catalogItemId: 20, marketName: 'ADT-1' }],
    });
    renderPage();
    await expandItems();

    expect(screen.getByRole('button', { name: 'Trocar vínculo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vincular ao catálogo' })).toBeNull();
  });

  it('viewer nao ve o botao de vincular nem as acoes', async () => {
    mockRole = 'viewer';
    renderPage();
    await expandItems();

    expect(screen.queryByRole('button', { name: 'Vincular ao catálogo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar cotação' })).toBeNull();
    // Continua vendo o item novo e a observacao.
    expect(screen.getByText('Item novo', { selector: 'span.badge' })).toBeTruthy();
  });
});
