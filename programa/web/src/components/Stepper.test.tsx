import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Stepper } from './Stepper';

const PASSOS = ['Cotação', 'Itens do catálogo'] as const;

function renderStepper(current: number, steps: readonly string[] = PASSOS) {
  return render(<Stepper ariaLabel="Etapas da nova cotação" steps={steps} current={current} />);
}

describe('Stepper', () => {
  it('e uma section com o nome acessivel recebido e uma lista ordenada de passos', () => {
    renderStepper(0);
    const regiao = screen.getByRole('region', { name: 'Etapas da nova cotação' });
    expect(regiao.tagName).toBe('SECTION');
    expect(regiao.classList.contains('stepper')).toBe(true);
    expect(within(regiao).getByRole('list').tagName).toBe('OL');
    expect(within(regiao).getAllByRole('listitem')).toHaveLength(2);
  });

  it('aria-current=step so no passo atual (passo 1)', () => {
    const { container } = renderStepper(0);
    const atuais = container.querySelectorAll('[aria-current]');
    expect(atuais).toHaveLength(1);
    expect(atuais[0]?.getAttribute('aria-current')).toBe('step');
    expect(atuais[0]?.textContent).toBe('1Cotação');
    expect(atuais[0]?.classList.contains('stepper__passo--atual')).toBe(true);
  });

  it('passo 2: o 1 vira feito (icone check aria-hidden, sem numero) e o atual e o 2', () => {
    const { container } = renderStepper(1);
    const feito = container.querySelector('.stepper__passo--feito') as HTMLElement;
    expect(feito).not.toBeNull();
    expect(feito.textContent).toBe('Cotação');
    const icone = feito.querySelector('svg');
    expect(icone?.getAttribute('aria-hidden')).toBe('true');
    expect(icone?.querySelector('path')?.getAttribute('d')).toBe('m5 12 5 5 9-10');
    expect(feito.hasAttribute('aria-current')).toBe(false);
    const atual = container.querySelector('[aria-current="step"]') as HTMLElement;
    expect(atual.textContent).toBe('2Itens do catálogo');
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('passo pendente mostra o numero e nao tem icone', () => {
    const { container } = renderStepper(0);
    const pendente = container.querySelector('.stepper__passo--pendente') as HTMLElement;
    expect(pendente.textContent).toBe('2Itens do catálogo');
    expect(pendente.querySelector('svg')).toBeNull();
    expect(pendente.hasAttribute('aria-current')).toBe(false);
  });

  it('as ligacoes entre passos sao aria-hidden e a ligacao depois de um passo feito e marcada', () => {
    const { container, rerender } = renderStepper(0);
    let ligacoes = container.querySelectorAll('.stepper__ligacao');
    expect(ligacoes).toHaveLength(1);
    expect(ligacoes[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(ligacoes[0]?.classList.contains('stepper__ligacao--feita')).toBe(false);
    rerender(<Stepper ariaLabel="Etapas da nova cotação" steps={PASSOS} current={1} />);
    ligacoes = container.querySelectorAll('.stepper__ligacao');
    expect(ligacoes[0]?.classList.contains('stepper__ligacao--feita')).toBe(true);
    // o leitor de tela so percorre os 2 passos (as ligacoes nao entram na arvore de acessibilidade)
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('aceita mais de 2 passos: N-1 ligacoes e os anteriores ao atual ficam feitos', () => {
    const { container } = renderStepper(2, ['A', 'B', 'C', 'D']);
    expect(container.querySelectorAll('.stepper__ligacao')).toHaveLength(3);
    expect(container.querySelectorAll('.stepper__passo--feito')).toHaveLength(2);
    expect(container.querySelectorAll('.stepper__passo--atual')).toHaveLength(1);
    expect(container.querySelectorAll('.stepper__passo--pendente')).toHaveLength(1);
  });

  it('sem style inline e sem o glifo de seta', () => {
    const { container } = renderStepper(1);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    expect(container.textContent).not.toContain('→');
  });
});
