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
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);

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

function relatorioDe(id: number) {
  return {
    quinzena: { id, label: id === 8 ? '11-1' : '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [
      {
        fonte: 'FONTE 2',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-10-22',
        vencidas: 0,
        itens: [
          {
            linha: 4,
            n: 2,
            item: 'PRODUTO B',
            codigos: ['C0003'],
            status: 'cotando',
            demanda: -40,
            quantidadeSugerida: 40,
            embalagem: { usada: null, cadastradas: [], multiplas: false },
            quantidadeEmbalagens: null,
            quantidadeFinal: 40,
            naoFraciona: false,
            ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
            dataLimite: '2026-10-22',
            vencida: false,
            leadTimeDias: 30,
            emAndamento: { chegadas: [], programacoes: [] },
          },
        ],
      },
    ],
  };
}

// Pendentes de cadastro (PR 3B-2), dados sinteticos: 1 sem cadastro e 1 de produto inativo.
const PENDENTES = {
  aplicavel: true,
  snapshotId: 8,
  label: '11-1',
  itens: [
    { codigo: 'TST0901', situacao: 'sem_cadastro', produtoInativo: null, vendasMes: 20, vendasAtual: 0, vendasAnual: 200, programacao: 0, chegadas: 80, saldo: 0 },
    { codigo: 'TST0902', situacao: 'produto_inativo', produtoInativo: { id: 9, nome: 'PRODUTO 009' }, vendasMes: 5, vendasAtual: 0, vendasAnual: 50, programacao: 0, chegadas: 0, saldo: 0 },
  ],
  totalItens: 2,
  omitidos: 0,
  soSaldo: { codigos: 0, kg: 0 },
};

function mockApi(detalhes: Record<number, unknown> | ((id: number) => unknown), lista: unknown = RESUMOS) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') {
      if (lista instanceof Error) throw lista;
      return { data: lista };
    }
    if (path.endsWith('/pendentes')) {
      return { data: { ...PENDENTES, snapshotId: Number(path.split('/')[4]) } };
    }
    if (path.endsWith('/relatorio-compras')) return { data: relatorioDe(Number(path.split('/')[4])) };
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
  get.mock.calls
    .map((c) => String(c[0]))
    .filter((p) => p.startsWith('/v1/forecast/snapshots/') && !p.endsWith('/relatorio-compras') && !p.endsWith('/pendentes'));

const pendentesChamados = () => get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/pendentes'));

const relatoriosChamados = () =>
  get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/relatorio-compras'));

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

  it('titulo mostra o selo Beta e o aviso de validacao', async () => {
    const aviso = 'Em validação: confira os números com a planilha do Forecast.';
    mockApi({}, []);
    const vazio = renderPage();
    await screen.findByText(/Nenhuma quinzena importada ainda/);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('Forecast de compras');
    expect(h1.querySelector('.fc-beta')?.textContent).toBe('Beta');
    expect(screen.getByText(aviso)).toBeTruthy();
    vazio.unmount();

    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.getByText(aviso)).toBeTruthy();
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

  it('regra AL: nota no selo quando ha chegada no 5o mes', async () => {
    mockApi({
      7: detalhe({ linhas: [linha({ chegadas: [0, 0, 0, 0, 50] }), ...LINHAS.slice(1)] }),
    });
    const { unmount } = renderPage();
    expect(await screen.findByText('Cálculo idêntico ao da planilha')).toBeTruthy();
    expect(
      screen.getByText(/^1 produto tem chegada em fev\/2027: o painel e o relatório somam essa chegada/),
    ).toBeTruthy();
    unmount();

    mockApi({ 7: detalhe() });
    renderPage();
    expect(await screen.findByText('Cálculo idêntico ao da planilha')).toBeTruthy();
    expect(screen.queryByText(/regra confirmada pelo Comex/)).toBeNull();
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

  it('divergencia so em coluna fora da grade: selo nomeia a coluna e nada e marcado', async () => {
    const colunas = [
      'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AC', 'AD', 'AE', 'AF', 'AG',
      'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AQ', 'AR', 'AS',
    ];
    mockApi({
      7: detalhe({
        conferencia: {
          celulas: 84,
          batem: 81,
          porColuna: Object.fromEntries(colunas.map((c) => [c, { celulas: 3, batem: c === 'AS' ? 0 : 3 }])),
          totalDivergencias: 3,
          divergencias: [4, 5, 6].map((linhaDaPlanilha) => ({
            linha: linhaDaPlanilha,
            item: 'PRODUTO B',
            coluna: 'AS',
            esperado: 12,
            calculado: 9,
          })),
        },
      }),
    });
    renderPage();
    expect(await screen.findByText('Diferenças só em colunas informativas')).toBeTruthy();
    expect(screen.getByText('81 de 84 células batem · 3 divergem')).toBeTruthy();
    expect(screen.getByText('3 em Clientes ativos 3m (col. AS) — coluna fora da grade')).toBeTruthy();
    expect(screen.getByText(/^Só colunas informativas divergem: a demanda, a projeção e o relatório de compras/)).toBeTruthy();
    expect(document.querySelectorAll('.fc-cell--diverge')).toHaveLength(0);
    expect(screen.queryByText('Há diferenças com a planilha')).toBeNull();
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

describe('Forecast - visao Relatorio de compras', () => {
  const botaoPainel = () => screen.getByRole('button', { name: 'Painel' });
  const botaoCompras = () => screen.getByRole('button', { name: 'Relatório de compras' });

  it('o padrao e o painel e nao pede o relatorio', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(botaoPainel().getAttribute('aria-pressed')).toBe('true');
    expect(botaoCompras().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('region', { name: 'Grade do Forecast' })).toBeTruthy();
    expect(relatoriosChamados()).toEqual([]);
  });

  it('clicar em "Relatorio de compras" pede o relatorio, esconde a grade e permite voltar ao painel', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    fireEvent.click(botaoCompras());

    expect(await screen.findByText('1 item em 1 fonte')).toBeTruthy();
    expect(botaoCompras().getAttribute('aria-pressed')).toBe('true');
    expect(botaoPainel().getAttribute('aria-pressed')).toBe('false');
    expect(relatoriosChamados()).toEqual(['/v1/forecast/snapshots/7/relatorio-compras']);
    expect(screen.queryByRole('region', { name: 'Grade do Forecast' })).toBeNull();
    expect(screen.queryByText('Cálculo idêntico ao da planilha')).toBeNull();
    expect(document.querySelector('.fc-grid')).toBeNull();

    fireEvent.click(botaoPainel());
    expect(await screen.findByRole('region', { name: 'Grade do Forecast' })).toBeTruthy();
    expect(screen.queryByText('1 item em 1 fonte')).toBeNull();
  });

  it('?quinzena=8&visao=compras abre direto o relatorio da quinzena pedida', async () => {
    mockApi({ 7: detalhe(), 8: detalhe({ id: 8, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'dbcorp', conferencia: null }) });
    renderPage('/forecast?quinzena=8&visao=compras');
    expect(await screen.findByText('1 item em 1 fonte')).toBeTruthy();
    expect(botaoCompras().getAttribute('aria-pressed')).toBe('true');
    expect(relatoriosChamados()).toEqual(['/v1/forecast/snapshots/8/relatorio-compras']);
    expect(screen.queryByRole('region', { name: 'Grade do Forecast' })).toBeNull();
  });

  it('trocar a quinzena mantem a visao; trocar a visao mantem a quinzena', async () => {
    mockApi({ 7: detalhe(), 8: detalhe({ id: 8, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'dbcorp', conferencia: null }) });
    renderPage('/forecast?visao=compras');
    await screen.findByText('1 item em 1 fonte');
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    await waitFor(() => expect(relatoriosChamados()).toContain('/v1/forecast/snapshots/8/relatorio-compras'));
    expect(botaoCompras().getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('8');

    fireEvent.click(botaoPainel());
    expect(await screen.findByRole('region', { name: 'Grade do Forecast' })).toBeTruthy();
    expect((screen.getByLabelText('Quinzena') as HTMLSelectElement).value).toBe('8');
  });
});

describe('Forecast - embalagens do item na memoria de calculo', () => {
  const EMBALAGENS = {
    produto: { id: 42, nome: 'PRODUTO A', ativo: true, embalagemPlanilha: null, naoFraciona: false },
    codigos: [
      { id: 1, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: null, principal: false, origem: 'manual', atualizadoEm: '2026-10-22' },
      { id: 2, posicao: 2, codigo: 'C0002', quantidadeKg: null, rotulo: null, principal: false, origem: null, atualizadoEm: null },
    ],
    usadaCodigoId: 1,
  };

  function mockComProduto() {
    mockApi({ 7: detalhe({ linhas: [linha({ productId: 42 }), ...LINHAS.slice(1)] }) });
    const base = get.getMockImplementation();
    get.mockImplementation(async (path: string, query?: unknown) => {
      if (path === '/v1/forecast/products/42/embalagens') return { data: EMBALAGENS };
      return (base as (p: string, q?: unknown) => Promise<unknown>)(path, query);
    });
  }

  it.each(['admin', 'comprador', 'gestor', 'viewer'])('%s ve o botao "Embalagens do item" na memoria', async (role) => {
    mockRole = role;
    mockComProduto();
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const memoria = within(screen.getByRole('region', { name: 'Memória de cálculo' }));
    const botao = memoria.getByRole('button', { name: 'Embalagens do item' });
    expect(botao.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('linha sem productId mostra "Produto fora do cadastro" e nenhum botao', async () => {
    mockApi({ 7: detalhe() });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const memoria = within(screen.getByRole('region', { name: 'Memória de cálculo' }));
    expect(memoria.getByText('Produto fora do cadastro')).toBeTruthy();
    expect(memoria.queryByRole('button', { name: 'Embalagens do item' })).toBeNull();
  });

  it('o modal do viewer abre em leitura (sem campos de texto)', async () => {
    mockRole = 'viewer';
    mockComProduto();
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    fireEvent.click(within(screen.getByRole('region', { name: 'Memória de cálculo' })).getByRole('button', { name: 'Embalagens do item' }));
    expect(await screen.findByText('Somente admin e comprador editam embalagens.')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Salvar embalagens' })).toBeNull();
  });

  it('o modal do admin abre em edicao e fechar devolve o foco ao botao', async () => {
    mockRole = 'admin';
    mockComProduto();
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    const botao = within(screen.getByRole('region', { name: 'Memória de cálculo' })).getByRole('button', { name: 'Embalagens do item' });
    fireEvent.click(botao);
    expect(await screen.findByLabelText('Quantidade em kg do código C0001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByLabelText('Quantidade em kg do código C0001')).toBeNull());
    expect(document.activeElement).toBe(botao);
  });
});

describe('Forecast - pendentes de cadastro (PR 3B-2)', () => {
  const DBCORP = detalhe({ id: 8, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'dbcorp', conferencia: null });

  it('quinzena DBCorp mostra o painel (so a quinzena aberta consulta); quinzena da planilha nao', async () => {
    mockApi({ 7: detalhe(), 8: DBCORP });
    const planilha = renderPage('/forecast?quinzena=7');
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.queryByText(/Pendentes de cadastro/)).toBeNull();
    expect(pendentesChamados()).toEqual([]);
    planilha.unmount();

    vi.clearAllMocks();
    mockApi({ 7: detalhe(), 8: DBCORP });
    renderPage('/forecast?quinzena=8');
    expect(await screen.findByText(/Pendentes de cadastro \(2\)/)).toBeTruthy();
    expect(pendentesChamados()).toEqual(['/v1/forecast/snapshots/8/pendentes']);
    expect(
      screen.getByText(/Esses códigos ficaram FORA do cálculo da quinzena 11-1\./),
    ).toBeTruthy();
  });

  it.each(['admin', 'comprador'])('%s ve "Completar cadastro" so no codigo sem cadastro', async (role) => {
    mockRole = role;
    mockApi({ 7: detalhe(), 8: DBCORP });
    renderPage('/forecast?quinzena=8');
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    expect(screen.getAllByRole('button', { name: /Completar cadastro do código/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Completar cadastro do código TST0901' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Completar cadastro do código TST0902' })).toBeNull();
  });

  it.each(['gestor', 'viewer'])('%s so ve a lista (sem botao nem coluna Acao)', async (role) => {
    mockRole = role;
    mockApi({ 7: detalhe(), 8: DBCORP });
    renderPage('/forecast?quinzena=8');
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    expect(screen.getByText('TST0901')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Completar cadastro/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Ação' })).toBeNull();
  });
});

describe('Forecast - compra sob demanda na memoria de calculo (PR 6a)', () => {
  const ROTULO = 'Só compra quando o cliente envia a programação';
  const memoria = () => within(screen.getByRole('region', { name: 'Memória de cálculo' }));

  async function abrir(over: Record<string, unknown> = {}) {
    mockApi({ 7: detalhe({ linhas: [linha({ productId: 42, sobDemanda: false, sobDemandaMotivo: null, ...over }), ...LINHAS.slice(1)] }) });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
  }

  it.each(['admin', 'comprador'])('%s ve o controle (caixa, motivo e Salvar) na memoria', async (role) => {
    mockRole = role;
    await abrir();
    expect(memoria().getByRole('checkbox', { name: ROTULO })).toBeTruthy();
    expect(memoria().getByRole('textbox', { name: 'Motivo (opcional)' })).toBeTruthy();
    expect(memoria().getByRole('button', { name: 'Salvar' })).toBeTruthy();
  });

  it.each(['gestor', 'viewer'])('%s so le: "Compra regular" ou o motivo, sem controle', async (role) => {
    mockRole = role;
    await abrir();
    expect(memoria().getByText('Compra regular')).toBeTruthy();
    expect(memoria().queryByRole('checkbox')).toBeNull();
    expect(memoria().queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('leitor ve o motivo da marca no texto padrao', async () => {
    mockRole = 'viewer';
    await abrir({ sobDemanda: true, sobDemandaMotivo: 'MOTIVO SINTETICO' });
    expect(memoria().getByText('Compra sob programação do cliente: MOTIVO SINTETICO')).toBeTruthy();
  });

  it('produto fora do cadastro e backend antigo (sem a marca no dado): "—" e nenhum controle', async () => {
    mockRole = 'admin';
    mockApi({ 7: detalhe() });
    const { unmount } = renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(memoria().queryByRole('checkbox')).toBeNull();
    unmount();

    mockApi({ 7: detalhe({ linhas: [linha({ productId: 42 }), ...LINHAS.slice(1)] }) });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(memoria().queryByRole('checkbox')).toBeNull();
  });

  it('marcar com motivo grava por PATCH, avisa em role=status e mantem o foco no botao', async () => {
    mockRole = 'comprador';
    await abrir();
    patch.mockResolvedValue({ data: { productId: 42, sobDemanda: true, motivo: 'MOTIVO SINTETICO' } });
    const salvar = memoria().getByRole('button', { name: 'Salvar' });
    expect(salvar.getAttribute('aria-disabled')).toBe('true');
    const motivo = memoria().getByRole('textbox', { name: 'Motivo (opcional)' }) as HTMLInputElement;
    expect(motivo.disabled).toBe(true);

    fireEvent.click(memoria().getByRole('checkbox', { name: ROTULO }));
    expect(motivo.disabled).toBe(false);
    fireEvent.change(motivo, { target: { value: '  MOTIVO SINTETICO ' } });
    expect(salvar.getAttribute('aria-disabled')).toBe('false');
    salvar.focus();
    fireEvent.click(salvar);

    expect(await screen.findByText('Salvo. O relatório foi atualizado.')).toBeTruthy();
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/42/compra-sob-demanda', {
      sobDemanda: true,
      motivo: 'MOTIVO SINTETICO',
    });
    expect(memoria().getByText('Salvo. O relatório foi atualizado.').getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(salvar);
    expect(salvar.getAttribute('aria-disabled')).toBe('true');
  });

  it('marcar sem motivo envia motivo nulo; desmarcar envia sobDemanda false e motivo nulo', async () => {
    mockRole = 'admin';
    await abrir({ sobDemanda: true, sobDemandaMotivo: 'MOTIVO SINTETICO' });
    patch.mockResolvedValue({ data: { productId: 42, sobDemanda: false, motivo: null } });
    const caixa = memoria().getByRole('checkbox', { name: ROTULO }) as HTMLInputElement;
    expect(caixa.checked).toBe(true);
    expect((memoria().getByRole('textbox', { name: 'Motivo (opcional)' }) as HTMLInputElement).value).toBe('MOTIVO SINTETICO');
    fireEvent.click(caixa);
    fireEvent.click(memoria().getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/v1/forecast/products/42/compra-sob-demanda', { sobDemanda: false, motivo: null });
  });

  it('motivo curto: erro no proprio campo (aria-invalid + aria-describedby) e nada e enviado', async () => {
    mockRole = 'admin';
    await abrir();
    fireEvent.click(memoria().getByRole('checkbox', { name: ROTULO }));
    const motivo = memoria().getByRole('textbox', { name: 'Motivo (opcional)' });
    fireEvent.change(motivo, { target: { value: 'ab' } });
    expect(motivo.getAttribute('aria-invalid')).toBe('true');
    const erro = memoria().getByText('O motivo precisa ter ao menos 3 caracteres.');
    expect(motivo.getAttribute('aria-describedby')).toBe(erro.id);
    const salvar = memoria().getByRole('button', { name: 'Salvar' });
    expect(salvar.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(salvar);
    expect(patch).not.toHaveBeenCalled();
  });

  it('erro do servidor: alerta com a mensagem e o rascunho continua', async () => {
    mockRole = 'admin';
    await abrir();
    patch.mockRejectedValue(new ApiError(403, null));
    fireEvent.click(memoria().getByRole('checkbox', { name: ROTULO }));
    fireEvent.click(memoria().getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Seu perfil não pode marcar compra sob demanda.');
    expect((memoria().getByRole('checkbox', { name: ROTULO }) as HTMLInputElement).checked).toBe(true);
  });

  it('depois de salvar, a quinzena e o relatorio sao lidos de novo (a marca vale para todas as quinzenas)', async () => {
    mockRole = 'admin';
    await abrir();
    patch.mockResolvedValue({ data: { productId: 42, sobDemanda: true, motivo: null } });
    const antes = detalhesChamados().length;
    fireEvent.click(memoria().getByRole('checkbox', { name: ROTULO }));
    fireEvent.click(memoria().getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Salvo. O relatório foi atualizado.');
    await waitFor(() => expect(detalhesChamados().length).toBeGreaterThan(antes));
  });
});

describe('Forecast - meses atipicos na memoria de calculo (PR 6c)', () => {
  const put = vi.mocked(api.put);
  const memoria = () => within(screen.getByRole('region', { name: 'Memória de cálculo' }));
  const MARCA = { anoMes: '2026-08', motivo: 'VENDA ATIPICA SINTETICA', indice: 4 };
  // Caso A do plano (sintetico): J..N = 300 300 300 300 2100 (N = ago/2026 atipico), O 300, P 100; media sem ago/2026.
  const ATIPICA = {
    productId: 42,
    historico: [300, 300, 300, 300, 2100],
    O: 300,
    P: 100,
    Q: 300,
    R: 300,
    AG: 300,
    mesesForaDaMedia: [MARCA],
    mediaAjustada: { meses: [4], Q: 900, R: 600, AG: 900, semMesValido: false },
  };

  async function abrir(over: Record<string, unknown> = {}, detalheOver: Record<string, unknown> = {}) {
    mockApi({ 7: detalhe({ linhas: [linha({ productId: 42, mesesForaDaMedia: [], ...over }), ...LINHAS.slice(1)], ...detalheOver }) });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
  }

  it('mostra a conta com os meses restantes, o mes excluido e quanto seria pela planilha', async () => {
    mockRole = 'comprador';
    await abrir(ATIPICA);
    expect(memoria().getByText('(300 + 300) ÷ 2')).toBeTruthy();
    expect(memoria().getByText('média usa 2 de 3 meses (excluído: ago/2026) · pela planilha seria 900,0')).toBeTruthy();
  });

  it.each(['admin', 'comprador'])('%s ve o botao "Meses fora da média" e a lista de meses marcados', async (role) => {
    mockRole = role;
    await abrir(ATIPICA);
    expect(memoria().getByRole('button', { name: 'Meses fora da média' })).toBeTruthy();
    expect(memoria().getByText('VENDA ATIPICA SINTETICA', { exact: false })).toBeTruthy();
  });

  it.each(['gestor', 'viewer'])('%s so ve os meses marcados e o motivo, sem botao', async (role) => {
    mockRole = role;
    await abrir(ATIPICA);
    expect(memoria().getByText('VENDA ATIPICA SINTETICA', { exact: false })).toBeTruthy();
    expect(memoria().queryByRole('button', { name: 'Meses fora da média' })).toBeNull();
  });

  it('sem marca: "Nenhum mês fora da média"; produto fora do cadastro ou backend antigo: "—" e sem botao', async () => {
    mockRole = 'admin';
    await abrir();
    expect(memoria().getByText('Nenhum mês fora da média')).toBeTruthy();
    expect(memoria().getByRole('button', { name: 'Meses fora da média' })).toBeTruthy();
    expect(memoria().queryByText(/média usa/)).toBeNull();
  });

  it('backend antigo (sem mesesForaDaMedia no dado) e produto fora do cadastro: nenhum controle', async () => {
    mockRole = 'admin';
    mockApi({ 7: detalhe({ linhas: [linha({ productId: 42 }), ...LINHAS.slice(1)] }) });
    const { unmount } = renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(memoria().queryByRole('button', { name: 'Meses fora da média' })).toBeNull();
    unmount();

    mockApi({ 7: detalhe({ linhas: [linha({ productId: null, mesesForaDaMedia: [] }), ...LINHAS.slice(1)] }) });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(memoria().queryByRole('button', { name: 'Meses fora da média' })).toBeNull();
  });

  it('modal: 7 meses com a venda de cada um, o mes marcado ja vem marcado com o motivo', async () => {
    mockRole = 'admin';
    await abrir(ATIPICA);
    fireEvent.click(memoria().getByRole('button', { name: 'Meses fora da média' }));
    const dialogo = within(await screen.findByRole('dialog'));
    const linhas = dialogo.getAllByRole('row').slice(1);
    expect(linhas.map((l) => within(l).getAllByRole('cell')[0]?.textContent ?? l.querySelector('th')?.textContent)).toBeTruthy();
    expect(dialogo.getAllByRole('checkbox')).toHaveLength(7);
    const caixaAgosto = dialogo.getByRole('checkbox', { name: 'Venda atípica em ago/2026' }) as HTMLInputElement;
    expect(caixaAgosto.checked).toBe(true);
    expect((dialogo.getByRole('textbox', { name: 'Motivo da venda atípica em ago/2026' }) as HTMLInputElement).value).toBe(
      'VENDA ATIPICA SINTETICA',
    );
    // Os outros meses nao tem marca e o motivo fica desabilitado ate marcar.
    expect((dialogo.getByRole('textbox', { name: 'Motivo da venda atípica em set/2026' }) as HTMLInputElement).disabled).toBe(true);
    // Venda do mes e o mes atual identificado.
    expect(dialogo.getByText('2.100')).toBeTruthy();
    expect(dialogo.getByText(/mês atual, até o dia 15/)).toBeTruthy();
    expect((dialogo.getByRole('button', { name: 'Salvar meses atípicos' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marcar outro mes exige motivo; salva por PUT com a janela e fecha, relendo a quinzena e o relatorio', async () => {
    mockRole = 'comprador';
    await abrir(ATIPICA);
    put.mockResolvedValue({ data: { productId: 42, meses: [] } });
    const antes = detalhesChamados().length;
    fireEvent.click(memoria().getByRole('button', { name: 'Meses fora da média' }));
    const dialogo = within(await screen.findByRole('dialog'));
    const salvar = dialogo.getByRole('button', { name: 'Salvar meses atípicos' }) as HTMLButtonElement;

    fireEvent.click(dialogo.getByRole('checkbox', { name: 'Venda atípica em set/2026' }));
    const motivo = dialogo.getByRole('textbox', { name: 'Motivo da venda atípica em set/2026' });
    expect(motivo.getAttribute('aria-invalid')).toBe('true');
    const erro = dialogo.getByText('Informe o motivo (ao menos 3 caracteres).');
    expect(motivo.getAttribute('aria-describedby')).toBe(erro.id);
    expect(salvar.disabled).toBe(true);

    fireEvent.change(motivo, { target: { value: '  OUTRA VENDA ATIPICA  ' } });
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/v1/forecast/products/42/meses-atipicos', {
      meses: [
        { anoMes: '2026-08', motivo: 'VENDA ATIPICA SINTETICA' },
        { anoMes: '2026-09', motivo: 'OUTRA VENDA ATIPICA' },
      ],
      janela: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(detalhesChamados().length).toBeGreaterThan(antes));
    // O foco volta ao botao que abriu o dialogo.
    expect(document.activeElement).toBe(memoria().getByRole('button', { name: 'Meses fora da média' }));
  });

  it('desmarcar o unico mes envia a lista vazia (com a janela)', async () => {
    mockRole = 'admin';
    await abrir(ATIPICA);
    put.mockResolvedValue({ data: { productId: 42, meses: [] } });
    fireEvent.click(memoria().getByRole('button', { name: 'Meses fora da média' }));
    const dialogo = within(await screen.findByRole('dialog'));
    fireEvent.click(dialogo.getByRole('checkbox', { name: 'Venda atípica em ago/2026' }));
    fireEvent.click(dialogo.getByRole('button', { name: 'Salvar meses atípicos' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]?.[1]).toMatchObject({ meses: [] });
  });

  it('avisa quando os 3 meses da media trimestral e o mes atual estao marcados', async () => {
    mockRole = 'admin';
    await abrir();
    fireEvent.click(memoria().getByRole('button', { name: 'Meses fora da média' }));
    const dialogo = within(await screen.findByRole('dialog'));
    for (const mes of ['jul/2026', 'ago/2026', 'set/2026', 'out/2026']) {
      fireEvent.click(dialogo.getByRole('checkbox', { name: `Venda atípica em ${mes}` }));
    }
    expect(dialogo.getByText(/Os 3 meses da média trimestral estão marcados/)).toBeTruthy();
    expect(dialogo.getByText(/Mês atual marcado: o consumo do mês \(AG\) fica igual à média trimestral/)).toBeTruthy();
  });

  it('erro do servidor: alerta com a mensagem e o dialogo continua aberto', async () => {
    mockRole = 'admin';
    await abrir(ATIPICA);
    put.mockRejectedValue(new ApiError(403, null));
    fireEvent.click(memoria().getByRole('button', { name: 'Meses fora da média' }));
    const dialogo = within(await screen.findByRole('dialog'));
    fireEvent.click(dialogo.getByRole('checkbox', { name: 'Venda atípica em ago/2026' }));
    fireEvent.click(dialogo.getByRole('button', { name: 'Salvar meses atípicos' }));
    expect((await dialogo.findByRole('alert')).textContent).toBe('Seu perfil não pode marcar meses atípicos.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('grade: celula do mes marcado riscada com o motivo, Q com asterisco e title; selo avisa', async () => {
    mockRole = 'viewer';
    await abrir(ATIPICA);
    // Os meses mais antigos ficam ocultos por padrao; ago/2026 (N) e a 5a coluna de consumo e e visivel.
    const celulas = Array.from(document.querySelectorAll('td.fc-cell--fora-media'));
    expect(celulas).toHaveLength(1);
    expect(celulas[0]?.getAttribute('title')).toBe('Venda atípica, fora da média: VENDA ATIPICA SINTETICA');
    expect(celulas[0]?.textContent).toBe('2.100');
    const q = Array.from(document.querySelectorAll('tbody tr.fc-row'))[0]?.querySelector('td[title^="Média sem meses atípicos"]');
    expect(q?.textContent).toBe('300,0*');
    expect(q?.getAttribute('title')).toBe('Média sem meses atípicos (ago/2026) · pela planilha seria 900,0');
    expect(
      screen.getByText(
        '1 produto tem meses fora da média: o painel e o relatório usam a média sem esses meses. A conferência acima usa a regra da planilha.',
      ),
    ).toBeTruthy();
  });

  it('sem meses marcados: nenhuma celula riscada, sem asterisco e sem nota no selo', async () => {
    mockRole = 'viewer';
    await abrir();
    expect(document.querySelectorAll('.fc-cell--fora-media')).toHaveLength(0);
    expect(screen.queryByText(/meses fora da média: o painel/)).toBeNull();
    expect(document.querySelectorAll('td[title^="Média sem meses atípicos"]')).toHaveLength(0);
  });
});
