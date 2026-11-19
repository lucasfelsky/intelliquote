import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ForecastItemRelatorio } from '@/services/forecast';

// Dados 100% sinteticos. Gancho do "Vincular cotacao" / "Trocar cotacao" em ForecastCotar (PR2): quem aparece, ao lado de quem, e o modal
// so montado depois do clique. O modal em si tem teste proprio (ForecastVincularCotacaoModal.test.tsx); aqui ele e um marcador.

const controles = vi.hoisted(() => ({ ctx: null as unknown, decisoes: null as unknown, vinculos: null as unknown }));

vi.mock('./ForecastCriarCotacao', () => ({ useCriarCotacao: () => controles.ctx }));
vi.mock('./ForecastDecisaoCompra', () => ({ useDecisoesDaQuinzena: () => controles.decisoes }));
vi.mock('./ForecastGerarCotacao', () => ({ useVinculosDeCotacao: () => controles.vinculos }));
vi.mock('@/components/InfoPopover', () => ({ InfoPopover: () => null }));
vi.mock('./ForecastVincularCotacaoModal', () => ({
  default: (p: { snapshotId: number; productId: number; nomeItem: string; cotacaoAtual: { id: number } | null; onFechar: () => void }) => (
    <div
      role="dialog"
      aria-label="Vincular cotação"
      data-snapshot={p.snapshotId}
      data-produto={p.productId}
      data-item={p.nomeItem}
      data-atual={p.cotacaoAtual?.id ?? ''}
    >
      <button type="button" onClick={p.onFechar}>
        Fechar marcador
      </button>
    </div>
  ),
}));

import ForecastCotar from './ForecastCotar';

const abrir = vi.fn();
const noRascunho = vi.fn<(id: number) => unknown>(() => undefined);

const contexto = () => ({
  quinzena: '11-1',
  selecionados: new Map(),
  podeSelecionar: () => true,
  motivoSemSelecao: () => null,
  alternar: vi.fn(),
  marcar: vi.fn(),
  limpar: vi.fn(),
  abrir,
  abrirPoDireta: vi.fn(),
  precoFechado: () => undefined,
  hojePrecos: '2026-11-17',
  abrirPreco: vi.fn(),
  noRascunho,
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

const comCotacao = (statusCotacao: 'criada' | 'enviada' | 'fechada' | 'po_enviada') => {
  controles.decisoes = {
    mapa: new Map([[42, { cotacao: { id: 5, requestCode: 'QR-20261117-ABC123', statusCotacao } }]]),
    carregando: false,
    erro: false,
  };
};

const VINCULAR = { name: 'Vincular cotação a PRODUTO SINTETICO A' };
const TROCAR = { name: 'Trocar cotação de PRODUTO SINTETICO A' };

beforeEach(() => {
  vi.clearAllMocks();
  noRascunho.mockImplementation(() => undefined);
  controles.ctx = contexto();
  controles.vinculos = { snapshotId: 7, carregando: false, erro: false, codesDe: () => [] };
  controles.decisoes = { mapa: new Map(), carregando: false, erro: false };
});

describe('ForecastCotar - Vincular cotacao (item no cadastro, sem cotacao)', () => {
  it('mostra "Vincular cotação a <item>" ao lado de "Cotar <item>" (mesmo bloco de acoes)', () => {
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    const cotar = screen.getByRole('button', { name: 'Cotar PRODUTO SINTETICO A' });
    const vincular = screen.getByRole('button', VINCULAR);
    expect(vincular.textContent).toBe('Vincular cotação');
    expect(vincular.getAttribute('aria-haspopup')).toBe('dialog');
    expect(vincular.parentElement).toBe(cotar.parentElement);
    expect(screen.queryByRole('button', { name: /Trocar cotação/ })).toBeNull();
  });

  it('o modal so existe depois do clique, recebe quinzena/produto/item e fecha pelo onFechar', () => {
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', VINCULAR));
    const dialogo = screen.getByRole('dialog', { name: 'Vincular cotação' });
    expect(dialogo.getAttribute('data-snapshot')).toBe('7');
    expect(dialogo.getAttribute('data-produto')).toBe('42');
    expect(dialogo.getAttribute('data-item')).toBe('PRODUTO SINTETICO A');
    expect(dialogo.getAttribute('data-atual')).toBe('');
    expect(abrir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar marcador' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ForecastCotar - Vincular cotacao (quem nao ve)', () => {
  it('sem permissao (useVinculosDeCotacao nulo): nem "Vincular cotação" nem "Trocar cotação", mesmo com cotacao aberta', () => {
    controles.vinculos = null;
    const { unmount } = render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.getByRole('button', { name: 'Cotar PRODUTO SINTETICO A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Vincular cotação|Trocar cotação/ })).toBeNull();
    unmount();

    comCotacao('criada');
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.queryByRole('button', { name: /Vincular cotação|Trocar cotação/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('item sem productId (fora do cadastro): nao oferece o botao', () => {
    render(<ForecastCotar item={linha({ productId: null })} fonte="FONTE A" />);
    expect(screen.queryByRole('button', { name: /Vincular cotação|Trocar cotação/ })).toBeNull();
  });

  it('cotacao FECHADA ligada: nenhum botao de vincular/trocar (so o tracking)', () => {
    comCotacao('fechada');
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.queryByRole('button', { name: /Vincular cotação|Trocar cotação/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Ver cotação QR-20261117-ABC123/ })).toBeTruthy();
  });

  it('com rascunho aberto e cotacao aberta ligada: "Continuar" e sem "Vincular cotação"/"Trocar cotação"', () => {
    comCotacao('criada');
    noRascunho.mockImplementation(() => ({}));
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.getByRole('button', { name: 'Continuar cotação de PRODUTO SINTETICO A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Vincular cotação|Trocar cotação/ })).toBeNull();
  });
});

describe('ForecastCotar - Trocar cotacao (cotacao aberta ligada)', () => {
  it.each(['criada', 'enviada'] as const)('cotacao %s: "Trocar cotação" no lugar de "Vincular", e o modal recebe a cotacao atual', (status) => {
    comCotacao(status);
    render(<ForecastCotar item={linha()} fonte="FONTE A" />);
    expect(screen.queryByRole('button', VINCULAR)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', TROCAR));
    expect(screen.getByRole('dialog', { name: 'Vincular cotação' }).getAttribute('data-atual')).toBe('5');
  });
});
