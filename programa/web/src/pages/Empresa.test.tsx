import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Empresa from './Empresa';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Empresa />
    </QueryClientProvider>,
  );
}

describe('Empresa - permissao de edicao', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((async (path: string) => {
      if (path.includes('company-profile')) {
        return { id: 1, companyName: 'SQ Quimica', dispatchCc: [] };
      }
      return [];
    }) as typeof api.get);
  });

  it('viewer: botao Salvar perfil desabilitado e aviso de somente leitura', async () => {
    mockRole = 'viewer';
    const { findByRole, getByText } = renderPage();
    const btn = (await findByRole('button', { name: 'Salvar perfil' })) as HTMLButtonElement;
    expect(btn.matches(':disabled')).toBe(true);
    expect(getByText(/Somente leitura/)).toBeTruthy();
  });

  it('comprador: botao Salvar perfil habilitado e sem aviso', async () => {
    mockRole = 'comprador';
    const { findByRole, queryByText } = renderPage();
    const btn = (await findByRole('button', { name: 'Salvar perfil' })) as HTMLButtonElement;
    await waitFor(() => expect(btn.matches(':disabled')).toBe(false));
    expect(queryByText(/Somente leitura/)).toBeNull();
  });
});
