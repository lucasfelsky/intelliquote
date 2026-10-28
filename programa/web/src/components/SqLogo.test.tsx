import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SqLogo from './SqLogo';

describe('SqLogo (assinatura "sq química", canvas v72)', () => {
  it('raiz role="img" com o nome "SQ Química"; o label e customizavel', () => {
    const { unmount } = render(<SqLogo />);
    const img = screen.getByRole('img', { name: 'SQ Química' });
    expect(img.hasAttribute('aria-hidden')).toBe(false);
    unmount();
    render(<SqLogo label="Assinatura SQ" />);
    expect(screen.getByRole('img', { name: 'Assinatura SQ' })).toBeTruthy();
  });

  it('svg decorativo (aria-hidden, focusable=false) e sem nenhum elemento focavel', () => {
    const { container } = render(<SqLogo />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(container.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
  });

  it('geometria IDENTICA a do board: viewBox 100, anel (tracado 8, ponta redonda), gargalo e balao', () => {
    const { container } = render(<SqLogo />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');
    const ring = container.querySelector('.sq-logo__ring');
    expect(ring?.getAttribute('d')).toBe('M64 19.5 A38 38 0 1 1 36 19.5');
    expect(ring?.getAttribute('fill')).toBe('none');
    expect(ring?.getAttribute('stroke-width')).toBe('8');
    expect(ring?.getAttribute('stroke-linecap')).toBe('round');
    const [gargalo, balao] = Array.from(container.querySelectorAll('.sq-logo__green'));
    expect(gargalo?.getAttribute('d')).toBe('M44 30.5 L56 23.5 L56 44 L44 44 Z');
    expect(balao?.tagName.toLowerCase()).toBe('circle');
    expect(balao?.getAttribute('cx')).toBe('50');
    expect(balao?.getAttribute('cy')).toBe('58.5');
    expect(balao?.getAttribute('r')).toBe('19.5');
  });

  it('textos "sq" e "química" nas classes das palavras', () => {
    const { container } = render(<SqLogo />);
    expect(container.querySelector('.sq-logo__sq')?.textContent).toBe('sq');
    expect(container.querySelector('.sq-logo__chem')?.textContent).toBe('química');
    expect(container.querySelector('.sq-logo__words')?.textContent).toBe('sqquímica');
  });

  it('classes: sq-logo, sq-logo--minusc, sq-logo--dark (+ className do chamador)', () => {
    const { container } = render(<SqLogo className="extra" />);
    const raiz = container.firstElementChild;
    expect(raiz?.className).toBe('sq-logo sq-logo--minusc sq-logo--dark extra');
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('sq-logo__symbol');
  });

  it('size 32 (sidebar): simbolo 32, gap 6 px, gap entre palavras 4 px, fonte 13 px', () => {
    const { container } = render(<SqLogo size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
    expect((container.firstElementChild as HTMLElement).style.gap).toBe('6px');
    const palavras = container.querySelector('.sq-logo__words') as HTMLElement;
    expect(palavras.style.gap).toBe('4px');
    expect(palavras.style.fontSize).toBe('13px');
  });

  it('o padrao e 32 e size 36 (F4, login) escala: simbolo 36, gaps 6 / 4 e fonte 14 px', () => {
    const padrao = render(<SqLogo />).container.querySelector('svg');
    expect(padrao?.getAttribute('width')).toBe('32');
    const { container } = render(<SqLogo size={36} />);
    const svg = container.querySelectorAll('svg')[0];
    expect(svg?.getAttribute('width')).toBe('36');
    expect(svg?.getAttribute('height')).toBe('36');
    expect((container.firstElementChild as HTMLElement).style.gap).toBe('6px');
    const palavras = container.querySelector('.sq-logo__words') as HTMLElement;
    expect(palavras.style.gap).toBe('4px');
    expect(palavras.style.fontSize).toBe('14px');
  });

  it('sem cor literal, sem opacity e sem filtro: fill/stroke so none ou ausentes; estilo inline so gap e fonte', () => {
    const { container } = render(<SqLogo />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|var\(/);
    expect(html).not.toMatch(/opacity|filter/i);
    for (const el of Array.from(container.querySelectorAll('svg, svg *'))) {
      for (const attr of ['fill', 'stroke']) {
        const valor = el.getAttribute(attr);
        expect(valor === null || valor === 'none', `${el.tagName} ${attr}=${valor}`).toBe(true);
      }
    }
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.getAttribute('style')).toBe('gap: 6px;');
    expect(container.querySelector('.sq-logo__words')?.getAttribute('style')).toBe('gap: 4px; font-size: 13px;');
  });
});
