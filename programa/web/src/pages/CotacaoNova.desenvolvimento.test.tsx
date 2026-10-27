import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
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

// Solicitacao de desenvolvimento: 1 item de catalogo + 1 item novo SEM catalogo. Dados sinteticos.
const DEV_REQUEST = {
  id: 9,
  status: 'pending',
  customerName: null,
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-19T12:00:00.000Z',
  statusChangedAt: null,
  isDevelopment: true,
  requestedBy: { id: 3, name: 'Ana', email: 'ana@x.com' },
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
      notes: 'observacao interna',
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

function mockRequest(row: unknown) {
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === '/api/v1/commercial-requests/9') return Promise.resolve(row);
    if (url === '/v1/item-families') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CotacaoNova />
    </QueryClientProvider>,
  );
}

describe('CotacaoNova a partir de solicitacao de desenvolvimento', () => {
  beforeEach(() => {
    routerState.search = 'fromCommercialRequest=9';
    routerState.navigate.mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('item novo sem catalogo: mostra o aviso e nao pre-preenche itens nem commercialRequestIds', async () => {
    mockRequest(DEV_REQUEST);
    const { findByRole, queryByText, getByRole, queryByRole } = renderPage();

    const alert = await findByRole('alert');
    expect(alert.textContent).toBe(
      'Solicitação #9 tem item novo sem cadastro no catálogo: vincule-o em Solicitações antes de criar a cotação.',
    );
    expect(queryByText(/Vinculada à solicitação/)).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Próximo' }));
    await waitFor(() => {
      const add = getByRole('button', { name: '+ Adicionar item' }) as HTMLButtonElement;
      expect(add.disabled).toBe(false);
    });
    // Nada pre-preenchido: nem o item de catalogo da solicitacao.
    expect(queryByText('Resina X')).toBeNull();
    expect(queryByText('Aditivo Novo')).toBeNull();
    expect(queryByRole('columnheader', { name: 'Preço-alvo' })).toBeNull();

    // Cotacao comum: o POST nao leva commercialRequestIds nem items.
    vi.mocked(api.post).mockResolvedValue({ id: 51 });
    fireEvent.click(getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('commercialRequestIds');
    expect(body).not.toHaveProperty('items');
  });

  it('item novo JA vinculado ao catalogo: pre-preenche normalmente (marketName do catalogo)', async () => {
    const linked = {
      ...DEV_REQUEST,
      items: [
        DEV_REQUEST.items[0],
        { ...DEV_REQUEST.items[1], catalogItemId: 12, commercialName: 'Aditivo Catalogado', marketName: 'ADT-1' },
      ],
    };
    mockRequest(linked);
    const { findByText, getByRole, getByText } = renderPage();

    expect(await findByText('Vinculada à solicitação #9 do comercial')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Próximo' }));
    await waitFor(() => {
      const add = getByRole('button', { name: '+ Adicionar item' }) as HTMLButtonElement;
      expect(add.disabled).toBe(false);
    });
    expect(getByText('Resina X')).toBeTruthy();
    expect(getByText('Aditivo Catalogado')).toBeTruthy();
  });
});
