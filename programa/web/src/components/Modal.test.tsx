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

  it('12. size="xl", className contém modal-dialog--xl e não contém modal-dialog--wide', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Título" size="xl">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(dialog.className).toContain('modal-dialog--xl');
    expect(dialog.className).not.toContain('modal-dialog--wide');
  });

  it('13. F3c: o botão "Fechar" traz um svg aria-hidden (sem o texto ×) e continua sendo um único elemento rotulado', () => {
    const { container, getAllByLabelText } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const botoes = getAllByLabelText('Fechar');
    expect(botoes).toHaveLength(1);
    const fechar = botoes[0] as HTMLElement;
    expect(fechar.className).toBe('btn-close');
    expect(fechar.getAttribute('type')).toBe('button');
    expect(fechar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(fechar.textContent).toBe('');
    expect(container.querySelector('.modal-header')?.textContent).not.toContain('×');
  });

  it('14. F3c: com subtitle, o h2 segue como descendente de .modal-header com o título exato e o subtítulo é um <p> irmão do h2', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Editar cotação" subtitle="QR-2026-0418 · Ácido cítrico anidro">
        <p>Conteúdo</p>
      </Modal>
    );
    const h2 = container.querySelector('.modal-header h2');
    expect(h2?.textContent).toBe('Editar cotação');
    const subtitulo = container.querySelector('.modal-subtitle');
    expect(subtitulo?.tagName).toBe('P');
    expect(subtitulo?.textContent).toBe('QR-2026-0418 · Ácido cítrico anidro');
    expect(subtitulo?.previousElementSibling).toBe(h2);
    expect(h2?.parentElement?.className).toBe('modal-header__titles');
    expect(container.querySelector('.modal-body h2')).toBeNull();
    expect(container.querySelector('.modal-body .modal-subtitle')).toBeNull();
  });

  it('15. F3c: sem subtitle não há .modal-subtitle nem .modal-header__titles e o h2 é filho direto de .modal-header', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    expect(container.querySelector('.modal-subtitle')).toBeNull();
    expect(container.querySelector('.modal-header__titles')).toBeNull();
    expect(container.querySelector('.modal-header > h2')?.textContent).toBe('Título');
  });

  it('16. F3c: subtitle aceita ReactNode (código em destaque) e não muda o nome acessível do botão Fechar', () => {
    const { container, getByLabelText } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Título" subtitle={<><b>QR-1</b> · Produto</>}>
        <p>Conteúdo</p>
      </Modal>
    );
    expect(container.querySelector('.modal-subtitle b')?.textContent).toBe('QR-1');
    expect(getByLabelText('Fechar').getAttribute('aria-label')).toBe('Fechar');
  });

  it('17. F3c: estrutura <dialog> > .modal-content > (header + .modal-body); abre com showModal (foco preso e Esc são do <dialog> nativo)', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Título">
        <p>Conteúdo</p>
      </Modal>
    );
    const dialog = getDialog(container);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(Array.from(dialog.children).map((c) => c.className)).toEqual(['modal-content']);
    expect(Array.from(dialog.querySelector('.modal-content')?.children ?? []).map((c) => c.className)).toEqual(['modal-header', 'modal-body']);
    showModal.mockRestore();
  });
});
