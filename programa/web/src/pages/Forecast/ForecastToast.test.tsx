import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { DURACAO_TOAST_MS, ForecastToast, SAIDA_TOAST_MS, useToastForecast, type DadosToast } from './ForecastToast';

const SALVO: DadosToast = { id: 1, tipo: 'salvo', titulo: 'Quantidade salva', texto: 'Quantidade fechada de PRODUTO A salva: 2.000 kg.' };
const REMOVIDO: DadosToast = { id: 2, tipo: 'removido', titulo: 'Quantidade removida', texto: 'Quantidade fechada de PRODUTO A removida.' };

function movimentoReduzido(ativo: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: ativo && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // @ts-expect-error jsdom nao tem matchMedia: volta ao estado de antes
  delete window.matchMedia;
});

describe('ForecastToast', () => {
  it('e uma regiao status educada, com titulo, texto, icone e botao de fechar', () => {
    render(<ForecastToast dados={SALVO} onFechar={() => undefined} />);
    const toast = screen.getByRole('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.textContent).toContain('Quantidade salva');
    expect(toast.textContent).toContain('Quantidade fechada de PRODUTO A salva: 2.000 kg.');
    expect(toast.className).toContain('fct--salvo');
    expect(toast.querySelector('.fct__marca')).not.toBeNull(); // o check que se desenha
    expect(screen.getByRole('button', { name: 'Fechar aviso' })).toBeTruthy();
  });

  it('remover usa a lixeira e a variante propria (sem o check)', () => {
    render(<ForecastToast dados={REMOVIDO} onFechar={() => undefined} />);
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('fct--removido');
    expect(toast.querySelector('.fct__marca')).toBeNull();
    expect(toast.textContent).toContain('Quantidade removida');
  });

  it('some sozinho em ~4 s: marca a saida, anima e so depois pede o fechamento', () => {
    const onFechar = vi.fn();
    render(<ForecastToast dados={SALVO} onFechar={onFechar} />);
    act(() => void vi.advanceTimersByTime(DURACAO_TOAST_MS - 1));
    expect(screen.getByRole('status').className).not.toContain('fct--saindo');
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByRole('status').className).toContain('fct--saindo');
    expect(onFechar).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(SAIDA_TOAST_MS));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('o botao fechar sai na hora (com a animacao de saida), sem esperar os 4 s', () => {
    const onFechar = vi.fn();
    render(<ForecastToast dados={SALVO} onFechar={onFechar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    expect(screen.getByRole('status').className).toContain('fct--saindo');
    act(() => void vi.advanceTimersByTime(SAIDA_TOAST_MS));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('pausa com o mouse em cima e retoma de onde parou', () => {
    const onFechar = vi.fn();
    render(<ForecastToast dados={SALVO} onFechar={onFechar} />);
    const toast = screen.getByRole('status');
    act(() => void vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(toast);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(toast.className).not.toContain('fct--saindo');
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(999));
    expect(toast.className).not.toContain('fct--saindo');
    act(() => void vi.advanceTimersByTime(1));
    expect(toast.className).toContain('fct--saindo');
  });

  it('pausa tambem com o foco dentro (teclado) e retoma ao sair', () => {
    render(<ForecastToast dados={SALVO} onFechar={() => undefined} />);
    const toast = screen.getByRole('status');
    fireEvent.focus(screen.getByRole('button', { name: 'Fechar aviso' }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(toast.className).not.toContain('fct--saindo');
    fireEvent.blur(screen.getByRole('button', { name: 'Fechar aviso' }));
    act(() => void vi.advanceTimersByTime(DURACAO_TOAST_MS));
    expect(toast.className).toContain('fct--saindo');
  });

  it('com movimento reduzido nao espera a animacao de saida', () => {
    movimentoReduzido(true);
    const onFechar = vi.fn();
    render(<ForecastToast dados={SALVO} onFechar={onFechar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    act(() => void vi.advanceTimersByTime(0));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('sem reduced-motion espera os ~300 ms da saida', () => {
    movimentoReduzido(false);
    const onFechar = vi.fn();
    render(<ForecastToast dados={SALVO} onFechar={onFechar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    act(() => void vi.advanceTimersByTime(SAIDA_TOAST_MS - 1));
    expect(onFechar).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('a barra de tempo acompanha a duracao informada', () => {
    const { container } = render(<ForecastToast dados={SALVO} onFechar={() => undefined} duracaoMs={2500} />);
    expect((container.querySelector('.fct__barra') as HTMLElement).style.animationDuration).toBe('2500ms');
  });
});

describe('useToastForecast', () => {
  it('um aviso por vez: o novo substitui o anterior (id novo reinicia animacao e tempo) e fechar o remove', () => {
    const { result } = renderHook(() => useToastForecast());
    expect(result.current.toast).toBeNull();
    act(() => result.current.mostrar('salvo', 'Quantidade salva', 'A'));
    const primeiro = result.current.toast;
    expect(primeiro?.texto).toBe('A');
    act(() => result.current.mostrar('removido', 'Quantidade removida', 'B'));
    expect(result.current.toast?.texto).toBe('B');
    expect(result.current.toast?.tipo).toBe('removido');
    expect(result.current.toast?.id).not.toBe(primeiro?.id);
    act(() => result.current.fechar());
    expect(result.current.toast).toBeNull();
  });

  it('trocar o aviso reinicia o tempo (a chave remonta o componente)', () => {
    const onFechar = vi.fn();
    const { rerender } = render(<ForecastToast key={1} dados={SALVO} onFechar={onFechar} />);
    act(() => void vi.advanceTimersByTime(3500));
    rerender(<ForecastToast key={3} dados={{ ...SALVO, id: 3, texto: 'Outro' }} onFechar={onFechar} />);
    act(() => void vi.advanceTimersByTime(3500));
    expect(screen.getByRole('status').className).not.toContain('fct--saindo');
    expect(screen.getByRole('status').textContent).toContain('Outro');
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole('status').className).toContain('fct--saindo');
  });
});
