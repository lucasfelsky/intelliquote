import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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
});
