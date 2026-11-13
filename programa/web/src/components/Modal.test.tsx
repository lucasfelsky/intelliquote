import { StrictMode } from 'react';
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

  it('18. className extra (opcional) entra depois das classes do tamanho; sem ele o className e o mesmo de antes', () => {
    const sem = render(<Modal isOpen={true} onClose={vi.fn()} title="Título" size="wide"><p>Conteúdo</p></Modal>);
    expect(getDialog(sem.container).className).toBe('modal-dialog modal-dialog--wide');
    sem.unmount();
    const com = render(<Modal isOpen={true} onClose={vi.fn()} title="Título" size="wide" className="fc-portal"><p>Conteúdo</p></Modal>);
    expect(getDialog(com.container).className).toBe('modal-dialog modal-dialog--wide fc-portal');
  });

  it('19. E8: o <dialog> tem nome acessivel (aria-labelledby aponta para o h2 do titulo, com ou sem subtitle)', () => {
    for (const subtitle of [undefined, 'Apoio']) {
      const { container, unmount } = render(
        <Modal isOpen={true} onClose={vi.fn()} title="Criar cotação" subtitle={subtitle}>
          <p>Conteúdo</p>
        </Modal>
      );
      const dialog = getDialog(container);
      const id = dialog.getAttribute('aria-labelledby');
      expect(id).toBeTruthy();
      expect(dialog.querySelector('h2')?.id).toBe(id);
      expect(document.getElementById(id as string)?.textContent).toBe('Criar cotação');
      unmount();
    }
  });

  it('20. eyebrow: <p class="modal-eyebrow"> vem ANTES do h2, dentro de .modal-header__titles; o nome acessivel do dialog segue sendo o titulo', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Acme Chemicals" eyebrow="Editar fornecedor">
        <p>Corpo</p>
      </Modal>,
    );
    const titulos = container.querySelector('.modal-header > .modal-header__titles');
    expect(titulos).not.toBeNull();
    expect(Array.from(titulos?.children ?? []).map((el) => el.tagName)).toEqual(['P', 'H2']);
    expect(titulos?.firstElementChild?.className).toBe('modal-eyebrow');
    expect(titulos?.firstElementChild?.textContent).toBe('Editar fornecedor');
    const h2 = container.querySelector('h2');
    expect(h2?.textContent).toBe('Acme Chemicals');
    expect(getDialog(container).getAttribute('aria-labelledby')).toBe(h2?.id);
    expect(container.querySelector('.modal-subtitle')).toBeNull();
  });

  it('21. eyebrow + subtitle: eyebrow, h2 e subtitulo, nessa ordem', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titulo" eyebrow="Linha" subtitle="Apoio">
        <p>Corpo</p>
      </Modal>,
    );
    const titulos = container.querySelector('.modal-header__titles');
    expect(Array.from(titulos?.children ?? []).map((el) => el.className || el.tagName)).toEqual(['modal-eyebrow', 'H2', 'modal-subtitle']);
  });

  it('22. sem eyebrow o markup e o de antes: h2 filho direto do header (sem subtitle) e sem .modal-eyebrow', () => {
    const semTudo = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titulo">
        <p>Corpo</p>
      </Modal>,
    );
    expect(semTudo.container.querySelector('.modal-eyebrow')).toBeNull();
    expect(semTudo.container.querySelector('.modal-header__titles')).toBeNull();
    expect(semTudo.container.querySelector('.modal-header > h2')?.textContent).toBe('Titulo');
    semTudo.unmount();
    const soSubtitle = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titulo" subtitle="Apoio">
        <p>Corpo</p>
      </Modal>,
    );
    expect(soSubtitle.container.querySelector('.modal-eyebrow')).toBeNull();
    expect(Array.from(soSubtitle.container.querySelector('.modal-header__titles')?.children ?? []).map((el) => el.tagName)).toEqual(['H2', 'P']);
  });

  it('23. data-autofocus: depois do showModal() o foco vai para o elemento marcado (o autoFocus do React age com o dialog fechado)', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titulo">
        <input aria-label="primeiro" />
        <input aria-label="segundo" data-autofocus />
      </Modal>,
    );
    expect(getDialog(container).open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('input[aria-label="segundo"]'));
  });

  it('24. sem data-autofocus nada e focado pelo Modal (comportamento dos demais modais do IQ inalterado)', () => {
    const foco = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Titulo">
          <input aria-label="primeiro" />
        </Modal>,
      );
      expect(foco).not.toHaveBeenCalled();
    } finally {
      foco.mockRestore();
    }
  });

  // restoreFocus (opt-in): devolve o foco a quem abriu o modal quando ele fecha ou desmonta (os modais do Indent desmontam).
  function Host({ aberto, comBotao = true, restaurar }: { aberto: boolean; comBotao?: boolean; restaurar?: boolean }) {
    return (
      <div>
        {comBotao && <button type="button">abrir</button>}
        {aberto && (
          <Modal isOpen restoreFocus={restaurar} onClose={vi.fn()} title="Titulo">
            <input aria-label="campo" data-autofocus />
          </Modal>
        )}
      </div>
    );
  }

  it('25. restoreFocus: ao desmontar, o foco volta ao botao que abriu o modal', () => {
    const { getByText, getByLabelText, rerender } = render(<Host aberto={false} restaurar />);
    const botao = getByText('abrir');
    botao.focus();
    expect(document.activeElement).toBe(botao);

    rerender(<Host aberto restaurar />);
    expect(document.activeElement).toBe(getByLabelText('campo'));

    rerender(<Host aberto={false} restaurar />);
    expect(document.activeElement).toBe(botao);
  });

  it('26. sem restoreFocus o foco nao volta (comportamento dos demais modais do IQ inalterado)', () => {
    const { getByText, rerender } = render(<Host aberto={false} />);
    const botao = getByText('abrir');
    botao.focus();

    rerender(<Host aberto />);
    rerender(<Host aberto={false} />);
    expect(document.activeElement).not.toBe(botao);
  });

  it('27. restoreFocus: elemento que abriu ja saiu do DOM nao quebra nem recebe foco', () => {
    const { getByText, rerender } = render(<Host aberto={false} restaurar />);
    const botao = getByText('abrir');
    botao.focus();

    rerender(<Host aberto restaurar />);
    const foco = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      expect(() => rerender(<Host aberto={false} comBotao={false} restaurar />)).not.toThrow();
      expect(foco).not.toHaveBeenCalled();
      expect(botao.isConnected).toBe(false);
    } finally {
      foco.mockRestore();
    }
  });

  it('28. restoreFocus sob React.StrictMode (efeito em dobro): o foco volta ao botao ao desmontar e o foco inicial segue no campo', () => {
    const { getByText, getByLabelText, rerender } = render(
      <StrictMode>
        <Host aberto={false} restaurar />
      </StrictMode>,
    );
    const botao = getByText('abrir');
    botao.focus();

    rerender(
      <StrictMode>
        <Host aberto restaurar />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(getByLabelText('campo'));

    rerender(
      <StrictMode>
        <Host aberto={false} restaurar />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(botao);
  });

  it('29. restoreFocus com o modal montado e isOpen alternando: devolve ao fechar e captura a nova origem ao reabrir', () => {
    function Alterna({ aberto }: { aberto: boolean }) {
      return (
        <div>
          <button type="button">abrir</button>
          <Modal isOpen={aberto} restoreFocus onClose={vi.fn()} title="Titulo">
            <input aria-label="campo" data-autofocus />
          </Modal>
        </div>
      );
    }
    const { getByText, getByLabelText, rerender } = render(<Alterna aberto={false} />);
    const botao = getByText('abrir');
    botao.focus();
    rerender(<Alterna aberto />);
    expect(document.activeElement).toBe(getByLabelText('campo'));
    rerender(<Alterna aberto={false} />);
    expect(document.activeElement).toBe(botao);

    getByLabelText('campo').focus();
    rerender(<Alterna aberto />);
    rerender(<Alterna aberto={false} />);
    expect(document.activeElement).toBe(getByLabelText('campo'));
  });
});

describe('Modal - headerAside (opt-in)', () => {
  it('sem a prop, o cabecalho tem so o titulo e o Fechar (markup de sempre)', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titulo" subtitle="Apoio">
        <p>Conteudo</p>
      </Modal>
    );
    const header = container.querySelector('header.modal-header');
    expect(Array.from(header?.children ?? []).map((el) => el.tagName + '.' + el.className)).toEqual([
      'DIV.modal-header__titles',
      'BUTTON.btn-close',
    ]);
  });

  it('com a prop, o no entra no cabecalho ANTES do Fechar', () => {
    const { container, getByTestId } = render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titulo" headerAside={<span data-testid="aside">Respondida</span>}>
        <p>Conteudo</p>
      </Modal>
    );
    const header = container.querySelector('header.modal-header');
    const aside = getByTestId('aside');
    const fechar = container.querySelector('.btn-close');
    expect(aside.parentElement).toBe(header);
    expect(aside.nextElementSibling).toBe(fechar);
    expect(header?.lastElementChild).toBe(fechar);
  });
});
