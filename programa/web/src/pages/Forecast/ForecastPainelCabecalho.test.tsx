import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from '../Forecast';

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

// Dados 100% sinteticos.
const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001', 'C0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

const LINHAS = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0003'], fonte: 'FONTE 2', status: 'cotando', AN: -40 }),
  linha({ linha: 5, n: 3, item: 'PRODUTO C', codigos: ['C0004'], fonte: 'FONTE 1', Q: 0, AN: null, AP: null }),
];

function detalhe(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    label: '10-2',
    baseDate: '2026-10-15',
    half: 2,
    origin: 'planilha',
    hoje: '2026-10-20',
    months: MONTHS,
    files: [],
    createdAt: '2026-10-20T12:00:00.000Z',
    linhas: LINHAS,
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
    ...over,
  };
}

const RESUMOS = [
  { id: 7, label: '10-2', baseDate: '2026-10-15T00:00:00.000Z', half: 2, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-10-20T12:00:00.000Z' },
  { id: 8, label: '11-1', baseDate: '2026-11-05T00:00:00.000Z', half: 1, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-11-05T12:00:00.000Z' },
];

const RELATORIO = {
  quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
  totais: { itens: 0, fontes: 0, vencidas: 0, semEmbalagem: 0, multiplasEmbalagens: 0 },
  fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
  grupos: [],
};

const PATH_XLSX = '/v1/forecast/snapshots/7/relatorio-compras/xlsx';
const NOME_MACRO = 'forecast-macro-10-2-2026-10-20.xlsx';
const xlsxOk = async () => ({ data: { fileName: NOME_MACRO, contentBase64: btoa('x') } });

function mockApi(xlsx: () => Promise<unknown> = xlsxOk) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: RESUMOS };
    if (path.endsWith('/xlsx')) return xlsx();
    if (path.endsWith('/decisoes')) return { data: { decisoes: [] } };
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    if (path.endsWith('/relatorio-compras')) return { data: RELATORIO };
    const id = Number(path.split('/').pop());
    return { data: id === 7 ? detalhe() : id === 8 ? detalhe({ id: 8, label: '11-1', baseDate: '2026-11-05', half: 1 }) : undefined };
  });
}

function renderPage(url = '/forecast') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SUBTITULO = 'Quinzena 10-2 · base 15/10/2026 · 3 produtos · origem planilha';

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Forecast - subtitulo com a proxima analise', () => {
  it('mostra "· próxima análise dd/mm/aaaa" (PO.COMP.01) depois do subtitulo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
    mockApi();
    renderPage();
    const p = (await screen.findByText(SUBTITULO)).closest('p');
    expect(p?.textContent).toBe(`${SUBTITULO} · próxima análise 04/11/2026`);
  });

  it('usa o dia de Sao Paulo, nao o de UTC (02:30Z de 04/11 ainda e 03/11 em SP)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T02:30:00Z'));
    mockApi();
    renderPage();
    const p = (await screen.findByText(SUBTITULO)).closest('p');
    expect(p?.textContent).toBe(`${SUBTITULO} · próxima análise 04/11/2026`);
  });

  it('fora da tabela de feriados o trecho nao aparece', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-12-20T15:00:00Z'));
    mockApi();
    renderPage();
    const p = (await screen.findByText(SUBTITULO)).closest('p');
    expect(p?.textContent).toBe(SUBTITULO);
    expect(screen.queryByText(/próxima análise/)).toBeNull();
  });
});

describe('Forecast - exportar planilha MACRO pelo cabecalho do painel', () => {
  const NOME_BOTAO = 'Exportar planilha MACRO (XLSX)';
  const originais = { criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
  const botaoExportar = () => screen.findByRole('button', { name: NOME_BOTAO }) as Promise<HTMLButtonElement>;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    URL.createObjectURL = originais.criar;
    URL.revokeObjectURL = originais.revogar;
    vi.restoreAllMocks();
  });

  it.each(['admin', 'comprador', 'gestor', 'viewer'])('%s ve o botao, direto em .page-header__actions', async (papel) => {
    mockRole = papel;
    mockApi();
    renderPage();
    const botao = await botaoExportar();
    expect(botao.parentElement?.classList.contains('page-header__actions')).toBe(true);
  });

  it('o clique baixa o MACRO com layout=macro e o hoje da quinzena, e mostra o nome gerado', async () => {
    mockApi();
    renderPage();
    fireEvent.click(await botaoExportar());
    const ok = await screen.findByText(`Planilha MACRO gerada: ${NOME_MACRO}`);
    expect(ok.getAttribute('role')).toBe('status');
    expect(get).toHaveBeenCalledWith(PATH_XLSX, { hoje: '2026-10-20', layout: 'macro' });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('pendente: "Gerando planilha MACRO…" desabilitado e aria-busy; ao resolver volta ao rotulo', async () => {
    let resolver: (v: unknown) => void = () => {};
    mockApi(() => new Promise((r) => (resolver = r)));
    renderPage();
    fireEvent.click(await botaoExportar());
    const gerando = (await screen.findByRole('button', { name: 'Gerando planilha MACRO…' })) as HTMLButtonElement;
    expect(gerando.disabled).toBe(true);
    expect(gerando.getAttribute('aria-busy')).toBe('true');
    resolver({ data: { fileName: NOME_MACRO, contentBase64: btoa('x') } });
    const volta = (await botaoExportar()) as HTMLButtonElement;
    expect(volta.disabled).toBe(false);
    expect(volta.getAttribute('aria-busy')).toBe('false');
  });

  it('erro 404: alerta com a mensagem do servico e nenhum "Planilha MACRO gerada"', async () => {
    mockApi(() => Promise.reject(new ApiError(404, null)));
    renderPage();
    fireEvent.click(await botaoExportar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Quinzena não encontrada (pode ter sido removida).');
    expect(screen.queryByText(/Planilha MACRO gerada/)).toBeNull();
  });

  it('na visao "Relatorio de compras" o botao do cabecalho some: so o do relatorio', async () => {
    mockApi();
    renderPage();
    await botaoExportar();
    fireEvent.click(screen.getByRole('button', { name: 'Relatório de compras' }));
    await screen.findByRole('button', { name: 'Baixar planilha MACRO (XLSX)' });
    expect(screen.queryByRole('button', { name: NOME_BOTAO })).toBeNull();
    expect(screen.getAllByRole('button', { name: /planilha MACRO/ })).toHaveLength(1);
  });

  it('trocar de quinzena limpa a mensagem de planilha gerada', async () => {
    mockApi();
    renderPage();
    fireEvent.click(await botaoExportar());
    await screen.findByText(/Planilha MACRO gerada/);
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    await screen.findByText(/Quinzena 11-1 · base 05\/11\/2026/);
    await waitFor(() => expect(screen.queryByText(/Planilha MACRO gerada/)).toBeNull());
    expect(within(document.body).getByRole('button', { name: NOME_BOTAO })).toBeTruthy();
  });
});
