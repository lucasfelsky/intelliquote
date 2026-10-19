/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import LoginGate from './LoginGate';

// `login.css?raw` volta vazio no Vitest (plugin de CSS desligado); le o arquivo direto.
const loginCss = readFileSync(resolve(__dirname, '../styles/login.css'), 'utf8');

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ login: vi.fn(), status: 'unauthenticated', exchangeError: null }),
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginGate />
    </MemoryRouter>,
  );
}

describe('LoginGate - fundo Rotas de fornecimento', () => {
  it('fundo: backdrop aria-hidden com 2 svgs (desktop/mobile) como primeiro filho do gate', () => {
    const { container } = renderLogin();
    const gate = container.querySelector('.auth-gate');
    const backdrop = container.querySelector('.login-backdrop');
    expect(gate).toBeTruthy();
    expect(backdrop).toBeTruthy();
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    expect(gate?.firstElementChild).toBe(backdrop);

    const svgs = backdrop!.querySelectorAll('svg');
    expect(svgs.length).toBe(2);
    svgs.forEach((svg) => {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
    });
    const desktop = backdrop!.querySelector('svg.login-backdrop__svg--desktop');
    const mobile = backdrop!.querySelector('svg.login-backdrop__svg--mobile');
    expect(desktop?.getAttribute('viewBox')).toBe('0 0 1440 900');
    expect(mobile?.getAttribute('viewBox')).toBe('0 0 390 844');
  });

  it('a11y: textos do svg ocultos; controles do formulario seguem acessiveis', () => {
    const { container } = renderLogin();
    const texts = container.querySelectorAll('text');
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((t) => expect(t.closest('[aria-hidden="true"]')).not.toBeNull());

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail')).toBeTruthy();
    expect(screen.getByLabelText('Senha')).toBeTruthy();

    const imgs = screen.getAllByRole('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0]?.getAttribute('alt')).toBe('IntelliQuote');
  });

  it('IDs: unicos, com prefixo iq-login- e url(#) resolvendo dentro do proprio svg', () => {
    const { container } = renderLogin();
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    container.querySelectorAll('.login-backdrop [id]').forEach((el) => {
      expect(el.id.startsWith('iq-login-')).toBe(true);
    });

    let refs = 0;
    container.querySelectorAll('.login-backdrop svg').forEach((svg) => {
      svg.querySelectorAll('*').forEach((el) => {
        ['fill', 'mask', 'clip-path'].forEach((attr) => {
          const m = /url\(#([^)]+)\)/.exec(el.getAttribute(attr) ?? '');
          if (m) {
            refs += 1;
            expect(svg.querySelector(`[id="${m[1]}"]`)).not.toBeNull();
          }
        });
      });
    });
    expect(refs).toBeGreaterThan(0);
  });

  it('sem var() nem template em atributo e sem animacao SMIL', () => {
    const { container } = renderLogin();
    container.querySelectorAll('.login-backdrop, .login-backdrop *').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        expect(a.value.includes('var(')).toBe(false);
        expect(a.value.includes('{{')).toBe(false);
      });
    });
    expect(container.querySelectorAll('animate, animateTransform').length).toBe(0);
  });

  it('card: classes de contraste no eyebrow e no botao Entrar', () => {
    const { container } = renderLogin();
    const eyebrow = Array.from(container.querySelectorAll('p')).find(
      (p) => p.textContent === 'IntelliQuote',
    );
    expect(eyebrow?.classList.contains('eyebrow')).toBe(true);
    expect(eyebrow?.classList.contains('auth-card__eyebrow')).toBe(true);

    const btn = screen.getByRole('button', { name: 'Entrar' });
    expect(btn.classList.contains('primary-button')).toBe(true);
    expect(btn.classList.contains('auth-card__submit')).toBe(true);
  });

  it('CSS: tokens, reduced-motion, breakpoint e sem tokens/globais redeclarados', () => {
    expect(loginCss).toContain('prefers-reduced-motion: reduce');
    expect(loginCss).toContain('var(--primary-strong, #00735c)');
    expect(loginCss).toContain('var(--on-strong, #fff)');
    expect(loginCss).toContain('var(--primary-strong-hover, #00563f)');
    expect(loginCss).toContain('var(--primary-700)');
    expect(loginCss).toContain('var(--primary)');
    expect(loginCss).toContain('max-width: 640px');
    expect(loginCss).not.toMatch(/:root/);
    expect(loginCss).not.toMatch(/--(primary-strong|on-strong|primary-strong-hover)\s*:/);
    expect(loginCss).not.toMatch(/(^|[\s,}])\.(eyebrow|primary-button)\b/m);
  });
});
