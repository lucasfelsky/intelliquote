import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Tabs, TabList, Tab, TabPanel } from './Tabs';

// F3d: Tabs perde o estilo inline (a aparencia passa a vir das classes tabs-list / tabs-trigger / tabs-panel no globals.css).
// Esta guarda trava o que NAO pode mudar: roles, IDs, aria-*, tabIndex em roving e o teclado (setas, Home, End).

function Exemplo({ inicial = 'resumo' }: { inicial?: string }) {
  const [aba, setAba] = useState(inicial);
  return (
    <Tabs value={aba} onValueChange={setAba} baseId="demo">
      <TabList aria-label="Seções da cotação">
        <Tab value="resumo">Resumo</Tab>
        <Tab value="itens">Itens</Tab>
        <Tab value="respostas">Respostas</Tab>
      </TabList>
      <TabPanel value="resumo"><p>Conteúdo do resumo</p></TabPanel>
      <TabPanel value="itens"><p>Conteúdo dos itens</p></TabPanel>
      <TabPanel value="respostas"><p>Conteúdo das respostas</p></TabPanel>
    </Tabs>
  );
}

const abas = () => screen.getAllByRole('tab') as HTMLButtonElement[];
const selecionada = () => abas().filter((t) => t.getAttribute('aria-selected') === 'true');

describe('Tabs: semântica e ARIA', () => {
  it('tablist com nome acessível; cada tab com id, aria-controls e aria-selected', () => {
    render(<Exemplo />);
    const lista = screen.getByRole('tablist', { name: 'Seções da cotação' });
    expect(lista.className).toBe('tabs-list');
    expect(abas().map((t) => t.textContent)).toEqual(['Resumo', 'Itens', 'Respostas']);
    expect(abas().map((t) => t.id)).toEqual(['demo-tab-resumo', 'demo-tab-itens', 'demo-tab-respostas']);
    expect(abas().map((t) => t.getAttribute('aria-controls'))).toEqual(['demo-panel-resumo', 'demo-panel-itens', 'demo-panel-respostas']);
    expect(abas().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
  });

  it('tabpanel só da aba selecionada, com id e aria-labelledby apontando para a tab', () => {
    render(<Exemplo />);
    const paineis = screen.getAllByRole('tabpanel');
    expect(paineis).toHaveLength(1);
    const painel = paineis[0] as HTMLElement;
    expect(painel.id).toBe('demo-panel-resumo');
    expect(painel.getAttribute('aria-labelledby')).toBe('demo-tab-resumo');
    expect(painel.className).toBe('tabs-panel');
    expect(painel.getAttribute('tabindex')).toBe('0');
    expect(painel.textContent).toBe('Conteúdo do resumo');
  });

  it('clicar numa aba a seleciona e troca o painel', () => {
    render(<Exemplo />);
    fireEvent.click(screen.getByRole('tab', { name: 'Itens' }));
    expect(selecionada().map((t) => t.textContent)).toEqual(['Itens']);
    expect(screen.getByRole('tabpanel').id).toBe('demo-panel-itens');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('demo-tab-itens');
  });

  it('roving tabIndex: 0 só na selecionada, -1 nas demais', () => {
    render(<Exemplo inicial="itens" />);
    expect(abas().map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    fireEvent.click(screen.getByRole('tab', { name: 'Respostas' }));
    expect(abas().map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  });
});

describe('Tabs: teclado', () => {
  const teclar = (alvo: HTMLElement, key: string) => {
    alvo.focus();
    fireEvent.keyDown(alvo, { key });
  };

  it('ArrowRight / ArrowLeft movem o foco e ativam a aba (com volta ao fim e ao começo)', () => {
    render(<Exemplo />);
    teclar(abas()[0] as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(abas()[1]);
    expect(selecionada().map((t) => t.textContent)).toEqual(['Itens']);
    teclar(abas()[1] as HTMLElement, 'ArrowLeft');
    expect(document.activeElement).toBe(abas()[0]);
    expect(selecionada().map((t) => t.textContent)).toEqual(['Resumo']);
    teclar(abas()[0] as HTMLElement, 'ArrowLeft');
    expect(document.activeElement).toBe(abas()[2]);
    expect(selecionada().map((t) => t.textContent)).toEqual(['Respostas']);
    teclar(abas()[2] as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(abas()[0]);
  });

  it('ArrowDown e ArrowUp se comportam como direita e esquerda', () => {
    render(<Exemplo />);
    teclar(abas()[0] as HTMLElement, 'ArrowDown');
    expect(selecionada().map((t) => t.textContent)).toEqual(['Itens']);
    teclar(abas()[1] as HTMLElement, 'ArrowUp');
    expect(selecionada().map((t) => t.textContent)).toEqual(['Resumo']);
  });

  it('End vai para a última aba e Home volta para a primeira', () => {
    render(<Exemplo />);
    teclar(abas()[0] as HTMLElement, 'End');
    expect(document.activeElement).toBe(abas()[2]);
    expect(selecionada().map((t) => t.textContent)).toEqual(['Respostas']);
    teclar(abas()[2] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(abas()[0]);
    expect(selecionada().map((t) => t.textContent)).toEqual(['Resumo']);
  });

  it('as setas chamam preventDefault (a rolagem da página não acompanha)', () => {
    render(<Exemplo />);
    abas()[0]?.focus();
    expect(fireEvent.keyDown(abas()[0] as HTMLElement, { key: 'ArrowRight' })).toBe(false);
  });

  it('outras teclas não mudam a aba', () => {
    render(<Exemplo />);
    teclar(abas()[0] as HTMLElement, 'a');
    expect(selecionada().map((t) => t.textContent)).toEqual(['Resumo']);
  });
});

describe('Tabs: aparência só por classe', () => {
  it('nenhum atributo style em tablist, tab e tabpanel', () => {
    render(<Exemplo />);
    for (const el of [screen.getByRole('tablist'), ...abas(), screen.getByRole('tabpanel')]) {
      expect(el.hasAttribute('style'), el.getAttribute('role') ?? '').toBe(false);
    }
  });

  it('classe tabs-trigger--active só na selecionada, sem espaço sobrando', () => {
    render(<Exemplo />);
    expect(abas().map((t) => t.className)).toEqual(['tabs-trigger tabs-trigger--active', 'tabs-trigger', 'tabs-trigger']);
    fireEvent.click(screen.getByRole('tab', { name: 'Respostas' }));
    expect(abas().map((t) => t.className)).toEqual(['tabs-trigger', 'tabs-trigger', 'tabs-trigger tabs-trigger--active']);
    expect(document.querySelectorAll('.tabs-trigger--active')).toHaveLength(1);
  });

  it('o contêiner continua .tabs-root e a aba continua sem type="button" (D-F3-28: comportamento atual, registrado para a F12)', () => {
    const { container } = render(<Exemplo />);
    expect(container.querySelector('.tabs-root')).not.toBeNull();
    for (const t of abas()) expect(t.hasAttribute('type')).toBe(false);
  });
});
