import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
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
      <ConfirmProvider>
        <Empresa />
      </ConfirmProvider>
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

describe('Empresa - avisos de nova solicitacao (Comercial)', () => {
  function mockProfile(extra: Record<string, unknown> = {}) {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((async (path: string) => {
      if (path.includes('company-profile')) {
        return { id: 1, companyName: 'SQ Quimica', dispatchCc: [], ...extra };
      }
      return [];
    }) as typeof api.get);
    vi.mocked(api.put).mockReset();
    vi.mocked(api.put).mockImplementation((async (_path: string, body: Record<string, unknown>) => ({
      id: 1,
      ...body,
      dispatchCc: [],
    })) as typeof api.put);
  }

  it('renderiza a secao com titulo e texto de ajuda', async () => {
    mockRole = 'comprador';
    mockProfile();
    const { findByText, getByText } = renderPage();
    expect(await findByText('Avisos de nova solicitação (Comercial)')).toBeTruthy();
    expect(
      getByText(
        /Quem recebe o e-mail quando o Comercial cria uma solicitação\. Se ficar vazio, vai para a Equipe COMEX em cópia\./,
      ),
    ).toBeTruthy();
  });

  it('lista os e-mails ja salvos e remove um deles ao salvar', async () => {
    mockRole = 'comprador';
    mockProfile({ commercialRequestNotifyEmails: ['gestor@sqquimica.com', 'compras@sqquimica.com'] });
    const { findByText, getByRole, queryByText } = renderPage();
    expect(await findByText('gestor@sqquimica.com')).toBeTruthy();
    expect(queryByText('compras@sqquimica.com')).toBeTruthy();

    fireEvent.click(
      getByRole('button', { name: 'Remover gestor@sqquimica.com dos avisos de nova solicitação' }),
    );
    expect(queryByText('gestor@sqquimica.com')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const body = (vi.mocked(api.put).mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(body.commercialRequestNotifyEmails).toEqual(['compras@sqquimica.com']);
  });

  it('adiciona e-mail (normalizado, sem duplicar) e salva o campo no PUT', async () => {
    mockRole = 'comprador';
    mockProfile();
    const { findByPlaceholderText, getByRole, findByText } = renderPage();
    const input = (await findByPlaceholderText('ex.: gestor@sqquimica.com')) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Gestor@SQQuimica.com' } });
    fireEvent.click(getByRole('button', { name: 'Adicionar aviso' }));
    expect(await findByText('gestor@sqquimica.com')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'gestor@sqquimica.com' } });
    fireEvent.click(getByRole('button', { name: 'Adicionar aviso' }));

    fireEvent.click(getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const body = (vi.mocked(api.put).mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(body.commercialRequestNotifyEmails).toEqual(['gestor@sqquimica.com']);
  });

  it('e-mail invalido mostra erro e nao entra na lista', async () => {
    mockRole = 'comprador';
    mockProfile();
    const { findByPlaceholderText, getByRole, findByText } = renderPage();
    const input = (await findByPlaceholderText('ex.: gestor@sqquimica.com')) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'sem-arroba' } });
    fireEvent.click(getByRole('button', { name: 'Adicionar aviso' }));
    expect(await findByText('Formato de e-mail invalido.')).toBeTruthy();
  });

  it('sem lista: salva commercialRequestNotifyEmails vazio', async () => {
    mockRole = 'comprador';
    mockProfile();
    const { findByRole } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const body = (vi.mocked(api.put).mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(body.commercialRequestNotifyEmails).toEqual([]);
  });
});
