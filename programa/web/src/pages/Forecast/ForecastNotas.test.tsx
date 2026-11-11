import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ForecastNotasIcone, { ProvedorNotas, useNotas, type NotaForecast } from './ForecastNotas';

function Fonte({ id, nota }: { id: string; nota: Omit<NotaForecast, 'id'> | null }) {
  const noIcone = useNotas(id, nota);
  return <p data-testid={`corpo-${id}`}>{noIcone ? 'no icone' : (nota?.texto ?? '')}</p>;
}

const PENDENTES = 'Pendentes de cadastro: nenhum código com venda nos últimos 3 meses, programação ou compra em aberto no FUP fora do cadastro nesta quinzena.';
const SEM_VENDA = 'Sem venda nos últimos 3 meses (não listados): 25 códigos · 8.230 kg de venda anual';
const AMOSTRAS = 'Amostras ignoradas (prefixo AM): 16 códigos';

function montar(notas: Array<{ id: string; nota: Omit<NotaForecast, 'id'> | null }>) {
  return render(
    <ProvedorNotas>
      <ForecastNotasIcone />
      {notas.map((n) => (
        <Fonte key={n.id} id={n.id} nota={n.nota} />
      ))}
    </ProvedorNotas>,
  );
}

const TRES = [
  { id: 'amostras', nota: { texto: AMOSTRAS, tom: 'neutro' as const } },
  { id: 'pendentes', nota: { texto: PENDENTES, tom: 'atencao' as const } },
  { id: 'sem-venda', nota: { texto: SEM_VENDA, tom: 'neutro' as const } },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ForecastNotas', () => {
  it('sem nota nao desenha o icone', () => {
    montar([{ id: 'pendentes', nota: null }]);
    expect(screen.queryByTestId('fc-notas-botao')).toBeNull();
    expect(screen.queryByTestId('fc-notas-texto')).toBeNull();
  });

  it('fora do provedor o hook devolve false (a frase segue no corpo da tela)', () => {
    render(<Fonte id="pendentes" nota={{ texto: PENDENTES, tom: 'atencao' }} />);
    expect(screen.getByTestId('corpo-pendentes').textContent).toBe(PENDENTES);
  });

  it('com notas: um icone com selo de contagem, e as frases saem do corpo da tela', () => {
    montar(TRES);
    const botao = screen.getByTestId('fc-notas-botao');
    expect(botao.getAttribute('aria-label')).toBe('Notas da quinzena: 3');
    expect(botao.querySelector('.fcnt__conta')?.textContent).toBe('3');
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    for (const { id } of TRES) expect(screen.getByTestId(`corpo-${id}`).textContent).toBe('no icone');
  });

  it('os textos exatos seguem no DOM (lista para leitor de tela e papel), na ordem de leitura fixa', () => {
    montar(TRES);
    const itens = within(screen.getByTestId('fc-notas-texto')).getAllByRole('listitem');
    expect(itens.map((li) => li.textContent)).toEqual([PENDENTES, SEM_VENDA, AMOSTRAS]);
  });

  it('o balao abre ao passar o mouse e lista as notas com o titulo', () => {
    montar(TRES);
    const botao = screen.getByTestId('fc-notas-botao');
    expect(screen.queryByTestId('fc-notas-balao')).toBeNull();
    fireEvent.mouseEnter(botao);
    const balao = screen.getByTestId('fc-notas-balao');
    expect(balao.getAttribute('role')).toBe('tooltip');
    expect(balao.textContent).toContain('Notas da quinzena');
    expect(within(balao).getAllByRole('listitem').map((li) => li.textContent)).toEqual([PENDENTES, SEM_VENDA, AMOSTRAS]);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
  });

  it('abre tambem pelo foco e pelo clique, e fecha com Esc', () => {
    montar(TRES);
    const botao = screen.getByTestId('fc-notas-botao');
    fireEvent.focus(botao);
    expect(screen.getByTestId('fc-notas-balao')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('fc-notas-balao')).toBeNull();
    fireEvent.click(botao);
    expect(screen.getByTestId('fc-notas-balao')).toBeTruthy();
  });

  it('a contagem e as frases acompanham o registro (some uma nota, o selo cai; sem nenhuma, o icone some)', () => {
    const { rerender } = montar(TRES);
    rerender(
      <ProvedorNotas>
        <ForecastNotasIcone />
        <Fonte id="pendentes" nota={{ texto: PENDENTES, tom: 'atencao' }} />
        <Fonte id="sem-venda" nota={null} />
        <Fonte id="amostras" nota={null} />
      </ProvedorNotas>,
    );
    expect(screen.getByTestId('fc-notas-botao').getAttribute('aria-label')).toBe('Notas da quinzena: 1');
    expect(within(screen.getByTestId('fc-notas-texto')).getAllByRole('listitem')).toHaveLength(1);
    rerender(
      <ProvedorNotas>
        <ForecastNotasIcone />
        <Fonte id="pendentes" nota={null} />
      </ProvedorNotas>,
    );
    expect(screen.queryByTestId('fc-notas-botao')).toBeNull();
  });

  it('o balao fica aberto e atualizado quando uma nota muda de texto', () => {
    const { rerender } = montar([{ id: 'amostras', nota: { texto: AMOSTRAS, tom: 'neutro' } }]);
    fireEvent.mouseEnter(screen.getByTestId('fc-notas-botao'));
    act(() => {
      rerender(
        <ProvedorNotas>
          <ForecastNotasIcone />
          <Fonte id="amostras" nota={{ texto: 'Amostras ignoradas (prefixo AM): 3 códigos', tom: 'neutro' }} />
        </ProvedorNotas>,
      );
    });
    expect(screen.getByTestId('fc-notas-balao').textContent).toContain('Amostras ignoradas (prefixo AM): 3 códigos');
  });
});
