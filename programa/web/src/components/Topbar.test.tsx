import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Topbar from './Topbar';

type MockUser = { id: number; name?: string; email: string; role: string } | null;
let mockUser: MockUser = { id: 1, name: '[Usuário Demo]', email: 'demo@exemplo.test', role: 'admin' };
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, logout: vi.fn() }),
}));

const GLYPHS = /[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\u{1F300}-\u{1FAFF}]/u;

function renderTopbar() {
  return render(
    <MemoryRouter>
      <Topbar />
    </MemoryRouter>,
  );
}

describe('Topbar (F2, mock v68)', () => {
  it('sem logo, sem seletor de tema, sem Sair e sem titulo', () => {
    mockUser = { id: 1, name: '[Usuário Demo]', email: 'demo@exemplo.test', role: 'admin' };
    const { container } = renderTopbar();
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('header.topbar')).not.toBeNull();
    expect(container.querySelector('.topbar__spacer')).not.toBeNull();
  });

  it('chip SSO com o title do mock', () => {
    mockUser = { id: 1, name: '[Usuário Demo]', email: 'demo@exemplo.test', role: 'admin' };
    const { container } = renderTopbar();
    const chip = container.querySelector('.topbar__sso');
    expect(chip?.textContent).toBe('SSO · Portal COMEX');
    expect(chip?.getAttribute('title')).toBe('Login único com o Portal COMEX');
    expect(chip?.querySelector('svg')).not.toBeNull();
  });

  it('bloco do usuario: nome, e-mail, papel cru e inicial (sem colchetes)', () => {
    mockUser = { id: 1, name: '[Usuário Demo]', email: 'demo@exemplo.test', role: 'admin' };
    const { container } = renderTopbar();
    expect(container.querySelector('.topbar__user-info strong')?.textContent).toBe('[Usuário Demo]');
    expect(container.querySelector('.topbar__user-info small')?.textContent).toBe('demo@exemplo.test');
    expect(container.querySelector('.topbar__role')?.textContent).toBe('admin');
    expect(container.querySelector('.topbar__avatar')?.textContent).toBe('U');
  });

  it('inicial em maiuscula e "U" quando o nome falta', () => {
    mockUser = { id: 2, name: 'maria silva', email: 'm@exemplo.test', role: 'comprador' };
    const a = renderTopbar();
    expect(a.container.querySelector('.topbar__avatar')?.textContent).toBe('M');
    a.unmount();
    mockUser = { id: 3, email: 'x@exemplo.test', role: 'viewer' };
    const b = renderTopbar();
    expect(b.container.querySelector('.topbar__avatar')?.textContent).toBe('U');
    expect(b.container.querySelector('.topbar__user-info strong')?.textContent).toBe('Usuário');
  });

  it('"Minha conta" e um link para /minha-conta (admin)', () => {
    mockUser = { id: 1, name: 'Admin Demo', email: 'a@exemplo.test', role: 'admin' };
    renderTopbar();
    const link = screen.getByRole('link', { name: 'Minha conta' });
    expect(link.getAttribute('href')).toBe('/minha-conta');
    expect(link.className).toBe('topbar__account');
  });

  it('comercial: sem "Minha conta"', () => {
    mockUser = { id: 4, name: 'Comercial Demo', email: 'c@exemplo.test', role: 'comercial' };
    renderTopbar();
    expect(screen.queryByRole('link', { name: 'Minha conta' })).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('todo svg e aria-hidden e nenhum glifo unicode no texto', () => {
    mockUser = { id: 1, name: 'Admin Demo', email: 'a@exemplo.test', role: 'admin' };
    const { container } = renderTopbar();
    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent ?? '').not.toMatch(GLYPHS);
  });
});
