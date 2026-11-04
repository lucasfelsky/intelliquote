import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './useConfirm';

type Opts = Parameters<ReturnType<typeof useConfirm>>[0];

function Harness({ opts, onResult }: { opts: Opts; onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onResult(await confirm(opts))}>
      abrir
    </button>
  );
}

function setup(opts: Opts) {
  const results: boolean[] = [];
  render(
    <ConfirmProvider>
      <Harness opts={opts} onResult={(v) => results.push(v)} />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByText('abrir'));
  return results;
}

describe('useConfirm', () => {
  it("tone 'danger' usa danger-button no botão de confirmar", async () => {
    setup({ message: 'x', tone: 'danger', confirmText: 'Remover PO' });
    const button = await screen.findByRole('button', { name: 'Remover PO', hidden: true });
    expect(button.className).toContain('danger-button');
    expect(button.className).not.toContain('primary-button');
  });

  it('sem tone mantém primary-button (default intacto)', async () => {
    setup({ message: 'x', confirmText: 'Confirmar tudo' });
    const button = await screen.findByRole('button', { name: 'Confirmar tudo', hidden: true });
    expect(button.className).toContain('primary-button');
    expect(button.className).not.toContain('danger-button');
  });

  it('clicar em confirmar resolve true e cancelar resolve false', async () => {
    const yes = setup({ message: 'x', tone: 'danger', confirmText: 'Remover PO' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remover PO', hidden: true }));
    await waitFor(() => expect(yes).toEqual([true]));
  });

  it('F3c: a mensagem é um <p class="modal-confirm__message"> dentro de .modal-body, antes das ações', async () => {
    setup({ message: 'Reabrir a cotação QR-2026-0412?' });
    const mensagem = await screen.findByText('Reabrir a cotação QR-2026-0412?');
    expect(mensagem.tagName).toBe('P');
    expect(mensagem.className).toBe('modal-confirm__message');
    expect(mensagem.parentElement?.className).toBe('modal-body');
    expect(mensagem.nextElementSibling?.className).toBe('modal-actions');
  });

  it('F3c: título padrão "Confirmar ação"; botões com os textos padrão e classes intactas', async () => {
    setup({ message: 'x' });
    expect((await screen.findByRole('heading', { name: 'Confirmar ação', hidden: true })).textContent).toBe('Confirmar ação');
    const cancelar = await screen.findByRole('button', { name: 'Cancelar', hidden: true });
    const confirmar = await screen.findByRole('button', { name: 'Confirmar', hidden: true });
    expect(cancelar.className).toBe('ghost-button');
    expect(confirmar.className).toBe('primary-button');
  });

  it('F3c: "Cancelar" resolve false', async () => {
    const resultados = setup({ message: 'x', confirmText: 'Apagar', cancelText: 'Voltar' });
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar', hidden: true }));
    await waitFor(() => expect(resultados).toEqual([false]));
  });

  it('F3c: Esc (evento cancel do <dialog>) resolve false e é prevenido', async () => {
    const resultados = setup({ message: 'x', tone: 'danger', confirmText: 'Apagar' });
    await screen.findByRole('button', { name: 'Apagar', hidden: true });
    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    const esc = new Event('cancel', { cancelable: true });
    fireEvent(dialog as HTMLDialogElement, esc);
    expect(esc.defaultPrevented).toBe(true);
    await waitFor(() => expect(resultados).toEqual([false]));
  });

  it('F3c: o botão Fechar (x) do cabeçalho também resolve false', async () => {
    const resultados = setup({ message: 'x' });
    fireEvent.click(await screen.findByLabelText('Fechar', { selector: 'button' }));
    await waitFor(() => expect(resultados).toEqual([false]));
  });
});
