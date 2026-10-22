import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemSobDemanda } from '@/services/forecast';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import ForecastRelatorioSobDemanda from './ForecastRelatorioSobDemanda';
import {
  APOIO_SOB_DEMANDA,
  MOTIVO_SOB_DEMANDA_PADRAO,
  paragrafoSobDemanda,
  resumoSobDemanda,
  textoMotivoSobDemanda,
  tituloSobDemanda,
} from './forecastRelatorioTextos';
import { textoMotivos } from './forecastRelatorioUrgencia';

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
function sob(over: Partial<ForecastItemSobDemanda> = {}): ForecastItemSobDemanda {
  return {
    linha: 9,
    n: 2,
    productId: 9,
    item: 'PRODUTO 001',
    codigos: ['C0001'],
    fonte: 'FONTE 001',
    status: 'nao',
    motivo: 'MOTIVO SINTETICO',
    demanda: -800,
    quantidadeSugerida: 800,
    estoque: 300,
    chegadas: [],
    programacoes: [{ anoMes: '2026-11', quantidade: 800 }],
    programado: 800,
    programacaoDescoberta: 500,
    obs: '',
    ...over,
  };
}

function itemDaLista(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    item: 'PRODUTO 002',
    codigos: ['C0002'],
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

function relatorio(over: Record<string, unknown> = {}) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 30,
        dataLimiteMaisUrgente: '2026-10-22',
        vencidas: 0,
        itens: [itemDaLista()],
      },
    ],
    ...over,
  };
}

function renderRelatorio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioCompras snapshotId={7} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastRelatorioSobDemanda (secao)', () => {
  it('mostra titulo, colunas, motivo, programacao e a programacao descoberta em destaque (> 0)', () => {
    render(<ForecastRelatorioSobDemanda itens={[sob()]} />);
    const secao = screen.getByRole('region', { name: 'Itens sob demanda' });
    expect(within(secao).getByText(tituloSobDemanda(1))).toBeTruthy();
    for (const coluna of ['Item', 'Fonte', 'Status', 'Motivo', 'Demanda', 'Programações', 'Programação descoberta', 'Estoque', 'Chegadas']) {
      expect(within(secao).getByRole('columnheader', { name: coluna })).toBeTruthy();
    }
    expect(within(secao).getByText('PRODUTO 001')).toBeTruthy();
    expect(within(secao).getByText('C0001')).toBeTruthy();
    expect(within(secao).getByText('FONTE 001')).toBeTruthy();
    expect(within(secao).getByText('Cotação não enviada')).toBeTruthy();
    expect(within(secao).getByText(`${MOTIVO_SOB_DEMANDA_PADRAO}: MOTIVO SINTETICO`)).toBeTruthy();
    expect(within(secao).getByText(/Programação nov\/2026: 800/)).toBeTruthy();
    const descoberta = within(secao).getByText('500,0');
    expect(descoberta.className).toContain('fcr-descoberta');
    expect(descoberta.className).toContain('fcr-forte');
    expect(screen.getByText(APOIO_SOB_DEMANDA)).toBeTruthy();
  });

  it('descoberta 0: sem destaque; sem motivo cadastrado: so o texto padrao; observacao na celula Item', () => {
    render(
      <ForecastRelatorioSobDemanda
        itens={[sob({ programacaoDescoberta: 0, motivo: null, obs: 'OBS SINTETICA', programacoes: [] })]}
      />,
    );
    const celulaZero = screen.getByText('0,0');
    expect(celulaZero.className).not.toContain('fcr-descoberta');
    expect(screen.getByText(MOTIVO_SOB_DEMANDA_PADRAO)).toBeTruthy();
    expect(screen.getByText('Obs.: OBS SINTETICA')).toBeTruthy();
  });

  it('regioes rolaveis com nome e foco por teclado', () => {
    render(<ForecastRelatorioSobDemanda itens={[sob()]} />);
    const regiao = screen.getByRole('region', { name: 'Itens sob demanda' });
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('region', { name: 'Sob demanda: só com programação do cliente' })).toBeTruthy();
  });
});

describe('ForecastRelatorioCompras com compra sob demanda', () => {
  it('resumo com a contagem, secao no fim, paragrafo das regras e lista de compra sem o item', async () => {
    get.mockResolvedValue({
      data: relatorio({
        fora: { semLeadTime: 0, semConsumoSemFalta: 0, sobDemanda: 1 },
        sobDemanda: { itens: [sob()] },
      }),
    });
    renderRelatorio();
    expect(await screen.findByText(resumoSobDemanda(1))).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Itens sob demanda' })).toBeTruthy();
    expect(screen.getByText(paragrafoSobDemanda())).toBeTruthy();
    // A lista de compra continua so com o item regular.
    expect(screen.getByRole('region', { name: 'Itens da fonte FONTE 001' })).toBeTruthy();
    expect(screen.getByText('1 item em 1 fonte')).toBeTruthy();
  });

  it('sem item sob demanda (ou backend antigo): nada de secao, resumo nem paragrafo', async () => {
    get.mockResolvedValue({ data: relatorio({ sobDemanda: { itens: [] }, fora: { semLeadTime: 0, semConsumoSemFalta: 0, sobDemanda: 0 } }) });
    const { unmount } = renderRelatorio();
    expect(await screen.findByText('1 item em 1 fonte')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Itens sob demanda' })).toBeNull();
    expect(screen.queryByText(/sob demanda \(fora da lista de compra\)/)).toBeNull();
    expect(screen.queryByText(paragrafoSobDemanda())).toBeNull();
    unmount();

    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    expect(await screen.findByText('1 item em 1 fonte')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Itens sob demanda' })).toBeNull();
  });

  it('sem consumo: o motivo ganha "compra sob demanda" so no item marcado', async () => {
    const semConsumo = (linha: number, nome: string, sobDemanda: boolean) => ({
      linha,
      n: null,
      productId: linha,
      item: nome,
      codigos: ['C0003'],
      fonte: 'FONTE 001',
      status: 'nao',
      motivos: ['estoque'],
      estoque: 200,
      programado: 0,
      programacoes: [],
      chegadas: [],
      semLeadTime: false,
      obs: '',
      sobDemanda,
    });
    get.mockResolvedValue({
      data: relatorio({
        fora: { semLeadTime: 0, semConsumoSemFalta: 0, semConsumoSemMovimento: 0, sobDemanda: 0 },
        semConsumo: { itens: [semConsumo(1, 'PRODUTO 003', true), semConsumo(2, 'PRODUTO 004', false)] },
      }),
    });
    renderRelatorio();
    expect(await screen.findByText('tem estoque · compra sob demanda')).toBeTruthy();
    expect(screen.getAllByText('tem estoque')).toHaveLength(1);
  });
});

describe('textos da compra sob demanda', () => {
  it('motivo: padrao com ou sem o motivo cadastrado', () => {
    expect(textoMotivoSobDemanda(null)).toBe('Compra sob programação do cliente');
    expect(textoMotivoSobDemanda('')).toBe('Compra sob programação do cliente');
    expect(textoMotivoSobDemanda('MOTIVO SINTETICO')).toBe('Compra sob programação do cliente: MOTIVO SINTETICO');
    expect(textoMotivos(['programacao', 'estoque'], true)).toBe('tem programação · tem estoque · compra sob demanda');
    expect(textoMotivos(['estoque'])).toBe('tem estoque');
  });

  it('titulo no singular e no plural', () => {
    expect(tituloSobDemanda(1)).toBe('Sob demanda: só com programação do cliente · 1 item');
    expect(tituloSobDemanda(3)).toBe('Sob demanda: só com programação do cliente · 3 itens');
    expect(resumoSobDemanda(2)).toBe('2 sob demanda (fora da lista de compra)');
  });
});

describe('ForecastRelatorioSobDemanda - meses atipicos (PR 6c)', () => {
  it('item com meses fora da media ganha o selo "Média sem" antes da observacao; sem marca, nada', () => {
    render(
      <ForecastRelatorioSobDemanda
        itens={[sob({ mesesForaDaMedia: ['2026-08'], obs: 'OBS SINTETICA' }), sob({ linha: 10, item: 'PRODUTO 002' })]}
      />,
    );
    const selos = screen.getAllByText(/^Média sem:/);
    expect(selos).toHaveLength(1);
    expect(selos[0]?.textContent).toBe('Média sem: ago/2026');
    expect(Array.from((selos[0]?.parentElement as HTMLElement).children).map((c) => c.className)).toEqual([
      'fcr-item__nome',
      'fcr-item__codigos',
      'fcr-item__media',
      'fcr-item__obs',
    ]);
  });
});
