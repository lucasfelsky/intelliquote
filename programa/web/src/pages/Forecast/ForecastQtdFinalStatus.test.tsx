import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import { ProvedorGerarCotacao } from './ForecastGerarCotacao';

// Qtd. final fixa, status automatico e tracking por linha (E7 do relatorio enxuto). Dados 100% sinteticos.

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
import { expandirDetalhes } from '@/test/forecastDetalhes';

const get = vi.mocked(api.get);

function item(over: Record<string, unknown>) {
  return {
    linha: 3,
    n: 1,
    productId: 41,
    item: 'PRODUTO 001',
    codigos: ['C0041'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 125,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  };
}

function decisao(over: Partial<ForecastDecisao>): ForecastDecisao {
  return {
    productId: 41,
    quantidadeKg: 300,
    status: 'nao',
    observacao: null,
    sugeridaKg: 80,
    demandaKg: -80,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

// 51 sem vinculo (status congelado 'cotando' da planilha); 52 cotacao criada; 53 enviada; 54 fechada; 55 PO enviada; 56 rascunho.
const ITENS = [
  item({ linha: 3, productId: 51, item: 'PRODUTO 051', codigos: ['C0051'], status: 'cotando' }),
  item({ linha: 4, productId: 52, item: 'PRODUTO 052', codigos: ['C0052'] }),
  item({ linha: 5, productId: 53, item: 'PRODUTO 053', codigos: ['C0053'] }),
  item({ linha: 6, productId: 54, item: 'PRODUTO 054', codigos: ['C0054'] }),
  item({ linha: 7, productId: 55, item: 'PRODUTO 055', codigos: ['C0055'] }),
  item({ linha: 8, productId: 56, item: 'PRODUTO 056', codigos: ['C0056'] }),
];

function decisoesPadrao(): ForecastDecisao[] {
  return [
    decisao({
      productId: 52,
      cotacao: { id: 152, requestCode: 'COT-0152', statusCotacao: 'criada' },
      finalKg: null,
      finalAt: null,
      statusDerivado: 'cotacao_criada',
    }),
    decisao({
      productId: 53,
      status: 'cotando',
      cotacao: { id: 153, requestCode: 'COT-0153', statusCotacao: 'enviada' },
      finalKg: 200,
      finalAt: '2026-11-09T15:30:00.000Z',
      statusDerivado: 'cotando',
    }),
    decisao({
      productId: 54,
      status: 'confirmado',
      cotacao: { id: 154, requestCode: 'COT-0154', statusCotacao: 'fechada' },
      finalKg: 1180.5,
      finalAt: '2026-11-10T13:00:00.000Z',
      statusDerivado: 'confirmado',
    }),
    decisao({
      productId: 55,
      status: 'po',
      cotacao: { id: 155, requestCode: 'COT-0155', statusCotacao: 'po_enviada' },
      finalKg: 900,
      finalAt: '2026-11-08T12:00:00.000Z',
      statusDerivado: 'po',
    }),
  ];
}

let decisoes: ForecastDecisao[];
let rascunhoItens: Array<{ productId: number; quantidadeKg: number; observacao: string | null }>;

beforeEach(() => {
  vi.clearAllMocks();
  decisoes = decisoesPadrao();
  rascunhoItens = [{ productId: 56, quantidadeKg: 70, observacao: null }];
  get.mockImplementation((async (path: string) => {
    if (path === '/v1/forecast/products') {
      return {
        data: ITENS.map((i) => ({
          id: i.productId,
          name: i.item,
          isActive: true,
          source: { id: 1, name: 'FONTE 001' },
          codes: [{ id: (i.productId as number) * 10, position: 1, code: `C${i.productId}`, catalogItemId: 900 + (i.productId as number), catalogItem: { id: 900, commercialName: 'X', marketName: 'Y' } }],
        })),
      };
    }
    if (path.endsWith('/decisoes')) return { data: { snapshotId: 7, label: '10-2', decisoes } };
    if (path.endsWith('/rascunho-cotacao')) {
      return {
        data: rascunhoItens.length
          ? { snapshotId: 7, itens: rascunhoItens, criadoEm: '2026-11-10T14:00:00.000Z', atualizadoEm: '2026-11-10T15:00:00.000Z' }
          : null,
      };
    }
    if (path.endsWith('/relatorio-compras')) {
      return {
        data: {
          quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
          totais: { itens: ITENS.length, fontes: 1, vencidas: 0, semEmbalagem: ITENS.length, multiplasEmbalagens: 0 },
          fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
          grupos: [{ fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: '2026-10-22', vencidas: 0, itens: ITENS }],
        },
      };
    }
    return { data: {} };
  }) as never);
});

function renderRelatorio(opts: { podeCriar?: boolean } = {}) {
  const podeCriar = opts.podeCriar ?? true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Routes>
          <Route
            path="/forecast"
            element={
              <ProvedorGerarCotacao snapshotId={7} podeCriar={podeCriar}>
                <ForecastRelatorioCompras snapshotId={7} podeEditar={podeCriar} />
              </ProvedorGerarCotacao>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Linha principal do item (a que tem a Qtd. final, o status e a acao). */
const linhaDe = (nome: string) => screen.getByText(nome).closest('tr') as HTMLElement;
const celula = (nome: string, classe: string) => linhaDe(nome).querySelector(`td.${classe}`) as HTMLElement;

async function carregar(opts: { podeCriar?: boolean } = {}) {
  renderRelatorio(opts);
  await screen.findByText('PRODUTO 051');
  // espera as decisoes: a cotacao 52 aparece como link
  await waitFor(() => expect(screen.queryAllByRole('link', { name: /^Ver cotação COT-0152/ })).toHaveLength(1));
}

describe('coluna Qtd. final (sistema)', () => {
  it('o cabecalho distingue a fixa da calculada e explica quando e preenchida', async () => {
    await carregar();
    const cab = screen.getByRole('columnheader', { name: /Qtd\. final \(sistema\)/ });
    expect(cab.textContent).toBe('Qtd. final (sistema)');
    expect(within(cab).getByRole('button', { name: 'Qtd. final (sistema): quando é preenchida' })).toBeTruthy();
    // vem logo depois da Qtd. sugerida e antes da Data-limite
    const nomes = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(nomes.indexOf('Qtd. final (sistema)')).toBe(nomes.indexOf('Qtd. sugerida') + 1);
    expect(nomes.indexOf('Data-limite')).toBe(nomes.indexOf('Qtd. final (sistema)') + 1);
  });

  it('vazia ("—") enquanto nao ha envio: so o traco na celula; a explicacao abre num pop-up ao passar o mouse', async () => {
    await carregar();
    const sem = celula('PRODUTO 051', 'fcr-final');
    expect(sem.textContent).toBe('—');
    expect(sem.querySelector('.fcr-final__apoio')).toBeNull();
    const criada = celula('PRODUTO 052', 'fcr-final');
    expect(criada.textContent).toBe('—');
    const chip = within(criada).getByRole('button', { name: 'Qtd. final (sistema) de PRODUTO 052: ainda não preenchida' });
    fireEvent.mouseEnter(chip);
    const balao = await screen.findByText(/COT-0152 ainda não foi enviada aos fornecedores\. Preenchida ao enviar a cotação; atualizada ao fechar com o fornecedor\./);
    expect(balao).toBeTruthy();
    // sem cotacao: a regra geral
    fireEvent.mouseEnter(within(celula('PRODUTO 051', 'fcr-final')).getByRole('button'));
    expect(await screen.findByText('Qtd. final (sistema): Preenchida ao enviar a cotação; atualizada ao fechar com o fornecedor.')).toBeTruthy();
  });

  it('enviada: mostra a quantidade cotada, com a data da gravacao discreta e o momento no tooltip', async () => {
    await carregar();
    const c = celula('PRODUTO 053', 'fcr-final');
    expect(c.querySelector('.fcr-final__valor')?.textContent).toBe('200');
    expect(c.querySelector('.fcr-final__apoio')?.textContent).toBe('quantidade cotada · 09/11');
    expect(c.getAttribute('title')).toContain('Atualizada em 09/11 12:30.');
  });

  it('fechada e PO enviada: mostra o valor final (formato kgBr) apos o fechamento', async () => {
    await carregar();
    const f = celula('PRODUTO 054', 'fcr-final');
    expect(f.querySelector('.fcr-final__valor')?.textContent).toBe('1.180,5');
    expect(f.querySelector('.fcr-final__apoio')?.textContent).toBe('após o fechamento · 10/11');
    expect(celula('PRODUTO 055', 'fcr-final').querySelector('.fcr-final__valor')?.textContent).toBe('900');
  });

  it('o expansor mantem a Qtd. final CALCULADA (literal da paridade com o XLSX) com o sufixo "calculada"', async () => {
    await carregar();
    expandirDetalhes();
    const detalhes = linhaDe('PRODUTO 051').nextElementSibling as HTMLElement;
    const rotulos = Array.from(detalhes.querySelectorAll('.fcr-det__rotulo')).map((r) => r.textContent);
    expect(rotulos).toContain('Qtd. final calculada');
    expect(within(detalhes).getByText('Qtd. final')).toBeTruthy();
  });
});

describe('status automatico', () => {
  it('sem vinculo: o status congelado de hoje, em texto simples (sem selo)', async () => {
    await carregar();
    const st = celula('PRODUTO 051', 'fcr-status');
    expect(st.textContent).toBe('Cotando');
    expect(st.querySelector('.badge')).toBeNull();
    // o item 052 tem status congelado "Cotação não enviada" e hoje tem cotacao criada: vale a derivada
    expect(celula('PRODUTO 052', 'fcr-status').querySelector('.badge')?.textContent).toBe('Cotação criada');
  });

  it.each([
    ['PRODUTO 052', 'Cotação criada', 'badge--info', 'COT-0152'],
    ['PRODUTO 053', 'Cotando', 'badge--warning', 'COT-0153'],
    ['PRODUTO 054', 'Confirmado, aguarda PO', 'badge--info', 'COT-0154'],
    ['PRODUTO 055', 'PO enviada', 'badge--success', 'COT-0155'],
  ])('%s: selo "%s" com o codigo da cotacao discreto', async (nome, rotulo, classe, codigo) => {
    await carregar();
    const st = celula(nome, 'fcr-status');
    const selo = st.querySelector('.badge') as HTMLElement;
    expect(selo.textContent).toBe(rotulo);
    expect(selo.classList.contains(classe)).toBe(true);
    expect(st.querySelector('.fcr-status__apoio')?.textContent).toBe(codigo);
  });

  it('rascunho local (E6): "Rascunho" no lugar do status, com a linha do rascunho', async () => {
    await carregar();
    const st = celula('PRODUTO 056', 'fcr-status');
    expect(st.querySelector('.badge')?.textContent).toBe('Rascunho');
    expect(st.textContent).not.toContain('Cotação não enviada');
    expect(st.textContent).toContain('70 kg a cotar');
  });

  it('backend sem `statusDerivado`: o status vem do estado da cotacao vinculada', async () => {
    decisoes = [decisao({ productId: 53, cotacao: { id: 153, requestCode: 'COT-0153', statusCotacao: 'fechada' } })];
    renderRelatorio();
    await screen.findByText('PRODUTO 053');
    await waitFor(() => expect(celula('PRODUTO 053', 'fcr-status').textContent).toContain('Confirmado, aguarda PO'));
  });

  it('decisao sem cotacao (so quantidade decidida) nao muda o status congelado', async () => {
    decisoes = [decisao({ productId: 51, status: 'po' })];
    renderRelatorio();
    await screen.findByText('PRODUTO 051');
    await waitFor(() => expect(get.mock.calls.some(([p]) => String(p).endsWith('/decisoes'))).toBe(true));
    expect(celula('PRODUTO 051', 'fcr-status').textContent).toBe('Cotando');
  });
});

describe('acoes e tracking por linha', () => {
  it('sem cotacao: "Cotar"; rascunho: "Continuar"; sem links de cotacao', async () => {
    await carregar();
    expect(within(celula('PRODUTO 051', 'fcr-acao')).getByRole('button', { name: 'Cotar PRODUTO 051' })).toBeTruthy();
    expect(within(celula('PRODUTO 051', 'fcr-acao')).queryByRole('link')).toBeNull();
    const rascunho = celula('PRODUTO 056', 'fcr-acao');
    expect(within(rascunho).getByRole('button', { name: 'Continuar cotação de PRODUTO 056' })).toBeTruthy();
    expect(within(rascunho).queryByRole('button', { name: 'Cotar PRODUTO 056' })).toBeNull();
  });

  it('com cotacao: "Ver cotação" leva a /cotacoes/<id>; sem "Cotar"', async () => {
    await carregar();
    for (const [nome, id] of [['PRODUTO 052', 152], ['PRODUTO 053', 153], ['PRODUTO 054', 154]] as const) {
      const acao = celula(nome, 'fcr-acao');
      const ver = within(acao).getByRole('link', { name: new RegExp(`^Ver cotação COT-0${id} de ${nome}$`) });
      expect(ver.getAttribute('href')).toBe(`/cotacoes/${id}`);
      expect(within(acao).queryByRole('link', { name: /^Ver pedido/ })).toBeNull();
      expect(within(acao).queryByRole('button')).toBeNull();
    }
  });

  it('PO enviada: "Ver pedido" leva a aba Comparacoes da cotacao, junto de "Ver cotação"', async () => {
    await carregar();
    const acao = celula('PRODUTO 055', 'fcr-acao');
    expect(within(acao).getByRole('link', { name: 'Ver cotação COT-0155 de PRODUTO 055' }).getAttribute('href')).toBe('/cotacoes/155');
    expect(within(acao).getByRole('link', { name: 'Ver pedido da cotação COT-0155 de PRODUTO 055' }).getAttribute('href')).toBe(
      '/cotacoes/155?aba=comparacao',
    );
  });

  it('expansor Detalhes: cotacao (codigo, situacao, links) e o resumo da decisao com a Qtd. final', async () => {
    await carregar();
    expandirDetalhes();
    const det = linhaDe('PRODUTO 055').nextElementSibling as HTMLElement;
    const cotacao = Array.from(det.querySelectorAll('.fcr-det')).find((d) => d.querySelector('.fcr-det__rotulo')?.textContent === 'Cotação') as HTMLElement;
    expect(cotacao.textContent).toContain('COT-0155');
    expect(cotacao.textContent).toContain('fechada, PO enviada');
    expect(within(cotacao).getByRole('link', { name: 'Abrir cotação COT-0155 de PRODUTO 055' }).getAttribute('href')).toBe('/cotacoes/155');
    expect(within(cotacao).getByRole('link', { name: 'Ver pedido da cotação COT-0155 de PRODUTO 055' }).getAttribute('href')).toBe(
      '/cotacoes/155?aba=comparacao',
    );
    expect(det.textContent).toContain('Qtd. final (sistema): 900 kg · COT-0155');
    // sem cotacao: nenhum bloco "Cotação" no expansor
    const semCot = linhaDe('PRODUTO 051').nextElementSibling as HTMLElement;
    expect(Array.from(semCot.querySelectorAll('.fcr-det__rotulo')).map((r) => r.textContent)).not.toContain('Cotação');
  });
});

describe('papeis', () => {
  it('quem so le (gestor/viewer) ve Qtd. final, status e os links, mas nunca "Cotar"/"Continuar" nem a selecao', async () => {
    renderRelatorio({ podeCriar: false });
    await screen.findByText('PRODUTO 051');
    await waitFor(() => expect(screen.queryAllByRole('link', { name: /^Ver cotação COT-0152/ })).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /^(Cotar|Continuar cotação de) / })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(celula('PRODUTO 054', 'fcr-final').querySelector('.fcr-final__valor')?.textContent).toBe('1.180,5');
    expect(celula('PRODUTO 054', 'fcr-status').querySelector('.badge')?.textContent).toBe('Confirmado, aguarda PO');
    expect(screen.getByRole('link', { name: 'Ver pedido da cotação COT-0155 de PRODUTO 055' }).getAttribute('href')).toBe('/cotacoes/155?aba=comparacao');
    // sem permissao nao ha rascunho: o item 056 mantem o status congelado
    expect(celula('PRODUTO 056', 'fcr-status').textContent).toBe('Cotação não enviada');
    expect(celula('PRODUTO 056', 'fcr-acao').textContent).toBe('');
  });
});

describe('impressao', () => {
  it('Qtd. final e status ficam em celulas que imprimem; as acoes (botoes e links) ficam so na coluna .fcr-acao (oculta no papel)', async () => {
    await carregar();
    const linha = linhaDe('PRODUTO 055');
    expect(linha.querySelector('td.fcr-final')).not.toBeNull();
    expect(linha.querySelector('td.fcr-status .badge')).not.toBeNull();
    expect(linha.querySelector('td.fcr-final a, td.fcr-status a')).toBeNull();
    const links = Array.from(linha.querySelectorAll('a'));
    expect(links.length).toBe(2);
    for (const a of links) expect(a.closest('td')?.classList.contains('fcr-acao')).toBe(true);
    // no expansor, os links ficam num bloco proprio (oculto no papel); o codigo da cotacao segue como texto
    expandirDetalhes();
    const det = linha.nextElementSibling as HTMLElement;
    for (const a of Array.from(det.querySelectorAll('a'))) expect(a.closest('.fcr-det__links')).not.toBeNull();
    const codigo = Array.from(det.querySelectorAll('.fcr-mono')).find((e) => e.textContent === 'COT-0155');
    expect(codigo).toBeTruthy();
    expect(codigo?.closest('.fcr-det__links')).toBeNull();
  });
});
