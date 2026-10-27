import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
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
const put = vi.mocked(api.put);
const del = vi.mocked(api.del);

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
    analiseForecast: 50,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

const LINHAS = [linha(), linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0003'], analiseForecast: 70, productId: null })];

function detalhe(id: number) {
  return {
    id,
    label: id === 8 ? '11-1' : '10-2',
    baseDate: id === 8 ? '2026-11-05' : '2026-10-15',
    half: id === 8 ? 1 : 2,
    origin: 'planilha',
    hoje: '2026-10-20',
    months: MONTHS,
    files: [],
    createdAt: '2026-10-20T12:00:00.000Z',
    linhas: LINHAS,
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
  };
}

function resumo(id: number) {
  return {
    id,
    label: id === 8 ? '11-1' : '10-2',
    baseDate: id === 8 ? '2026-11-05T00:00:00.000Z' : '2026-10-15T00:00:00.000Z',
    half: id === 8 ? 1 : 2,
    origin: 'planilha',
    months: MONTHS,
    files: [],
    createdById: 1,
    createdAt: '2026-10-20T12:00:00.000Z',
  };
}

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
            linha: 3,
            n: 1,
            productId: 42,
            item: 'PRODUTO A',
            codigos: ['C0001'],
            status: 'nao',
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

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 1600,
    status: 'cotando',
    observacao: null,
    sugeridaKg: 40,
    demandaKg: -40,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

type RespostaDecisoes = (id: number) => Promise<unknown> | unknown;

function mockApi(decisoes: RespostaDecisoes, quinzenas: number[] = [7]) {
  let lista = [...quinzenas];
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: lista.map(resumo) };
    if (path === '/v1/forecast/products') return { data: [] };
    const id = Number(path.split('/')[4]);
    if (!lista.includes(id)) throw new ApiError(404, null);
    if (path.endsWith('/decisoes')) return decisoes(id);
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    if (path.endsWith('/relatorio-compras')) return { data: relatorioDe(id) };
    return { data: detalhe(id) };
  });
  del.mockImplementation(async (path: string) => {
    const id = Number(path.split('/').pop());
    lista = lista.filter((x) => x !== id);
    return { data: { id, label: '10-2', excluida: true } };
  });
}

const comDecisoes = (...ds: ForecastDecisao[]): RespostaDecisoes => () => ({ data: { decisoes: ds } });

function renderPage(clientOpts: { staleTime?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, ...clientOpts } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

const decisoesChamadas = () => get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/decisoes'));

/** `td` da coluna ANALISE FORECAST da linha do item (as 2 primeiras celulas sao N e ITENS). */
async function celulaAnalise(nomeDoItem: string): Promise<HTMLTableCellElement> {
  const grade = await screen.findByRole('region', { name: 'Grade do Forecast' });
  const rotulos = Array.from(grade.querySelectorAll('tr.fc-rotulos th'));
  const i = rotulos.findIndex((th) => th.textContent === 'ANÁLISE FORECAST');
  expect(i).toBeGreaterThanOrEqual(0);
  const botao = Array.from(grade.querySelectorAll('button.fc-item')).find((b) => b.textContent?.includes(nomeDoItem));
  expect(botao).toBeTruthy();
  const td = botao!.closest('tr')!.querySelectorAll('td')[i + 2];
  return td as HTMLTableCellElement;
}

/** Texto visivel da celula (sem o trecho so para leitor de tela). */
const textoDaCelula = (td: HTMLElement) => td.firstChild?.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

describe('Painel - coluna ANALISE FORECAST com a quantidade decidida', () => {
  it.each(['admin', 'comprador', 'gestor', 'viewer'])('%s ve a quantidade decidida, com dica e texto acessivel', async (papel) => {
    mockRole = papel;
    mockApi(comDecisoes(decisao({ observacao: 'OBS SINTETICA' })));
    renderPage();
    await waitFor(async () => {
      expect((await celulaAnalise('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('1.600,0');
    });
    const td = await celulaAnalise('PRODUTO A');
    expect(td.getAttribute('title')).toContain('decidida em 26/10');
    expect(td.getAttribute('title')).toContain('Obs.: OBS SINTETICA');
    const oculto = td.querySelector('.sr-only');
    expect(oculto).toBeTruthy();
    expect(oculto?.textContent).toBe(` — ${td.getAttribute('title')}`);
  });

  it('sem decisao a celula mostra o valor congelado, sem ponto de status', async () => {
    mockApi(comDecisoes());
    renderPage();
    await waitFor(async () => expect(decisoesChamadas()).toHaveLength(1));
    const td = await celulaAnalise('PRODUTO A');
    expect(textoDaCelula(td)).toBe('50,0');
    expect(td.querySelector('.fcad-decidida')).toBeNull();
    expect(td.querySelector('.sr-only')).toBeNull();
    // Linha sem productId: sempre o congelado.
    expect(textoDaCelula(await celulaAnalise('PRODUTO B'))).toBe('70,0');
  });

  it('faz 1 GET de decisoes por quinzena; trocar de quinzena busca exatamente 1 da nova', async () => {
    mockApi(comDecisoes(), [7, 8]);
    renderPage();
    await celulaAnalise('PRODUTO A');
    await waitFor(() => expect(decisoesChamadas()).toEqual(['/v1/forecast/snapshots/7/decisoes']));
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    await waitFor(() => expect(decisoesChamadas()).toContain('/v1/forecast/snapshots/8/decisoes'));
    await celulaAnalise('PRODUTO A');
    expect(decisoesChamadas().filter((p) => p.includes('/snapshots/8/'))).toHaveLength(1);
  });

  it('erro nas decisoes: a grade fica, mostra o congelado e avisa; "Tentar de novo" refaz o GET', async () => {
    let falhar = true;
    mockApi(() => {
      if (falhar) throw new ApiError(500, null);
      return { data: { decisoes: [decisao()] } };
    });
    renderPage();
    const aviso = await screen.findByText(/Não foi possível carregar as quantidades decididas/);
    expect(aviso.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Grade do Forecast' })).toBeTruthy();
    expect(textoDaCelula(await celulaAnalise('PRODUTO A'))).toBe('50,0');
    expect(screen.queryByRole('alert')).toBeNull();

    falhar = false;
    fireEvent.click(within(aviso.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(async () => {
      expect((await celulaAnalise('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('1.600,0');
    });
    expect(screen.queryByText(/Não foi possível carregar as quantidades decididas/)).toBeNull();
  });

  it('carregando: a grade aparece com o congelado e o aviso de carregamento', async () => {
    mockApi(() => new Promise(() => {}));
    renderPage();
    const aviso = await screen.findByText('Carregando as quantidades decididas…');
    expect(aviso.getAttribute('role')).toBe('status');
    expect(textoDaCelula(await celulaAnalise('PRODUTO A'))).toBe('50,0');
  });

  it('compartilha o cache com o relatorio: salvar la atualiza a grade sem novo GET', async () => {
    mockApi(comDecisoes(decisao()));
    put.mockResolvedValue({
      data: { acao: 'update', decisao: decisao({ quantidadeKg: 2000, atualizadaEm: '2026-10-27T15:00:00.000Z' }) },
    } as never);
    renderPage({ staleTime: Infinity });
    await waitFor(async () => {
      expect((await celulaAnalise('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('1.600,0');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Relatório de compras' }));
    const campo = (await screen.findByLabelText('Qtd. decidida (kg) de PRODUTO A')) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar decisão de PRODUTO A' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Painel' }));
    await waitFor(async () => {
      expect((await celulaAnalise('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('2.000,0');
    });
    expect(decisoesChamadas()).toHaveLength(1);
  });

  it('excluir a quinzena tira as decisoes dela do cache', async () => {
    mockApi(comDecisoes(decisao()), [7, 8]);
    const { client } = renderPage();
    await waitFor(async () => {
      expect((await celulaAnalise('PRODUTO A')).querySelector('.fcad-decidida')).toBeTruthy();
    });
    expect(client.getQueryData(['forecast', 'decisoes', 7])).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir quinzena' }));
    const dialogo = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent.change(within(dialogo).getByLabelText(/Para confirmar, digite/), { target: { value: '10-2' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir quinzena' }));

    expect(await screen.findByText('Quinzena 10-2 excluída.')).toBeTruthy();
    await waitFor(() => expect(client.getQueryData(['forecast', 'decisoes', 7])).toBeUndefined());
  });
});
