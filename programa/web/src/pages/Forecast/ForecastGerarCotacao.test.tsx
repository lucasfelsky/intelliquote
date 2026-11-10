import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Forecast from '../Forecast';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import { ProvedorGerarCotacao } from './ForecastGerarCotacao';

// Provedor do vinculo com o catalogo e papeis do "Criar cotacao" (E6): quem pode criar ve a selecao e a acao Cotar; quem so
// le (e o relatorio fora do provedor) nao ve nada e nao consulta o vinculo nem o rascunho. O pop-up em si fica em
// ForecastCriarCotacao.test.tsx.

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

import { api } from '@/api/client';

const get = vi.mocked(api.get);

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

const LINHA_PADRAO = [item({ linha: 4, productId: 42, item: 'PRODUTO 002' })];

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/products') return { data: [produto(41, 'PRODUTO 001'), produto(42, 'PRODUTO 002')] };
    if (path.endsWith('/decisoes')) return { data: { snapshotId: 7, label: '10-2', decisoes: [] } };
    if (path.endsWith('/rascunho-cotacao')) return { data: null };
    if (path.endsWith('/relatorio-compras')) return { data: relatorio(LINHA_PADRAO) };
    return { data: {} };
  });
}

interface Opcoes {
  podeCriar?: boolean;
  semProvedor?: boolean;
}

function renderRelatorio(o: Opcoes = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const relatorioEl = <ForecastRelatorioCompras snapshotId={7} podeEditar={o.podeCriar ?? true} />;
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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const chamadas = (fim: string) => get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith(fim));

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

describe('ProvedorGerarCotacao (vinculo com o catalogo e papeis)', () => {
  it('quem pode criar ve a selecao da linha e a acao Cotar; 1 GET de produtos, de decisoes e de rascunho', async () => {
    mockApi();
    renderRelatorio();
    expect(await screen.findByRole('button', { name: 'Cotar PRODUTO 002' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Selecionar PRODUTO 002' })).toBeTruthy();
    await waitFor(() => expect(chamadas('/rascunho-cotacao')).toHaveLength(1));
    expect(chamadas('/v1/forecast/products')).toHaveLength(1);
    expect(chamadas('/decisoes')).toHaveLength(1);
  });

  it('sem permissao de criar (gestor/viewer): nenhuma selecao, nenhum Cotar e ZERO GET de produtos e de rascunho', async () => {
    mockApi();
    renderRelatorio({ podeCriar: false });
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cotar / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Criar cotação/ })).toBeNull();
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
    expect(chamadas('/rascunho-cotacao')).toHaveLength(0);
  });

  it('sem provedor (relatorio puro): nenhuma selecao, nenhum Cotar e ZERO GET de produtos e de rascunho', async () => {
    mockApi();
    renderRelatorio({ semProvedor: true });
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cotar / })).toBeNull();
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
    expect(chamadas('/rascunho-cotacao')).toHaveLength(0);
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
    if (path.endsWith('/rascunho-cotacao')) return { data: null };
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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Forecast (pagina): selecao e Cotar no relatorio de compras', () => {
  it.each(['comprador', 'admin'])('%s ve a selecao e a acao Cotar e abre o pop-up Criar cotacao', async (role) => {
    mockRole = role;
    mockPagina();
    renderPagina();
    fireEvent.click(await screen.findByRole('button', { name: 'Cotar PRODUTO 002' }));
    expect(await screen.findByRole('heading', { name: 'Criar cotação' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Selecionar PRODUTO 002' })).toBeTruthy();
  });

  it.each(['viewer', 'gestor'])('%s nao ve a selecao nem o Cotar e nao consulta o vinculo nem o rascunho', async (role) => {
    mockRole = role;
    mockPagina();
    renderPagina();
    await screen.findByText('1 item em 1 fonte');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cotar / })).toBeNull();
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
    expect(chamadas('/rascunho-cotacao')).toHaveLength(0);
  });
});
