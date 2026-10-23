import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { api, ApiError } from '@/api/client';

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

function relatorio(over: Record<string, unknown> = {}) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: 3, fontes: 2, vencidas: 1, semEmbalagem: 2, multiplasEmbalagens: 1 },
    fora: { semLeadTime: 4, semConsumoSemFalta: 5 },
    grupos: [
      {
        fonte: 'FONTE 001',
        leadTimeDias: 90,
        dataLimiteMaisUrgente: '2026-08-23',
        vencidas: 1,
        itens: [
          item({
            linha: 5,
            item: 'PRODUTO 002',
            dataLimite: '2026-08-23',
            vencida: true,
            leadTimeDias: 90,
            quantidadeSugerida: 101,
            quantidadeFinal: 125,
            quantidadeEmbalagens: 5,
            embalagem: {
              usada: { codigo: 'C0005', quantidade: 25, rotulo: null },
              cadastradas: [
                { codigo: 'C0004', quantidade: 200, rotulo: null },
                { codigo: 'C0005', quantidade: 25, rotulo: null },
              ],
              multiplas: true,
            },
            emAndamento: {
              chegadas: [{ anoMes: '2026-11', quantidade: 300 }],
              programacoes: [{ anoMes: '2027-01', quantidade: 20 }],
            },
          }),
          item({ linha: 6, item: 'PRODUTO 003', naoFraciona: true, dataLimite: '2026-10-22' }),
        ],
      },
      {
        fonte: 'FONTE 002',
        leadTimeDias: 10,
        dataLimiteMaisUrgente: null,
        vencidas: 0,
        itens: [item({ linha: 7, item: 'PRODUTO 004', ruptura: null, dataLimite: null, leadTimeDias: 10 })],
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

describe('ForecastRelatorioCompras', () => {
  it('pede o relatorio da quinzena e mostra o resumo com os totais', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    expect(await screen.findByText('3 itens em 2 fontes')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/relatorio-compras');
    expect(screen.getByText('1 com data-limite vencida')).toBeTruthy();
    expect(screen.getByText('2 sem embalagem cadastrada')).toBeTruthy();
    expect(screen.getByText('1 com mais de uma embalagem')).toBeTruthy();
    expect(screen.getByText('Fora do relatório: 4 sem lead time, 5 sem consumo e sem falta')).toBeTruthy();
    expect(screen.getByText('Como as datas são calculadas')).toBeTruthy();
  });

  it('um bloco por fonte, na ordem recebida, com lead time e data mais urgente na legenda', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(2);
    expect(within(tabelas[0] as HTMLElement).getByText('FONTE 001 · lead time 90 dias · mais urgente 23/08/2026')).toBeTruthy();
    expect(within(tabelas[1] as HTMLElement).getByText('FONTE 002 · lead time 10 dias · sem data-limite')).toBeTruthy();
    const nomes = within(tabelas[0] as HTMLElement)
      .getAllByRole('rowheader')
      .map((h) => h.querySelector('.fcr-item__nome')?.textContent);
    expect(nomes).toEqual(['PRODUTO 002', 'PRODUTO 003']);
    expect(document.querySelector('.fc-grid')).toBeNull();
  });

  it('item vencido ganha a classe e o texto "Vencida" (nao so cor)', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const vencidas = document.querySelectorAll('.fcr-linha--vencida');
    expect(vencidas).toHaveLength(1);
    expect(within(vencidas[0] as HTMLElement).getByText('Vencida')).toBeTruthy();
    expect(within(vencidas[0] as HTMLElement).getByText('23/08/2026')).toBeTruthy();
    expect(screen.getByText('1 vencida')).toBeTruthy();
  });

  it('sem embalagem: chip "Embalagem nao cadastrada" e a quantidade final e a sugerida', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 003').closest('tr') as HTMLElement;
    expect(within(linha).getByText('Embalagem não cadastrada')).toBeTruthy();
    expect(within(linha).getAllByText('40,0')).toHaveLength(2); // sugerida e final iguais (sem arredondar)
    expect(within(linha).getByText('-40,0')).toBeTruthy(); // demanda
  });

  it('backend antigo (sem porEmbalagem): destaca a usada e lista as outras no texto de antes', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 002').closest('tr') as HTMLElement;
    expect(within(linha).getByText('5 × 25 kg (código C0005)')).toBeTruthy();
    const chip = within(linha).getByText('Arredondado pela embalagem do código C0005');
    expect(chip.getAttribute('title')).toBe('Outras embalagens: C0004 (200 kg)');
    expect(within(linha).getByText('Outras: C0004 (200 kg)')).toBeTruthy();
    expect(within(linha).getByText('125,0')).toBeTruthy();
    expect(within(linha).queryByText('Embalagem não cadastrada')).toBeNull();
  });

  it('varias embalagens: destaca a usada e mostra a quantidade arredondada para CADA uma, uma por linha', async () => {
    const base = relatorio();
    const [p2, ...resto] = base.grupos[0]!.itens;
    const item2 = {
      ...p2,
      embalagem: {
        usada: { codigo: 'C0005', quantidade: 25, rotulo: null },
        cadastradas: [
          { codigo: 'C0004', quantidade: 200, rotulo: null },
          { codigo: 'C0005', quantidade: 25, rotulo: null },
          { codigo: 'C0006', quantidade: 1000, rotulo: 'Bag' },
        ],
        multiplas: true,
      },
      porEmbalagem: [
        { codigo: 'C0004', quantidade: 200, rotulo: null, embalagens: 1, quantidadeFinal: 200, destaque: false },
        { codigo: 'C0005', quantidade: 25, rotulo: null, embalagens: 5, quantidadeFinal: 125, destaque: true },
        { codigo: 'C0006', quantidade: 1000, rotulo: 'Bag', embalagens: 1, quantidadeFinal: 1000, destaque: false },
      ],
    };
    get.mockResolvedValue({
      data: { ...base, grupos: [{ ...base.grupos[0], itens: [item2, ...resto] }, base.grupos[1]] },
    });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 002').closest('tr') as HTMLElement;
    // A usada continua em destaque e a Qtd. final e a dela.
    expect(within(linha).getByText('5 × 25 kg (código C0005)')).toBeTruthy();
    expect(within(linha).getByText('125,0')).toBeTruthy();
    const chip = within(linha).getByText('Arredondado pela embalagem do código C0005');
    expect(chip.getAttribute('title')).toBe(
      'Outras embalagens: 1 × 200 kg (código C0004) = 200 kg; 1 × Bag (código C0006) = 1.000 kg',
    );
    const outras = Array.from(linha.querySelectorAll('.fcr-embalagem__outras')).map((e) => e.textContent);
    expect(outras).toEqual(['1 × 200 kg (código C0004) = 200 kg', '1 × Bag (código C0006) = 1.000 kg']);
    expect(within(linha).queryByText(/^Outras:/)).toBeNull();
  });

  it('Observação: linha "Obs.: ..." na celula Item, so quando ha texto, sem criar coluna', async () => {
    const base = relatorio();
    const [p2, p3] = base.grupos[0]!.itens;
    get.mockResolvedValue({
      data: {
        ...base,
        grupos: [
          { ...base.grupos[0], itens: [{ ...p2, obs: 'OBS SINTETICA 002' }, { ...p3, obs: '   ' }] },
          { ...base.grupos[1]!, itens: [{ ...base.grupos[1]!.itens[0], obs: '' }] },
        ],
      },
    });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const comObs = screen.getByText('PRODUTO 002').closest('tr') as HTMLElement;
    const obs = comObs.querySelector('.fcr-item__obs');
    expect(obs?.textContent).toBe('Obs.: OBS SINTETICA 002');
    expect(obs?.closest('th')).toBe(comObs.querySelector('th'));
    expect(document.querySelectorAll('.fcr-item__obs')).toHaveLength(1);
    const colunas = within(screen.getAllByRole('table')[0] as HTMLElement)
      .getAllByRole('columnheader')
      .map((c) => c.textContent);
    expect(colunas).toEqual([
      'Item', 'Status', 'Demanda', 'Qtd. sugerida', 'Embalagem', 'Qtd. final', 'Saldo zera', 'Ruptura', 'Data-limite', 'Em andamento',
    ]);
  });

  it('Observação tambem aparece na secao "Atencao: sem consumo"', async () => {
    const sem = (linha: number, obs?: string) => ({
      linha,
      n: linha,
      productId: null,
      item: 'PRODUTO ' + linha,
      codigos: ['C' + linha],
      fonte: 'FONTE 001',
      status: 'nao',
      motivos: ['estoque'],
      estoque: 10,
      programado: 0,
      programacoes: [],
      chegadas: [],
      semLeadTime: false,
      ...(obs === undefined ? {} : { obs }),
    });
    get.mockResolvedValue({
      data: relatorio({
        fora: { semLeadTime: 4, semConsumoSemFalta: 5, semConsumoSemMovimento: 1 },
        semConsumo: { itens: [sem(101, 'OBS SINTETICA 101'), sem(102, ''), sem(103)] },
      }),
    });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const secao = screen.getByRole('region', { name: 'Itens sem consumo' });
    expect(within(secao).getByText('Obs.: OBS SINTETICA 101')).toBeTruthy();
    expect(secao.querySelectorAll('.fcr-item__obs')).toHaveLength(1);
  });

  it('o paragrafo das embalagens nas regras explica a quantidade por embalagem', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    expect(
      screen.getByText(/Com mais de uma embalagem, mostra também a quantidade arredondada para cada uma/),
    ).toBeTruthy();
  });

  it('"nao fraciona" aparece como marca no item e nao muda a quantidade', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const linha = screen.getByText('PRODUTO 003').closest('tr') as HTMLElement;
    expect(within(linha).getByText('Não fraciona')).toBeTruthy();
    expect(screen.getAllByText('Não fraciona')).toHaveLength(1);
  });

  it('em andamento lista so os meses com valor; sem ruptura mostra aviso', async () => {
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const comAndamento = screen.getByText('PRODUTO 002').closest('tr') as HTMLElement;
    expect(within(comAndamento).getByText('Chegada nov/2026: 300')).toBeTruthy();
    expect(within(comAndamento).getByText('Programação jan/2027: 20')).toBeTruthy();
    const semRuptura = screen.getByText('PRODUTO 004').closest('tr') as HTMLElement;
    expect(within(semRuptura).getByText('sem ruptura em 6 meses')).toBeTruthy();
    expect(within(comAndamento).getByText('nov/2026')).toBeTruthy(); // saldo zera
    expect(within(comAndamento).getAllByText('21/11/2026')).toHaveLength(1);
  });

  it('ruptura ja na data-base e descrita em texto', async () => {
    get.mockResolvedValue({
      data: relatorio({
        totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
        grupos: [
          {
            fonte: 'FONTE 001',
            leadTimeDias: 30,
            dataLimiteMaisUrgente: '2026-09-15',
            vencidas: 0,
            itens: [
              item({
                ruptura: { indiceMes: 0, anoMes: '2026-10', data: '2026-10-15', jaNaDataBase: true },
                dataLimite: '2026-11-15',
              }),
            ],
          },
        ],
      }),
    });
    renderRelatorio();
    expect(await screen.findByText('já na data-base')).toBeTruthy();
  });

  it('sem itens: estado vazio', async () => {
    get.mockResolvedValue({
      data: relatorio({
        totais: { itens: 0, fontes: 0, vencidas: 0, semEmbalagem: 0, multiplasEmbalagens: 0 },
        grupos: [],
      }),
    });
    renderRelatorio();
    expect(await screen.findByText('Nenhum item com demanda ≤ 0 nesta quinzena.')).toBeTruthy();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('404 mostra a mensagem do servico; carregando mostra o spinner', async () => {
    get.mockRejectedValue(new ApiError(404, null));
    renderRelatorio();
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeTruthy();
    expect(await screen.findByText('Quinzena não encontrada (pode ter sido removida).')).toBeTruthy();
  });
});

describe('ForecastRelatorioCompras - exportacao e impressao', () => {
  const NOME_XLSX = 'relatorio-compras-10-2-2026-10-20.xlsx';
  const PATH_XLSX = '/v1/forecast/snapshots/7/relatorio-compras/xlsx';
  const originais = { criar: URL.createObjectURL, revogar: URL.revokeObjectURL };
  const html = document.documentElement;

  // Roteia o mock de `get` por caminho: a tela chama o relatorio e o botao chama o xlsx.
  function rotear(xlsx: () => Promise<unknown>) {
    get.mockImplementation(async (path: string) => {
      if (path === PATH_XLSX) return xlsx();
      return { data: relatorio() };
    });
  }

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    URL.createObjectURL = originais.criar;
    URL.revokeObjectURL = originais.revogar;
    vi.restoreAllMocks();
    delete html.dataset.theme;
  });

  it('barra de acoes: grupo "Exportar relatorio" com os dois botoes', async () => {
    rotear(async () => ({ data: { fileName: NOME_XLSX, contentBase64: btoa('x') } }));
    renderRelatorio();
    const grupo = await screen.findByRole('group', { name: 'Exportar relatório' });
    expect(within(grupo).getByRole('button', { name: 'Baixar XLSX' })).toBeTruthy();
    expect(within(grupo).getByRole('button', { name: 'Imprimir / Salvar como PDF' })).toBeTruthy();
    expect(grupo.closest('.fcr-resumo')).not.toBeNull();
  });

  it('"Baixar XLSX" pede o arquivo com a data da tela (quinzena.hoje) e mostra o nome gerado', async () => {
    rotear(async () => ({ data: { fileName: NOME_XLSX, contentBase64: btoa('x') } }));
    renderRelatorio();
    fireEvent.click(await screen.findByRole('button', { name: 'Baixar XLSX' }));
    const ok = await screen.findByRole('status');
    expect(ok.textContent).toBe(`XLSX gerado: ${NOME_XLSX}`);
    expect(get).toHaveBeenCalledWith(PATH_XLSX, { hoje: '2026-10-20' });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('enquanto gera: botao desabilitado, aria-busy e texto "Gerando XLSX…"', async () => {
    let liberar: (v: unknown) => void = () => {};
    rotear(() => new Promise((resolve) => (liberar = resolve)));
    renderRelatorio();
    fireEvent.click(await screen.findByRole('button', { name: 'Baixar XLSX' }));
    const botao = await screen.findByRole('button', { name: 'Gerando XLSX…' });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(botao.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      liberar({ data: { fileName: NOME_XLSX, contentBase64: btoa('x') } });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar XLSX' })).toBeTruthy());
  });

  it('erro 404 do arquivo: alerta com a mensagem do servico', async () => {
    rotear(() => Promise.reject(new ApiError(404, null)));
    renderRelatorio();
    fireEvent.click(await screen.findByRole('button', { name: 'Baixar XLSX' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Quinzena não encontrada (pode ter sido removida).');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('"Imprimir / Salvar como PDF" chama window.print e aponta para a dica', async () => {
    rotear(async () => ({ data: { fileName: NOME_XLSX, contentBase64: btoa('x') } }));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderRelatorio();
    const botao = await screen.findByRole('button', { name: 'Imprimir / Salvar como PDF' });
    fireEvent.click(botao);
    expect(print).toHaveBeenCalledTimes(1);
    const dica = document.getElementById(botao.getAttribute('aria-describedby') ?? '');
    expect(dica?.textContent).toBe('Abre a impressão do navegador; para PDF, escolha “Salvar como PDF” no destino.');
  });

  it('em tema escuro, beforeprint vira claro e afterprint volta ao escuro; apos desmontar nao altera', async () => {
    rotear(async () => ({ data: { fileName: NOME_XLSX, contentBase64: btoa('x') } }));
    html.dataset.theme = 'dark';
    const { unmount } = renderRelatorio();
    await screen.findByRole('group', { name: 'Exportar relatório' });
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(html.dataset.theme).toBe('light');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(html.dataset.theme).toBe('dark');
    unmount();
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(html.dataset.theme).toBe('dark');
  });
});

describe('ForecastRelatorioCompras - meses atipicos fora da media (PR 6c)', () => {
  const com = () =>
    relatorio({
      grupos: [
        {
          fonte: 'FONTE 001',
          leadTimeDias: 90,
          dataLimiteMaisUrgente: '2026-10-22',
          vencidas: 0,
          itens: [
            item({ linha: 5, item: 'PRODUTO 002', mesesForaDaMedia: ['2026-08', '2026-09'], obs: 'OBS SINTETICA' }),
            item({ linha: 6, item: 'PRODUTO 003' }),
          ],
        },
      ],
      semConsumo: {
        itens: [
          {
            linha: 8,
            n: 3,
            productId: 8,
            item: 'PRODUTO 005',
            codigos: ['C0005'],
            fonte: 'FONTE 001',
            status: 'nao',
            motivos: ['estoque'],
            estoque: 100,
            programado: 0,
            programacoes: [],
            chegadas: [],
            semLeadTime: false,
            mesesForaDaMedia: ['2026-08'],
          },
        ],
      },
      fora: { semLeadTime: 0, semConsumoSemFalta: 0, semConsumoSemMovimento: 0 },
    });

  it('selo "Média sem: ..." na celula Item, antes da observacao, so nos itens com meses marcados', async () => {
    get.mockResolvedValue({ data: com() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    const selo = screen.getAllByText('Média sem: ago/2026, set/2026');
    expect(selo).toHaveLength(1);
    expect(selo[0]?.className).toBe('fcr-item__media');
    expect(selo[0]?.getAttribute('title')).toBe('A média deste item não conta o mês marcado como venda atípica.');
    // Ordem na celula Item: nome, codigos, selo da media, observacao.
    const celula = selo[0]?.parentElement as HTMLElement;
    expect(Array.from(celula.children).map((c) => c.className)).toEqual([
      'fcr-item__nome',
      'fcr-item__codigos',
      'fcr-item__media',
      'fcr-item__obs',
    ]);
    // PRODUTO 003 (sem marca) nao ganha o selo; a secao sem consumo mostra o do item dela.
    expect(screen.getByText('Média sem: ago/2026')).toBeTruthy();
    expect(screen.getAllByText(/^Média sem:/)).toHaveLength(2);
  });

  it('resumo e paragrafo das regras so quando ha item com meses fora da media', async () => {
    get.mockResolvedValue({ data: com() });
    const { unmount } = renderRelatorio();
    expect(await screen.findByText('2 itens usam média sem meses atípicos')).toBeTruthy();
    expect(
      screen.getByText(
        'Meses marcados como venda atípica ficam fora das médias trimestral e semestral (e do consumo do mês, se marcado o mês atual). A conferência com a planilha usa a regra original.',
      ),
    ).toBeTruthy();
    unmount();

    // Sem marca (ou backend antigo, sem o campo): nada novo na tela.
    get.mockResolvedValue({ data: relatorio() });
    renderRelatorio();
    await screen.findByText('3 itens em 2 fontes');
    expect(screen.queryByText(/usam média sem meses atípicos|usa média sem meses atípicos/)).toBeNull();
    expect(screen.queryByText(/Média sem:/)).toBeNull();
    expect(screen.queryByText(/fora das médias trimestral e semestral/)).toBeNull();
  });
});
