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
});
