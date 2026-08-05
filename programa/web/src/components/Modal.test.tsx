import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

function getDialog(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog');
  if (!dialog) throw new Error('dialog não encontrado no container');
  return dialog;
}

describe('Modal', () => {
  it('1. isOpen=false: dialog está no DOM e dialog.open é false', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={false} onClose={onClose} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(dialog.open).toBe(false);
  });

  it('2. isOpen=true: dialog.open é true, title aparece no h2 e children são renderizados', () => {
    const onClose = vi.fn();
    const { container, getByText } = render(
      <Modal isOpen={true} onClose={onClose} title="Meu Título">
        <p>Conteúdo do modal</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    const heading = container.querySelector('h2');
    expect(heading?.textContent).toBe('Meu Título');
    expect(getByText('Conteúdo do modal')).toBeTruthy();
  });

  it('3. re-render de isOpen true -> false: dialog.open volta a false', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(dialog.open).toBe(true);
    rerender(
      <Modal isOpen={false} onClose={onClose} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    expect(dialog.open).toBe(false);
  });

  it('4. clique no botão aria-label="Fechar" chama onClose exatamente 1x', () => {
    const onClose = vi.fn();
    const { getByLabelText } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    fireEvent.click(getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('5. evento cancel no dialog (ESC) chama onClose 1x e previne o default', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    const event = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('6. D2: clique com target = o próprio dialog chama onClose 1x', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <button type="button">Inner</button>
      </Modal>
    );
    const dialog = getDialog(container);
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('7. D2: clique dentro da .modal-content (num botão dos children) não chama onClose', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <button type="button">Inner</button>
      </Modal>
    );
    const innerButton = getByText('Inner');
    fireEvent.mouseDown(innerButton);
    fireEvent.click(innerButton);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('8. D2: mousedown na .modal-content seguido de click no dialog (drag-select) não chama onClose', () => {
    const onClose = vi.fn();
    const { container, getByText } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <button type="button">Inner</button>
      </Modal>
    );
    const dialog = getDialog(container);
    const innerButton = getByText('Inner');
    fireEvent.mouseDown(innerButton);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('9. D1: sem prop size, className contém modal-dialog e não contém modal-dialog--wide', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} onClose={onClose} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).not.toContain('modal-dialog--wide');
  });

  it('10. D1: size="wide", className contém modal-dialog--wide', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} onClose={onClose} title="Título" size="wide">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog--wide');
  });

  it('11. troca de referência de onClose entre renders: só o onClose atual é chamado 1x', () => {
    const onCloseFirst = vi.fn();
    const onCloseSecond = vi.fn();
    const { container, rerender } = render(
      <Modal isOpen={true} onClose={onCloseFirst} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    rerender(
      <Modal isOpen={true} onClose={onCloseSecond} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onCloseFirst).not.toHaveBeenCalled();
    expect(onCloseSecond).toHaveBeenCalledTimes(1);
  });
});
