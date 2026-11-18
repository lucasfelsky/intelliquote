import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { PrecoFechadoDoItem } from '@/services/forecastPrecoFechado';

// Dados 100% sinteticos. Todo perfil ve o selo; so quem edita ve o valor e os termos.

const controles = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('./ForecastCriarCotacao', () => ({ useCriarCotacao: () => controles.ctx }));

import { PrecoFechadoNoDetalhe, SeloPrecoFechado } from './ForecastPrecoFechadoSelo';

const abrirPreco = vi.fn();
const precos = new Map<number, PrecoFechadoDoItem>();

const item = (over: Partial<ForecastItemRelatorio> = {}) =>
  ({ linha: 3, n: 1, productId: 42, item: 'PRODUTO SINTETICO A', codigos: ['C0001'], status: 'nao', quantidadeFinal: 25000, precoFixo: true, ...over }) as unknown as ForecastItemRelatorio;

const preco = (over: Partial<PrecoFechadoDoItem> = {}): PrecoFechadoDoItem => ({
  productId: 42,
  estado: 'ok',
  valorPorKg: 1.8425,
  moeda: 'USD',
  incoterm: 'CFR',
  validoAte: '2026-12-31',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  precos.clear();
  controles.ctx = { precoFechado: (id: number) => precos.get(id), hojePrecos: '2026-11-17', abrirPreco };
});

describe('SeloPrecoFechado', () => {
  it('sem precoFixo na linha: nada', () => {
    const { container } = render(<SeloPrecoFechado item={item({ precoFixo: false })} />);
    expect(container.textContent).toBe('');
  });

  it('quem so le (sem provedor): so o selo, sem valor', () => {
    controles.ctx = null;
    render(<SeloPrecoFechado item={item()} />);
    expect(screen.getByText('Preço fechado')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/US\$|\/kg|1,84/);
  });

  it('quem edita, preco ok: valor, moeda e dica com incoterm e validade', () => {
    precos.set(42, preco());
    render(<SeloPrecoFechado item={item()} />);
    expect(screen.getByText(/US\$ 1,8425\/kg/)).toBeTruthy();
    expect(screen.getByTitle('CFR · válido até 31/12/2026')).toBeTruthy();
  });

  it('sem valor e vencido tem selos proprios (aviso e perigo)', () => {
    precos.set(42, preco({ estado: 'sem_valor', valorPorKg: null, moeda: null, incoterm: null, validoAte: null }));
    const { rerender } = render(<SeloPrecoFechado item={item()} />);
    expect(screen.getByText('Preço fechado sem valor').className).toContain('badge--warning');
    precos.set(42, preco({ estado: 'vencido', validoAte: '2026-10-31' }));
    rerender(<SeloPrecoFechado item={item()} />);
    expect(screen.getByText('Preço fechado vencido').className).toContain('badge--danger');
  });

  it('editor com a lista de precos ainda sem esse item: selo simples', () => {
    render(<SeloPrecoFechado item={item()} />);
    expect(screen.getByText('Preço fechado')).toBeTruthy();
  });
});

describe('PrecoFechadoNoDetalhe', () => {
  it('quem so le: nada', () => {
    controles.ctx = null;
    const { container } = render(<PrecoFechadoNoDetalhe item={item()} />);
    expect(container.textContent).toBe('');
  });

  it('item sem selo ou sem productId: nada', () => {
    precos.set(42, preco());
    expect(render(<PrecoFechadoNoDetalhe item={item({ precoFixo: false })} />).container.textContent).toBe('');
    expect(render(<PrecoFechadoNoDetalhe item={item({ productId: null })} />).container.textContent).toBe('');
  });

  it('preco ok: mostra os termos e "Editar preco", que abre o cadastro com o botao de origem', () => {
    precos.set(42, preco());
    render(<PrecoFechadoNoDetalhe item={item()} />);
    expect(screen.getByText(/US\$ 1,8425\/kg/)).toBeTruthy();
    expect(screen.getByText('CFR')).toBeTruthy();
    expect(screen.getByText(/válido até 31\/12\/2026/)).toBeTruthy();
    const botao = screen.getByRole('button', { name: 'Editar preço de PRODUTO SINTETICO A' });
    fireEvent.click(botao);
    expect(abrirPreco).toHaveBeenCalledWith(expect.objectContaining({ productId: 42 }), botao);
  });

  it('sem valor: explica e oferece "Definir preco"; vencido: data e "Atualizar preco"', () => {
    precos.set(42, preco({ estado: 'sem_valor', valorPorKg: null, moeda: null, incoterm: null, validoAte: null }));
    const { unmount } = render(<PrecoFechadoNoDetalhe item={item()} />);
    expect(screen.getByText(/Falta cadastrar o preço/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Definir preço de PRODUTO SINTETICO A' })).toBeTruthy();
    unmount();
    precos.set(42, preco({ estado: 'vencido', validoAte: '2026-10-31' }));
    render(<PrecoFechadoNoDetalhe item={item()} />);
    expect(screen.getByText('Venceu em 31/10/2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atualizar preço de PRODUTO SINTETICO A' })).toBeTruthy();
  });

  it('cadastro ainda carregando: aviso e sem botao', () => {
    render(<PrecoFechadoNoDetalhe item={item()} />);
    expect(screen.getByText('Carregando o cadastro do preço…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
