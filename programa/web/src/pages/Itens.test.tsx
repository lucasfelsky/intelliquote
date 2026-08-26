import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Itens from './Itens';

vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function catalogItem(id: number, commercialName: string) {
  return {
    id,
    commercialName,
    marketName: `Mercado ${commercialName}`,
    ncm: null,
    dbcorpCode: null,
    isDangerousGood: false,
    notes: null,
    isActive: true,
    familyId: null,
    family: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const page1Items = [catalogItem(1, 'Item A'), catalogItem(2, 'Item B')];
const page2Items = [catalogItem(3, 'Item C')];

const page1Response = {
  data: page1Items,
  pagination: { page: 1, pageSize: 50, totalItems: 75, totalPages: 2 },
};
const page2Response = {
  data: page2Items,
  pagination: { page: 2, pageSize: 50, totalItems: 75, totalPages: 2 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Itens />
    </QueryClientProvider>
  );
}

describe('Itens (catálogo) — paginação', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(api.get).mockImplementation((url: string, query?: Record<string, unknown>) => {
      if (url.includes('item-families')) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes('catalog-items')) {
        const page = Number(query?.page ?? 1);
        return Promise.resolve(page === 2 ? page2Response : page1Response);
      }
      return Promise.resolve({ data: [] });
    });
  });

  it('1. render da 1ª página: mostra itens, "Página 1 de 2" e "75 itens no total"', async () => {
    const { findByText } = renderPage();
    await findByText('Item A');
    await findByText('Item B');
    await findByText((content) => content.includes('Página 1 de 2'));
    await findByText((content) => content.includes('75 itens no total'));
  });

  it('2. botão "Anterior" desabilitado na 1ª página; "Próxima" habilitado', async () => {
    const { findByText, getByRole } = renderPage();
    await findByText('Item A');
    expect((getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('3. clicar "Próxima" refaz a query com page:2 e mostra a 2ª página', async () => {
    const { findByText, getByRole } = renderPage();
    await findByText('Item A');

    fireEvent.click(getByRole('button', { name: 'Próxima página' }));

    await findByText('Item C');
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => String(u).includes('catalog-items'));
      const lastCall = calls[calls.length - 1];
      expect(lastCall?.[1]).toMatchObject({ page: 2 });
    });
    await findByText((content) => content.includes('Página 2 de 2'));
  });

  it('4. na última página, "Próxima" fica desabilitado e "Anterior" habilitado; clicar "Anterior" volta pra 1ª página', async () => {
    const { findByText, getByRole } = renderPage();
    await findByText('Item A');
    fireEvent.click(getByRole('button', { name: 'Próxima página' }));
    await findByText('Item C');

    expect((getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(getByRole('button', { name: 'Página anterior' }));
    await findByText('Item A');
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => String(u).includes('catalog-items'));
      const lastCall = calls[calls.length - 1];
      expect(lastCall?.[1]).toMatchObject({ page: 1 });
    });
  });

  it('5. mudar a busca reseta a página para 1', async () => {
    const { findByText, getByRole, getByLabelText } = renderPage();
    await findByText('Item A');
    fireEvent.click(getByRole('button', { name: 'Próxima página' }));
    await findByText('Item C');

    fireEvent.change(getByLabelText('Buscar item'), { target: { value: 'Item' } });

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.filter(([u]) => String(u).includes('catalog-items'));
      const lastCall = calls[calls.length - 1];
      expect(lastCall?.[1]).toMatchObject({ page: 1, search: 'Item' });
    });
  });
});
