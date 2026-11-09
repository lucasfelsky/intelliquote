import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ForecastFiltrosMenu from './ForecastFiltrosMenu';
import ForecastFiltroSemVenda from './ForecastFiltroSemVenda';

function montar(props: Partial<React.ComponentProps<typeof ForecastFiltrosMenu>> = {}) {
  const onAlternarOcultas = vi.fn();
  const onAlternarSemVenda = vi.fn();
  render(
    <>
      <button type="button">fora</button>
      <ForecastFiltrosMenu
        ocultas={false}
        onAlternarOcultas={onAlternarOcultas}
        mostrarSemVenda={false}
        ocultaveis={70}
        onAlternarSemVenda={onAlternarSemVenda}
        {...props}
      />
    </>,
  );
  return { onAlternarOcultas, onAlternarSemVenda };
}

describe('ForecastFiltrosMenu (refino visual, etapa 5)', () => {
  it('as chaves ficam dentro do balao: fechado nao ha switch; clicar no botao abre (aria-expanded) e Esc fecha devolvendo o foco', () => {
    montar();
    const botao = screen.getByRole('button', { name: 'Filtros avançados' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    fireEvent.click(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('group', { name: 'Filtros avançados' }), { key: 'Escape' });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.activeElement).toBe(botao);
  });

  it('clicar fora fecha; clicar numa chave chama o callback e mantem o balao aberto', () => {
    const { onAlternarOcultas, onAlternarSemVenda } = montar();
    fireEvent.click(screen.getByTestId('fc-filtros-botao'));
    fireEvent.click(screen.getByRole('switch', { name: 'Colunas ocultas da planilha' }));
    fireEvent.click(screen.getByRole('switch', { name: /^Mostrar produtos sem venda há 6 meses ou mais/ }));
    expect(onAlternarOcultas).toHaveBeenCalledTimes(1);
    expect(onAlternarSemVenda).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    fireEvent.pointerDown(screen.getByText('fora'));
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('o contador do botao e o numero de chaves ligadas; o numero de produtos ocultaveis aparece na chave de sem venda', () => {
    montar({ ocultas: true, mostrarSemVenda: true });
    const botao = screen.getByRole('button', { name: 'Filtros avançados: 2 ligados' });
    expect(botao.textContent).toContain('2');
    fireEvent.click(botao);
    expect(screen.getByRole('switch', { name: /^Mostrar produtos sem venda/ }).textContent).toContain('70');
  });
});

describe('ForecastFiltroSemVenda (aviso)', () => {
  it('so o leitor de tela le o aviso de produtos ocultos; vazio quando a chave esta ligada', () => {
    const { container, rerender } = render(<ForecastFiltroSemVenda mostrar={false} ocultaveis={2} />);
    const aviso = container.querySelector('.fcsv-ocultos') as HTMLElement;
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.className).toContain('sr-only');
    expect(aviso.textContent).toBe('2 produtos ocultos pelo filtro de sem venda');
    rerender(<ForecastFiltroSemVenda mostrar ocultaveis={2} />);
    expect(container.querySelector('.fcsv-ocultos')?.textContent).toBe('');
  });
});
