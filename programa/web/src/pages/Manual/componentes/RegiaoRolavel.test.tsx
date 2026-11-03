import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import RegiaoRolavel from './RegiaoRolavel';
import Figura from './Figura';
import TabelaManual from './TabelaManual';

// F13-M2: a regiao do Manual so e focavel (tabIndex 0 + role region + nome) quando de fato rola na horizontal.

let largura = { scroll: 300, client: 300 };
let callbacks: Array<() => void> = [];
const aoRedimensionar = () => callbacks.forEach((cb) => cb());
let observados: Element[] = [];
let desconexoes = 0;

class ObservadorFalso {
  constructor(cb: () => void) {
    callbacks.push(cb);
  }
  observe(el: Element) {
    observados.push(el);
  }
  unobserve() {}
  disconnect() {
    desconexoes += 1;
  }
}

function medidas(scroll: number, client: number) {
  largura = { scroll, client };
}

function preparar() {
  observados = [];
  callbacks = [];
  desconexoes = 0;
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(() => largura.scroll);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => largura.client);
  vi.stubGlobal('ResizeObserver', ObservadorFalso);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RegiaoRolavel (F13-M2)', () => {
  it('conteudo mais largo que a caixa: regiao focavel com nome acessivel', () => {
    preparar();
    medidas(900, 300);
    render(
      <RegiaoRolavel className="manual-rolagem" nome="Tabela: x, role na horizontal">
        <p>conteudo</p>
      </RegiaoRolavel>,
    );
    const regiao = screen.getByRole('region', { name: 'Tabela: x, role na horizontal' });
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(regiao.className).toBe('manual-rolagem');
  });

  it('conteudo que cabe (ou so 1 px de arredondamento): sem tabindex, role nem nome; a classe fica', () => {
    preparar();
    for (const [scroll, client] of [[300, 300], [301, 300]] as Array<[number, number]>) {
      medidas(scroll, client);
      const { container, unmount } = render(
        <RegiaoRolavel className="manual-rolagem" nome="Tabela: x, role na horizontal">
          <p>conteudo</p>
        </RegiaoRolavel>,
      );
      const regiao = container.firstElementChild as HTMLElement;
      expect(regiao.className).toBe('manual-rolagem');
      expect(regiao.hasAttribute('tabindex')).toBe(false);
      expect(regiao.hasAttribute('role')).toBe(false);
      expect(regiao.hasAttribute('aria-label')).toBe(false);
      expect(screen.queryByRole('region')).toBeNull();
      unmount();
    }
  });

  it('acompanha a largura: ResizeObserver liga e desliga o tabindex, e o conteudo interno tambem e observado', () => {
    preparar();
    medidas(300, 300);
    const { container } = render(
      <RegiaoRolavel className="manual-rolagem" nome="Figura: y, role na horizontal">
        <svg />
      </RegiaoRolavel>,
    );
    const regiao = container.firstElementChild as HTMLElement;
    expect(observados).toContain(regiao);
    expect(observados).toContain(regiao.firstElementChild);
    expect(regiao.hasAttribute('tabindex')).toBe(false);
    medidas(900, 300);
    act(() => aoRedimensionar());
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(regiao.getAttribute('role')).toBe('region');
    expect(regiao.getAttribute('aria-label')).toBe('Figura: y, role na horizontal');
    medidas(300, 300);
    act(() => aoRedimensionar());
    expect(regiao.hasAttribute('tabindex')).toBe(false);
    expect(regiao.hasAttribute('role')).toBe(false);
  });

  it('ao desmontar: desconecta o ResizeObserver 1 vez e remove do window o MESMO handler de resize que registrou', () => {
    preparar();
    medidas(300, 300);
    const adicionar = vi.spyOn(window, 'addEventListener');
    const remover = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <RegiaoRolavel className="manual-rolagem" nome="Tabela: w, role na horizontal">
        <p>conteudo</p>
      </RegiaoRolavel>,
    );
    const registrado = adicionar.mock.calls.find(([tipo]) => tipo === 'resize')?.[1];
    expect(registrado).toBeTypeOf('function');
    expect(desconexoes).toBe(0);
    expect(remover.mock.calls.filter(([tipo]) => tipo === 'resize')).toHaveLength(0);
    unmount();
    expect(desconexoes).toBe(1);
    const removidos = remover.mock.calls.filter(([tipo]) => tipo === 'resize');
    expect(removidos).toHaveLength(1);
    expect(removidos[0]?.[1]).toBe(registrado);
  });

  it('funciona sem ResizeObserver (resize da janela religa a medida)', () => {
    preparar();
    vi.stubGlobal('ResizeObserver', undefined);
    medidas(300, 300);
    const { container } = render(
      <RegiaoRolavel className="manual-rolagem" nome="Tabela: z, role na horizontal">
        <p>conteudo</p>
      </RegiaoRolavel>,
    );
    const regiao = container.firstElementChild as HTMLElement;
    expect(regiao.hasAttribute('tabindex')).toBe(false);
    medidas(900, 300);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(regiao.getAttribute('tabindex')).toBe('0');
  });

  it('TabelaManual e Figura (com rolagem) usam a regiao: focaveis so quando rolam; Figura sem rolagem declarada nunca e', () => {
    preparar();
    medidas(900, 300);
    const { container } = render(
      <>
        <TabelaManual rotulo="demo">
          <tbody>
            <tr>
              <td>a</td>
            </tr>
          </tbody>
        </TabelaManual>
        <Figura legenda="L" rolagem="fluxo demo">
          <svg />
        </Figura>
        <Figura legenda="M">
          <svg />
        </Figura>
      </>,
    );
    expect(screen.getByRole('region', { name: 'Tabela: demo, role na horizontal' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('region', { name: 'Figura: fluxo demo, role na horizontal' }).getAttribute('tabindex')).toBe('0');
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(2);
    expect(container.querySelector('.manual-figura__caixa:not(.manual-rolagem)')?.hasAttribute('tabindex')).toBe(false);

    medidas(300, 300);
    act(() => aoRedimensionar());
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
  });
});
