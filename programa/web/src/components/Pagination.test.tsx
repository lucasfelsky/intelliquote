import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Pagination } from './Pagination';

// F3d: os números da paginação passam a ser <span class="pagination__num"> (mono no mock). Botões, aria-labels, textos e plural NÃO mudam;
// por isso o texto completo se lê pelo textContent do nav (getByText de uma frase não casa mais com um único nó de texto).

const itemLabel = { singular: 'cotação', plural: 'cotações' };
const nav = () => screen.getByRole('navigation', { name: 'Paginação' });
const info = () => nav().querySelector('.pagination__info') as HTMLElement;

describe('Pagination', () => {
  it('lê "Página 2 de 3 · 128 cotações no total" pelo textContent do nav, com 3 números em .pagination__num', () => {
    render(<Pagination page={2} totalPages={3} totalItems={128} itemLabel={itemLabel} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(nav().textContent).toContain('Página 2 de 3 · 128 cotações no total');
    expect(info().textContent).toBe('Página 2 de 3 · 128 cotações no total');
    expect([...nav().querySelectorAll('.pagination__num')].map((n) => n.textContent)).toEqual(['2', '3', '128']);
  });

  it('o rótulo padrão é "item"/"itens" e o plural/singular segue o total', () => {
    const { rerender } = render(<Pagination page={1} totalPages={1} totalItems={1} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(info().textContent).toBe('Página 1 de 1 · 1 item no total');
    rerender(<Pagination page={1} totalPages={1} totalItems={75} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(info().textContent).toBe('Página 1 de 1 · 75 itens no total');
    rerender(<Pagination page={1} totalPages={1} totalItems={1} itemLabel={itemLabel} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(info().textContent).toBe('Página 1 de 1 · 1 cotação no total');
    rerender(<Pagination page={1} totalPages={1} totalItems={0} itemLabel={itemLabel} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(info().textContent).toBe('Página 1 de 1 · 0 cotações no total');
  });

  it('botões com aria-label "Página anterior" / "Próxima página" e texto "Anterior" / "Próxima"', () => {
    render(<Pagination page={2} totalPages={3} totalItems={128} itemLabel={itemLabel} onPrevious={vi.fn()} onNext={vi.fn()} />);
    const anterior = screen.getByRole('button', { name: 'Página anterior' });
    const proxima = screen.getByRole('button', { name: 'Próxima página' });
    expect(anterior.textContent).toBe('Anterior');
    expect(proxima.textContent).toBe('Próxima');
    expect(anterior.className).toBe('ghost-button');
    expect(proxima.className).toBe('ghost-button');
    expect(anterior.getAttribute('type')).toBe('button');
  });

  it('desabilitado nas pontas: "Anterior" na página 1 e "Próxima" na última', () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} totalItems={128} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(false);
    rerender(<Pagination page={3} totalPages={3} totalItems={128} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('onPrevious e onNext são chamados no clique; desabilitado não dispara', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(<Pagination page={2} totalPages={3} totalItems={128} onPrevious={onPrevious} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    rerender(<Pagination page={1} totalPages={1} totalItems={3} onPrevious={onPrevious} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('totalPages = 0 vira "de 1" e desabilita os dois botões', () => {
    render(<Pagination page={1} totalPages={0} totalItems={0} itemLabel={itemLabel} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(info().textContent).toBe('Página 1 de 1 · 0 cotações no total');
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('nav com a classe .pagination, sem estilo inline', () => {
    render(<Pagination page={1} totalPages={2} totalItems={60} onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(nav().className).toBe('pagination');
    expect(nav().querySelector('[style]')).toBeNull();
    expect(nav().hasAttribute('style')).toBe(false);
  });
});
