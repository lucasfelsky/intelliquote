import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingShell from './LoadingShell';

// Carregando sessao (F4, board AcessoEstados C): o conteiner de tela cheia NAO pode levar `.spinner` (o bug de antes pintava anel no conteiner).
describe('LoadingShell', () => {
  it('role=status com o nome "Carregando"', () => {
    render(<LoadingShell />);
    const status = screen.getByRole('status', { name: 'Carregando' });
    expect(status.classList.contains('loading-shell')).toBe(true);
    expect(status.classList.contains('spinner--fullscreen')).toBe(true);
  });

  it('o conteiner nao tem a classe spinner; so o filho decorativo a tem', () => {
    const { container } = render(<LoadingShell />);
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.classList.contains('spinner')).toBe(false);
    const aneis = container.querySelectorAll('.spinner');
    expect(aneis).toHaveLength(1);
    expect(aneis[0]?.classList.contains('loading-shell__spinner')).toBe(true);
    expect(aneis[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('a marca (BrandMark light 56) e decorativa; sem img acessivel nem estilo inline', () => {
    const { container } = render(<LoadingShell />);
    const marca = container.querySelector('svg.brand-mark--light');
    expect(marca?.getAttribute('aria-hidden')).toBe('true');
    expect(marca?.getAttribute('width')).toBe('56');
    expect(screen.queryByRole('img')).toBeNull();
    container.querySelectorAll('*').forEach((el) => expect(el.hasAttribute('style')).toBe(false));
  });
});
