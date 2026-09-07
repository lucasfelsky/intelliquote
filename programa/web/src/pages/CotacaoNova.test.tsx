import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CotacaoNova from './CotacaoNova';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
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
      isDangerousGood: false,
      family: { id: 1, name: 'Químicos' },
    },
  ],
  2: [
    {
      id: 2,
      commercialName: 'Fibra de Vidro',
      marketName: 'FDV',
      isDangerousGood: false,
      family: { id: 2, name: 'Materiais' },
    },
  ],
};

const allItemsFlat = Object.values(familyItemsById).flat() as Array<{
  id: number;
  commercialName: string;
  marketName: string;
  isDangerousGood: boolean;
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
    const button = getByRole('button', { name: '+ Adicionar item' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
}

describe('CotacaoNova', () => {
  beforeEach(() => {
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

  it('2. step 2 + clique em "+ Adicionar item": abre com título "Adicionar item do catálogo"', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Adicionar item do catálogo');
  });

  it('3. título dinâmico de edição: selecionar via família expandida e depois clicar em Editar mostra "Editar item"', async () => {
    const { container, getByRole, getByLabelText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

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

  it('4. tamanho wide: className contém modal-dialog--wide', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).toContain('modal-dialog--wide');
  });

  it('5. sem título duplicado: escopado ao dialog (a página já tem <h2>Itens do catálogo</h2>)', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.querySelectorAll('h2').length).toBe(1);
    expect(dialog.querySelector('.modal-body h2')).toBeNull();
  });

  it('6. reabrir zera: busca vazia e pastas fechadas de novo após Cancelar', async () => {
    const { container, getByRole, getByPlaceholderText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

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
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

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
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

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
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

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
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

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
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    fireEvent.click(getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
  });
});
