import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from '../Forecast';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: 'comprador' } }),
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
    productId: null,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

// Sem nenhuma venda em J..P: zera consumo e historico.
const SEM_VENDA = { O: 0, P: 0, Q: 0, R: 0, historico: [0, 0, 0, 0, 0] };

// A: com venda | B: sem venda ocultavel | C: sem venda com AN < 0 (entra no relatorio) | D: sem venda "cotando".
const LINHAS = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0002'], fonte: 'FONTE 2', AN: 50, ...SEM_VENDA }),
  linha({ linha: 5, n: 3, item: 'PRODUTO C', codigos: ['C0003'], fonte: 'FONTE 1', AN: -20, ...SEM_VENDA }),
  linha({ linha: 6, n: 4, item: 'PRODUTO D', codigos: ['C0004'], fonte: 'FONTE 3', status: 'cotando', AN: 30, ...SEM_VENDA }),
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
    quinzena: { id, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [
      {
        fonte: 'FONTE 1',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-10-22',
        vencidas: 0,
        itens: [
          {
            linha: 5,
            n: 3,
            item: 'PRODUTO C',
            codigos: ['C0003'],
            status: 'nao',
            demanda: -20,
            quantidadeSugerida: 20,
            embalagem: { usada: null, cadastradas: [], multiplas: false },
            quantidadeEmbalagens: null,
            quantidadeFinal: 20,
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

const PENDENTES_VAZIO = {
  aplicavel: true,
  snapshotId: 8,
  label: '11-1',
  itens: [],
  totalItens: 0,
  omitidos: 0,
  soSaldo: { codigos: 0, kg: 0 },
};

function mockApi(detalhes: Record<number, unknown>) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: RESUMOS };
    if (path.endsWith('/pendentes')) return { data: PENDENTES_VAZIO };
    if (path.endsWith('/relatorio-compras')) return { data: relatorioDe(Number(path.split('/')[4])) };
    return { data: detalhes[Number(path.split('/').pop())] };
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

const nomesDosItens = () =>
  screen.queryAllByRole('button', { name: /PRODUTO [A-E]/ }).map((b) => b.querySelector('.fc-item__nome')?.textContent);

const NOME_CHAVE = /^Mostrar produtos sem venda há 6 meses ou mais/;
const chave = () => screen.getByRole('switch', { name: NOME_CHAVE });
const avisoOcultos = () => document.querySelector('.fcsv-ocultos')?.textContent;
const selos = () => Array.from(document.querySelectorAll('.fcsv-selo')).map((s) => s.closest('tr')?.querySelector('.fc-item__nome')?.textContent);
const SUBTITULO_PADRAO = 'Quinzena 10-2 · base 15/10/2026 · 4 produtos · origem planilha';

async function abrirPainel(url?: string) {
  mockApi({ 7: detalhe(), 8: detalhe({ id: 8, label: '11-1', origin: 'dbcorp', baseDate: '2026-11-05' }) });
  const resultado = renderPage(url);
  await screen.findByText('Cálculo idêntico ao da planilha');
  return resultado;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Forecast - filtro sem venda ha 6 meses ou mais', () => {
  it('padrao: switch ligado, grade com todos, subtitulo e legenda iguais aos de hoje', async () => {
    await abrirPainel();
    expect(chave().getAttribute('aria-checked')).toBe('true');
    expect(chave().querySelector('.fc-filtro__conta')?.textContent).toBe('1');
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO B', 'PRODUTO C', 'PRODUTO D']);
    expect(screen.getByText(SUBTITULO_PADRAO)).toBeTruthy();
    expect(screen.getByText('4 de 4 produtos')).toBeTruthy();
    expect(avisoOcultos()).toBe('');
    expect(localStorage.length).toBe(0);
  });

  it('desligar oculta so os ocultaveis; chips recontam; legenda mantem o total; status anuncia N ocultos', async () => {
    await abrirPainel();
    const filtros = within(screen.getByRole('group', { name: 'Filtros' }));
    expect(filtros.getByRole('button', { name: 'Todos 4' })).toBeTruthy();

    fireEvent.click(chave());
    expect(chave().getAttribute('aria-checked')).toBe('false');
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO C', 'PRODUTO D']);
    expect(filtros.getByRole('button', { name: 'Todos 3' })).toBeTruthy();
    expect(filtros.getByRole('button', { name: 'Demanda ≤ 0 1' })).toBeTruthy();
    expect(filtros.getByRole('button', { name: 'Em andamento 1' })).toBeTruthy();
    expect(screen.getByText('3 de 4 produtos')).toBeTruthy();
    expect(avisoOcultos()).toBe('1 produto oculto pelo filtro de sem venda');
    expect(localStorage.getItem('iq-forecast-sem-venda:1')).toBe('ocultar');

    fireEvent.click(chave());
    expect(nomesDosItens()).toHaveLength(4);
    expect(avisoOcultos()).toBe('');
    expect(localStorage.getItem('iq-forecast-sem-venda:1')).toBeNull();
  });

  it('subtitulo mostra ocultos so no painel; na visao compras volta ao texto atual', async () => {
    await abrirPainel();
    fireEvent.click(chave());
    expect(screen.getByText('Quinzena 10-2 · base 15/10/2026 · 4 produtos (1 ocultos sem venda ≥6 meses) · origem planilha')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Relatório de compras' }));
    expect(await screen.findByText(SUBTITULO_PADRAO)).toBeTruthy();
    expect(screen.queryByText(/ocultos sem venda/)).toBeNull();
  });

  it('preferencia lembrada ao remontar a pagina (mesmo usuario)', async () => {
    const primeira = await abrirPainel();
    fireEvent.click(chave());
    primeira.unmount();

    // Nova montagem: a escolha vem do localStorage.
    await abrirPainel();
    expect(chave().getAttribute('aria-checked')).toBe('false');
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO C', 'PRODUTO D']);
  });

  it('selo "sem venda ≥6 meses" so nas linhas sem venda (inclusive as excecoes visiveis)', async () => {
    await abrirPainel();
    expect(selos()).toEqual(['PRODUTO B', 'PRODUTO C', 'PRODUTO D']);
    fireEvent.click(chave());
    // As excecoes (C: entra no relatorio; D: em andamento) continuam visiveis e com selo.
    expect(selos()).toEqual(['PRODUTO C', 'PRODUTO D']);
    expect(document.querySelector('.fcsv-selo')?.textContent).toBe('sem venda ≥6 meses');
  });

  it('todos ocultos: estado vazio especifico e memoria de calculo nao renderiza', async () => {
    const soSemVenda = [
      linha({ linha: 4, item: 'PRODUTO B', codigos: ['C0002'], ...SEM_VENDA, AN: 50 }),
      linha({ linha: 5, item: 'PRODUTO E', codigos: ['C0005'], ...SEM_VENDA, AN: 10 }),
    ];
    mockApi({ 7: detalhe({ linhas: soSemVenda }) });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.getByRole('region', { name: 'Memória de cálculo' })).toBeTruthy();

    fireEvent.click(chave());
    expect(
      screen.getByText('Todos os produtos desta quinzena estão ocultos pelo filtro “sem venda há 6 meses ou mais”.'),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Memória de cálculo' })).toBeNull();
    expect(screen.getByText('0 de 2 produtos')).toBeTruthy();
    expect(avisoOcultos()).toBe('2 produtos ocultos pelo filtro de sem venda');
  });

  it('busca que so casaria itens ocultos: mensagem informa quantos estao ocultos', async () => {
    await abrirPainel();
    fireEvent.click(chave());
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'C0002' } });
    expect(
      await screen.findByText('Nenhum produto visível com esses filtros: 1 sem venda há 6 meses ou mais está oculto.'),
    ).toBeTruthy();

    // Busca sem nenhum candidato oculto: texto atual.
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'nao existe' } });
    expect(await screen.findByText('Nenhum produto com esses filtros.')).toBeTruthy();
  });

  it('linha selecionada que fica oculta: memoria passa para a primeira visivel', async () => {
    await abrirPainel();
    const memoria = within(screen.getByRole('region', { name: 'Memória de cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: /PRODUTO B/ }));
    expect(memoria.getByRole('heading', { name: 'PRODUTO B' })).toBeTruthy();

    fireEvent.click(chave());
    expect(memoria.getByRole('heading', { name: 'PRODUTO A' })).toBeTruthy();
    expect(memoria.queryByRole('heading', { name: 'PRODUTO B' })).toBeNull();
  });

  it('teclado: foco no switch, click/Enter/Espaco alternam, foco permanece no switch, aria-checked atualiza', async () => {
    await abrirPainel();
    const botao = chave();
    // Botao nativo: Enter e Espaco disparam click no navegador; o handler nao intercepta as teclas.
    expect(botao.tagName).toBe('BUTTON');
    expect(botao.getAttribute('type')).toBe('button');
    botao.focus();
    expect(document.activeElement).toBe(botao);
    expect(fireEvent.keyDown(botao, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(botao, { key: ' ' })).toBe(true);

    fireEvent.click(botao);
    expect(botao.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(botao);
    expect(avisoOcultos()).toBe('1 produto oculto pelo filtro de sem venda');

    fireEvent.click(botao);
    expect(botao.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(botao);
  });

  it('selo de conferencia identico com o filtro ligado e desligado', async () => {
    await abrirPainel();
    const seloConferencia = () => document.querySelector('.fc-selo-conferencia')?.textContent;
    const ligado = seloConferencia();
    expect(ligado).toContain('Cálculo idêntico ao da planilha');
    fireEvent.click(chave());
    expect(seloConferencia()).toBe(ligado);
  });

  it('quinzena dbcorp aplica a mesma regra', async () => {
    mockApi({ 8: detalhe({ id: 8, label: '11-1', origin: 'dbcorp', baseDate: '2026-11-05' }) });
    renderPage('/forecast?quinzena=8');
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(screen.getByText('Quinzena 11-1 · base 05/11/2026 · 4 produtos · origem relatórios DBCorp')).toBeTruthy();
    expect(chave().querySelector('.fc-filtro__conta')?.textContent).toBe('1');
    fireEvent.click(chave());
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO C', 'PRODUTO D']);
    expect(
      screen.getByText('Quinzena 11-1 · base 05/11/2026 · 4 produtos (1 ocultos sem venda ≥6 meses) · origem relatórios DBCorp'),
    ).toBeTruthy();
  });

  it('relatorio de compras nao muda: visao compras renderiza os mesmos itens com o filtro desligado', async () => {
    const textoDaVisaoCompras = async (preferencia: 'ocultar' | null) => {
      localStorage.clear();
      if (preferencia) localStorage.setItem('iq-forecast-sem-venda:1', preferencia);
      mockApi({ 7: detalhe() });
      const { unmount } = renderPage('/forecast?visao=compras');
      await screen.findByText('PRODUTO C');
      const texto = document.body.textContent;
      unmount();
      return texto;
    };
    const ligado = await textoDaVisaoCompras(null);
    const desligado = await textoDaVisaoCompras('ocultar');
    expect(desligado).toBe(ligado);
    expect(desligado).not.toContain('Mostrar produtos sem venda');
  });

  it('backend antigo sem historico: nada e ocultado e contagem = 0', async () => {
    const antigas = LINHAS.map((l) => {
      const copia: Record<string, unknown> = { ...l };
      delete copia.historico;
      return copia;
    });
    mockApi({ 7: detalhe({ linhas: antigas }) });
    renderPage();
    await screen.findByText('Cálculo idêntico ao da planilha');
    expect(chave().querySelector('.fc-filtro__conta')?.textContent).toBe('0');
    expect(document.querySelectorAll('.fcsv-selo')).toHaveLength(0);

    fireEvent.click(chave());
    expect(nomesDosItens()).toEqual(['PRODUTO A', 'PRODUTO B', 'PRODUTO C', 'PRODUTO D']);
    expect(screen.getByText('4 de 4 produtos')).toBeTruthy();
    expect(screen.getByText(SUBTITULO_PADRAO)).toBeTruthy();
    expect(avisoOcultos()).toBe('');
  });
});
