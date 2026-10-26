import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from '../Forecast';
import ForecastImportModal from './ForecastImportModal';
import { NOTA_DBCORP_CONFIRMACAO, NOTA_PLANILHA_ADMIN } from './forecastImport';
import { NOTA_DBCORP_SEM_TESTE } from './forecastModoTeste';

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
const post = vi.mocked(api.post);

// ---------- dados 100% sinteticos ----------
function resumoPlanilha() {
  return {
    label: '12-2',
    baseDate: '2026-12-15',
    half: 2,
    produtos: { total: 3, novos: 1, alterados: 1, inativados: 0 },
    codigos: { total: 4, vinculadosCatalogo: 2, movidos: 0 },
    fontes: { total: 2, novas: 0, alteradas: 1, comFornecedor: 1 },
    historico: { yearMonth: '2026-11', linhas: 5, novas: 1, alteradas: 2, removidas: 0 },
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
    avisos: [],
    erros: [],
  };
}

const arquivo = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome);
const SLOTS_2A = ['saldo', 'vendasMes', 'vendasAtual', 'vendasAnual', 'programacao', 'fup'];
const TESTE = /Importar como teste/;

function renderModal(somenteDbcorp?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ForecastImportModal
        aberto
        onFechar={vi.fn()}
        quinzenasExistentes={['10-2', '11-1']}
        onImportada={vi.fn()}
        somenteDbcorp={somenteDbcorp}
      />
    </QueryClientProvider>,
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function preencherComuns() {
  fireEvent.change(screen.getByLabelText('Data-base'), { target: { value: '2026-12-15' } });
  fireEvent.click(screen.getByLabelText('2ª'));
}

const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement;
const slot = (id: string) => document.querySelector(`#fci-slot-${id}`) as HTMLInputElement | null;

async function abrirModalNaPagina() {
  get.mockImplementation(async () => ({ data: [] }));
  renderPage();
  const abrir = await screen.findByRole('button', { name: 'Importar quinzena' });
  fireEvent.click(abrir);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  post.mockReset();
  mockRole = 'comprador';
});

describe('Importar quinzena - planilha so para admin (modal)', () => {
  it('somenteDbcorp: sem barra de abas nem planilha; so os relatorios DBCorp com a nota da confirmacao', () => {
    renderModal(true);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.queryByText('Planilha (.xlsx)')).toBeNull();
    expect(screen.queryByLabelText('Arquivo da planilha')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Relatórios DBCorp' })).toBeTruthy();
    expect(slot('saldo')).toBeTruthy();
    expect(screen.getByText(NOTA_DBCORP_CONFIRMACAO)).toBeTruthy();
    expect(screen.queryByText(NOTA_DBCORP_SEM_TESTE)).toBeNull();
    expect(screen.queryByText(/Importar como teste/)).toBeNull();
    const faltam = screen.getByText(/^Faltam:/).textContent ?? '';
    expect(faltam.startsWith('Faltam: data-base, quinzena, SALDO')).toBe(true);
    expect(faltam).not.toMatch(/planilha/i);
  });

  it('somenteDbcorp: a previa vai para o endpoint DBCorp e nunca para o da planilha', async () => {
    post.mockImplementation(() => new Promise(() => undefined));
    renderModal(true);
    preencherComuns();
    for (const id of SLOTS_2A) {
      fireEvent.change(slot(id) as HTMLInputElement, { target: { files: [arquivo(`${id}-teste.xlsx`)] } });
    }
    fireEvent.click(botao('Pré-visualizar'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/v1/forecast/import/dbcorp/preview');
    expect(post.mock.calls.some((c) => String(c[0]).includes('workbook'))).toBe(false);
  });

  it('sem a prop (admin): duas abas, planilha ativa com a nota de ferramenta; DBCorp mostra a nota sem teste', () => {
    renderModal();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    const planilha = screen.getByRole('tab', { name: 'Planilha (.xlsx)' });
    expect(planilha.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Relatórios DBCorp' })).toBeTruthy();
    expect(screen.getByText(NOTA_PLANILHA_ADMIN)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Relatórios DBCorp' }));
    expect(screen.getByText(NOTA_DBCORP_SEM_TESTE)).toBeTruthy();
  });
});

describe('Importar quinzena - planilha so para admin (pagina)', () => {
  it('comprador: ve o botao e o estado vazio so de DBCorp; o modal nao tem a planilha', async () => {
    mockRole = 'comprador';
    await abrirModalNaPagina();
    expect(
      screen.getByText('Nenhuma quinzena importada ainda. Use “Importar quinzena” para enviar os relatórios do DBCorp.'),
    ).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Planilha (.xlsx)' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Relatórios DBCorp' })).toBeTruthy();
    expect(screen.queryByLabelText('Arquivo da planilha')).toBeNull();
    expect(screen.queryByText(/Importar como teste/)).toBeNull();
  });

  it('admin: o modal tem as duas abas e "Importar como teste" aparece na previa da planilha', async () => {
    mockRole = 'admin';
    await abrirModalNaPagina();
    expect(screen.getByRole('tab', { name: 'Planilha (.xlsx)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Relatórios DBCorp' })).toBeTruthy();
    post.mockResolvedValueOnce({ data: resumoPlanilha() });
    preencherComuns();
    fireEvent.change(screen.getByLabelText('Arquivo da planilha'), { target: { files: [arquivo('planilha-teste.xlsx')] } });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização da planilha' });
    expect(screen.getByLabelText(TESTE)).toBeTruthy();
  });

  it.each(['gestor', 'viewer'])('%s: sem o botao "Importar quinzena" (gate da pagina inalterado)', async (role) => {
    mockRole = role;
    get.mockImplementation(async () => ({ data: [] }));
    renderPage();
    await screen.findByText('Nenhuma quinzena importada ainda. Peça a um comprador ou administrador para importar.');
    expect(screen.queryByRole('button', { name: 'Importar quinzena' })).toBeNull();
  });
});
