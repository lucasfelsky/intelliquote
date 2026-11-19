import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { forecastDecisoesKeys, type ForecastDecisao } from '@/services/forecastDecisoes';
import Forecast from '../Forecast';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: 'viewer' } }),
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

// Painel: o status da compra (rotulo, classe fc-status--*, chip "Em andamento") segue a cotacao vinculada, como no
// Relatorio de compras. Dados 100% sinteticos.
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

let linhasDoDetalhe: unknown[] = [linha()];

function detalhe(id: number) {
  return {
    id,
    label: '10-2',
    baseDate: '2026-10-15',
    half: 2,
    origin: 'planilha',
    hoje: '2026-10-20',
    months: MONTHS,
    files: [],
    createdAt: '2026-10-20T12:00:00.000Z',
    linhas: linhasDoDetalhe,
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
  };
}

function resumo(id: number) {
  return {
    id,
    label: '10-2',
    baseDate: '2026-10-15T00:00:00.000Z',
    half: 2,
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

const enviada = (): ForecastDecisao =>
  decisao({
    cotacao: { id: 1, requestCode: 'AO/UV-17112026', statusCotacao: 'enviada' },
    statusDerivado: 'cotando',
  });

type RespostaDecisoes = () => Promise<unknown> | unknown;
let respostaDecisoes: RespostaDecisoes = () => ({ data: { decisoes: [] } });

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: [resumo(7)] };
    if (path === '/v1/forecast/products') return { data: [] };
    if (path.endsWith('/decisoes')) return respostaDecisoes();
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    if (path.endsWith('/relatorio-compras')) return { data: relatorioDe(7) };
    return { data: detalhe(7) };
  });
}

function renderPage(url = '/forecast?quinzena=7') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

/** `td` ITENS da linha do item na grade do Painel. */
async function celulaItem(nome: string): Promise<HTMLTableCellElement> {
  const grade = await screen.findByRole('region', { name: 'Grade do Forecast' });
  const link = Array.from(grade.querySelectorAll('a.fc-item')).find((a) => a.textContent?.includes(nome));
  expect(link).toBeTruthy();
  return link!.closest('td') as HTMLTableCellElement;
}

const classesDeStatus = (td: HTMLElement) => Array.from(td.classList).filter((c) => c.startsWith('fc-status--'));

function chipAndamento() {
  const botao = screen.getByRole('button', { name: /^Em andamento/ });
  return { botao, conta: botao.querySelector('.fc-filtro__conta')?.textContent };
}

beforeEach(() => {
  vi.clearAllMocks();
  linhasDoDetalhe = [linha()];
  respostaDecisoes = () => ({ data: { decisoes: [] } });
  mockApi();
});

describe('Painel - status da compra derivado da cotacao vinculada', () => {
  it('(a) cotacao enviada: rotulo, classe e chip "Em andamento" seguem a cotacao, nao o congelado', async () => {
    respostaDecisoes = () => ({ data: { decisoes: [enviada()] } });
    renderPage();
    await waitFor(async () => expect(classesDeStatus(await celulaItem('PRODUTO A'))).toEqual(['fc-status--cotando']));
    const td = await celulaItem('PRODUTO A');
    expect(td.textContent).toContain('Cotando');
    expect(td.textContent).not.toContain('Cotação não enviada');
    expect(chipAndamento().conta).toBe('1');

    fireEvent.click(chipAndamento().botao);
    const tdDepois = await celulaItem('PRODUTO A');
    expect(tdDepois.textContent).toContain('Cotando');
    expect(screen.getByText('1 de 1 produtos')).toBeTruthy();
  });

  it('(b) cotacao criada: rotulo "Cotação criada", classe "nao" e fora de "Em andamento"', async () => {
    respostaDecisoes = () => ({
      data: {
        decisoes: [
          decisao({
            cotacao: { id: 1, requestCode: 'AO/UV-17112026', statusCotacao: 'criada' },
            statusDerivado: 'cotacao_criada',
          }),
        ],
      },
    });
    renderPage();
    await waitFor(async () => expect((await celulaItem('PRODUTO A')).textContent).toContain('Cotação criada'));
    const td = await celulaItem('PRODUTO A');
    expect(classesDeStatus(td)).toEqual(['fc-status--nao']);
    expect(td.textContent).not.toContain('Cotação não enviada');
    expect(chipAndamento().conta).toBe('0');
  });

  it('(c) decisoes pendentes: a grade aparece com o status congelado', async () => {
    respostaDecisoes = () => new Promise(() => {});
    renderPage();
    const td = await celulaItem('PRODUTO A');
    expect(td.textContent).toContain('Cotação não enviada');
    expect(classesDeStatus(td)).toEqual(['fc-status--nao']);
    expect(chipAndamento().conta).toBe('0');
  });

  it('(d) decisoes com erro: a grade aparece com o status congelado', async () => {
    respostaDecisoes = () => {
      throw new ApiError(500, null);
    };
    renderPage();
    await screen.findByTestId('fc-avisos-botao');
    const td = await celulaItem('PRODUTO A');
    expect(td.textContent).toContain('Cotação não enviada');
    expect(classesDeStatus(td)).toEqual(['fc-status--nao']);
  });

  it('(e) linha pendente de cadastro: nenhum texto de status na celula (FZ4), mesmo com decisao vinculada', async () => {
    linhasDoDetalhe = [linha({ pendenteCadastro: 'sem_cadastro' })];
    respostaDecisoes = () => ({ data: { decisoes: [enviada()] } });
    renderPage();
    await waitFor(async () => expect(classesDeStatus(await celulaItem('PRODUTO A'))).toEqual(['fc-status--cotando']));
    const td = await celulaItem('PRODUTO A');
    expect(td.textContent).not.toContain('Cotando');
    expect(td.textContent).not.toContain('Cotação não enviada');
    expect(td.textContent).not.toContain('Cotação criada');
  });

  it('(f) invalidar a lista de decisoes (como vincular/criar/enviar cotacao) atualiza o Painel', async () => {
    respostaDecisoes = () => ({ data: { decisoes: [enviada()] } });
    const { client } = renderPage();
    await waitFor(async () => expect(classesDeStatus(await celulaItem('PRODUTO A'))).toEqual(['fc-status--cotando']));

    respostaDecisoes = () => ({
      data: {
        decisoes: [
          decisao({
            cotacao: { id: 1, requestCode: 'AO/UV-17112026', statusCotacao: 'po_enviada' },
            statusDerivado: 'po',
          }),
        ],
      },
    });
    await client.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(7) });
    await waitFor(async () => expect(classesDeStatus(await celulaItem('PRODUTO A'))).toEqual(['fc-status--po']));
    expect((await celulaItem('PRODUTO A')).textContent).toContain('PO enviada');
  });

  it('(g) trocar do Relatorio para o Painel reaproveita o cache e mostra o status da cotacao', async () => {
    respostaDecisoes = () => ({ data: { decisoes: [enviada()] } });
    renderPage('/forecast?visao=compras&quinzena=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Painel' }));
    await waitFor(async () => expect(classesDeStatus(await celulaItem('PRODUTO A'))).toEqual(['fc-status--cotando']));
    expect((await celulaItem('PRODUTO A')).textContent).toContain('Cotando');
  });
});
