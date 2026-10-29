import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import StarRating from './StarRating';
import { ICONS } from './icons';

// F3d: as estrelas passam de glifos (★/☆) para SVG (o path do ícone `star`), estilizadas só por classe; o valor sai com vírgula decimal
// (correção de copy aprovada). API, nomes acessíveis da edição e onChange NÃO mudam.

describe('StarRating: edição', () => {
  it('radiogroup "Preço: sem nota" com 5 radios "N de 5" e aria-checked', () => {
    render(<StarRating value={0} onChange={vi.fn()} label="Preço" />);
    expect(screen.getByRole('radiogroup', { name: 'Preço: sem nota' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['1 de 5', '2 de 5', '3 de 5', '4 de 5', '5 de 5']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false', 'false']);
  });

  it('com nota 4: radiogroup "Preço: 4", só o 4º marcado e 4 estrelas cheias', () => {
    const { container } = render(<StarRating value={4} onChange={vi.fn()} label="Preço" />);
    expect(screen.getByRole('radiogroup', { name: 'Preço: 4' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false']);
    expect(container.querySelectorAll('.star-rating__star--on')).toHaveLength(4);
    expect(container.querySelectorAll('.star-rating__star--off')).toHaveLength(1);
  });

  it('clicar numa estrela chama onChange com o valor; clicar na estrela já marcada zera (alterna)', () => {
    const onChange = vi.fn();
    const { rerender } = render(<StarRating value={0} onChange={onChange} label="Prazo" />);
    fireEvent.click(screen.getByRole('radio', { name: '3 de 5' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    rerender(<StarRating value={3} onChange={onChange} label="Prazo" />);
    fireEvent.click(screen.getByRole('radio', { name: '3 de 5' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('radio', { name: '5 de 5' }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('cada radio é um <button type="button"> com .star-rating__button e um SVG decorativo', () => {
    render(<StarRating value={2} onChange={vi.fn()} label="Qualidade" />);
    for (const r of screen.getAllByRole('radio')) {
      expect(r.tagName).toBe('BUTTON');
      expect(r.getAttribute('type')).toBe('button');
      expect(r.className).toBe('star-rating__button');
      expect(r.querySelectorAll('svg')).toHaveLength(1);
    }
  });

  it('sem onChange, clicar não quebra', () => {
    render(<StarRating value={1} label="Preço" />);
    expect(() => fireEvent.click(screen.getByRole('radio', { name: '2 de 5' }))).not.toThrow();
  });
});

describe('StarRating: leitura', () => {
  it('role="img" "Avaliação média 4,2 de 5" (vírgula decimal, D-F3-17) e texto "4,2"', () => {
    const { container } = render(<StarRating value={4.2} readOnly showValue />);
    expect(screen.getByRole('img', { name: 'Avaliação média 4,2 de 5' })).toBeTruthy();
    expect(container.querySelector('.star-rating__value')?.textContent).toBe('4,2');
    expect(container.textContent).toBe('4,2');
  });

  it('valor inteiro sai com uma casa ("4,0") e a nota 4,6 enche 5 estrelas (arredondada)', () => {
    const { container, rerender } = render(<StarRating value={4} readOnly showValue />);
    expect(container.querySelector('.star-rating__value')?.textContent).toBe('4,0');
    expect(container.querySelectorAll('.star-rating__star--on')).toHaveLength(4);
    rerender(<StarRating value={4.6} readOnly showValue />);
    expect(container.querySelector('.star-rating__value')?.textContent).toBe('4,6');
    expect(container.querySelectorAll('.star-rating__star--on')).toHaveLength(5);
    expect(container.querySelectorAll('.star-rating__star--off')).toHaveLength(0);
  });

  it('com label, o formato atual do nome acessível fica: "Avaliação: 4" / "Preço: sem nota"', () => {
    const { rerender } = render(<StarRating value={4} readOnly label="Avaliação" />);
    expect(screen.getByRole('img', { name: 'Avaliação: 4' })).toBeTruthy();
    rerender(<StarRating value={0} readOnly label="Preço" />);
    expect(screen.getByRole('img', { name: 'Preço: sem nota' })).toBeTruthy();
  });

  it('sem nota e sem label: "Avaliação média: sem nota" e nenhum valor mesmo com showValue', () => {
    const { container } = render(<StarRating value={0} readOnly showValue />);
    expect(screen.getByRole('img', { name: 'Avaliação média: sem nota' })).toBeTruthy();
    expect(container.querySelector('.star-rating__value')).toBeNull();
    expect(container.querySelectorAll('.star-rating__star--on')).toHaveLength(0);
  });

  it('sem showValue não mostra o número', () => {
    const { container } = render(<StarRating value={3.5} readOnly />);
    expect(container.querySelector('.star-rating__value')).toBeNull();
  });

  it('nenhum glifo ★/☆ e nenhum atributo style; todo svg é aria-hidden, usa o path do ícone `star` e não é focável', () => {
    const { container } = render(
      <>
        <StarRating value={4.2} readOnly showValue />
        <StarRating value={2} onChange={vi.fn()} label="Preço" />
      </>,
    );
    expect(container.textContent).not.toMatch(/[★☆]/);
    expect(container.querySelector('[style]')).toBeNull();
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs).toHaveLength(10);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.querySelector('path')?.getAttribute('d')).toBe(ICONS.star);
      expect(svg.getAttribute('class')).toMatch(/^star-rating__star star-rating__star--(on|off)$/);
    }
  });

  it('a leitura não renderiza botões', () => {
    render(<StarRating value={3} readOnly />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
