import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ForecastCandidato, ForecastRascunho } from '@/services/forecastCotacaoLote';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import { ProvedorGerarCotacao } from './ForecastGerarCotacao';

// Selecao em varias linhas, barra de acao e pop-up "Criar cotacao" (E6 do relatorio enxuto). Dados 100% sinteticos.

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
import { abrirCotar } from '@/test/forecastDetalhes';

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);
const post = vi.mocked(api.post);
const del = vi.mocked(api.del);

function item(over: Record<string, unknown> = {}) {
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

interface Cenario {
  /** Grupos do relatorio (fonte + itens). */
  grupos: Array<{ fonte: string; itens: Array<Record<string, unknown>> }>;
  /** productIds com codigo vinculado ao catalogo (os demais ficam sem vinculo). */
  vinculados: number[];
  decisoes: ForecastDecisao[];
  rascunho: ForecastRascunho | null;
  /** Candidatos por fonte (chave em maiusculas). */
  candidatos: Record<string, ForecastCandidato[]>;
  /** Falhas simuladas. */
  rascunhoGetFalha?: boolean;
  candidatosFalha?: boolean;
}

function candidato(over: Partial<ForecastCandidato> = {}): ForecastCandidato {
  return {
    productId: 9,
    item: 'PRODUTO 009',
    codigos: ['C0009'],
    fonte: 'FONTE 001',
    demandaKg: 480,
    quantidadeSugeridaKg: null,
    motivoForaDaLista: 'sem-falta',
    coberturaAteMes: '2027-01',
    coberturaAteOFimDaJanela: false,
    urgencia: null,
    grupoNome: null,
    ...over,
  };
}

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
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

function rascunhoDe(itens: ForecastRascunho['itens'], atualizadoEm = '2026-10-27T15:00:00.000Z'): ForecastRascunho {
  return { snapshotId: 7, itens, criadoEm: '2026-10-27T14:00:00.000Z', atualizadoEm };
}

function cenarioPadrao(): Cenario {
  return {
    grupos: [
      {
        fonte: 'FONTE 001',
        itens: [
          item({ linha: 3, productId: 41, item: 'PRODUTO 001', codigos: ['C0041'], quantidadeFinal: 125.12345 }),
          item({ linha: 4, productId: 42, item: 'PRODUTO 002', codigos: ['C0042'], quantidadeFinal: 80 }),
          item({ linha: 5, productId: 44, item: 'PRODUTO 005', codigos: ['C0044'], quantidadeFinal: 55 }),
          item({ linha: 6, productId: null, item: 'PRODUTO 004', codigos: ['C0099'], quantidadeFinal: 10 }),
        ],
      },
      { fonte: 'FONTE 002', itens: [item({ linha: 7, productId: 43, item: 'PRODUTO 003', codigos: ['C0043'], quantidadeFinal: 300 })] },
    ],
    vinculados: [41, 42, 43, 44],
    decisoes: [],
    rascunho: null,
    candidatos: {
      'FONTE 001': [
        candidato({ productId: 9, item: 'PRODUTO 009', codigos: ['C0009'], demandaKg: 480 }),
        candidato({ productId: 10, item: 'PRODUTO 010', codigos: ['C0010'], demandaKg: 120, quantidadeSugeridaKg: 50.5, motivoForaDaLista: 'sob-demanda' }),
      ],
      'FONTE 002': [candidato({ productId: 11, item: 'PRODUTO 011', codigos: ['C0011'], fonte: 'FONTE 002', demandaKg: 90 })],
    },
  };
}

let c: Cenario;
let versaoRascunho = 0;

function relatorio() {
  const itens = c.grupos.flatMap((g) => g.itens);
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: itens.length, fontes: c.grupos.length, vencidas: 0, semEmbalagem: itens.length, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: c.grupos.map((g) => ({ fonte: g.fonte, leadTimeDias: 30, dataLimiteMaisUrgente: '2026-10-22', vencidas: 0, itens: g.itens })),
  };
}

function produtos() {
  return [...c.grupos.flatMap((g) => g.itens.map((i) => i.productId as number | null)), 9, 10, 11]
    .filter((id): id is number => id !== null)
    .map((id) => ({
      id,
      name: `PRODUTO ${id}`,
      isActive: true,
      source: { id: 1, name: 'FONTE 001' },
      codes: [
        {
          id: id * 10,
          position: 1,
          code: `C${String(id).padStart(4, '0')}`,
          catalogItemId: c.vinculados.includes(id) || id < 40 ? id + 100 : null,
          catalogItem: c.vinculados.includes(id) || id < 40 ? { id: id + 100, commercialName: `ITEM ${id}`, marketName: `M${id}` } : null,
        },
      ],
    }));
}

function instalarApi() {
  get.mockImplementation((async (path: string, query?: Record<string, string>) => {
    if (path === '/v1/forecast/products') return { data: produtos() };
    if (path.endsWith('/decisoes')) return { data: { snapshotId: 7, label: '10-2', decisoes: c.decisoes } };
    if (path.endsWith('/rascunho-cotacao')) {
      if (c.rascunhoGetFalha) throw new ApiError(500, null);
      return { data: c.rascunho };
    }
    if (path.endsWith('/candidatos-cotacao')) {
      if (c.candidatosFalha) throw new ApiError(500, null);
      const fonte = query?.fonte?.toUpperCase();
      const fontes = Object.entries(c.candidatos)
        .filter(([chave]) => fonte === undefined || chave === fonte)
        .map(([chave, itens]) => ({ fonte: chave, itens }));
      return { data: { snapshotId: 7, label: '10-2', fonte: query?.fonte ?? null, fontes, excluidos: [] } };
    }
    if (path.endsWith('/relatorio-compras')) return { data: relatorio() };
    return { data: {} };
  }) as never);
  put.mockImplementation((async (path: string, body: { itens: ForecastRascunho['itens'] }) => {
    if (!path.endsWith('/rascunho-cotacao')) throw new Error(`PUT inesperado: ${path}`);
    versaoRascunho += 1;
    const rascunho = rascunhoDe(body.itens, `2026-10-27T15:00:${String(versaoRascunho).padStart(2, '0')}.000Z`);
    const acao = c.rascunho ? 'update' : 'create';
    c.rascunho = body.itens.length === 0 ? null : rascunho;
    return { data: { acao: body.itens.length === 0 ? 'delete' : acao, rascunho: c.rascunho } };
  }) as never);
  del.mockImplementation((async (path: string) => {
    if (!path.endsWith('/rascunho-cotacao')) throw new Error(`DELETE inesperado: ${path}`);
    c.rascunho = null;
    return { data: { acao: 'delete', rascunho: null } };
  }) as never);
  post.mockImplementation((async (path: string, body: { itens: Array<{ productId: number; quantidadeKg: number }> }) => {
    if (!path.endsWith('/cotacoes')) throw new Error(`POST inesperado: ${path}`);
    const porFonte = new Map<string, typeof body.itens>();
    for (const i of body.itens) {
      const fonte = c.grupos.find((g) => g.itens.some((x) => x.productId === i.productId))?.fonte ?? 'FONTE 001';
      porFonte.set(fonte, [...(porFonte.get(fonte) ?? []), i]);
    }
    return {
      data: {
        snapshotId: 7,
        label: '10-2',
        cotacoes: [...porFonte.entries()].map(([fonte, itens], n) => ({
          id: 501 + n,
          requestCode: `COT-000${n + 1}`,
          fonte,
          itens: itens.map((i) => ({ productId: i.productId, item: `PRODUTO ${i.productId}`, quantidadeKg: i.quantidadeKg })),
        })),
      },
    };
  }) as never);
}

function renderRelatorio(opts: { podeCriar?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const podeCriar = opts.podeCriar ?? true;
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
          <Route path="/cotacoes/:id" element={<div>detalhe</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const marcar = async (nome: string) => fireEvent.click(await screen.findByRole('checkbox', { name: `Selecionar ${nome}` }));
const barra = () => screen.queryByRole('region', { name: 'Itens selecionados' });

async function abrirPelaBarra(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Criar cotação' }));
  const titulo = await screen.findByRole('heading', { name: 'Criar cotação' });
  const dialogo = titulo.closest('dialog') as HTMLElement;
  await within(dialogo).findByRole('button', { name: 'Cancelar' });
  return dialogo;
}

const campoKg = (d: HTMLElement, nome: string) => within(d).getByLabelText(`Quantidade a cotar de ${nome}`) as HTMLInputElement;
const botaoGerar = (d: HTMLElement) => within(d).getByRole('button', { name: /^Gerar( \d+)? cotaç(ão|ões)$|^Gerando…$/ }) as HTMLButtonElement;
const chamadas = (fim: string) => get.mock.calls.filter(([p]) => String(p).endsWith(fim));

/** Espera o debounce do rascunho (1,2 s) com folga. */
const esperarGravacao = (n = 1) => waitFor(() => expect(put).toHaveBeenCalledTimes(n), { timeout: 4000 });

beforeEach(() => {
  vi.clearAllMocks();
  c = cenarioPadrao();
  versaoRascunho = 0;
  instalarApi();
});

describe('selecao em varias linhas e barra de acao', () => {
  it('marcar linhas mostra a barra ("N itens selecionados" + Criar cotacao); Limpar selecao a esconde', async () => {
    renderRelatorio();
    expect(await screen.findByRole('checkbox', { name: 'Selecionar PRODUTO 001' })).toBeTruthy();
    expect(barra()).toBeNull();

    await marcar('PRODUTO 001');
    expect(barra()?.textContent).toContain('1 item selecionado');
    await marcar('PRODUTO 003');
    const b = barra() as HTMLElement;
    expect(b.textContent).toContain('2 itens selecionados');
    expect(b.textContent).toContain('2 fontes');
    expect(b.textContent).toMatch(/425,12\d* kg sugeridos/);
    expect(within(b).getByRole('button', { name: 'Criar cotação' })).toBeTruthy();

    fireEvent.click(within(b).getByRole('button', { name: 'Limpar seleção' }));
    expect(barra()).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Selecionar PRODUTO 001' }) as HTMLInputElement).checked).toBe(false);
  });

  it('selecionar todos da fonte marca so os itens marcaveis (nao o sem cadastro); parcial fica indeterminado', async () => {
    renderRelatorio();
    const todos = (await screen.findByRole('checkbox', { name: 'Selecionar todos os itens da fonte FONTE 001' })) as HTMLInputElement;
    fireEvent.click(todos);
    expect(barra()?.textContent).toContain('3 itens selecionados');
    expect(todos.checked).toBe(true);
    expect(todos.indeterminate).toBe(false);
    for (const nome of ['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 005']) {
      expect((screen.getByRole('checkbox', { name: `Selecionar ${nome}` }) as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.queryByRole('checkbox', { name: 'Selecionar PRODUTO 004' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar PRODUTO 002' }));
    expect(todos.checked).toBe(false);
    expect(todos.indeterminate).toBe(true);

    fireEvent.click(todos);
    expect(todos.checked).toBe(true);
    fireEvent.click(todos);
    expect(barra()).toBeNull();
  });

  it('item sem produto no cadastro: sem checkbox e Cotar desabilitado com o motivo', async () => {
    renderRelatorio();
    const cotar = await screen.findByRole('button', { name: 'Cotar PRODUTO 004' });
    expect(cotar.getAttribute('aria-disabled')).toBe('true');
    const motivo = document.getElementById(cotar.getAttribute('aria-describedby') as string);
    expect(motivo?.textContent).toBe('Item fora do cadastro do Forecast.');
    fireEvent.click(cotar);
    expect(screen.queryByRole('heading', { name: 'Criar cotação' })).toBeNull();
  });

  it('item que ja esta em cotacao aberta: checkbox desabilitado com o motivo e fora do "selecionar todos"', async () => {
    c.decisoes = [decisao({ productId: 42, cotacao: { id: 9, requestCode: 'COT-0009', statusCotacao: 'criada' } })];
    renderRelatorio();
    const caixa = (await screen.findByRole('checkbox', { name: 'Selecionar PRODUTO 002' })) as HTMLInputElement;
    await waitFor(() => expect(caixa.disabled).toBe(true));
    expect(caixa.title).toBe('Já está na cotação aberta COT-0009.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos os itens da fonte FONTE 001' }));
    expect(barra()?.textContent).toContain('2 itens selecionados');
  });

  it('a cotacao ja fechada (fechada/PO) nao bloqueia a selecao', async () => {
    c.decisoes = [decisao({ productId: 42, cotacao: { id: 9, requestCode: 'COT-0009', statusCotacao: 'po_enviada' } })];
    renderRelatorio();
    const caixa = (await screen.findByRole('checkbox', { name: 'Selecionar PRODUTO 002' })) as HTMLInputElement;
    await waitFor(() => expect(chamadas('/decisoes')).toHaveLength(1));
    expect(caixa.disabled).toBe(false);
  });

  it('leitor (gestor/viewer): sem checkbox, sem barra e sem Cotar; nenhum GET de rascunho nem de produtos', async () => {
    renderRelatorio({ podeCriar: false });
    await screen.findByText('5 itens em 2 fontes');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(barra()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cotar / })).toBeNull();
    expect(chamadas('/rascunho-cotacao')).toHaveLength(0);
    expect(chamadas('/v1/forecast/products')).toHaveLength(0);
  });
});

describe('pop-up Criar cotacao: itens, fontes e quantidades', () => {
  it('abre pela barra com os itens agrupados por fonte e o resumo "Serao geradas 2 cotacoes"', async () => {
    renderRelatorio();
    await marcar('PRODUTO 001');
    await marcar('PRODUTO 002');
    await marcar('PRODUTO 003');
    const d = await abrirPelaBarra();
    expect(within(d).getByText('Quinzena 10-2 · uma cotação por fonte')).toBeTruthy();
    const g1 = within(d).getByRole('group', { name: 'Itens da fonte FONTE 001' });
    const g2 = within(d).getByRole('group', { name: 'Itens da fonte FONTE 002' });
    expect(within(g1).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['PRODUTO 001', 'PRODUTO 002']);
    expect(within(g2).getAllByRole('listitem')).toHaveLength(1);
    expect(within(d).getByText('Serão geradas 2 cotações: FONTE 001 (2 itens) e FONTE 002 (1 item).')).toBeTruthy();
    expect(botaoGerar(d).textContent).toBe('Gerar 2 cotações');
    expect(within(d).getByText('3 itens · 506 kg')).toBeTruthy();
  });

  it('a quantidade nasce da decisao salva ou da Qtd. final (kg inteiro para cima); Usar sugerida e Obs.', async () => {
    c.decisoes = [decisao({ productId: 42, quantidadeKg: 300, observacao: 'OBS SALVA' })];
    renderRelatorio();
    await marcar('PRODUTO 001');
    await marcar('PRODUTO 002');
    const d = await abrirPelaBarra();
    expect(campoKg(d, 'PRODUTO 001').value).toBe('126');
    expect(campoKg(d, 'PRODUTO 002').value).toBe('300');
    expect((within(d).getByLabelText('Observação de PRODUTO 002') as HTMLInputElement).value).toBe('OBS SALVA');

    fireEvent.change(campoKg(d, 'PRODUTO 002'), { target: { value: '10,5' } });
    expect(within(d).getByText('A cotação leva 11 kg (inteiro, para cima).')).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Usar sugerida de PRODUTO 002' }));
    expect(campoKg(d, 'PRODUTO 002').value).toBe('80');
  });

  it('quantidade invalida ou vazia: mensagem no item e Gerar desabilitado; corrigir libera', async () => {
    renderRelatorio();
    await marcar('PRODUTO 001');
    const d = await abrirPelaBarra();
    expect(botaoGerar(d).disabled).toBe(false);

    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '' } });
    expect(within(d).getByText('Informe a quantidade a cotar.')).toBeTruthy();
    expect(campoKg(d, 'PRODUTO 001').getAttribute('aria-invalid')).toBe('true');
    expect(botaoGerar(d).disabled).toBe(true);
    expect(within(d).getByText('1 item precisa de ajuste (quantidade ou bloqueio) antes de gerar.')).toBeTruthy();

    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '0' } });
    expect(within(d).getByText('A quantidade a cotar deve ser maior que zero.')).toBeTruthy();
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: 'abc' } });
    expect(within(d).getByText('Informe a quantidade em kg (ex.: 1.600 ou 1600,5).')).toBeTruthy();
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '20' } });
    expect(botaoGerar(d).disabled).toBe(false);
  });

  it('decisao 0 (nao comprar): campo vazio com a dica; o usuario informa a quantidade', async () => {
    c.decisoes = [decisao({ productId: 42, quantidadeKg: 0 })];
    renderRelatorio();
    await marcar('PRODUTO 002');
    const d = await abrirPelaBarra();
    expect(campoKg(d, 'PRODUTO 002').value).toBe('');
    expect(within(d).getByText('Informe a quantidade a cotar.')).toBeTruthy();
    fireEvent.change(campoKg(d, 'PRODUTO 002'), { target: { value: '15' } });
    expect(botaoGerar(d).disabled).toBe(false);
  });

  it('tirar da cotacao remove o item e muda o resumo; sem itens, Gerar fica desabilitado', async () => {
    renderRelatorio();
    await marcar('PRODUTO 001');
    await marcar('PRODUTO 003');
    const d = await abrirPelaBarra();
    fireEvent.click(within(d).getByRole('button', { name: 'Tirar PRODUTO 003 da cotação' }));
    expect(within(d).getByText('Será gerada 1 cotação: FONTE 001 (1 item).')).toBeTruthy();
    expect(botaoGerar(d).textContent).toBe('Gerar cotação');
    fireEvent.click(within(d).getByRole('button', { name: 'Tirar PRODUTO 001 da cotação' }));
    expect(within(d).getByText(/Nenhum item na cotação/)).toBeTruthy();
    expect(botaoGerar(d).disabled).toBe(true);
  });

  it('Cotar da linha abre o pop-up so com aquele item; cancelar devolve o foco a acao', async () => {
    renderRelatorio();
    const acao = await screen.findByRole('button', { name: 'Cotar PRODUTO 003' });
    const d = await abrirCotar('PRODUTO 003');
    expect(within(d).getAllByRole('listitem').filter((li) => li.classList.contains('fcl-item'))).toHaveLength(1);
    expect(campoKg(d, 'PRODUTO 003').value).toBe('300');
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(document.activeElement).toBe(acao));
    expect(screen.queryByRole('heading', { name: 'Criar cotação' })).toBeNull();
  });
});

describe('pop-up Criar cotacao: bloqueios', () => {
  it('item sem fonte: bloqueado com "Item sem fonte." e Gerar desabilitado ate tirar o item', async () => {
    c.grupos = [{ fonte: '', itens: [item({ productId: 41, item: 'PRODUTO 001' })] }, ...c.grupos.slice(1)];
    renderRelatorio();
    await marcar('PRODUTO 001');
    await marcar('PRODUTO 003');
    const d = await abrirPelaBarra();
    expect(within(d).getByText('Item sem fonte.')).toBeTruthy();
    expect(within(d).getByRole('group', { name: 'Itens da fonte Sem fonte' })).toBeTruthy();
    expect(botaoGerar(d).disabled).toBe(true);
    expect(within(d).getByText('Será gerada 1 cotação: FONTE 002 (1 item).')).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Tirar PRODUTO 001 da cotação' }));
    expect(botaoGerar(d).disabled).toBe(false);
  });

  it('produto sem codigo vinculado ao catalogo: motivo visivel e Gerar desabilitado', async () => {
    c.vinculados = [42, 43, 44];
    renderRelatorio();
    await marcar('PRODUTO 001');
    const d = await abrirPelaBarra();
    await waitFor(() => expect(within(d).getByText('Nenhum código deste produto está vinculado a um item do catálogo.')).toBeTruthy());
    expect(botaoGerar(d).disabled).toBe(true);
  });

  it('item que ja esta em cotacao aberta: a linha troca "Cotar" por "Ver cotacao" (E7) e o checkbox fica bloqueado com o codigo', async () => {
    c.decisoes = [decisao({ productId: 42, cotacao: { id: 9, requestCode: 'COT-0009', statusCotacao: 'enviada' } })];
    renderRelatorio();
    await waitFor(() => expect(chamadas('/decisoes')).toHaveLength(1));
    const ver = await screen.findByRole('link', { name: 'Ver cotação COT-0009 de PRODUTO 002' });
    expect(ver.getAttribute('href')).toBe('/cotacoes/9');
    expect(screen.queryByRole('button', { name: 'Cotar PRODUTO 002' })).toBeNull();
    const caixa = screen.getByRole('checkbox', { name: 'Selecionar PRODUTO 002' }) as HTMLInputElement;
    expect(caixa.disabled).toBe(true);
    expect(caixa.getAttribute('title')).toBe('Já está na cotação aberta COT-0009.');
  });
});

describe('pop-up Criar cotacao: convite "incluir?" e adicionar outro item', () => {
  it('convida a incluir os demais itens da mesma fonte (lista e candidatos, inclusive sem falta) com a etiqueta do motivo', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    const convite = await within(d).findByRole('region', { name: 'Outros itens da fonte FONTE 001' });
    // PRODUTO 002 e 005 (lista) + candidatos 009 (sem falta) e 010 (sob demanda); o sem cadastro nunca entra
    await waitFor(() => expect(within(convite).getAllByRole('checkbox')).toHaveLength(4));
    expect(within(convite).getByText('Há 4 itens da FONTE 001 com demanda nesta quinzena que não estão na cotação.')).toBeTruthy();
    expect(within(convite).getByText('Sem falta: estoque cobre até jan/2027')).toBeTruthy();
    expect(within(convite).getByText('Compra sob demanda')).toBeTruthy();
    expect(within(convite).getAllByText('Na lista de compra')).toHaveLength(2);
    expect(within(convite).getByText('Demanda 480 kg')).toBeTruthy();
    expect(within(convite).queryByText('PRODUTO 004')).toBeNull();
    // 1 GET por fonte da cotacao, com o parametro `fonte`
    expect(get.mock.calls.filter(([p, q]) => String(p).endsWith('/candidatos-cotacao') && (q as { fonte?: string } | undefined)?.fonte === 'FONTE 001')).toHaveLength(1);
  });

  it('incluir um candidato adiciona o item como "Fora da lista de compra"; desmarcar o tira; "Agora nao" esconde o convite', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    const convite = await within(d).findByRole('region', { name: 'Outros itens da fonte FONTE 001' });
    await waitFor(() => expect(within(convite).getAllByRole('checkbox')).toHaveLength(4));

    fireEvent.click(within(convite).getByRole('checkbox', { name: 'Incluir PRODUTO 009' }));
    const grupo = within(d).getByRole('group', { name: 'Itens da fonte FONTE 001' });
    expect(within(grupo).getByText('PRODUTO 009')).toBeTruthy();
    expect(within(grupo).getByText('Fora da lista de compra')).toBeTruthy();
    expect(campoKg(d, 'PRODUTO 009').value).toBe('');
    expect(within(d).getByText('Sem falta calculada: informe a quantidade a cotar.')).toBeTruthy();
    expect(within(convite).getByText('Há 3 itens da FONTE 001 com demanda nesta quinzena que não estão na cotação.')).toBeTruthy();
    expect((within(convite).getByRole('checkbox', { name: 'Incluir PRODUTO 009' }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(convite).getByRole('checkbox', { name: 'Incluir PRODUTO 009' }));
    expect(within(grupo).queryByText('PRODUTO 009')).toBeNull();

    fireEvent.click(within(convite).getByRole('button', { name: 'Incluir os 4' }));
    expect(within(grupo).getAllByRole('listitem')).toHaveLength(5);
    expect(campoKg(d, 'PRODUTO 010').value).toBe('51');

    fireEvent.click(within(convite).getByRole('button', { name: 'Agora não' }));
    expect(within(d).queryByRole('region', { name: 'Outros itens da fonte FONTE 001' })).toBeNull();
  });

  it('adicionar outro item: a mesma fonte aparece primeiro e em destaque; outras fontes avisam que criam mais uma cotacao', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    const mesma = await within(d).findByRole('group', { name: 'Mesma fonte' });
    expect(within(mesma).getByText('Mesma fonte · com demanda')).toBeTruthy();
    expect(within(mesma).getByRole('button', { name: 'Adicionar PRODUTO 002 à cotação' })).toBeTruthy();
    expect(within(d).queryByRole('group', { name: 'Outras fontes' })).toBeNull();

    fireEvent.change(within(d).getByLabelText('Buscar item para adicionar'), { target: { value: 'produto 011' } });
    const outras = await within(d).findByRole('group', { name: 'Outras fontes' });
    expect(within(outras).getByText('cria mais uma cotação')).toBeTruthy();
    expect(within(outras).getByText('FONTE 002')).toBeTruthy();
    // 1 GET com todas as fontes (sem `fonte`), so depois de digitar
    expect(get.mock.calls.filter(([p, q]) => String(p).endsWith('/candidatos-cotacao') && (q as { fonte?: string } | undefined) === undefined)).toHaveLength(1);

    fireEvent.click(within(outras).getByRole('button', { name: 'Adicionar PRODUTO 011 à cotação' }));
    expect(within(d).getByRole('group', { name: 'Itens da fonte FONTE 002' })).toBeTruthy();
    expect(within(d).getByText('Serão geradas 2 cotações: FONTE 001 (1 item) e FONTE 002 (1 item).')).toBeTruthy();
    expect(within(d).queryByRole('group', { name: 'Outras fontes' })).toBeNull();
  });

  it('busca sem resultado avisa; erro ao carregar os candidatos da fonte mostra mensagem e "Tentar de novo"', async () => {
    c.candidatosFalha = true;
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 003');
    const convite = await within(d).findByRole('region', { name: 'Outros itens da fonte FONTE 002' });
    await waitFor(() => expect(within(convite).getByText(/Não foi possível carregar os itens com demanda \(HTTP 500\)/)).toBeTruthy());
    c.candidatosFalha = false;
    fireEvent.click(within(convite).getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(within(d).getByRole('checkbox', { name: 'Incluir PRODUTO 011' })).toBeTruthy());

    fireEvent.change(within(d).getByLabelText('Buscar item para adicionar'), { target: { value: 'zzzz' } });
    expect(await within(d).findByText(/Nenhum item com demanda encontrado para “zzzz”/)).toBeTruthy();
  });
});

describe('pop-up Criar cotacao: gerar', () => {
  it('POST em lote com o corpo exato; apaga o rascunho; fica na tela com os links "Abrir COT-..."; limpa a selecao', async () => {
    c.decisoes = [decisao({ productId: 42, quantidadeKg: 300, observacao: 'OBS SALVA', atualizadaEm: '2026-10-26T17:30:00.000Z' })];
    renderRelatorio();
    await marcar('PRODUTO 001');
    await marcar('PRODUTO 002');
    await marcar('PRODUTO 003');
    const d = await abrirPelaBarra();
    // um candidato de fora da lista entra pelo convite da FONTE 001
    const convite = await within(d).findByRole('region', { name: 'Outros itens da fonte FONTE 001' });
    fireEvent.click(await within(convite).findByRole('checkbox', { name: 'Incluir PRODUTO 010' }));
    fireEvent.change(within(d).getByLabelText('Observação de PRODUTO 001'), { target: { value: '  oi  ' } });

    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![0]).toBe('/v1/forecast/snapshots/7/cotacoes');
    expect(post.mock.calls[0]![1]).toEqual({
      itens: [
        { productId: 41, quantidadeKg: 126, observacao: 'oi', atualizadoEm: null },
        { productId: 42, quantidadeKg: 300, observacao: 'OBS SALVA', atualizadoEm: '2026-10-26T17:30:00.000Z' },
        { productId: 43, quantidadeKg: 300, observacao: null, atualizadoEm: null },
        { productId: 10, quantidadeKg: 51, observacao: null, incluidoManualmente: true, atualizadoEm: null },
      ],
    });

    // fica na tela: pop-up fechado, aviso com os links, selecao limpa
    const aviso = await screen.findByRole('status', { name: 'Cotações criadas' });
    expect(aviso.textContent).toContain('2 cotações criadas');
    const l1 = within(aviso).getByRole('link', { name: 'Abrir COT-0001' });
    expect(l1.getAttribute('href')).toBe('/cotacoes/501');
    expect(within(aviso).getByRole('link', { name: 'Abrir COT-0002' }).getAttribute('href')).toBe('/cotacoes/502');
    expect(aviso.textContent).toContain('FONTE 001 (3 itens)');
    expect(screen.queryByRole('heading', { name: 'Criar cotação' })).toBeNull();
    expect(barra()).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Selecionar PRODUTO 001' }) as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(aviso));

    // rascunho apagado e decisoes recarregadas (as quantidades foram gravadas pelo lote)
    expect(del).toHaveBeenCalledWith('/v1/forecast/snapshots/7/rascunho-cotacao');
    await waitFor(() => expect(chamadas('/decisoes').length).toBeGreaterThanOrEqual(2));

    fireEvent.click(within(aviso).getByRole('button', { name: 'Dispensar' }));
    expect(screen.queryByRole('status', { name: 'Cotações criadas' })).toBeNull();
  });

  it('erro do lote (409): a mensagem do backend aparece, o pop-up segue aberto e o que foi digitado fica', async () => {
    post.mockRejectedValueOnce(new ApiError(409, { message: 'Não foi possível gerar as cotações. PRODUTO 001: já está na cotação aberta COT-0001.' }));
    renderRelatorio();
    await marcar('PRODUTO 001');
    await marcar('PRODUTO 003');
    const d = await abrirPelaBarra();
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '777' } });
    fireEvent.change(within(d).getByLabelText('Observação de PRODUTO 001'), { target: { value: 'MINHA OBS' } });

    fireEvent.click(botaoGerar(d));
    const alerta = await within(d).findByRole('alert');
    expect(alerta.textContent).toContain('PRODUTO 001: já está na cotação aberta COT-0001.');
    expect(campoKg(d, 'PRODUTO 001').value).toBe('777');
    expect((within(d).getByLabelText('Observação de PRODUTO 001') as HTMLInputElement).value).toBe('MINHA OBS');
    expect(within(d).getByRole('group', { name: 'Itens da fonte FONTE 002' })).toBeTruthy();
    expect(botaoGerar(d).disabled).toBe(false);
    expect(screen.queryByRole('status', { name: 'Cotações criadas' })).toBeNull();
    expect(del).not.toHaveBeenCalled();

    // tentar de novo (o mock agora responde 201)
    fireEvent.click(botaoGerar(d));
    expect(await screen.findByRole('status', { name: 'Cotações criadas' })).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![1]).toEqual(post.mock.calls[0]![1]);
  });

  it('erro de rede/403 no lote: mensagem propria e nada e perdido', async () => {
    post.mockRejectedValueOnce(new ApiError(403, null));
    renderRelatorio();
    await marcar('PRODUTO 001');
    const d = await abrirPelaBarra();
    fireEvent.click(botaoGerar(d));
    expect((await within(d).findByRole('alert')).textContent).toBe('Seu perfil não pode criar cotações.');
    expect(campoKg(d, 'PRODUTO 001').value).toBe('126');
  });

  it('sem ter lido as decisoes (erro no GET) o lote nao manda atualizadoEm', async () => {
    const base = get.getMockImplementation() as (p: string, q?: unknown) => Promise<unknown>;
    get.mockImplementation((async (p: string, q?: unknown) => {
      if (String(p).endsWith('/decisoes')) throw new ApiError(500, null);
      return base(p, q);
    }) as never);
    renderRelatorio();
    await marcar('PRODUTO 001');
    const d = await abrirPelaBarra();
    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // sem ler as decisoes a nota ja gravada e desconhecida: a observacao vazia nao vai (o backend so mexe na nota quando a chave vem)
    expect(post.mock.calls[0]![1]).toEqual({ itens: [{ productId: 41, quantidadeKg: 126 }] });
  });

  it('durante o POST o pop-up nao fecha (Cancelar desabilitado; Esc ignorado) e depois do erro volta ao normal', async () => {
    let falhar: (e: unknown) => void = () => {};
    post.mockReturnValueOnce(new Promise((_, rej) => (falhar = rej)) as never);
    renderRelatorio();
    await marcar('PRODUTO 001');
    const d = await abrirPelaBarra();
    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect((within(d).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent(d, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('heading', { name: 'Criar cotação' })).not.toBeNull();
    await act(async () => {
      falhar(new ApiError(500, null));
    });
    await within(d).findByRole('alert');
    expect((within(d).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('pop-up Criar cotacao: rascunho (E5)', () => {
  it('autosave com debounce: varias edicoes seguidas viram 1 PUT com o atualizadoEm lido; o seguinte usa o novo', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '1' } });
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '12' } });
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '700' } });
    fireEvent.change(within(d).getByLabelText('Observação de PRODUTO 001'), { target: { value: 'oi' } });
    expect(within(d).getByText('Alterações a salvar…')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();

    await esperarGravacao(1);
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/rascunho-cotacao', {
      itens: [{ productId: 41, quantidadeKg: 700, observacao: 'oi' }],
      atualizadoEm: null,
    });
    expect(await within(d).findByText(/Rascunho salvo às \d{2}:\d{2}\./)).toBeTruthy();

    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '800' } });
    await esperarGravacao(2);
    expect(put.mock.calls[1]![1]).toEqual({
      itens: [{ productId: 41, quantidadeKg: 800, observacao: 'oi' }],
      atualizadoEm: '2026-10-27T15:00:01.000Z',
    });
  });

  it('abrir e fechar sem editar nao grava nada; cancelar com edicao pendente grava na hora', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Criar cotação' })).toBeNull());
    expect(put).not.toHaveBeenCalled();

    const d2 = await abrirCotar('PRODUTO 001');
    fireEvent.change(campoKg(d2, 'PRODUTO 001'), { target: { value: '33' } });
    fireEvent.click(within(d2).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toEqual({ itens: [{ productId: 41, quantidadeKg: 33, observacao: null }], atualizadoEm: null });
  });

  it('restaura ao reabrir: a linha mostra "Rascunho" e "Continuar"; quantidade, obs. e item de fora da lista voltam', async () => {
    c.rascunho = rascunhoDe([
      { productId: 41, quantidadeKg: 500, observacao: 'OBS DO RASCUNHO' },
      { productId: 9, quantidadeKg: 70, observacao: null },
    ]);
    renderRelatorio();
    const continuar = await screen.findByRole('button', { name: 'Continuar cotação de PRODUTO 001' });
    expect(continuar.textContent).toBe('Continuar');
    const linha = continuar.closest('tr') as HTMLElement;
    expect(within(linha).getByText('Rascunho')).toBeTruthy();
    expect(linha.textContent).toContain('500 kg a cotar');
    expect(linha.textContent).toContain('salvo em 27/10');
    // as demais linhas nao mostram rascunho
    const outra = screen.getByRole('button', { name: 'Cotar PRODUTO 003' }).closest('tr') as HTMLElement;
    expect(within(outra).queryByText('Rascunho')).toBeNull();

    const d = await abrirCotar('PRODUTO 001');
    expect(campoKg(d, 'PRODUTO 001').value).toBe('500');
    expect((within(d).getByLabelText('Observação de PRODUTO 001') as HTMLInputElement).value).toBe('OBS DO RASCUNHO');
    expect(campoKg(d, 'PRODUTO 009').value).toBe('70');
    expect(within(d).getAllByText('Fora da lista de compra').length).toBeGreaterThanOrEqual(1);
    expect(within(d).getByRole('button', { name: 'Descartar rascunho' })).toBeTruthy();
    // item de fora da lista restaurado: o lote leva incluidoManualmente: true
    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).toMatchObject({
      itens: [
        { productId: 41, quantidadeKg: 500, observacao: 'OBS DO RASCUNHO' },
        { productId: 9, quantidadeKg: 70, incluidoManualmente: true },
      ],
    });
  });

  it('item do rascunho que nao esta mais disponivel aparece bloqueado ate ser tirado', async () => {
    c.rascunho = rascunhoDe([{ productId: 999, quantidadeKg: 10, observacao: null }]);
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    expect(within(d).getByText('Produto 999')).toBeTruthy();
    expect(within(d).getByText(/não está mais disponível para cotação/)).toBeTruthy();
    expect(botaoGerar(d).disabled).toBe(true);
    fireEvent.click(within(d).getByRole('button', { name: 'Tirar Produto 999 da cotação' }));
    expect(botaoGerar(d).disabled).toBe(false);
  });

  it('409 no rascunho: recarrega a versao salva e pergunta; "Usar o rascunho salvo" troca os itens', async () => {
    put.mockRejectedValueOnce(new ApiError(409, { message: 'O rascunho desta cotação acabou de ser alterado em outra aba ou sessão.' }));
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    // outra aba grava um rascunho com o PRODUTO 003 antes do nosso PUT
    c.rascunho = rascunhoDe([{ productId: 43, quantidadeKg: 222, observacao: 'DA OUTRA ABA' }], '2026-10-27T16:00:00.000Z');
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '5' } });

    const alerta = await within(d).findByRole('alert', undefined);
    expect(alerta.textContent).toContain('alterado em outra aba ou sessão');
    fireEvent.click(within(alerta).getByRole('button', { name: 'Usar o rascunho salvo' }));
    await waitFor(() => expect(within(d).queryByRole('alert')).toBeNull());
    expect(within(d).queryByLabelText('Quantidade a cotar de PRODUTO 001')).toBeNull();
    expect(campoKg(d, 'PRODUTO 003').value).toBe('222');
    expect((within(d).getByLabelText('Observação de PRODUTO 003') as HTMLInputElement).value).toBe('DA OUTRA ABA');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('409 no rascunho: "Manter o que digitei" regrava com o atualizadoEm novo', async () => {
    put.mockRejectedValueOnce(new ApiError(409, { message: 'Alterado em outra aba.' }));
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    c.rascunho = rascunhoDe([{ productId: 43, quantidadeKg: 222, observacao: null }], '2026-10-27T16:00:00.000Z');
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '5' } });

    const alerta = await within(d).findByRole('alert');
    fireEvent.click(within(alerta).getByRole('button', { name: 'Manter o que digitei' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1]![1]).toEqual({
      itens: [{ productId: 41, quantidadeKg: 5, observacao: null }],
      atualizadoEm: '2026-10-27T16:00:00.000Z',
    });
    expect(campoKg(d, 'PRODUTO 001').value).toBe('5');
  });

  it('descartar o rascunho: DELETE, o pop-up fecha e a linha volta a "Cotar"', async () => {
    c.rascunho = rascunhoDe([{ productId: 41, quantidadeKg: 500, observacao: null }]);
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.click(within(d).getByRole('button', { name: 'Descartar rascunho' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/v1/forecast/snapshots/7/rascunho-cotacao'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Criar cotação' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Cotar PRODUTO 001' })).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('rascunho nao carrega (500): avisa, nao grava nada e ainda permite gerar', async () => {
    c.rascunhoGetFalha = true;
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    expect(within(d).getByText(/Rascunho indisponível/)).toBeTruthy();
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '9' } });
    await new Promise((r) => setTimeout(r, 1500));
    expect(put).not.toHaveBeenCalled();
    expect(within(d).queryByRole('button', { name: 'Descartar rascunho' })).toBeNull();
    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // o rascunho salvo nunca foi visto aqui: gerar nao o apaga
    await screen.findByRole('status', { name: 'Cotações criadas' });
    expect(del).not.toHaveBeenCalled();
  });

  it('falha ao gravar o rascunho (500): mostra o erro sem fechar nem perder a digitacao', async () => {
    put.mockRejectedValueOnce(new ApiError(500, null));
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.change(campoKg(d, 'PRODUTO 001'), { target: { value: '9' } });
    expect(await within(d).findByText('Não foi possível salvar o rascunho (HTTP 500).', undefined, { timeout: 4000 })).toBeTruthy();
    expect(campoKg(d, 'PRODUTO 001').value).toBe('9');
    // "Salvar rascunho" tenta de novo na hora
    await act(async () => {
      fireEvent.click(within(d).getByRole('button', { name: 'Salvar rascunho' }));
    });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(await within(d).findByText(/Rascunho salvo às/)).toBeTruthy();
  });
});
