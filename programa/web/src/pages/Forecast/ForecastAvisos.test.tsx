import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ForecastAvisos, { ProvedorAvisos, useAviso, type AvisoForecast } from './ForecastAvisos';

function Fonte({ id, aviso }: { id: string; aviso: Omit<AvisoForecast, 'id'> | null }) {
  const noIcone = useAviso(id, aviso);
  return <p data-testid={`inline-${id}`}>{noIcone ? 'no icone' : 'inline'}</p>;
}

function montar(avisos: Array<{ id: string; aviso: Omit<AvisoForecast, 'id'> | null }>) {
  return render(
    <ProvedorAvisos>
      <ForecastAvisos />
      {avisos.map((a) => (
        <Fonte key={a.id} id={a.id} aviso={a.aviso} />
      ))}
    </ProvedorAvisos>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ForecastAvisos', () => {
  it('sem aviso nao desenha o icone', () => {
    montar([{ id: 'a', aviso: null }]);
    expect(screen.queryByTestId('fc-avisos-botao')).toBeNull();
    expect(screen.getByTestId('inline-a').textContent).toBe('inline');
  });

  it('fora do provedor o hook devolve false (o aviso segue no corpo da tela)', () => {
    render(<Fonte id="a" aviso={{ tom: 'info', titulo: 'X' }} />);
    expect(screen.getByTestId('inline-a').textContent).toBe('inline');
  });

  it('com aviso: icone com contador, aviso fora do corpo, balao fechado', () => {
    montar([
      { id: 'a', aviso: { tom: 'info', titulo: 'Informativo' } },
      { id: 'b', aviso: { tom: 'erro', titulo: 'Falhou', texto: 'Detalhe do erro' } },
    ]);
    const botao = screen.getByTestId('fc-avisos-botao');
    expect(botao.getAttribute('aria-label')).toBe('Avisos: 2');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(botao.className).toContain('fc-avisos__botao--erro');
    expect(screen.getByTestId('inline-a').textContent).toBe('no icone');
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
  });

  it('hover abre, lista na ordem erro > info e fecha ao sair', () => {
    vi.useFakeTimers();
    montar([
      { id: 'a', aviso: { tom: 'info', titulo: 'Informativo' } },
      { id: 'b', aviso: { tom: 'erro', titulo: 'Falhou', texto: 'Detalhe do erro' } },
    ]);
    const botao = screen.getByTestId('fc-avisos-botao');
    fireEvent.mouseEnter(botao.parentElement as HTMLElement);
    const painel = screen.getByRole('region', { name: 'Avisos' });
    const itens = painel.querySelectorAll('li');
    expect(itens).toHaveLength(2);
    expect(itens[0]?.textContent).toContain('Falhou');
    expect(itens[0]?.textContent).toContain('Detalhe do erro');
    expect(itens[1]?.textContent).toContain('Informativo');
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseLeave(botao.parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
  });

  it('clique fixa o balao (mouseleave nao fecha) e Esc fecha devolvendo o foco', () => {
    vi.useFakeTimers();
    montar([{ id: 'a', aviso: { tom: 'atencao', titulo: 'Pendentes' } }]);
    const botao = screen.getByTestId('fc-avisos-botao');
    fireEvent.click(botao);
    fireEvent.mouseLeave(botao.parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('region', { name: 'Avisos' })).toBeTruthy();
    fireEvent.keyDown(botao, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  it('a acao chama o callback mais recente e fecha o balao', () => {
    const aoClicar = vi.fn();
    montar([{ id: 'a', aviso: { tom: 'erro', titulo: 'Falhou', acao: { rotulo: 'Tentar de novo', aoClicar } } }]);
    fireEvent.click(screen.getByTestId('fc-avisos-botao'));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
  });

  it('aviso removido some do icone; ao zerar o icone desaparece', () => {
    const { rerender } = montar([{ id: 'a', aviso: { tom: 'info', titulo: 'Informativo' } }]);
    expect(screen.getByTestId('fc-avisos-botao')).toBeTruthy();
    rerender(
      <ProvedorAvisos>
        <ForecastAvisos />
        <Fonte id="a" aviso={null} />
      </ProvedorAvisos>,
    );
    expect(screen.queryByTestId('fc-avisos-botao')).toBeNull();
  });
});
