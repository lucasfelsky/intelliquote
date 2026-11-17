import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';

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

import { api } from '@/api/client';

const get = vi.mocked(api.get);

// Dados 100% sinteticos.
function item(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    item: 'PRODUTO 001',
    codigos: ['C0001'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 40,
    naoFraciona: false,
    ruptura: null,
    dataLimite: null,
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    urgencia: 'no-prazo',
    diasAteRuptura: null,
    ...over,
  };
}

const A = item({ linha: 3, item: 'PRODUTO 001', productId: 41, posicaoUrgencia: 0 });
const B = item({ linha: 4, item: 'PRODUTO 002', productId: 42, posicaoUrgencia: 1 });
const C = item({ linha: 5, item: 'PRODUTO 003', productId: 43, posicaoUrgencia: 2 });

function relatorio() {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: {
      itens: 3,
      fontes: 2,
      vencidas: 0,
      semEmbalagem: 3,
      multiplasEmbalagens: 0,
      porUrgencia: { 'sem-estoque': 0, critico: 0, atrasado: 0, 'no-prazo': 3 },
    },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    urgencia: { diasCritico: 15 },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: null,
        vencidas: 0,
        urgenciaMaisAlta: 'no-prazo',
        porUrgencia: { 'sem-estoque': 0, critico: 0, atrasado: 0, 'no-prazo': 2 },
        itens: [A, B],
      },
      {
        fonte: 'FONTE 002',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: null,
        vencidas: 0,
        urgenciaMaisAlta: 'no-prazo',
        porUrgencia: { 'sem-estoque': 0, critico: 0, atrasado: 0, 'no-prazo': 1 },
        itens: [C],
      },
    ],
  };
}

function decisao(productId: number) {
  return {
    productId,
    quantidadeKg: 500,
    status: 'cotando',
    observacao: null,
    sugeridaKg: 40,
    demandaKg: -40,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
  };
}

function mockApi(decisoes: unknown[]) {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/decisoes')) return { data: { decisoes } };
    return { data: relatorio() };
  });
}

function renderRelatorio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioCompras snapshotId={7} />
    </QueryClientProvider>,
  );
}

const nomesVisiveis = () =>
  Array.from(document.querySelectorAll('.fcr-item__nome')).map((n) => n.textContent);

const decisoesChamadas = () => get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/decisoes'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastRelatorioCompras - filtro "so com analise forecast"', () => {
  it('mostra a contagem de itens com quantidade fechada e filtra a lista', async () => {
    mockApi([decisao(42)]);
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const grupo = within(screen.getByRole('group', { name: 'Filtrar por análise forecast' }));
    const botao = await grupo.findByRole('button', { name: /Só com análise forecast/ });
    expect(await within(botao).findByText('1')).toBeTruthy();
    expect(botao.getAttribute('aria-pressed')).toBe('false');
    expect(nomesVisiveis()).toEqual(expect.arrayContaining(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003']));

    fireEvent.click(botao);
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    expect(nomesVisiveis()).toEqual(['PRODUTO 002']);
    expect(screen.getByText(/Mostrando 1 de 3 itens · todas as faixas · só com análise forecast preenchida/)).toBeTruthy();

    // desligar volta a lista inteira
    fireEvent.click(botao);
    expect(nomesVisiveis()).toHaveLength(3);
  });

  it('funciona tambem na visao por fonte: grupo sem item preenchido some', async () => {
    mockApi([decisao(43)]);
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    fireEvent.click(screen.getByRole('button', { name: 'Por fonte' }));
    fireEvent.click(await screen.findByRole('button', { name: /Só com análise forecast/ }));
    expect(nomesVisiveis()).toEqual(['PRODUTO 003']);
    expect(screen.queryByText(/FONTE 001/)).toBeNull();
  });

  it('sem nenhuma analise preenchida: avisa em vez de tela vazia', async () => {
    mockApi([]);
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    fireEvent.click(await screen.findByRole('button', { name: /Só com análise forecast/ }));
    expect(screen.getByText('Nenhum item com análise forecast preenchida nesta faixa.')).toBeTruthy();
  });

  it('as decisoes vem num unico GET (o provedor da tela toda)', async () => {
    mockApi([decisao(42)]);
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    expect(decisoesChamadas()).toHaveLength(1);
  });
});
