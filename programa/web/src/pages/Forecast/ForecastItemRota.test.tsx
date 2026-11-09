import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ComercialRouteGuard from '@/components/ComercialRouteGuard';
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

import { api } from '@/api/client';
import { chaveDoFiltro } from '@/test/forecastFiltros';

const get = vi.mocked(api.get);

// F13-W: rota /forecast/item/:linha (pagina do item) e painel com filtro, busca e colunas ocultas na URL. Dados 100% sinteticos.
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
    codigos: ['C0001'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    sobDemanda: false,
    sobDemandaMotivo: null,
    ...over,
  };
}

const LINHAS_7 = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0003'], fonte: 'FONTE 2', status: 'cotando', AN: -40, P: 130, projecao: [10, -5, -10, -15, -20, -25] }),
  linha({ linha: 5, n: 3, item: 'PRODUTO C', codigos: ['C0004'], fonte: 'FONTE 1', Q: 0, AN: null, AP: null }),
];
// A quinzena 8 tem numeros de linha iguais com OUTROS nomes: prova que a pagina do item le a quinzena da URL.
const LINHAS_8 = [linha({ item: 'ITEM OITO A' }), linha({ linha: 4, n: 2, item: 'ITEM OITO B', codigos: ['C0008'] })];

function detalhe(id: number) {
  return {
    id,
    label: id === 8 ? '11-1' : '10-2',
    baseDate: id === 8 ? '2026-11-05' : '2026-10-15',
    half: id === 8 ? 1 : 2,
    origin: id === 8 ? 'dbcorp' : 'planilha',
    hoje: '2026-10-20',
    months: MONTHS,
    files: [],
    createdAt: '2026-10-20T12:00:00.000Z',
    linhas: id === 8 ? LINHAS_8 : LINHAS_7,
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
  };
}

const RESUMOS = [
  { id: 8, label: '11-1', baseDate: '2026-11-05T00:00:00.000Z', half: 1, origin: 'dbcorp', months: MONTHS, files: [], createdById: 1, createdAt: '2026-11-05T12:00:00.000Z' },
  { id: 7, label: '10-2', baseDate: '2026-10-15T00:00:00.000Z', half: 2, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-10-20T12:00:00.000Z' },
];

const PENDENTES = {
  aplicavel: true,
  snapshotId: 8,
  label: '11-1',
  itens: [{ codigo: 'TST0901', situacao: 'sem_cadastro', produtoInativo: null, vendasMes: 20, vendasAtual: 0, vendasAnual: 200, programacao: 0, chegadas: 80, saldo: 0 }],
  totalItens: 1,
  omitidos: 0,
  soSaldo: { codigos: 0, kg: 0 },
};

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: RESUMOS };
    if (path.endsWith('/pendentes')) return { data: PENDENTES };
    if (path.endsWith('/decisoes')) return { data: [] };
    return { data: detalhe(Number(path.split('/').pop())) };
  });
}

function Local() {
  const l = useLocation();
  return <output data-testid="local">{`${l.pathname}${l.search}`}</output>;
}

function renderRota(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Local />
        <Routes>
          <Route element={<ComercialRouteGuard />}>
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/forecast/item/:linha" element={<Forecast />} />
          </Route>
          <Route path="/solicitacoes" element={<p>Tela de Solicitações</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const local = () => screen.getByTestId('local').textContent ?? '';
const query = () => new URLSearchParams(local().split('?')[1] ?? '');
const memoria = () => screen.findByRole('region', { name: 'Memória de cálculo' });
const NAO_ENCONTRADO = 'Item não encontrado nesta quinzena';
const itensDaGrade = () =>
  screen.queryAllByRole('link', { name: /(PRODUTO|ITEM OITO) [A-C]/ }).map((b) => b.querySelector('.fc-item__nome')?.textContent);

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockRole = 'comprador';
  mockApi();
});

describe('Forecast - rota /forecast/item/:linha', () => {
  it('deep link abre a pagina do item da quinzena da URL, sem grade e sem pendentes', async () => {
    renderRota('/forecast/item/4?quinzena=8');
    const regiao = within(await memoria());
    expect(regiao.getByRole('heading', { name: 'ITEM OITO B' })).toBeTruthy();
    expect(regiao.getByText('MEMÓRIA DE CÁLCULO · LINHA 4 DA PLANILHA')).toBeTruthy();
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('8');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filtros' })).toBeNull();
    expect(screen.queryByText(/Pendentes de cadastro/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Painel' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('sem ?quinzena usa a mais recente (mesma regra do painel)', async () => {
    renderRota('/forecast/item/3');
    expect(within(await memoria()).getByRole('heading', { name: 'ITEM OITO A' })).toBeTruthy();
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('8');
  });

  it('quinzena inexistente cai na mais recente, como o painel; o item segue pelo numero da linha', async () => {
    renderRota('/forecast/item/3?quinzena=999');
    expect(within(await memoria()).getByRole('heading', { name: 'ITEM OITO A' })).toBeTruthy();
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('8');
  });

  // FZ2: so digitos (inteiro positivo). Estas formas viram o numero de uma linha que EXISTE na quinzena 7 (3 ou 4) se lidas com Number().
  it.each([
    '/forecast/item/99?quinzena=7',
    '/forecast/item/abc?quinzena=7',
    '/forecast/item/3abc?quinzena=7',
    '/forecast/item/0?quinzena=7',
    '/forecast/item/0x3?quinzena=7',
    '/forecast/item/4e0?quinzena=7',
    '/forecast/item/%203?quinzena=7',
    '/forecast/item/3.0?quinzena=7',
    '/forecast/item/%2B3?quinzena=7',
    '/forecast/item/-3?quinzena=7',
  ])(
    'linha inexistente ou nao numerica (%s): "Item não encontrado nesta quinzena"',
    async (url) => {
      renderRota(url);
      expect(await screen.findByText(NAO_ENCONTRADO)).toBeTruthy();
      expect(screen.queryByRole('region', { name: 'Memória de cálculo' })).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
    },
  );

  it('a linha 5 existe na quinzena 7 mas nao na quinzena 8', async () => {
    renderRota('/forecast/item/5?quinzena=8');
    expect(await screen.findByText(NAO_ENCONTRADO)).toBeTruthy();
  });

  it('clicar no item leva quinzena, filtro, busca e colunas ocultas para a URL da pagina', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Demanda ≤ 0 1' }));
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'FONTE 2' } });
    fireEvent.click(chaveDoFiltro('Colunas ocultas da planilha'));
    await waitFor(() => expect(itensDaGrade()).toEqual(['PRODUTO B']));
    fireEvent.click(screen.getByRole('link', { name: /PRODUTO B/ }));
    await memoria();
    expect(local().startsWith('/forecast/item/4?')).toBe(true);
    expect(Object.fromEntries(query())).toEqual({ quinzena: '7', filtro: 'demanda', busca: 'FONTE 2', ocultas: '1' });
  });

  it('F13-H: o item da grade e um link (<a href>) para a pagina do item, com quinzena, filtro, busca e ocultas; sem aria-pressed', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Demanda ≤ 0 1' }));
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'FONTE 2' } });
    fireEvent.click(chaveDoFiltro('Colunas ocultas da planilha'));
    await waitFor(() => expect(itensDaGrade()).toEqual(['PRODUTO B']));
    const link = screen.getByRole('link', { name: /PRODUTO B/ });
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('aria-pressed')).toBe(false);
    expect(link.getAttribute('tabindex')).toBeNull();
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('/forecast/item/4?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(href.split('?')[1]))).toEqual({ quinzena: '7', filtro: 'demanda', busca: 'FONTE 2', ocultas: '1' });
    expect(document.querySelectorAll('.fc-grid button[aria-pressed], .fc-row--selecionada')).toHaveLength(0);
  });

  it('F13-H: digitar na busca atualiza o href do item na hora (antes de a URL ganhar `busca` pelo debounce de 300 ms)', async () => {
    renderRota('/forecast?quinzena=7');
    await screen.findByRole('link', { name: /PRODUTO A/ });
    // FZ2: relogio falso so depois de a grade carregar (react-query usa timers reais); o debounce passa a ser exato, sem depender de tempo de parede.
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'FONTE 2' } });
    expect(itensDaGrade()).toEqual(['PRODUTO B']);
    expect(query().get('busca')).toBeNull();
    const href = screen.getByRole('link', { name: /PRODUTO B/ }).getAttribute('href') ?? '';
    expect(Object.fromEntries(new URLSearchParams(href.split('?')[1]))).toEqual({ quinzena: '7', busca: 'FONTE 2' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(query().get('busca')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(query().get('busca')).toBe('FONTE 2');
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: '' } });
    expect(itensDaGrade()).toHaveLength(3);
    expect(screen.getByRole('link', { name: /PRODUTO A/ }).getAttribute('href')).toBe('/forecast/item/3?quinzena=7');
  });

  it('F13-H: sem filtro/busca/ocultas o href leva so a quinzena; Ctrl+clique e clique com meta deixam o navegador abrir em nova aba (a rota nao muda)', async () => {
    renderRota('/forecast?quinzena=7');
    const link = await screen.findByRole('link', { name: /PRODUTO A/ });
    expect(link.getAttribute('href')).toBe('/forecast/item/3?quinzena=7');
    // jsdom nao abre aba: o clique com modificador cai na navegacao nativa do <a>; o ouvinte so evita o aviso do jsdom
    const semNavegacaoNativa = (e: Event) => e.preventDefault();
    document.addEventListener('click', semNavegacaoNativa);
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    document.removeEventListener('click', semNavegacaoNativa);
    expect(local()).toBe('/forecast?quinzena=7');
    fireEvent.click(link);
    await memoria();
    expect(local()).toBe('/forecast/item/3?quinzena=7');
  });

  it('a aba Painel volta com a mesma quinzena, filtro, busca e colunas ocultas', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Demanda ≤ 0 1' }));
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'FONTE 2' } });
    fireEvent.click(chaveDoFiltro('Colunas ocultas da planilha'));
    fireEvent.click(screen.getByRole('link', { name: /PRODUTO B/ }));
    await memoria();

    fireEvent.click(screen.getByRole('button', { name: 'Painel' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(local().startsWith('/forecast?')).toBe(true);
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('7');
    expect(screen.getByRole('button', { name: 'Demanda ≤ 0 1' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Buscar produto, código ou fonte') as HTMLInputElement).value).toBe('FONTE 2');
    expect(chaveDoFiltro('Colunas ocultas da planilha').getAttribute('aria-checked')).toBe('true');
    expect(itensDaGrade()).toEqual(['PRODUTO B']);
  });

  it('o Relatorio de compras sai da pagina do item para /forecast?visao=compras', async () => {
    renderRota('/forecast/item/4?quinzena=7');
    await memoria();
    fireEvent.click(screen.getByRole('button', { name: 'Relatório de compras' }));
    await waitFor(() => expect(query().get('visao')).toBe('compras'));
    expect(local().startsWith('/forecast?')).toBe(true);
    expect(query().get('quinzena')).toBe('7');
  });

  it('trocar a quinzena na pagina do item volta ao painel da quinzena escolhida', async () => {
    renderRota('/forecast/item/4?quinzena=7&filtro=demanda');
    await memoria();
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(local()).toBe('/forecast?quinzena=8');
    expect(screen.queryByRole('region', { name: 'Memória de cálculo' })).toBeNull();
  });

  it('comercial e redirecionado para /solicitacoes (a rota nova segue o guarda)', async () => {
    mockRole = 'comercial';
    renderRota('/forecast/item/3?quinzena=7');
    expect(await screen.findByText('Tela de Solicitações')).toBeTruthy();
    expect(local()).toBe('/solicitacoes');
    expect(screen.queryByRole('region', { name: 'Memória de cálculo' })).toBeNull();
  });

  it.each(['viewer', 'gestor'])('%s abre a pagina so para leitura (sem Salvar, caixa de Compra nem Importar)', async (role) => {
    mockRole = role;
    renderRota('/forecast/item/3?quinzena=7');
    const regiao = within(await memoria());
    expect(regiao.getByText('Compra regular')).toBeTruthy();
    expect(regiao.queryByRole('checkbox')).toBeNull();
    expect(regiao.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(regiao.getByRole('button', { name: 'Embalagens do item' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Importar quinzena' })).toBeNull();
  });

  it('admin edita pela pagina (caixa de Compra e Salvar)', async () => {
    mockRole = 'admin';
    renderRota('/forecast/item/3?quinzena=7');
    const regiao = within(await memoria());
    expect(regiao.getByRole('checkbox', { name: 'Só compra quando o cliente envia a programação' })).toBeTruthy();
    expect(regiao.getByRole('button', { name: 'Salvar' })).toBeTruthy();
  });
});

describe('Forecast - filtro, busca e colunas ocultas na URL do painel', () => {
  it('o painel le filtro, busca e ocultas da URL', async () => {
    renderRota('/forecast?quinzena=7&filtro=demanda&busca=produto&ocultas=1');
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Demanda ≤ 0 1' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Buscar produto, código ou fonte') as HTMLInputElement).value).toBe('produto');
    expect(chaveDoFiltro('Colunas ocultas da planilha').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('columnheader', { name: 'EMB.1–7' })).toBeTruthy();
    expect(itensDaGrade()).toEqual(['PRODUTO B']);
  });

  it('filtro desconhecido na URL vale "Todos"', async () => {
    renderRota('/forecast?quinzena=7&filtro=qualquer');
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Todos 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(itensDaGrade()).toEqual(['PRODUTO A', 'PRODUTO B', 'PRODUTO C']);
  });

  it('mudar filtro e colunas ocultas escreve na URL; "Todos" e desligar limpam os parametros', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Em andamento 1' }));
    fireEvent.click(chaveDoFiltro('Colunas ocultas da planilha'));
    expect(Object.fromEntries(query())).toEqual({ quinzena: '7', filtro: 'andamento', ocultas: '1' });
    fireEvent.click(screen.getByRole('button', { name: 'Todos 3' }));
    fireEvent.click(chaveDoFiltro('Colunas ocultas da planilha'));
    expect(local()).toBe('/forecast?quinzena=7');
  });

  it('a busca digitada chega na URL depois de uma pausa de 300 ms e limpar remove o parametro', async () => {
    renderRota('/forecast?quinzena=7');
    const campo = await screen.findByLabelText('Buscar produto, código ou fonte');
    vi.useFakeTimers();
    fireEvent.change(campo, { target: { value: 'produto c' } });
    expect(itensDaGrade()).toEqual(['PRODUTO C']);
    expect(query().get('busca')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(query().get('busca')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(query().get('busca')).toBe('produto c');
    fireEvent.change(campo, { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(query().get('busca')).toBeNull();
  });

  it('digitar de novo antes dos 300 ms reinicia a pausa: so a ultima busca vai para a URL', async () => {
    renderRota('/forecast?quinzena=7');
    const campo = await screen.findByLabelText('Buscar produto, código ou fonte');
    vi.useFakeTimers();
    fireEvent.change(campo, { target: { value: 'pro' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(campo, { target: { value: 'produto c' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(query().get('busca')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(query().get('busca')).toBe('produto c');
  });

  it('trocar de quinzena limpa filtro, busca e colunas ocultas', async () => {
    renderRota('/forecast?quinzena=7&filtro=demanda&busca=produto&ocultas=1');
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    await waitFor(() => expect(local()).toBe('/forecast?quinzena=8'));
    expect(((await screen.findByLabelText('Buscar produto, código ou fonte')) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('table', { name: /quinzena 11-1/ })).toBeTruthy();
    expect(chaveDoFiltro('Colunas ocultas da planilha').getAttribute('aria-checked')).toBe('false');
  });
});
