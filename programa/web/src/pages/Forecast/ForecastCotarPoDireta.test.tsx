import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ForecastItemRelatorio } from '@/services/forecast';

// Dados 100% sinteticos. O botao "Enviar PO" so existe para item de preco fechado e para quem pode criar cotacao.

const controles = vi.hoisted(() => ({ ctx: null as unknown, decisoes: null as unknown }));

vi.mock('./ForecastCriarCotacao', () => ({ useCriarCotacao: () => controles.ctx }));
vi.mock('./ForecastDecisaoCompra', () => ({ useDecisoesDaQuinzena: () => controles.decisoes }));
vi.mock('@/components/InfoPopover', () => ({ InfoPopover: () => null }));

import ForecastCotar from './ForecastCotar';

const abrir = vi.fn();
const abrirPoDireta = vi.fn();

const contexto = () => ({
  quinzena: '11-1',
  selecionados: new Map(),
  podeSelecionar: () => true,
  motivoSemSelecao: () => null,
  alternar: vi.fn(),
  marcar: vi.fn(),
  limpar: vi.fn(),
  abrir,
  abrirPoDireta,
  noRascunho: () => undefined,
  rascunho: undefined,
});

const linha = (over: Partial<ForecastItemRelatorio> = {}) =>
  ({
    linha: 3,
    n: 1,
    productId: 42,
    item: 'PRODUTO SINTETICO A',
    codigos: ['C0001'],
    status: 'nao',
    quantidadeFinal: 25000,
    ...over,
  }) as unknown as ForecastItemRelatorio;

beforeEach(() => {
  vi.clearAllMocks();
  controles.ctx = contexto();
  controles.decisoes = { mapa: new Map(), carregando: false, erro: false };
});

describe('ForecastCotar - Enviar PO (preco fechado)', () => {
  it('item de preco fechado: mostra "Enviar PO" ao lado de "Cotar" e abre o modal com o item e o botao de origem', () => {
    render(<ForecastCotar item={linha({ precoFixo: true })} fonte="FONTE A" />);
    expect(screen.getByRole('button', { name: 'Cotar PRODUTO SINTETICO A' })).toBeTruthy();
    const botao = screen.getByRole('button', { name: 'Enviar PO de PRODUTO SINTETICO A' });
    fireEvent.click(botao);
    expect(abrirPoDireta).toHaveBeenCalledTimes(1);
    expect(abrirPoDireta.mock.calls[0]![0]).toMatchObject({ productId: 42, precoFixo: true });
    expect(abrirPoDireta.mock.calls[0]![1]).toBe(botao);
    expect(abrir).not.toHaveBeenCalled();
  });

  it('item sem preco fechado: so "Cotar"', () => {
    render(<ForecastCotar item={linha({ precoFixo: false })} fonte="FONTE A" />);
    expect(screen.getByRole('button', { name: 'Cotar PRODUTO SINTETICO A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enviar PO/ })).toBeNull();
  });

  it('backend antigo (sem precoFixo): so "Cotar"', () => {
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.queryByRole('button', { name: /Enviar PO/ })).toBeNull();
  });

  it('quem so le (sem permissao de cotar) nunca ve "Enviar PO"', () => {
    controles.ctx = null;
    render(<ForecastCotar item={linha({ precoFixo: true })} fonte="FONTE A" />);
    expect(screen.queryByRole('button', { name: /Enviar PO|Cotar/ })).toBeNull();
  });

  it('item fora do cadastro (sem productId): nao oferece PO direta', () => {
    render(<ForecastCotar item={linha({ precoFixo: true, productId: null })} fonte="FONTE A" />);
    expect(screen.queryByRole('button', { name: /Enviar PO/ })).toBeNull();
  });

  it('com cotacao vinculada e sem rascunho: mantem "Enviar PO" junto dos links', () => {
    controles.decisoes = {
      mapa: new Map([[42, { cotacao: { id: 5, requestCode: 'QR-20261117-ABC123', statusCotacao: 'enviada' } }]]),
      carregando: false,
      erro: false,
    };
    render(<ForecastCotar item={linha({ precoFixo: true })} fonte="FONTE A" />);
    expect(screen.getByRole('button', { name: 'Enviar PO de PRODUTO SINTETICO A' })).toBeTruthy();
  });
});
