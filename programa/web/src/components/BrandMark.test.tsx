import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrandMark from './BrandMark';

describe('BrandMark (direcao A, IQ)', () => {
  it('decorativa por padrao: aria-hidden e sem role', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('role')).toBe(false);
    expect(svg?.hasAttribute('aria-label')).toBe(false);
  });

  it('decorative={false}: role="img" com o nome IntelliQuote', () => {
    render(<BrandMark decorative={false} />);
    const img = screen.getByRole('img', { name: 'IntelliQuote' });
    expect(img.hasAttribute('aria-hidden')).toBe(false);
  });

  it('geometria do mock: tile 48 rx 13; lupa r=10 em 22,5; cabo; ponto r=3,1 em 35,4', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 48 48');
    const tile = container.querySelector('.brand-mark__tile');
    expect(tile?.getAttribute('width')).toBe('48');
    expect(tile?.getAttribute('rx')).toBe('13');
    const [lente, cabo] = Array.from(container.querySelectorAll('.brand-mark__glyph'));
    expect(lente?.getAttribute('cx')).toBe('22.5');
    expect(lente?.getAttribute('cy')).toBe('22.5');
    expect(lente?.getAttribute('r')).toBe('10');
    expect(lente?.getAttribute('stroke-width')).toBe('4.5');
    expect(cabo?.getAttribute('d')).toBe('M29.8 29.8 L31.2 31.2');
    expect(cabo?.getAttribute('stroke-linecap')).toBe('round');
    const ponto = container.querySelector('.brand-mark__dot');
    expect(ponto?.getAttribute('cx')).toBe('35.4');
    expect(ponto?.getAttribute('cy')).toBe('35.4');
    expect(ponto?.getAttribute('r')).toBe('3.1');
  });

  it('tamanho padrao 40; ajustavel; tom vira classe', () => {
    const padrao = render(<BrandMark />).container.querySelector('svg');
    expect(padrao?.getAttribute('width')).toBe('40');
    expect(padrao?.getAttribute('height')).toBe('40');
    expect(padrao?.getAttribute('class')).toContain('brand-mark--dark');
    const claro = render(<BrandMark tone="light" size={32} />).container.querySelector('svg');
    expect(claro?.getAttribute('width')).toBe('32');
    expect(claro?.getAttribute('class')).toContain('brand-mark--light');
  });

  it('nenhum atributo fill/stroke com cor literal (a cor vem do CSS)', () => {
    const { container } = render(<BrandMark />);
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const attr of ['fill', 'stroke']) {
        const value = el.getAttribute(attr);
        if (value !== null) expect(value, `${el.tagName}[${attr}]`).toBe('none');
      }
    }
  });
});
