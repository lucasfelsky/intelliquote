import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ForecastMenuMais from './ForecastMenuMais';
import { readSource } from '../../test/rfCss';

function montar(podeExcluir = true) {
  const acoes = { onFontes: vi.fn(), onEventos: vi.fn(), onGrupos: vi.fn(), onExcluir: vi.fn() };
  const ui = render(
    <div>
      <ForecastMenuMais podeExcluir={podeExcluir} {...acoes} />
      <button type="button">Depois</button>
    </div>,
  );
  return { ...ui, acoes };
}

const botao = () => screen.getByRole('button', { name: 'Mais' });
const itens = () => screen.queryAllByRole('menuitem');
const rotulos = () => itens().map((i) => i.textContent);

describe('ForecastMenuMais (board F1e/F1f do mock v68)', () => {
  it('fechado: so o botao, com aria-haspopup="menu" e aria-expanded="false", sem aria-controls (o menu nao existe)', () => {
    montar();
    expect(botao().getAttribute('aria-haspopup')).toBe('menu');
    expect(botao().getAttribute('aria-expanded')).toBe('false');
    expect(botao().hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('o clique abre o menu, marca aria-expanded, liga aria-controls ao menu e foca o 1o item', () => {
    montar();
    fireEvent.click(botao());
    const menu = screen.getByRole('menu', { name: 'Mais ações do Forecast' });
    expect(botao().getAttribute('aria-expanded')).toBe('true');
    expect(menu.id).toBe(botao().getAttribute('aria-controls'));
    expect(document.activeElement).toBe(itens()[0]);
  });

  it('admin/comprador (podeExcluir): 3 consultas, divisor e "Excluir quinzena" em tom de perigo', () => {
    montar(true);
    fireEvent.click(botao());
    expect(rotulos()).toEqual(['Fontes e lead time', 'Eventos estrangeiros', 'Grupos de equivalência', 'Excluir quinzena']);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(itens()[3]?.className).toContain('fc-mais__item--perigo');
    expect(itens()[0]?.className).not.toContain('fc-mais__item--perigo');
  });

  it('gestor/viewer (sem podeExcluir): so as 3 consultas e nenhum divisor', () => {
    montar(false);
    fireEvent.click(botao());
    expect(rotulos()).toEqual(['Fontes e lead time', 'Eventos estrangeiros', 'Grupos de equivalência']);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('roving tabindex: so o 1o item e tabulavel', () => {
    montar();
    fireEvent.click(botao());
    expect(itens().map((i) => i.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('seta para baixo no botao abre e foca o 1o item; seta para cima abre e foca o ultimo', () => {
    montar();
    fireEvent.keyDown(botao(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(itens()[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(botao(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(itens()[3]);
  });

  it('setas navegam (com volta ao inicio e ao fim); Home e End vao ao primeiro e ao ultimo', () => {
    montar();
    fireEvent.click(botao());
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(itens()[1]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(itens()[3]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(itens()[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(itens()[3]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(itens()[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(itens()[3]);
  });

  it('Esc fecha o menu e devolve o foco ao botao Mais', () => {
    montar();
    fireEvent.click(botao());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(botao().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(botao());
  });

  it('Tab fecha o menu (sem prender o foco)', () => {
    montar();
    fireEvent.click(botao());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('clicar fora fecha o menu', () => {
    montar();
    fireEvent.click(botao());
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Depois' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('o clique no botao com o menu aberto fecha', () => {
    montar();
    fireEvent.click(botao());
    fireEvent.click(botao());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it.each([
    ['Fontes e lead time', 'onFontes'],
    ['Eventos estrangeiros', 'onEventos'],
    ['Grupos de equivalência', 'onGrupos'],
    ['Excluir quinzena', 'onExcluir'],
  ] as const)('"%s" fecha o menu e dispara %s uma vez', (nome, chave) => {
    const { acoes } = montar();
    fireEvent.click(botao());
    fireEvent.click(screen.getByRole('menuitem', { name: nome }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(acoes[chave]).toHaveBeenCalledTimes(1);
    const outras = Object.entries(acoes).filter(([k]) => k !== chave);
    for (const [, fn] of outras) expect(fn).not.toHaveBeenCalled();
  });

  it('os itens tem icone decorativo (svg aria-hidden) e o nome acessivel e so o texto', () => {
    montar();
    fireEvent.click(botao());
    for (const item of itens()) {
      expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(screen.getByRole('menuitem', { name: 'Fontes e lead time' })).toBeTruthy();
  });
});

// Guardas do CSS da F13-C (par sentinela): espaco em flex e texto so de papel.
describe('CSS F13-C: guardas do par sentinela', () => {
  const normal = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
  const par = normal.slice(normal.indexOf('/* -- F13-C >>> -- */'), normal.indexOf('/* -- <<< F13-C -- */'));
  const corpo = (seletor: string) => {
    const i = par.indexOf(`${seletor} {`);
    expect(i, seletor).toBeGreaterThan(-1);
    return par.slice(i, par.indexOf('}', i));
  };

  it('inline-flex/flex com texto + <span> adjacentes tem gap (o espaco em branco some em flex): .fc-filtro, .fc-chave, summary, .fc-cabecalho__quinzena', () => {
    expect(corpo('.fc-pagina .fc-filtro')).toMatch(/gap: 8px/);
    expect(corpo('.fc-pagina .fc-chave,\n  .fc-pagina .fc-chave.fcsv-chave[aria-checked="false"]')).toMatch(/gap: 10px/);
    expect(corpo('.fc-pagina .fcp__detalhes summary')).toMatch(/gap: 8px/);
    expect(corpo('.fc-pagina .fc-cabecalho__quinzena')).toMatch(/gap: 6px 16px/);
    expect(corpo('.fc-pagina .page-header h1')).toMatch(/gap: 12px/);
  });

  it('.fc-so-papel e display:none SO dentro de @media screen (no papel o texto segue impresso)', () => {
    const tela = par.slice(par.indexOf('@media screen {'));
    expect(tela).toMatch(/\.fc-pagina \.fc-so-papel \{ display: none; \}/);
    expect(par.slice(0, par.indexOf('@media screen {')).replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('fc-so-papel');
  });

  it('o cartao do cabecalho nao impoe largura minima (a 390 nao pode estourar a pagina): min-width:0 no cartao e no grupo da quinzena; select com min-width limitado a 100%', () => {
    expect(corpo('.fc-pagina > .page-header > .fc-cabecalho')).toMatch(/min-width: 0/);
    expect(corpo('.fc-pagina .fc-cabecalho__quinzena')).toMatch(/min-width: 0/);
    // basis pequena: o grupo encolhe/quebra sozinho e as acoes ficam a direita na mesma linha (1440)
    expect(corpo('.fc-pagina .fc-cabecalho__quinzena')).toMatch(/flex: 1 1 340px/);
    expect(corpo('.fc-pagina .fc-cabecalho__quinzena .select')).toMatch(/min-width: min\(260px, 100%\)/);
    expect(par).not.toMatch(/min-width: 260px/);
  });
});
