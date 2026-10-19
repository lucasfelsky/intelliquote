import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Usuarios from './Usuarios';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Usuarios />
    </QueryClientProvider>
  );
}

function getDialog(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog');
  if (!dialog) throw new Error('dialog não encontrado no container');
  return dialog;
}

describe('Usuarios', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.get).mockResolvedValue([]);
  });

  it('1. fechado no load: existe exatamente 1 dialog e dialog.open é false', async () => {
    const { container, findByText } = renderPage();
    await findByText('Nenhum usuário encontrado');
    expect(container.querySelectorAll('dialog').length).toBe(1);
    const dialog = getDialog(container);
    expect(dialog.open).toBe(false);
  });

  it('2. abre com o título certo ao clicar em "+ Novo usuário"', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('Nenhum usuário encontrado');
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Novo usuário');
  });

  it('3. sem título duplicado: só 1 h2 no container com o modal aberto', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('Nenhum usuário encontrado');
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));
    expect(container.querySelectorAll('h2').length).toBe(1);
  });

  it('4. tamanho default: className contém modal-dialog e não modal-dialog--wide', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('Nenhum usuário encontrado');
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).not.toContain('modal-dialog--wide');
  });

  it('5. cancelar fecha o modal e não chama api.post', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('Nenhum usuário encontrado');
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    fireEvent.click(getByRole('button', { name: 'Cancelar' }));
    expect(dialog.open).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('6. botão × do componente compartilhado fecha o modal', async () => {
    const { container, findByText, getByRole, getByLabelText } = renderPage();
    await findByText('Nenhum usuário encontrado');
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    fireEvent.click(getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
  });

  const USER_ROW = {
    id: 42,
    name: 'Ana Vendas',
    email: 'ana@sqquimica.com',
    role: 'comprador',
    isActive: true,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };

  it('8. Editar abre o modal com nome/perfil do usuário, e-mail travado e sem senha', async () => {
    vi.mocked(api.get).mockResolvedValue([USER_ROW]);
    const { container, findByRole, getByLabelText, queryByLabelText } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Editar Ana Vendas' }));

    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Editar usuário');
    expect((getByLabelText('Nome') as HTMLInputElement).value).toBe('Ana Vendas');
    const email = getByLabelText('E-mail') as HTMLInputElement;
    expect(email.value).toBe('ana@sqquimica.com');
    expect(email.disabled).toBe(true);
    expect((getByLabelText('Perfil') as HTMLSelectElement).value).toBe('comprador');
    expect(queryByLabelText('Senha inicial')).toBeNull();
    expect(container.querySelectorAll('dialog').length).toBe(1);
  });

  it('9. Salvar troca o perfil para Comercial via PUT /users/:id (só nome e perfil)', async () => {
    vi.mocked(api.get).mockResolvedValue([USER_ROW]);
    vi.mocked(api.put).mockResolvedValue({ ...USER_ROW, role: 'comercial' });
    const { container, findByRole, getByLabelText, getByRole } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Editar Ana Vendas' }));
    fireEvent.change(getByLabelText('Perfil'), { target: { value: 'comercial' } });
    fireEvent.click(getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/v1/users/42', { name: 'Ana Vendas', role: 'comercial' });
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(getDialog(container).open).toBe(false));
  });

  it('10. erro do backend (ex.: alterar o próprio perfil) aparece no modal e ele continua aberto', async () => {
    vi.mocked(api.get).mockResolvedValue([USER_ROW]);
    vi.mocked(api.put).mockRejectedValue(new Error('Nao e permitido alterar o proprio perfil.'));
    const { container, findByRole, findByText, getByLabelText, getByRole } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Editar Ana Vendas' }));
    fireEvent.change(getByLabelText('Perfil'), { target: { value: 'viewer' } });
    fireEvent.click(getByRole('button', { name: 'Salvar' }));

    expect(await findByText('Nao e permitido alterar o proprio perfil.')).toBeTruthy();
    expect(getDialog(container).open).toBe(true);
  });

  it('12. enquanto o PUT está pendente o modal não fecha (Cancelar, × e Esc) e só fecha no sucesso', async () => {
    vi.mocked(api.get).mockResolvedValue([USER_ROW]);
    let resolvePut: (v: unknown) => void = () => {};
    vi.mocked(api.put).mockReturnValue(new Promise((r) => { resolvePut = r; }) as never);
    const { container, findByRole, getByLabelText, getByRole } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Editar Ana Vendas' }));
    fireEvent.change(getByLabelText('Perfil'), { target: { value: 'comercial' } });
    fireEvent.click(getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));

    const dialog = getDialog(container);
    const cancel = getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement;
    await waitFor(() => expect(cancel.disabled).toBe(true));
    fireEvent.click(getByLabelText('Fechar'));
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Editar usuário');

    resolvePut({ ...USER_ROW, role: 'comercial' });
    await waitFor(() => expect(dialog.open).toBe(false));
  });

  it('11. depois de editar, "+ Novo usuário" volta ao formulário de cadastro limpo', async () => {
    vi.mocked(api.get).mockResolvedValue([USER_ROW]);
    const { container, findByRole, getByLabelText, getByRole } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Editar Ana Vendas' }));
    fireEvent.click(getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));

    expect(getDialog(container).querySelector('.modal-header h2')?.textContent).toBe('Novo usuário');
    expect((getByLabelText('Nome') as HTMLInputElement).value).toBe('');
    expect((getByLabelText('E-mail') as HTMLInputElement).disabled).toBe(false);
    expect(getByLabelText('Senha inicial')).toBeTruthy();
  });

  it('7. perfil Comercial disponível no formulário e no filtro', async () => {
    const { container, findByText, getByRole, getByLabelText } = renderPage();
    await findByText('Nenhum usuário encontrado');
    fireEvent.click(getByRole('button', { name: '+ Novo usuário' }));
    const formSelect = getByLabelText('Perfil') as HTMLSelectElement;
    expect(Array.from(formSelect.options).map((o) => o.value)).toContain('comercial');
    const filterSelect = container.querySelector('.page-header__actions select') as HTMLSelectElement;
    expect(Array.from(filterSelect.options).map((o) => o.textContent)).toContain('Comercial');
  });
});
