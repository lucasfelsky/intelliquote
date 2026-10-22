import { afterEach, describe, expect, it } from 'vitest';
import { forcarClaroNaImpressao } from './impressaoEmClaro';

const html = document.documentElement;
const tema = () => html.dataset.theme;
const disparar = (tipo: 'beforeprint' | 'afterprint') => window.dispatchEvent(new Event(tipo));

afterEach(() => {
  delete html.dataset.theme;
});

describe('forcarClaroNaImpressao', () => {
  it('escuro -> beforeprint grava light -> afterprint volta para dark', () => {
    html.dataset.theme = 'dark';
    const limpar = forcarClaroNaImpressao();
    disparar('beforeprint');
    expect(tema()).toBe('light');
    disparar('afterprint');
    expect(tema()).toBe('dark');
    limpar();
  });

  it('claro continua claro e o afterprint nao mexe', () => {
    html.dataset.theme = 'light';
    const limpar = forcarClaroNaImpressao();
    disparar('beforeprint');
    expect(tema()).toBe('light');
    disparar('afterprint');
    expect(tema()).toBe('light');
    limpar();
  });

  it('dois beforeprint seguidos ainda restauram dark', () => {
    html.dataset.theme = 'dark';
    const limpar = forcarClaroNaImpressao();
    disparar('beforeprint');
    disparar('beforeprint');
    expect(tema()).toBe('light');
    disparar('afterprint');
    expect(tema()).toBe('dark');
    limpar();
  });

  it('sem atributo de tema: volta a ficar sem atributo', () => {
    const limpar = forcarClaroNaImpressao();
    disparar('beforeprint');
    expect(tema()).toBe('light');
    disparar('afterprint');
    expect(html.hasAttribute('data-theme')).toBe(false);
    limpar();
  });

  it('o afterprint nao sobrescreve um tema trocado no meio da impressao', () => {
    html.dataset.theme = 'dark';
    const limpar = forcarClaroNaImpressao();
    disparar('beforeprint');
    html.dataset.theme = 'sepia';
    disparar('afterprint');
    expect(tema()).toBe('sepia');
    limpar();
  });

  it('depois do cleanup o beforeprint nao altera nada', () => {
    html.dataset.theme = 'dark';
    const limpar = forcarClaroNaImpressao();
    limpar();
    disparar('beforeprint');
    expect(tema()).toBe('dark');
  });

  it('cleanup no meio da impressao restaura dark', () => {
    html.dataset.theme = 'dark';
    const limpar = forcarClaroNaImpressao();
    disparar('beforeprint');
    expect(tema()).toBe('light');
    limpar();
    expect(tema()).toBe('dark');
  });
});
