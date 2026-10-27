import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comercial' } }),
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

const CATALOG = [{ id: 10, commercialName: 'Ácido Cítrico', familyName: 'Ácidos' }];

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (path: string, params?: { search?: string }) => {
    if (path === '/api/v1/commercial-requests/mine') return page([]);
    if (path === '/api/v1/commercial-requests/catalog-items') {
      // Busca server-side simulada: contem, ignorando caixa (o servidor nao normaliza acento).
      const term = (params?.search ?? '').toLowerCase();
      return CATALOG.filter((item) => item.commercialName.toLowerCase().includes(term));
    }
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

async function openModalAndSearch(term: string) {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Solicitar uma cotação' }));
  fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: term } });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

describe('ComercialView - item novo (desenvolvimento)', () => {
  it('termo sem resultado mostra "+ Incluir "X" como item novo"', async () => {
    await openModalAndSearch('Aditivo Novo');

    expect(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' })).toBeTruthy();
    expect(screen.getByText('Nenhum item cadastrado com esse nome.')).toBeTruthy();
  });

  it('termo com match exato (acento e caixa diferentes) nao mostra o botao e mostra a dica', async () => {
    // O servidor devolve o item (busca por "contem"); o termo difere em acento e caixa.
    vi.mocked(api.get).mockImplementation((async (path: string) => {
      if (path === '/api/v1/commercial-requests/mine') return page([]);
      if (path === '/api/v1/commercial-requests/catalog-items') return CATALOG;
      return [];
    }) as typeof api.get);
    await openModalAndSearch('ACIDO  citrico');

    expect(await screen.findByText('Esse item já está cadastrado: selecione-o acima.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /como item novo/ })).toBeNull();
  });

  it('incluir cria a linha com o selo "Item novo" e o banner de desenvolvimento', async () => {
    await openModalAndSearch('Aditivo Novo');
    fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));

    expect(screen.getByText('Item novo', { selector: 'span.badge' })).toBeTruthy();
    const banner = screen.getByRole('status');
    expect(banner.textContent).toBe(
      'Item novo: esta solicitação será de desenvolvimento. O COMEX cadastra o item antes de cotar.',
    );
    expect(screen.getByLabelText('Observação do item')).toBeTruthy();
    expect(screen.getByLabelText('Quantidade *')).toBeTruthy();
  });

  it('o POST leva { proposedName, quantity, unit, notes } e nao leva catalogItemId', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 6, isDevelopment: true, items: [] });
    await openModalAndSearch('  Aditivo   Novo ');
    fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));
    fireEvent.change(screen.getByLabelText('Observação do item'), { target: { value: ' aplicação em tintas ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/commercial-requests');
    expect(body.customerName).toBeNull();
    expect(body.items).toEqual([
      { proposedName: 'Aditivo Novo', notes: 'aplicação em tintas', quantity: 1, unit: 'KG' },
    ]);
    expect((body.items as Array<Record<string, unknown>>)[0]).not.toHaveProperty('catalogItemId');
  });

  it('sem observacao o POST omite notes', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 6, isDevelopment: true, items: [] });
    await openModalAndSearch('Aditivo Novo');
    fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body.items).toEqual([{ proposedName: 'Aditivo Novo', quantity: 1, unit: 'KG' }]);
  });

  it('incluir o mesmo nome 2x nao duplica a linha', async () => {
    await openModalAndSearch('Aditivo Novo');
    fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar outro item' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'ADITIVO  novo' } });

    await screen.findByText('Nenhum item cadastrado com esse nome.');
    expect(screen.queryByRole('button', { name: /como item novo/ })).toBeNull();
    expect(screen.getAllByLabelText('Quantidade *')).toHaveLength(1);
  });

  it('remover a ultima linha nova esconde o banner de desenvolvimento', async () => {
    await openModalAndSearch('Aditivo Novo');
    fireEvent.click(await screen.findByRole('button', { name: '+ Incluir "Aditivo Novo" como item novo' }));
    expect(screen.getByRole('status')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remover item' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Observação do item')).toBeNull();
  });

  it('item de catalogo continua sem banner de desenvolvimento', async () => {
    await openModalAndSearch('ácido');
    fireEvent.click(await screen.findByRole('button', { name: '+ Ácido Cítrico · Ácidos' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Observação do item')).toBeNull();
  });
});
