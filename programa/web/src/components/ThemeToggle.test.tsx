import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ThemeToggle from './ThemeToggle';
import { ICONS, ICON_FILLS } from './icons';
import { THEME_STORAGE_KEY, writeThemePreference } from '@/theme/theme';

const html = () => document.documentElement;
const botao = () => screen.getByRole('button', { name: /^Tema: .+ — alternar tema$/ });

afterEach(() => {
  vi.restoreAllMocks();
  writeThemePreference('auto'); // zera a preferencia em memoria
  localStorage.clear();
  html().removeAttribute('data-theme');
  html().removeAttribute('data-theme-switching');
});

describe('ThemeToggle (botao unico ciclico, canvas v72)', () => {
  it('um unico button type="button"; nenhum radiogroup nem radio', () => {
    const { container } = render(<ThemeToggle />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(botao().getAttribute('type')).toBe('button');
    expect(botao().className).toBe('sidebar__theme');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(container.querySelector('.theme-toggle')).toBeNull();
  });

  it('sem chave: nome, title, texto visivel e icone do automatico (com a camada preenchida)', () => {
    render(<ThemeToggle />);
    const b = screen.getByRole('button', { name: 'Tema: automático — alternar tema' });
    expect(b.getAttribute('title')).toBe('Alternar tema (automático / noturno / claro)');
    expect(b.textContent).toBe('Tema: automático');
    const svg = b.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('stroke-width')).toBe('1.9');
    const paths = svg?.querySelectorAll('path') ?? [];
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')).toBe(ICONS['theme-half']);
    expect(paths[1]?.getAttribute('d')).toBe(ICON_FILLS['theme-half']);
    expect(paths[1]?.getAttribute('fill')).toBe('currentColor');
  });

  it('ciclo por clique: automatico -> noturno -> claro -> automatico (storage, data-theme, nome, texto e icone)', () => {
    render(<ThemeToggle />);

    fireEvent.click(botao());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(html().dataset.theme).toBe('dark');
    const noturno = screen.getByRole('button', { name: 'Tema: noturno — alternar tema' });
    expect(noturno.textContent).toBe('Tema: noturno');
    expect(noturno.querySelectorAll('path')).toHaveLength(1);
    expect(noturno.querySelector('path')?.getAttribute('d')).toBe(ICONS.moon);

    fireEvent.click(noturno);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(html().dataset.theme).toBe('light');
    const claro = screen.getByRole('button', { name: 'Tema: claro — alternar tema' });
    expect(claro.textContent).toBe('Tema: claro');
    expect(claro.querySelector('path')?.getAttribute('d')).toBe(ICONS.sun);

    fireEvent.click(claro);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tema: automático — alternar tema' }).textContent).toBe('Tema: automático');
  });

  it('com chave "dark" ja comeca em "Tema: noturno"; com "light", em "Tema: claro"', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { unmount } = render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Tema: noturno — alternar tema' })).toBeTruthy();
    unmount();

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Tema: claro — alternar tema' })).toBeTruthy();
  });

  it('com setItem lancando o clique nao quebra e o tema muda mesmo assim', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ThemeToggle />);
    expect(() => fireEvent.click(botao())).not.toThrow();
    expect(html().dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Tema: noturno — alternar tema' })).toBeTruthy();
  });

  it('role="status" invisivel: vazio ate o primeiro clique e depois anuncia o novo tema', () => {
    const { container } = render(<ThemeToggle />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(status.className).toContain('sr-only');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    fireEvent.click(botao());
    expect(screen.getByRole('status').textContent).toBe('Tema: noturno');
    fireEvent.click(botao());
    expect(screen.getByRole('status').textContent).toBe('Tema: claro');
  });

  it('todo svg e decorativo (aria-hidden) nos 3 estados', () => {
    const { container } = render(<ThemeToggle />);
    for (let i = 0; i < 3; i += 1) {
      const svgs = container.querySelectorAll('svg');
      expect(svgs).toHaveLength(1);
      expect(svgs[0]?.getAttribute('aria-hidden')).toBe('true');
      fireEvent.click(botao());
    }
  });
});
