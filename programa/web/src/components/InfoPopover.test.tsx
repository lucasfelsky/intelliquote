import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InfoPopover } from './InfoPopover';

function renderPopover() {
  return render(
    <InfoPopover
      label="Qtd divergente: ver itens"
      trigger={<>Qtd divergente</>}
      testId="chip"
      contentTestId="content"
    >
      <p>Detalhes da divergência</p>
    </InfoPopover>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('InfoPopover', () => {
  it('fechado: sem tooltip e aria-expanded=false', () => {
    renderPopover();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('chip').getAttribute('aria-expanded')).toBe('false');
  });

  it('mouseEnter abre (aria-describedby = id) e mouseLeave fecha', () => {
    vi.useFakeTimers();
    renderPopover();
    const chip = screen.getByTestId('chip');
    fireEvent.mouseEnter(chip);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('Detalhes da divergência');
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(chip.getAttribute('aria-describedby')).toBe(tooltip.id);
    fireEvent.mouseLeave(chip);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('mouse que passa do chip para o popover mantém aberto', () => {
    vi.useFakeTimers();
    renderPopover();
    const chip = screen.getByTestId('chip');
    fireEvent.mouseEnter(chip);
    fireEvent.mouseLeave(chip);
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
  });

  it('focus abre e blur fecha', () => {
    vi.useFakeTimers();
    renderPopover();
    const chip = screen.getByTestId('chip');
    fireEvent.focus(chip);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.blur(chip);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('fixado por teclado/clique: blur (Tab para fora) fecha', () => {
    renderPopover();
    const chip = screen.getByTestId('chip');
    fireEvent.focus(chip);
    fireEvent.click(chip);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.blur(chip);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });

  it('click fixa: mouseLeave não fecha; segundo click fecha', () => {
    vi.useFakeTimers();
    renderPopover();
    const chip = screen.getByTestId('chip');
    fireEvent.click(chip);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.mouseLeave(chip);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.click(chip);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Escape fecha e devolve o foco ao botão', () => {
    renderPopover();
    const chip = screen.getByTestId('chip');
    fireEvent.click(chip);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('pointerDown fora fecha; dentro do popover não fecha', () => {
    renderPopover();
    fireEvent.click(screen.getByTestId('chip'));
    fireEvent.pointerDown(screen.getByRole('tooltip'));
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('posiciona dentro da viewport (clamp à direita e inversão para cima)', () => {
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;
    let buttonRect = { left: innerWidth - 20, top: 100, bottom: 120, right: innerWidth, width: 20, height: 20 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect =
        this.getAttribute('role') === 'tooltip'
          ? { left: 0, top: 0, bottom: 80, right: 300, width: 300, height: 80 }
          : buttonRect;
      return { ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect;
    });
    renderPopover();
    fireEvent.click(screen.getByTestId('chip'));
    let tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.left).toBe(`${innerWidth - 300 - 8}px`);
    expect(tooltip.style.top).toBe('126px');
    expect(tooltip.style.visibility).toBe('visible');

    cleanup();
    buttonRect = { left: 40, top: innerHeight - 30, bottom: innerHeight - 10, right: 100, width: 60, height: 20 };
    renderPopover();
    fireEvent.click(screen.getByTestId('chip'));
    tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.top).toBe(`${innerHeight - 30 - 80 - 6}px`);
  });
});
