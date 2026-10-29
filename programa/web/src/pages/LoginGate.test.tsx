/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import LoginGate from './LoginGate';
import { readSource, regioes } from '../test/rfCss';

// O CSS do login mora na regiao `tela F4` do globals.css (o login.css foi apagado na F4); `?raw` volta vazio no Vitest, le do disco.
const regiaoF4 = regioes(readSource('../styles/globals.css').replace(/\r\n/g, '\n')).find((r) => r.nome === 'tela F4');
const cssF4 = regiaoF4?.limpo ?? '';

const auth = vi.hoisted(() => ({
  state: { login: vi.fn(), status: 'unauthenticated', exchangeError: null as string | null },
}));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => auth.state }));

beforeEach(() => {
  auth.state = { login: vi.fn(), status: 'unauthenticated', exchangeError: null };
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginGate />
    </MemoryRouter>,
  );
}

function preencherEEnviar(container: HTMLElement) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'demo@exemplo.test' } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-ficticia' } });
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
}

describe('LoginGate - fundo Curvas de cambio', () => {
  it('fundo: backdrop aria-hidden com os 2 svgs (pontos e curvas) como primeiro filho do gate', () => {
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
    const curvas = svgs[1];
    expect(curvas?.getAttribute('viewBox')).toBe('600 0 840 900');
    expect(curvas?.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
  });

  it('estrutura: painel, area do cartao e cartao na ordem do board', () => {
    const { container } = renderLogin();
    const gate = container.querySelector('.auth-gate')!;
    expect(Array.from(gate.children).map((c) => c.className)).toEqual(['login-backdrop', 'login-painel', 'auth-gate__area']);
    expect(container.querySelector('.auth-gate__area > form.auth-card')).toBeTruthy();
    expect(container.querySelector('.login-painel__nome')?.textContent).toBe('IntelliQuote');
    expect(container.querySelector('.login-painel__assinatura .sq-logo')).toBeTruthy();
    expect(container.querySelector('.login-painel__marca .brand-mark--dark')).toBeTruthy();
    expect(container.querySelector('.login-painel__textura')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('a11y: textos do svg ocultos; controles do formulario seguem acessiveis; um h1 "Entrar"', () => {
    const { container } = renderLogin();
    const texts = container.querySelectorAll('text');
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((t) => expect(t.closest('[aria-hidden="true"]')).not.toBeNull());

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeTruthy();
    expect(screen.getByLabelText('E-mail')).toBeTruthy();
    expect(screen.getByLabelText('Senha')).toBeTruthy();
    expect(screen.getByLabelText('E-mail').id).toBe('email');
    expect(screen.getByLabelText('Senha').id).toBe('password');

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe('Entrar');
  });

  it('unica imagem acessivel e a assinatura "SQ Quimica" (sem /logo.png); marca e arte decorativas', () => {
    const { container } = renderLogin();
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('aria-label')).toBe('SQ Química');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('/logo.png');
  });

  it('IDs: unicos, com prefixo iq-login- em todo svg do gate e url(#) / href=# resolvendo dentro do proprio svg', () => {
    const { container } = renderLogin();
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    container.querySelectorAll('.auth-gate svg [id]').forEach((el) => {
      expect(el.id.startsWith('iq-login-')).toBe(true);
    });

    let refs = 0;
    container.querySelectorAll('.auth-gate svg').forEach((svg) => {
      svg.querySelectorAll('*').forEach((el) => {
        ['fill', 'mask', 'clip-path'].forEach((attr) => {
          const m = /url\(#([^)]+)\)/.exec(el.getAttribute(attr) ?? '');
          if (m) {
            refs += 1;
            expect(svg.querySelector(`[id="${m[1]}"]`)).not.toBeNull();
          }
        });
        if (el.tagName.toLowerCase() === 'use') {
          refs += 1;
          const alvo = (el.getAttribute('href') ?? '').replace(/^#/, '');
          expect(svg.querySelector(`[id="${alvo}"]`)).not.toBeNull();
        }
      });
    });
    expect(refs).toBeGreaterThan(0);
  });

  it('sem var() nem template em atributo e SEM animacao SMIL (animate, animateTransform, animateMotion, set)', () => {
    const { container } = renderLogin();
    container.querySelectorAll('.auth-gate, .auth-gate *').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        expect(a.value.includes('var(')).toBe(false);
        expect(a.value.includes('{{')).toBe(false);
      });
    });
    expect(container.querySelectorAll('animate, animateTransform, animateMotion, set').length).toBe(0);
  });

  it('card: classes de contraste no eyebrow e no botao Entrar', () => {
    const { container } = renderLogin();
    const eyebrow = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'IntelliQuote' && p.classList.contains('eyebrow'));
    expect(eyebrow?.classList.contains('eyebrow')).toBe(true);
    expect(eyebrow?.classList.contains('auth-card__eyebrow')).toBe(true);

    const btn = screen.getByRole('button', { name: 'Entrar' });
    expect(btn.classList.contains('primary-button')).toBe(true);
    expect(btn.classList.contains('auth-card__submit')).toBe(true);
    expect(container.querySelector('a.ghost-button.auth-card__portal')?.textContent).toBe('Voltar ao Portal COMEX');
  });

  it('campos: IDs, tipos, placeholders, autocomplete e foco iniciais intactos', () => {
    renderLogin();
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    const senha = screen.getByLabelText('Senha') as HTMLInputElement;
    expect(email.type).toBe('email');
    expect(email.required).toBe(true);
    expect(email.placeholder).toBe('voce@sqquimica.com');
    expect(email.autocomplete).toBe('email');
    expect(senha.type).toBe('password');
    expect(senha.required).toBe(true);
    expect(senha.minLength).toBe(6);
    expect(senha.autocomplete).toBe('current-password');
    expect(document.activeElement).toBe(email);
  });
});

describe('LoginGate - estados A (erro), B (entrando) e detalhe da troca', () => {
  it('A: login rejeitando vira .alert.alert--error[role=alert] com a mensagem de credenciais', async () => {
    auth.state.login = vi.fn().mockRejectedValue(new Error('auth/invalid-login-credential'));
    const { container } = renderLogin();
    preencherEEnviar(container);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('E-mail ou senha inválidos.');
    expect(alerta.classList.contains('alert')).toBe(true);
    expect(alerta.classList.contains('alert--error')).toBe(true);
    expect(alerta.hasAttribute('style')).toBe(false);
    await waitFor(() => expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('false'));
  });

  it('A: falha do servidor mantem o texto de autenticacao no mesmo alerta', async () => {
    auth.state.login = vi.fn().mockRejectedValue(new Error('token expired'));
    const { container } = renderLogin();
    preencherEEnviar(container);
    expect((await screen.findByRole('alert')).textContent).toBe('Falha de autenticação no servidor: token expired');
  });

  it('B: enviando -> form aria-busy, botao desabilitado com "Entrando…" e spinner decorativo', async () => {
    auth.state.login = vi.fn().mockReturnValue(new Promise(() => undefined));
    const { container } = renderLogin();
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('false');
    expect(container.querySelector('.btn-spinner')).toBeNull();
    preencherEEnviar(container);
    const botao = await screen.findByRole('button', { name: 'Entrando…' });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(botao.classList.contains('auth-card__submit')).toBe(true);
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    const spinner = botao.querySelector('.btn-spinner');
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('exchangeError aparece em .auth-card__detalhe (sem papel de alerta) quando nao ha erro de login', () => {
    auth.state.exchangeError = '[detalhe ficticio]';
    const { container } = renderLogin();
    const detalhe = container.querySelector('.auth-card__detalhe');
    expect(detalhe?.textContent).toBe('Detalhe: [detalhe ficticio]');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('LoginGate - CSS da regiao `tela F4`', () => {
  it('login.css nao existe mais e a regiao tem as regras do login', () => {
    expect(existsSync(resolve(__dirname, '../styles/login.css'))).toBe(false);
    expect(regiaoF4).toBeDefined();
    expect(cssF4).toContain('.auth-gate');
    expect(cssF4).toContain('.login-backdrop');
  });

  it('reduced-motion e faixa estreita (max-width 640px) presentes; sem :root e sem declarar tokens --*', () => {
    expect(cssF4).toContain('prefers-reduced-motion: reduce');
    expect(cssF4).toContain('max-width: 640px');
    expect(cssF4.replace(/:root\[data-theme="dark"\]/g, '')).not.toMatch(/:root/);
    expect(cssF4).not.toMatch(/(^|[\s;{])--[\w-]+\s*:/);
  });
});
