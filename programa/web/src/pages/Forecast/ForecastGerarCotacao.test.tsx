import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ForecastDadosDoGrupo } from '@/services/forecast';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import Forecast from '../Forecast';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import { ProvedorGerarCotacao } from './ForecastGerarCotacao';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import { api, ApiError } from '@/api/client';

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

// Dados 100% sinteticos.
function item(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    productId: 41,
    item: 'PRODUTO 001',
    codigos: ['C0001'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 125,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  };
}

function relatorio(itens: Array<Record<string, unknown>>) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: itens.length, fontes: 1, vencidas: 0, semEmbalagem: itens.length, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [{ fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: '2026-10-22', vencidas: 0, itens }],
  };
}

function produto(id: number, name: string, catalogItemId: number | null = id + 100) {
  return {
    id,
    name,
    isActive: true,
    source: { id: 1, name: 'FONTE 001' },
    codes: [
      {
        id: id * 10,
        position: 1,
        code: `C${String(id).padStart(4, '0')}`,
        catalogItemId,
        catalogItem: catalogItemId === null ? null : { id: catalogItemId, commercialName: `ITEM ${id}`, marketName: `MERCADO ${id}` },
      },
    ],
  };
}

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 1234.5,
    status: 'confirmado',
    observacao: null,
    sugeridaKg: 125,
    demandaKg: -40,
    decididaPorId: 3,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

interface Cenario {
  itens?: Array<Record<string, unknown>>;
  produtos?: unknown[];
  decisoes?: ForecastDecisao[];
  produtosErro?: boolean;
}

const LINHA_PADRAO = [item({ linha: 4, productId: 42, item: 'PRODUTO 002' })];

function mockApi(c: Cenario = {}) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/products') {
      if (c.produtosErro) throw new ApiError(500, null);
      return { data: c.produtos ?? [produto(41, 'PRODUTO 001'), produto(42, 'PRODUTO 002')] };
    }
    if (path.endsWith('/decisoes')) return { data: { snapshotId: 7, label: '10-2', decisoes: c.decisoes ?? [] } };
    if (path.endsWith('/relatorio-compras')) return { data: relatorio(c.itens ?? LINHA_PADRAO) };
    return { data: {} };
  });
}

function Destino() {
  return <div data-testid="destino">{useLocation().search}</div>;
}

interface Opcoes {
  podeCriar?: boolean;
  podeEditar?: boolean;
  semProvedor?: boolean;
}

function renderRelatorio(o: Opcoes = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const relatorioEl = <ForecastRelatorioCompras snapshotId={7} podeEditar={o.podeEditar ?? false} />;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Routes>
          <Route
            path="/forecast"
            element={
              o.semProvedor ? (
                relatorioEl
              ) : (
                <ProvedorGerarCotacao snapshotId={7} podeCriar={o.podeCriar ?? true}>
                  {relatorioEl}
                </ProvedorGerarCotacao>
              )
            }
          />
          <Route path="/cotacoes/nova" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const chamadas = (fim: string) => get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith(fim));
const botao = (nome = 'PRODUTO 002') => screen.findByRole('button', { name: `Gerar cotação de ${nome}` });

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

describe('ForecastGerarCotacao (botao da linha)', () => {
  it('clique leva para /cotacoes/nova?fromForecast=<quinzena>-<produto> (SPA)', async () => {
    mockApi({ decisoes: [decisao({ productId: 42, quantidadeKg: 300 })] });
    renderRelatorio();
    const b = await botao();
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(b);
    expect((await screen.findByTestId('destino')).textContent).toBe('?fromForecast=7-42');
  });

  it('o botao nao tem role="alert" e fica na celula da decisao', async () => {
    mockApi();
    renderRelatorio();
    const b = await botao();
    expect(b.closest('td')?.className).toContain('fdec-celula');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('sem permissao de criar (gestor/viewer): nenhum botao e ZERO GET de produtos', async () => {
    mockApi();
    renderRelatorio({ podeCriar: false });
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('button', { name: /Gerar cotação/ })).toBeNull();
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
  });

  it('sem provedor (relatorio puro): nenhum botao e ZERO GET de produtos', async () => {
    mockApi();
    renderRelatorio({ semProvedor: true });
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('button', { name: /Gerar cotação/ })).toBeNull();
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
  });

  it('varias linhas: exatamente 1 GET de produtos e 1 GET de decisoes (deduplicado)', async () => {
    mockApi({
      itens: [
        item({ linha: 3, productId: 41, item: 'PRODUTO 001' }),
        item({ linha: 4, productId: 42, item: 'PRODUTO 002' }),
        item({ linha: 5, productId: 43, item: 'PRODUTO 003' }),
      ],
      produtos: [produto(41, 'PRODUTO 001'), produto(42, 'PRODUTO 002'), produto(43, 'PRODUTO 003')],
    });
    renderRelatorio();
    await screen.findByRole('button', { name: 'Gerar cotação de PRODUTO 003' });
    expect(screen.getAllByRole('button', { name: /^Gerar cotação de/ })).toHaveLength(3);
    await waitFor(() => expect(chamadas('/decisoes')).toHaveLength(1));
    expect(chamadas('/v1/forecast/products')).toHaveLength(1);
  });

  describe.each([
    ['item fora do cadastro (productId nulo)', { itens: [item({ linha: 4, productId: null, item: 'PRODUTO 002' })] }, 'Item fora do cadastro do Forecast.'],
    [
      'produto sem codigo vinculado ao catalogo',
      { produtos: [produto(42, 'PRODUTO 002', null)] },
      'Nenhum código deste produto está vinculado a um item do catálogo.',
    ],
    [
      'decisao salva = 0 (nao comprar)',
      { decisoes: [decisao({ productId: 42, quantidadeKg: 0 })] },
      'A decisão salva desta quinzena é não comprar (0 kg).',
    ],
    [
      'sem decisao e Qtd. final 0',
      { itens: [item({ linha: 4, productId: 42, item: 'PRODUTO 002', quantidadeFinal: 0 })] },
      'Sem quantidade a comprar nesta quinzena.',
    ],
  ] as Array<[string, Cenario, string]>)('desabilitado: %s', (_nome, cenario, texto) => {
    it('aria-disabled, motivo ligado por aria-describedby, foco e clique nao navegam', async () => {
      mockApi(cenario);
      renderRelatorio();
      const b = await screen.findByRole('button', { name: 'Gerar cotação de PRODUTO 002' });
      await waitFor(() => expect(b.getAttribute('aria-describedby')).not.toBeNull());
      await waitFor(() => expect(document.getElementById(b.getAttribute('aria-describedby') as string)?.textContent).toBe(texto));
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect((b as HTMLButtonElement).disabled).toBe(false);
      b.focus();
      expect(document.activeElement).toBe(b);
      fireEvent.click(b);
      expect(screen.queryByTestId('destino')).toBeNull();
      expect(screen.getByRole('button', { name: 'Gerar cotação de PRODUTO 002' })).toBe(b);
    });
  });

  it('decisao > 0 com Qtd. final 0: habilitado', async () => {
    mockApi({
      itens: [item({ linha: 4, productId: 42, item: 'PRODUTO 002', quantidadeFinal: 0 })],
      decisoes: [decisao({ productId: 42, quantidadeKg: 10 })],
    });
    renderRelatorio();
    const b = await botao();
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull());
    expect(b.getAttribute('aria-describedby')).toBeNull();
  });

  it('enquanto verifica o vinculo, mostra o motivo de espera e depois habilita', async () => {
    mockApi();
    const base = get.getMockImplementation() as (path: string) => Promise<unknown>;
    let liberar: () => void = () => {};
    const espera = new Promise<void>((r) => (liberar = r));
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/products') await espera;
      return base(path);
    });
    renderRelatorio();
    const b = await botao();
    expect(await screen.findByText('Verificando o vínculo com o catálogo…')).toBeTruthy();
    expect(b.getAttribute('aria-disabled')).toBe('true');
    liberar();
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull());
    expect(screen.queryByText('Verificando o vínculo com o catálogo…')).toBeNull();
  });

  it('salvar a decisao 0 na mesma linha desabilita o botao sem recarregar', async () => {
    mockApi({ decisoes: [decisao({ productId: 42, quantidadeKg: 300 })] });
    put.mockResolvedValue({ data: { acao: 'update', decisao: decisao({ productId: 42, quantidadeKg: 0 }) } });
    renderRelatorio({ podeEditar: true });
    const b = await botao();
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull());

    fireEvent.change(await screen.findByLabelText('Qtd. decidida (kg) de PRODUTO 002'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar decisão de PRODUTO 002' }));

    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBe('true'));
    expect(document.getElementById(b.getAttribute('aria-describedby') as string)?.textContent).toBe(
      'A decisão salva desta quinzena é não comprar (0 kg).',
    );
    expect(chamadas('/decisoes')).toHaveLength(1);
  });

  it('GET de produtos falha (500): motivo visivel, sem alerta', async () => {
    mockApi({ produtosErro: true });
    renderRelatorio();
    const b = await botao();
    await waitFor(() => expect(b.getAttribute('aria-describedby')).not.toBeNull());
    expect(await screen.findByText('Não foi possível verificar o vínculo com o catálogo. Recarregue a página.')).toBeTruthy();
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('linha de grupo de equivalencia cota o produto PRINCIPAL do grupo', async () => {
    const grupo: ForecastDadosDoGrupo = {
      id: 10,
      nome: 'GRUPO SINTETICO',
      principalProductId: 42,
      principalItem: 'PRODUTO 002',
      membros: [
        {
          linha: 4,
          productId: 42,
          item: 'PRODUTO 002',
          codigos: ['C0042'],
          fonte: 'FONTE 001',
          principal: true,
          estoque: 0,
          chegadas: 0,
          programado: 0,
          mediaTrimestral: 100,
          demandaIndividual: -300,
          semLeadTime: false,
          obs: '',
        },
        {
          linha: 5,
          productId: 43,
          item: 'PRODUTO 003',
          codigos: ['C0043'],
          fonte: 'FONTE 001',
          principal: false,
          estoque: 100,
          chegadas: 0,
          programado: 0,
          mediaTrimestral: 50,
          demandaIndividual: -70,
          semLeadTime: false,
          obs: '',
        },
      ],
      estoque: 100,
      chegadas: 0,
      programado: 0,
      mediaTrimestral: 150,
      seguranca: 300,
      demanda: -150,
      cobertura: 2,
    };
    mockApi({
      itens: [item({ linha: 4, productId: 42, item: 'GRUPO SINTETICO', quantidadeFinal: 150, grupo })],
      produtos: [produto(42, 'PRODUTO 002'), produto(43, 'PRODUTO 003')],
    });
    renderRelatorio();
    const b = await screen.findByRole('button', { name: 'Gerar cotação de GRUPO SINTETICO' });
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(b);
    expect((await screen.findByTestId('destino')).textContent).toBe('?fromForecast=7-42');
  });
});

// ---------- pagina Forecast (o provedor e montado em Forecast.tsx) ----------

const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function mockPagina() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') {
      return {
        data: [
          { id: 7, label: '10-2', baseDate: '2026-10-15T00:00:00.000Z', half: 2, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-10-20T12:00:00.000Z' },
        ],
      };
    }
    if (path === '/v1/forecast/snapshots/7') {
      return {
        data: {
          id: 7,
          label: '10-2',
          baseDate: '2026-10-15',
          half: 2,
          origin: 'planilha',
          hoje: '2026-10-20',
          months: MONTHS,
          files: [],
          createdAt: '2026-10-20T12:00:00.000Z',
          linhas: [],
          conferencia: null,
        },
      };
    }
    if (path === '/v1/forecast/products') return { data: [produto(42, 'PRODUTO 002')] };
    if (path.endsWith('/decisoes')) return { data: { snapshotId: 7, label: '10-2', decisoes: [] } };
    if (path.endsWith('/relatorio-compras')) return { data: relatorio(LINHA_PADRAO) };
    return { data: {} };
  });
}

function renderPagina() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast?visao=compras']}>
        <Routes>
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/cotacoes/nova" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Forecast (pagina): botao Gerar cotacao no relatorio de compras', () => {
  it.each(['comprador', 'admin'])('%s ve o botao e navega para o formulario', async (role) => {
    mockRole = role;
    mockPagina();
    renderPagina();
    const b = await botao();
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(b);
    expect((await screen.findByTestId('destino')).textContent).toBe('?fromForecast=7-42');
  });

  it.each(['viewer', 'gestor'])('%s nao ve o botao e nao consulta o vinculo', async (role) => {
    mockRole = role;
    mockPagina();
    renderPagina();
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('button', { name: /Gerar cotação/ })).toBeNull();
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
  });
});
