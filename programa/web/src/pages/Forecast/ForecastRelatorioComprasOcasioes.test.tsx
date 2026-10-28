import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import {
  APOIO_OCASIOES,
  AVISO_ANTES_DE_HOJE,
  PARAGRAFO_OCASIOES,
  TEXTO_OCASIOES_INDISPONIVEIS,
} from './forecastOcasioesRelatorio';

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
    codigos: ['C0001', 'C0002'],
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
    ...over,
  };
}

const BLOCO = {
  extraDias: 5,
  leadTimeAjustado: 35,
  dataLimiteAjustada: '2026-10-17',
  antesDeHoje: true,
  emissaoAvaliada: '2026-10-20',
  chegadaEstimada: '2026-11-24',
  ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total', dias: 5 }],
};

const POR_URGENCIA = { 'sem-estoque': 1, critico: 1, atrasado: 1, 'no-prazo': 1 };

// 4 itens, um por faixa, em 2 fontes (mesmo desenho do teste de urgencia).
const itemSemEstoque = (ocasioes?: unknown) =>
  item({
    linha: 3,
    item: 'PRODUTO 001',
    urgencia: 'sem-estoque',
    diasAteRuptura: -5,
    posicaoUrgencia: 0,
    ruptura: { indiceMes: 0, anoMes: '2026-10', data: '2026-10-15', jaNaDataBase: true },
    dataLimite: '2026-09-15',
    vencida: true,
    ...(ocasioes ? { ocasioes } : {}),
  });
const itemCritico = (ocasioes?: unknown) =>
  item({
    linha: 4,
    item: 'PRODUTO 002',
    urgencia: 'critico',
    diasAteRuptura: 3,
    posicaoUrgencia: 1,
    ruptura: { indiceMes: 0, anoMes: '2026-10', data: '2026-10-23', jaNaDataBase: false },
    dataLimite: '2026-09-23',
    vencida: true,
    ...(ocasioes ? { ocasioes } : {}),
  });
const ITEM_ATRASADO = item({
  linha: 5,
  item: 'PRODUTO 003',
  urgencia: 'atrasado',
  diasAteRuptura: 32,
  posicaoUrgencia: 2,
  dataLimite: '2026-10-10',
  vencida: true,
});
const ITEM_NO_PRAZO = item({
  linha: 6,
  item: 'PRODUTO 004',
  urgencia: 'no-prazo',
  diasAteRuptura: null,
  posicaoUrgencia: 3,
  ruptura: null,
  dataLimite: null,
});

function relatorio(comOcasioes: boolean, ocasioesDoRelatorio?: unknown) {
  const bloco = comOcasioes ? BLOCO : undefined;
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 4, fontes: 2, vencidas: 3, semEmbalagem: 4, multiplasEmbalagens: 0, porUrgencia: POR_URGENCIA },
    fora: { semLeadTime: 0, semConsumoSemFalta: 3, semConsumoSemMovimento: 46 },
    urgencia: { diasCritico: 15 },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-09-15',
        vencidas: 2,
        urgenciaMaisAlta: 'sem-estoque',
        porUrgencia: { 'sem-estoque': 1, critico: 0, atrasado: 1, 'no-prazo': 0 },
        itens: [itemSemEstoque(bloco), ITEM_ATRASADO],
        ...(comOcasioes
          ? { ocasioes: { itensAfetados: 1, ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total' }] } }
          : {}),
      },
      {
        fonte: 'FONTE 002',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-09-23',
        vencidas: 1,
        urgenciaMaisAlta: 'critico',
        porUrgencia: { 'sem-estoque': 0, critico: 1, atrasado: 0, 'no-prazo': 1 },
        itens: [itemCritico(bloco), ITEM_NO_PRAZO],
        ...(comOcasioes
          ? { ocasioes: { itensAfetados: 1, ocasioes: [{ id: 1, nome: 'OCASIAO 001', etapa: 'total' }] } }
          : {}),
      },
    ],
    ...(ocasioesDoRelatorio ? { ocasioes: ocasioesDoRelatorio } : {}),
  };
}

const RESUMO_OK = {
  estado: 'ok',
  ativas: 1,
  itensAfetados: 2,
  ocasioesQueCruzam: 1,
  antesDeHoje: 2,
  itensSemFonteCadastrada: 1,
  fontesSemPais: 0,
};

function renderRelatorio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioCompras snapshotId={7} />
    </QueryClientProvider>,
  );
}

// Urgencia, ordem, filtros e contagens: o que NAO pode mudar com as ocasioes.
const assinatura = () => ({
  nomes: [...document.querySelectorAll('.fcr-item__nome')].map((e) => e.textContent),
  linhas: [...document.querySelectorAll('tr.fcr-linha')].map((tr) => tr.className),
  filtros: [...document.querySelectorAll('.fc-filtro')].map((b) => b.textContent),
  vencidas: [...document.querySelectorAll('.badge--danger')].map((b) => b.textContent),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastRelatorioCompras com ocasioes (PR 3)', () => {
  it('sem o bloco (backend antigo ou nenhuma ocasiao ativa): nada de ocasiao no DOM', async () => {
    get.mockResolvedValue({ data: relatorio(false) });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(document.querySelector('[class*="fcoc-"]')).toBeNull();
    expect(screen.queryByText(/Ocasi/)).toBeNull();
    expect(screen.queryByText(APOIO_OCASIOES)).toBeNull();
    expect(screen.queryByText(PARAGRAFO_OCASIOES)).toBeNull();
  });

  it('visao por urgencia: selo, sublinha com colSpan de todas as colunas, resumo, apoio e paragrafo', async () => {
    get.mockResolvedValue({ data: relatorio(true, RESUMO_OK) });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');

    expect(screen.getAllByRole('img', { name: /Evento estrangeiro no lead time: 5 dias a mais/ })).toHaveLength(2);

    const sublinhas = [...document.querySelectorAll('tr.fcoc-linha')];
    expect(sublinhas).toHaveLength(2);
    for (const linha of sublinhas) {
      const dados = linha.previousElementSibling as HTMLTableRowElement;
      expect(dados.className).toContain('fcr-linha');
      const celula = linha.querySelector('td') as HTMLTableCellElement;
      expect(celula.colSpan).toBe(dados.children.length);
      expect(within(celula).getByText('30 + 5 = 35 dias')).toBeTruthy();
      expect(within(celula).getByText('17/10/2026')).toBeTruthy();
      expect(within(celula).getByText('24/11/2026 (pedido em 20/10/2026)')).toBeTruthy();
      expect(within(celula).getByText('OCASIAO 001 · +5 d (Lead time inteiro)')).toBeTruthy();
      expect(within(celula).getByText(AVISO_ANTES_DE_HOJE, { exact: false })).toBeTruthy();
    }

    expect(screen.getByText('2 itens com evento estrangeiro no lead time (estimativa)')).toBeTruthy();
    expect(screen.getByText('2 itens com a data-limite ajustada já vencida')).toBeTruthy();
    expect(screen.getByText('1 item com fonte fora do cadastro de lead time: eventos não avaliados')).toBeTruthy();
    expect(screen.queryByText(/sem país/)).toBeNull();
    expect(screen.getByText(APOIO_OCASIOES)).toBeTruthy();
    expect(screen.getByText(PARAGRAFO_OCASIOES)).toBeTruthy();
    expect(screen.getByText(PARAGRAFO_OCASIOES).closest('details')).not.toBeNull();
  });

  it('visao por fonte: caption do grupo com as ocasioes e a sublinha continua nos itens', async () => {
    get.mockResolvedValue({ data: relatorio(true, RESUMO_OK) });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    fireEvent.click(screen.getByRole('button', { name: 'Por fonte' }));

    const tabelas = screen.getAllByRole('table');
    for (const tabela of tabelas) {
      const caption = tabela.querySelector('caption') as HTMLElement;
      if (caption.textContent?.startsWith('FONTE')) {
        expect(within(caption).getByText('Evento estrangeiro: OCASIAO 001 · 1 item')).toBeTruthy();
        expect(tabela.querySelectorAll('tr.fcoc-linha')).toHaveLength(1);
      }
    }
    expect(screen.getAllByRole('img', { name: /Evento estrangeiro no lead time/ })).toHaveLength(2);
    const sublinha = document.querySelector('tr.fcoc-linha') as HTMLElement;
    const dados = sublinha.previousElementSibling as HTMLTableRowElement;
    expect((sublinha.querySelector('td') as HTMLTableCellElement).colSpan).toBe(dados.children.length);
  });

  it('urgencia, ordem, classes das linhas, filtros e contagens identicos aos do relatorio sem blocos', async () => {
    get.mockResolvedValue({ data: relatorio(false) });
    const sem = renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    const antes = assinatura();
    sem.unmount();

    get.mockResolvedValue({ data: relatorio(true, RESUMO_OK) });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    const depois = assinatura();
    expect(depois).toEqual(antes);
    expect(antes.nomes.length).toBeGreaterThan(0);
    expect(antes.filtros.some((f) => f?.includes('Todas'))).toBe(true);
  });

  it('indisponivel: so o aviso no resumo, sem selo, sem sublinha, sem apoio e sem paragrafo', async () => {
    get.mockResolvedValue({ data: relatorio(false, { estado: 'indisponivel' }) });
    renderRelatorio();
    await screen.findByText('4 itens em 2 fontes');
    expect(screen.getByRole('status', { name: '' }).textContent).toBe(TEXTO_OCASIOES_INDISPONIVEIS);
    expect(document.querySelector('.fcoc-selo, .fcoc-linha, .fcoc-grupo, .fcoc-detalhe')).toBeNull();
    expect(screen.queryByText(APOIO_OCASIOES)).toBeNull();
    expect(screen.queryByText(PARAGRAFO_OCASIOES)).toBeNull();
  });
});
