import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ThemeToggle from './ThemeToggle';
import { THEME_STORAGE_KEY, writeThemePreference } from '@/theme/theme';

const html = () => document.documentElement;
const radio = (name: string) => screen.getByRole('radio', { name });
const AUTO = 'Automático (segue o sistema)';

afterEach(() => {
  vi.restoreAllMocks();
  writeThemePreference('auto'); // zera a preferencia em memoria
  localStorage.clear();
  html().removeAttribute('data-theme');
  html().removeAttribute('data-theme-switching');
});

describe('ThemeToggle', () => {
  it('renderiza 3 radios com nomes acessiveis dentro de um radiogroup', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('radiogroup', { name: 'Tema da interface' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(radio('Claro')).toBeTruthy();
    expect(radio('Escuro')).toBeTruthy();
    expect(radio(AUTO)).toBeTruthy();
  });

  it('sem chave => Automatico marcado; com chave => reflete o storage; roving tabindex', () => {
    const { unmount } = render(<ThemeToggle />);
    expect(radio(AUTO).getAttribute('aria-checked')).toBe('true');
    expect(radio(AUTO).tabIndex).toBe(0);
    expect(radio('Claro').tabIndex).toBe(-1);
    unmount();

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(radio('Escuro').getAttribute('aria-checked')).toBe('true');
    expect(radio(AUTO).getAttribute('aria-checked')).toBe('false');
    expect(radio('Escuro').tabIndex).toBe(0);
  });

  it('clicar em Escuro grava dark e aplica data-theme; clicar em Automatico remove a chave', () => {
    render(<ThemeToggle />);
    fireEvent.click(radio('Escuro'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(html().dataset.theme).toBe('dark');
    expect(radio('Escuro').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(radio('Claro'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(html().dataset.theme).toBe('light');

    fireEvent.click(radio(AUTO));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(radio(AUTO).getAttribute('aria-checked')).toBe('true');
  });

  it('setas movem foco e selecao (com wrap)', () => {
    render(<ThemeToggle />);
    act(() => radio('Claro').focus());
    fireEvent.click(radio('Claro'));

    fireEvent.keyDown(radio('Claro'), { key: 'ArrowRight' });
    expect(radio('Escuro').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Escuro'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.keyDown(radio('Escuro'), { key: 'ArrowLeft' });
    expect(radio('Claro').getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(radio('Claro'), { key: 'ArrowLeft' });
    expect(radio(AUTO).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio(AUTO));
  });

  it('com setItem lancando o clique nao quebra e o tema muda mesmo assim', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ThemeToggle />);
    expect(() => fireEvent.click(radio('Escuro'))).not.toThrow();
    expect(html().dataset.theme).toBe('dark');
    expect(radio('Escuro').getAttribute('aria-checked')).toBe('true');
  });
});
