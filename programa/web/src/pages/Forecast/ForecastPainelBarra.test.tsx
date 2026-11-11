import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from '../Forecast';

// Barra de filtros do Painel em uma linha: notas da quinzena em icone, legenda, contador e a busca que vira lupa em largura estreita.

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: 'admin' } }),
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
const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    O: 100, P: 50, Q: 100, R: 90, S: 80, T: 10, U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: -40, AQ: 30, AP: '2026-11-20', AR: 0, AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: 50,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

const LINHAS = [linha(), linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0002'], productId: 43 })];

const resumo = {
  id: 7, label: '11-1', baseDate: '2026-11-15T00:00:00.000Z', half: 1, origin: 'dbcorp', months: MONTHS, files: [], createdById: 1, createdAt: '2026-11-16T12:00:00.000Z',
};
const detalhe = {
  id: 7, label: '11-1', baseDate: '2026-11-15', half: 1, origin: 'dbcorp', hoje: '2026-11-16', months: MONTHS, files: [], createdAt: '2026-11-16T12:00:00.000Z',
  linhas: LINHAS,
  conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
};

const REGRA = { mesesVenda: ['2026-08', '2026-09', '2026-10'], historicoAusente: [] as string[], compras: 'fup_em_aberto' };
const NENHUM =
  'Pendentes de cadastro: nenhum código com venda nos últimos 3 meses, programação ou compra em aberto no FUP fora do cadastro nesta quinzena.';
const SEM_VENDA = 'Sem venda nos últimos 3 meses (não listados): 25 códigos · 8.230 kg de venda anual';
const AMOSTRAS = 'Amostras ignoradas (prefixo AM): 16 códigos';

let pendentes: Record<string, unknown>;

function pendentesVazio(over: Record<string, unknown> = {}) {
  return {
    aplicavel: true, snapshotId: 7, label: '11-1', itens: [], totalItens: 0, omitidos: 0, soSaldo: { codigos: 0, kg: 0 },
    semVendaRecente: { codigos: 25, vendasAnual: 8230 }, amostrasIgnoradas: { codigos: 16, prefixos: ['AM'] }, regra: REGRA, ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function consultaEstreita(estreita: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: estreita && q.includes('max-width: 980px'),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  pendentes = pendentesVazio();
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: [resumo] };
    if (path === '/v1/forecast/products') return { data: [] };
    if (path.endsWith('/decisoes')) return { data: { decisoes: [] } };
    if (path.endsWith('/pendentes')) return { data: pendentes };
    return { data: detalhe };
  });
});

afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom nao tem matchMedia: volta ao estado de antes
  delete window.matchMedia;
});

const barra = () => screen.getByRole('group', { name: 'Filtros' }).parentElement as HTMLElement;

describe('Painel - notas da quinzena em icone', () => {
  it('as tres frases saem do fluxo da pagina e viram um icone com selo 3 na barra de filtros', async () => {
    const { container } = renderPage();
    const botao = await screen.findByTestId('fc-notas-botao');
    expect(botao.getAttribute('aria-label')).toBe('Notas da quinzena: 3');
    expect(botao.querySelector('.fcnt__conta')?.textContent).toBe('3');
    expect(barra().contains(botao)).toBe(true);
    // nada de frase fixa no fluxo: so a lista do leitor de tela (fora da pagina visivel) as carrega
    expect(container.querySelector('.fcp-estado')).toBeNull();
    expect(container.querySelector('.fcp-nota')).toBeNull();
    const itens = within(screen.getByTestId('fc-notas-texto')).getAllByRole('listitem');
    expect(itens.map((li) => li.textContent)).toEqual([NENHUM, SEM_VENDA, AMOSTRAS]);
  });

  it('o balao abre ao passar o mouse, com os textos exatos', async () => {
    renderPage();
    fireEvent.mouseEnter(await screen.findByTestId('fc-notas-botao'));
    const balao = screen.getByTestId('fc-notas-balao');
    for (const texto of [NENHUM, SEM_VENDA, AMOSTRAS]) expect(within(balao).getByText(texto)).toBeTruthy();
  });

  it('o icone fica na mesma linha da legenda e do contador "N de M produtos"', async () => {
    renderPage();
    await screen.findByTestId('fc-notas-botao');
    const linhaDaBarra = barra();
    expect(linhaDaBarra.className).toContain('fc-barra--linha');
    expect(within(linhaDaBarra).getByTestId('fc-legenda-botao')).toBeTruthy();
    expect(within(linhaDaBarra).getByTestId('fc-filtros-botao')).toBeTruthy();
    expect(within(linhaDaBarra).getByText('2 de 2 produtos')).toBeTruthy();
    expect(within(linhaDaBarra).getByRole('button', { name: /^Todos/ })).toBeTruthy();
  });

  it('com pendentes: o selo conta so as notas de resumo e elas nao se repetem sob a tabela', async () => {
    pendentes = pendentesVazio({
      totalItens: 1,
      itens: [
        {
          codigo: 'TST0901', situacao: 'sem_cadastro', produtoInativo: null, vendasMes: 20, vendasAtual: 0, vendasAnual: 1200, vendas3Meses: 60,
          vendasAnteriores: 40, programacao: 0, chegadas: 0, comprasEmAberto: 80, saldo: 0,
        },
      ],
    });
    const { container } = renderPage();
    const botao = await screen.findByTestId('fc-notas-botao');
    expect(botao.getAttribute('aria-label')).toBe('Notas da quinzena: 2');
    await screen.findAllByText(/Pendentes de cadastro \(1\)/);
    expect(container.querySelector('.fcp-nota')?.textContent ?? '').not.toContain('Amostras ignoradas');
    expect(screen.getAllByText(SEM_VENDA)).toHaveLength(1);
  });

  it('sem as contagens fora da lista sobra so a nota do criterio: selo 1', async () => {
    pendentes = pendentesVazio({ semVendaRecente: { codigos: 0, vendasAnual: 0 }, amostrasIgnoradas: undefined });
    renderPage();
    await screen.findByText('2 de 2 produtos');
    expect((await screen.findByTestId('fc-notas-botao')).getAttribute('aria-label')).toBe('Notas da quinzena: 1');
  });
});

describe('Painel - busca vira lupa em largura estreita', () => {
  it('larga: campo de busca visivel, sem lupa', async () => {
    consultaEstreita(false);
    renderPage();
    expect(await screen.findByRole('searchbox', { name: 'Buscar produto, código ou fonte' })).toBeTruthy();
    expect(screen.queryByTestId('fc-busca-lupa')).toBeNull();
  });

  it('estreita: so a lupa (aria-expanded=false); clicar abre o campo com foco, e Esc fecha devolvendo o foco a lupa', async () => {
    consultaEstreita(true);
    renderPage();
    const lupa = await screen.findByTestId('fc-busca-lupa');
    expect(lupa.getAttribute('aria-label')).toBe('Buscar produto, código ou fonte');
    expect(lupa.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(lupa);
    const campo = await screen.findByRole('searchbox', { name: 'Buscar produto, código ou fonte' });
    expect(lupa.getAttribute('aria-expanded')).toBe('true');
    expect(lupa.getAttribute('aria-controls')).toBe(campo.id);
    expect(document.activeElement).toBe(campo);
    expect(campo.parentElement?.className).toContain('fc-busca--compacta');

    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(lupa.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(lupa);
  });

  it('clicar de novo na lupa fecha o campo', async () => {
    consultaEstreita(true);
    renderPage();
    const lupa = await screen.findByTestId('fc-busca-lupa');
    fireEvent.click(lupa);
    await screen.findByRole('searchbox');
    fireEvent.click(lupa);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('a busca digitada continua valendo com o campo fechado (a lupa marca busca ativa)', async () => {
    consultaEstreita(true);
    renderPage();
    const lupa = await screen.findByTestId('fc-busca-lupa');
    fireEvent.click(lupa);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'PRODUTO B' } });
    await screen.findByText('1 de 2 produtos');
    fireEvent.click(lupa);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('1 de 2 produtos')).toBeTruthy();
    expect(lupa.className).toContain('fc-busca__lupa--ativa');
    expect(lupa.getAttribute('title')).toBe('Busca ativa: PRODUTO B');
  });

  it('o botao Filtros mantem o rotulo acessivel e o texto "Filtros" no DOM (a tela estreita so esconde o texto por CSS)', async () => {
    consultaEstreita(true);
    renderPage();
    const filtros = await screen.findByTestId('fc-filtros-botao');
    expect(filtros.getAttribute('aria-label')).toMatch(/^Filtros avançados/);
    expect(filtros.querySelector('.fc-filtros-menu__txt')?.textContent).toBe('Filtros');
  });
});
