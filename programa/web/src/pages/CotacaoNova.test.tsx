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

const catalogItems = [
  {
    id: 1,
    commercialName: 'Soda Cáustica',
    marketName: 'NaOH',
    ncm: null,
    dbcorpCode: null,
    isDangerousGood: false,
    notes: null,
    isActive: true,
    family: { id: 1, name: 'Químicos' },
  },
];

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
    vi.mocked(api.get).mockResolvedValue(catalogItems);
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

  it('3. título dinâmico de edição: "Editar item" ao clicar em Editar na linha do item', async () => {
    const { container, getByRole, getByLabelText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

    fireEvent.click(getByRole('button', { name: /Químicos/ }));
    fireEvent.click(getByRole('button', { name: 'Soda Cáustica — NaOH' }));
    fireEvent.change(getByLabelText('Quantidade *'), { target: { value: '10' } });
    fireEvent.click(getByRole('button', { name: 'Adicionar' }));

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const dialog = getDialog(container);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Editar item');
  });

  it('4. tamanho default: className contém modal-dialog e não modal-dialog--wide', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).not.toContain('modal-dialog--wide');
  });

  it('5. sem título duplicado: escopado ao dialog (a página já tem <h2>Itens do catálogo</h2>)', async () => {
    const { container, getByRole } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = getDialog(container);
    expect(dialog.querySelectorAll('h2').length).toBe(1);
    expect(dialog.querySelector('.modal-body h2')).toBeNull();
  });

  it('6. guard de desmontagem: busca do picker zera ao reabrir após Cancelar', async () => {
    const { container, getByRole, getByPlaceholderText } = renderPage();
    await goToStep2(getByRole);
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

    const searchInput = getByPlaceholderText('Buscar item do catálogo...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'soda' } });
    expect(searchInput.value).toBe('soda');

    const dialog = getDialog(container);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));

    const reopenedSearchInput = getByPlaceholderText('Buscar item do catálogo...') as HTMLInputElement;
    expect(reopenedSearchInput.value).toBe('');
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
