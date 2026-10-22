import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from './Forecast';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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
const post = vi.mocked(api.post);

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
  linha({
    linha: 4,
    n: 2,
    item: 'PRODUTO B',
    codigos: ['C0003'],
    fonte: 'FONTE 2',
    status: 'cotando',
    AN: -40,
    P: 130,
    projecao: [10, -5, -10, -15, -20, -25],
    obs: 'Obs. de teste',
    precoFixo: true,
    historico: [1, 2, 3, 4, 5],
  }),
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
  { id: 8, label: '11-1', baseDate: '2026-11-05T00:00:00.000Z', half: 1, origin: 'dbcorp', months: MONTHS, files: [], createdById: 1, createdAt: '2026-11-05T12:00:00.000Z' },
];

function mockApi(detalhes: Record<number, unknown> | ((id: number) => unknown), lista: unknown = RESUMOS) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') {
      if (lista instanceof Error) throw lista;
      return { data: lista };
    }
    const id = Number(path.split('/').pop());
    const value = typeof detalhes === 'function' ? detalhes(id) : detalhes[id];
    if (value instanceof Error) throw value;
    return { data: value };
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

const detalhesChamados = () =>
  get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/v1/forecast/snapshots/'));

const nomesDosItens = () => screen.queryAllByRole('button', { name: /PRODUTO [ABC]/ }).map((b) => b.querySelector('.fc-item__nome')?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

describe('Forecast', () => {
  it('lista vazia mostra o estado vazio e nao pede detalhe', async () => {
    mockApi({}, []);
    renderPage();
    expect(
      await screen.findByText(
        'Nenhuma quinzena importada ainda. Use “Importar quinzena” para enviar a planilha ou os relatórios do DBCorp.',
      ),
    ).toBeTruthy();
    expect(detalhesChamados()).toEqual([]);
  });

  it('mostra o spinner enquanto a lista carrega', () => {
    get.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
  });

  it('pede o detalhe da primeira quinzena e mostra subtitulo, selo e grade', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    expect(await screen.findByText('Quinzena 10-2 · base 15/10/2026 · 3 produtos · origem planilha')).toBeTruthy();
    expect(detalhesChamados()).toEqual(['/v1/forecast/snapshots/7']);
    expect(screen.getByText('Cálculo idêntico ao da planilha')).toBeTruthy();
    expect(screen.getByText('84 de 84 células batem')).toBeTruthy();
    expect((screen.getByRole('region', { name: 'Grade do Forecast' }))?.getAttribute('tabindex')).toBe('0');
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO B', 'PRODUTO C']);
    expect(screen.getByText('3 de 3 produtos')).toBeTruthy();
  });

  it('trocar o seletor pede o detalhe da outra quinzena (origem DBCorp, 1a quinzena)', async () => {
    mockApi({
      7: detalhe(),
      8: detalhe({ id: 8, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'dbcorp', conferencia: null }),
    });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '10-2 · 15/10/2026 · planilha',
      '11-1 · 05/11/2026 · relatórios DBCorp',
    ]);
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    expect(
      await screen.findByText('Quinzena 11-1 · base 05/11/2026 · 3 produtos · origem relatórios DBCorp'),
    ).toBeTruthy();
    expect(detalhesChamados()).toEqual(['/v1/forecast/snapshots/7', '/v1/forecast/snapshots/8']);
    expect(
      screen.getByText('Quinzena gerada dos relatórios DBCorp — sem planilha para conferir.'),
    ).toBeTruthy();
  });

  it('?quinzena=<id> abre a quinzena pedida; id fora da lista usa a primeira', async () => {
    mockApi({ 7: detalhe(), 8: detalhe({ id: 8, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'dbcorp', conferencia: null }) });
    const primeira = renderPage('/forecast?quinzena=8');
    expect(await screen.findByText(/Quinzena 11-1 · base 05\/11\/2026/)).toBeTruthy();
    expect(detalhesChamados()).toEqual(['/v1/forecast/snapshots/8']);
    primeira.unmount();

    vi.clearAllMocks();
    mockApi({ 7: detalhe() });
    renderPage('/forecast?quinzena=999');
    expect(await screen.findByText(/Quinzena 10-2 · base 15\/10\/2026/)).toBeTruthy();
    expect(detalhesChamados()).toEqual(['/v1/forecast/snapshots/7']);
  });

  it('1a quinzena de planilha: rotulo da regra da planilha e a nota', async () => {
    mockApi({ 7: detalhe({ half: 1 }) });
    renderPage();
    expect(
      await screen.findByText('Conferência motor × planilha (regra da planilha, 2ª quinzena)'),
    ).toBeTruthy();
    expect(screen.getByText(/Nesta 1ª quinzena o consumo do mês \(AG\) usa a média trimestral/)).toBeTruthy();
    expect(screen.queryByText('Cálculo idêntico ao da planilha')).toBeNull();
  });

  it('celula divergente e marcada com title "Planilha: X · motor: Y"', async () => {
    mockApi({
      7: detalhe({
        conferencia: {
          celulas: 84,
          batem: 83,
          porColuna: {},
          totalDivergencias: 1,
          divergencias: [{ linha: 4, item: 'PRODUTO B', coluna: 'Q', esperado: 77, calculado: 100 }],
        },
      }),
    });
    renderPage();
    expect(await screen.findByText('Há diferenças com a planilha')).toBeTruthy();
    expect(screen.getByText('83 de 84 células batem · 1 divergem')).toBeTruthy();
    const celula = document.querySelector('.fc-cell--diverge');
    expect(celula).not.toBeNull();
    expect((celula)?.getAttribute('title')).toBe('Planilha: 77 · motor: 100');
    expect(document.querySelectorAll('.fc-cell--diverge')).toHaveLength(1);
  });

  it('filtros mudam as linhas e mostram as contagens da quinzena inteira', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const filtros = within(screen.getByRole('group', { name: 'Filtros' }));
    expect((filtros.getByRole('button', { name: 'Todos 3' }))?.getAttribute('aria-pressed')).toBe('true');
    expect(filtros.getByRole('button', { name: 'Demanda ≤ 0 1' })).toBeTruthy();
    expect(filtros.getByRole('button', { name: 'Falta até janeiro 1' })).toBeTruthy();
    expect(filtros.getByRole('button', { name: 'Em andamento 1' })).toBeTruthy();

    fireEvent.click(filtros.getByRole('button', { name: 'Demanda ≤ 0 1' }));
    expect(nomesDosItens()).toEqual(['PRODUTO B']);
    expect(screen.getByText('1 de 3 produtos')).toBeTruthy();
    expect((filtros.getByRole('button', { name: 'Demanda ≤ 0 1' }))?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(filtros.getByRole('button', { name: 'Todos 3' }));
    expect(nomesDosItens()).toHaveLength(3);
  });

  it('busca filtra sem acento e sem caixa; combina com o filtro; sem resultado mostra aviso', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const busca = screen.getByLabelText('Buscar produto, código ou fonte');
    fireEvent.change(busca, { target: { value: 'c0004' } });
    await waitFor(() => expect(nomesDosItens()).toEqual(['PRODUTO C']));
    fireEvent.change(busca, { target: { value: 'fonte 1' } });
    await waitFor(() => expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO C']));
    fireEvent.click(screen.getByRole('button', { name: 'Em andamento 1' }));
    expect(await screen.findByText('Nenhum produto com esses filtros.')).toBeTruthy();
  });

  it('chave mostra EMB.1–7 e o mes mais antigo (oculto por padrao)', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.queryByRole('columnheader', { name: 'EMB.1–7' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'M1' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'M4' })).toBeTruthy();
    const chave = screen.getByRole('switch', { name: 'Colunas ocultas da planilha' });
    expect((chave)?.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(chave);
    expect((chave)?.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('columnheader', { name: 'EMB.1–7' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'M1' })).toBeTruthy();
    // uma vez na grade e outra na memoria de calculo (item selecionado)
    expect(screen.getAllByText('C0001 · C0002')).toHaveLength(2);
  });

  it('colunas de compras: selo Fixo, OBS com title e DEMANDA <= 0 em pilula', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.getAllByText('Fixo')).toHaveLength(1);
    expect((screen.getByText('Obs. de teste').closest('td'))?.getAttribute('title')).toBe('Obs. de teste');
    expect(document.querySelectorAll('.fc-pill--falta')).toHaveLength(1);
    // P > Q: PRODUTO B (130 > 100) e PRODUTO C (50 > 0).
    expect(document.querySelectorAll('.fc-cell--acima-media')).toHaveLength(2);
  });

  it('clicar em outro item troca a memoria de calculo e o aria-pressed', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const memoria = within(screen.getByRole('region', { name: 'Memória de cálculo' }));
    expect(memoria.getByText('MEMÓRIA DE CÁLCULO · LINHA 3 DA PLANILHA')).toBeTruthy();
    expect(memoria.getByRole('heading', { name: 'PRODUTO A' })).toBeTruthy();
    const [itemA, itemB] = screen.getAllByRole('button', { name: /PRODUTO [AB]/ });
    expect((itemA)?.getAttribute('aria-pressed')).toBe('true');
    expect((itemB)?.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(itemB as HTMLElement);
    expect(memoria.getByText('MEMÓRIA DE CÁLCULO · LINHA 4 DA PLANILHA')).toBeTruthy();
    expect(memoria.getByRole('heading', { name: 'PRODUTO B' })).toBeTruthy();
    expect((itemA)?.getAttribute('aria-pressed')).toBe('false');
    expect((itemB)?.getAttribute('aria-pressed')).toBe('true');
    expect(memoria.getByText('Falta em nov/2026. Uma PO feita hoje chega em 20/11/2026, a tempo.')).toBeTruthy();
    expect(memoria.getByText(/CHEG\. calculada com hoje = 20\/10\/2026/)).toBeTruthy();
    expect(memoria.getByText('LEAD TIME · FONTE 2')).toBeTruthy();
    // nem margem nem clientes ativos aparecem no painel
    expect(memoria.queryByText(/Margem/)).toBeNull();
    expect(memoria.queryByText(/Clientes ativos/)).toBeNull();
  });

  it('erro 403 no detalhe mostra a mensagem de acesso', async () => {
    mockApi({ 7: new ApiError(403, { message: 'Acesso negado.' }) });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('Seu perfil não tem acesso ao Forecast.');
    expect(screen.getByLabelText('Quinzena')).toBeTruthy();
  });

  it('erro na lista mostra o alerta e nao pede detalhe', async () => {
    mockApi({}, new ApiError(500, null));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar o Forecast (HTTP 500).');
    expect(detalhesChamados()).toEqual([]);
  });

  it('backend antigo (sem n/historico/obs/precoFixo) renderiza sem erro', async () => {
    const antigas = LINHAS.map((l) => {
      const copia: Record<string, unknown> = { ...l };
      delete copia.n;
      delete copia.historico;
      delete copia.obs;
      delete copia.precoFixo;
      return copia;
    });
    mockApi({ 7: detalhe({ linhas: antigas }) });
    renderPage();
    expect(await screen.findByText('Cálculo idêntico ao da planilha')).toBeTruthy();
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO B', 'PRODUTO C']);
    expect(screen.queryByText('Fixo')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Colunas ocultas da planilha' }));
    expect(screen.getByRole('columnheader', { name: 'M1' })).toBeTruthy();
  });
});

describe('Forecast - importar quinzena', () => {
  it.each(['admin', 'comprador'])('%s ve o botao "Importar quinzena" (com lista e com lista vazia)', async (role) => {
    mockRole = role;
    mockApi({ 7: detalhe() });
    const comLista = renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.getByRole('button', { name: 'Importar quinzena' })).toBeTruthy();
    comLista.unmount();

    mockApi({}, []);
    renderPage();
    expect(await screen.findByText(/Use “Importar quinzena” para enviar a planilha ou os relatórios do DBCorp\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar quinzena' })).toBeTruthy();
  });

  it.each(['gestor', 'viewer'])('%s nao ve o botao e recebe o texto de pedir a um comprador', async (role) => {
    mockRole = role;
    mockApi({}, []);
    renderPage();
    expect(
      await screen.findByText('Nenhuma quinzena importada ainda. Peça a um comprador ou administrador para importar.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Importar quinzena' })).toBeNull();
    expect(screen.queryByText('Quinzena', { selector: 'label' })).toBeNull();
  });

  it('sem permissao e com lista, so o seletor aparece', async () => {
    mockRole = 'viewer';
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.queryByRole('button', { name: 'Importar quinzena' })).toBeNull();
    expect(screen.getByLabelText('Quinzena')).toBeTruthy();
  });

  it('ao fechar o modal o foco volta ao botao "Importar quinzena"', async () => {
    mockRole = 'comprador';
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const abrir = screen.getByRole('button', { name: 'Importar quinzena' });
    fireEvent.click(abrir);
    await screen.findByLabelText('Data-base');
    (screen.getByLabelText('Data-base') as HTMLElement).focus();
    expect(document.activeElement).not.toBe(abrir);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByLabelText('Data-base')).toBeNull());
    expect(document.activeElement).toBe(abrir);

    // reabrir e fechar pelo "Fechar" do cabecalho tambem devolve o foco
    fireEvent.click(abrir);
    await screen.findByLabelText('Data-base');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByLabelText('Data-base')).toBeNull());
    expect(document.activeElement).toBe(abrir);
  });

  it('fluxo integrado: planilha -> preview -> confirm 201 abre a quinzena nova', async () => {
    const novo = {
      id: 9,
      label: '12-2',
      baseDate: '2026-12-15T00:00:00.000Z',
      half: 2,
      origin: 'planilha',
      months: MONTHS,
      files: [],
      createdById: 1,
      createdAt: '2026-12-15T12:00:00.000Z',
    };
    let lista: unknown[] = RESUMOS;
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/snapshots') return { data: lista };
      const id = Number(path.split('/').pop());
      return { data: id === 9 ? detalhe({ id: 9, label: '12-2', baseDate: '2026-12-15' }) : detalhe() };
    });
    const resumo = {
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
    post.mockImplementation((async (path: string) => {
      if (path.endsWith('/preview')) return { data: resumo };
      lista = [...RESUMOS, novo];
      return { data: { ...resumo, snapshotId: 9, options: {} } };
    }) as typeof api.post);

    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    fireEvent.click(screen.getByRole('button', { name: 'Importar quinzena' }));
    fireEvent.change(await screen.findByLabelText('Data-base'), { target: { value: '2026-12-15' } });
    fireEvent.click(screen.getByLabelText('2ª'));
    fireEvent.change(screen.getByLabelText('Arquivo da planilha'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'planilha-teste.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar' }));
    await screen.findByRole('heading', { name: 'Pré-visualização da planilha' });
    const listasAntes = get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots').length;
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }));

    expect(await screen.findByText('Quinzena 12-2 importada.')).toBeTruthy();
    expect(await screen.findByText(/^Quinzena 12-2 · base 15\/12\/2026 · 3 produtos · origem planilha$/)).toBeTruthy();
    expect(get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots').length).toBeGreaterThan(listasAntes);
    expect(detalhesChamados()).toContain('/v1/forecast/snapshots/9');
    expect(screen.queryByRole('heading', { name: 'Importar quinzena' })).toBeNull();
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('9');

    // a mensagem some ao trocar de quinzena
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '7' } });
    await waitFor(() => expect(screen.queryByText('Quinzena 12-2 importada.')).toBeNull());
  });
});
