import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CotacaoNova from '../CotacaoNova';

// Mesmo mock de router/auth/api do CotacaoNova.test.tsx (com role variavel e ApiError com status).
const routerState = vi.hoisted(() => ({ search: '', navigate: vi.fn(), role: 'comprador' }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => routerState.navigate,
  useSearchParams: () => [new URLSearchParams(routerState.search)],
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: routerState.role } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
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

// Dados 100% sinteticos.
interface Cenario {
  quantidadeFinal?: number;
  itemNaLista?: boolean;
  relatorio?: Error;
  decisoes?: unknown[] | Error;
  produtos?: unknown[] | Error;
  embalagens?: unknown | Error;
  catalogo?: Record<number, unknown | Error>;
}

const CODIGO_1 = { id: 1, position: 1, code: 'C0001', catalogItemId: 10, catalogItem: { id: 10, commercialName: 'ITEM SINTETICO A', marketName: 'MERCADO A' } };
const CODIGO_2 = { id: 2, position: 2, code: 'C0002', catalogItemId: 11, catalogItem: { id: 11, commercialName: 'ITEM SINTETICO B', marketName: 'MERCADO B' } };
const PRODUTO = (codes: unknown[]) => [{ id: 42, name: 'PRODUTO 002', isActive: true, source: null, codes }];
const DECISAO = (quantidadeKg: number) => ({
  productId: 42,
  quantidadeKg,
  status: 'confirmado',
  observacao: null,
  sugeridaKg: 125,
  demandaKg: -40,
  decididaPorId: 3,
  criadaEm: '2026-10-26T17:30:00.000Z',
  atualizadaEm: '2026-10-26T17:30:00.000Z',
});
const EMBALAGENS = (principal: string | null) => ({
  produto: { id: 42, nome: 'PRODUTO 002', ativo: true, embalagemPlanilha: null, naoFraciona: false },
  codigos: [
    { id: 1, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: null, principal: principal === 'C0001', origem: 'manual', atualizadoEm: null },
    { id: 2, posicao: 2, codigo: 'C0002', quantidadeKg: 25, rotulo: null, principal: principal === 'C0002', origem: 'manual', atualizadoEm: null },
  ],
  usadaCodigoId: null,
});
const CATALOGO = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  commercialName: id === 10 ? 'ITEM SINTETICO A' : 'ITEM SINTETICO B',
  marketName: id === 10 ? 'MERCADO A' : 'MERCADO B',
  isActive: true,
  family: { id: 1, name: 'FAMILIA' },
  ...over,
});

function relatorio(c: Cenario) {
  const linha = {
    linha: 4,
    n: 1,
    productId: 42,
    item: 'PRODUTO 002',
    codigos: ['C0001', 'C0002'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: c.quantidadeFinal ?? 125.12345,
    naoFraciona: false,
    ruptura: null,
    dataLimite: null,
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
  };
  return {
    quinzena: { id: 7, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'planilha', hoje: '2026-11-06' },
    totais: { itens: 1, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [{ fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: null, vencidas: 0, itens: c.itemNaLista === false ? [] : [linha] }],
  };
}

function mockApi(c: Cenario = {}) {
  get.mockImplementation(async (path: string) => {
    const lancar = <T,>(v: T | Error): T => {
      if (v instanceof Error) throw v;
      return v;
    };
    if (path === '/v1/forecast/snapshots/7/relatorio-compras') {
      if (c.relatorio) throw c.relatorio;
      return { data: relatorio(c) };
    }
    if (path === '/v1/forecast/snapshots/7/decisoes') {
      return { data: { snapshotId: 7, label: '11-1', decisoes: lancar(c.decisoes ?? [DECISAO(1234.5)]) } };
    }
    if (path === '/v1/forecast/products') return { data: lancar(c.produtos ?? PRODUTO([CODIGO_1, CODIGO_2])) };
    if (path === '/v1/forecast/products/42/embalagens') return { data: lancar(c.embalagens ?? EMBALAGENS(null)) };
    const catalogo = /^\/v1\/catalog-items\/(\d+)$/.exec(path);
    if (catalogo) {
      const id = Number(catalogo[1]);
      return lancar(c.catalogo?.[id] ?? CATALOGO(id));
    }
    return { data: [] };
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const resultado = render(
    <QueryClientProvider client={client}>
      <CotacaoNova />
    </QueryClientProvider>,
  );
  return { ...resultado, client };
}

const chamadasForecast = () =>
  get.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/forecast/') || p.includes('/catalog-items/'));

const aguardarBanner = () => screen.findByText(/Pré-preenchida pelo Forecast/);
const descricao = () => (screen.getByLabelText('Descrição') as HTMLTextAreaElement).value;

async function irParaPasso2() {
  fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
  await waitFor(() => {
    expect((screen.getByRole('button', { name: '+ Adicionar item' }) as HTMLButtonElement).disabled).toBe(false);
  });
}

async function bloqueio(cenario: Cenario, texto: string) {
  mockApi(cenario);
  routerState.search = 'fromForecast=7-42';
  renderPage();
  const alerta = await screen.findByRole('alert');
  expect(alerta.textContent).toBe(texto);
  expect(alerta.className).toContain('fgc-aviso');
  expect(screen.queryByText(/Pré-preenchida pelo Forecast/)).toBeNull();
  expect(descricao()).toBe('');
  await irParaPasso2();
  expect(screen.queryByText('ITEM SINTETICO A')).toBeNull();
  // O usuario ainda cria uma cotacao comum.
  post.mockResolvedValue({ id: 51 });
  fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const [, corpo] = post.mock.calls[0] as [string, Record<string, unknown>];
  expect(corpo).not.toHaveProperty('commercialRequestIds');
  expect(corpo).not.toHaveProperty('items');
  expect(corpo.description).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  routerState.search = '';
  routerState.role = 'comprador';
  get.mockReset();
  post.mockReset();
});

describe('CotacaoNova com ?fromForecast', () => {
  it('com decisao 1234,5: item do catalogo, 1.235 KG, descricao so com o rotulo e criacao pelo fluxo de sempre', async () => {
    mockApi();
    routerState.search = 'fromForecast=7-42';
    post.mockResolvedValueOnce({ id: 50 }).mockResolvedValueOnce({ id: 900 });
    renderPage();

    const banner = await aguardarBanner();
    expect(banner.textContent).toBe(
      'Pré-preenchida pelo Forecast (quinzena 11-1): PRODUTO 002, 1.235 kg (quantidade decidida). Revise e escolha os Incoterms.',
    );
    expect(banner.getAttribute('role')).toBe('status');
    expect(descricao()).toBe('Forecast 11-1');
    expect(descricao()).not.toContain('PRODUTO');
    expect(descricao()).not.toContain('CLIENTE SINTETICO');

    await irParaPasso2();
    expect(screen.getByText('ITEM SINTETICO A')).toBeTruthy();
    expect(screen.getByText('MERCADO A')).toBeTruthy();
    expect(screen.getByText('1.235')).toBeTruthy();
    expect(screen.getByText('KG')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith('/cotacoes/50'));
    expect(post).toHaveBeenCalledTimes(2);
    const [path1, corpo1] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path1).toBe('/v1/quote-requests');
    expect(corpo1).not.toHaveProperty('commercialRequestIds');
    expect(corpo1).not.toHaveProperty('items');
    expect(corpo1.description).toBe('Forecast 11-1');
    expect(post.mock.calls[1]).toEqual([
      '/v1/quote-requests/50/items',
      { catalogItemId: 10, quantity: 1235, unit: 'KG', notes: null },
    ]);
  });

  it('sem decisao: a Qtd. final 125,12345 vira 126 kg (Qtd. final sugerida)', async () => {
    mockApi({ decisoes: [] });
    routerState.search = 'fromForecast=7-42';
    renderPage();
    const banner = await aguardarBanner();
    expect(banner.textContent).toContain('126 kg (Qtd. final sugerida)');
    expect(screen.queryByRole('alert')).toBeNull();
    await irParaPasso2();
    expect(screen.getByText('126')).toBeTruthy();
  });

  it('decisoes indisponiveis (500): usa a sugerida, avisa e a tela segue utilizavel', async () => {
    mockApi({ decisoes: new ApiError(500, null) });
    routerState.search = 'fromForecast=7-42';
    post.mockResolvedValueOnce({ id: 50 }).mockResolvedValueOnce({ id: 900 });
    renderPage();
    const banner = await aguardarBanner();
    expect(banner.textContent).toContain('126 kg (Qtd. final sugerida)');
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(
      'Não foi possível carregar a quantidade decidida; foi usada a Qtd. final sugerida. Confira antes de salvar.',
    );
    await irParaPasso2();
    fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith('/cotacoes/50'));
    expect(post.mock.calls[1]![1]).toMatchObject({ catalogItemId: 10, quantity: 126 });
  });

  it('embalagem principal vinculada (C0002) vence o 1o codigo', async () => {
    mockApi({ embalagens: EMBALAGENS('C0002') });
    routerState.search = 'fromForecast=7-42';
    renderPage();
    await aguardarBanner();
    await irParaPasso2();
    expect(screen.getByText('ITEM SINTETICO B')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/catalog-items/11');
    expect(get).not.toHaveBeenCalledWith('/v1/catalog-items/10');
  });

  it('embalagem principal SEM vinculo: usa o codigo vinculado da menor posicao (C0001)', async () => {
    mockApi({
      embalagens: EMBALAGENS('C0002'),
      produtos: PRODUTO([{ ...CODIGO_2, catalogItemId: null, catalogItem: null }, CODIGO_1]),
    });
    routerState.search = 'fromForecast=7-42';
    renderPage();
    await aguardarBanner();
    await irParaPasso2();
    expect(screen.getByText('ITEM SINTETICO A')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('embalagens indisponiveis (500): 1o codigo vinculado e aviso', async () => {
    mockApi({ embalagens: new ApiError(500, null) });
    routerState.search = 'fromForecast=7-42';
    renderPage();
    await aguardarBanner();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível conferir a embalagem principal; foi usado o 1º código vinculado (C0001).',
    );
    await irParaPasso2();
    expect(screen.getByText('ITEM SINTETICO A')).toBeTruthy();
  });

  it('falha do catalogo que nao e 404: segue com os nomes do cadastro do Forecast', async () => {
    mockApi({ catalogo: { 10: new ApiError(500, null) } });
    routerState.search = 'fromForecast=7-42';
    renderPage();
    await aguardarBanner();
    await irParaPasso2();
    expect(screen.getByText('ITEM SINTETICO A')).toBeTruthy();
  });

  describe('bloqueios: aviso com o texto exato, nada preenchido e cotacao comum ainda possivel', () => {
    it('produto sem codigo vinculado ao catalogo', async () => {
      await bloqueio(
        { produtos: PRODUTO([{ ...CODIGO_1, catalogItemId: null, catalogItem: null }]) },
        'Nenhum código deste produto está vinculado a um item do catálogo.',
      );
    });

    it('decisao salva = 0 (nao comprar)', async () => {
      await bloqueio({ decisoes: [DECISAO(0)] }, 'A decisão salva desta quinzena é não comprar (0 kg).');
    });

    it('sem decisao e sugerida <= 0', async () => {
      await bloqueio({ decisoes: [], quantidadeFinal: 0 }, 'Sem quantidade a comprar nesta quinzena.');
    });

    it('item do catalogo inativo', async () => {
      await bloqueio(
        { catalogo: { 10: CATALOGO(10, { isActive: false }) } },
        'O item do catálogo ITEM SINTETICO A está inativo: reative-o em Itens antes de cotar.',
      );
    });

    it('item do catalogo inexistente (404)', async () => {
      await bloqueio({ catalogo: { 10: new ApiError(404, null) } }, 'Item do catálogo não encontrado.');
    });

    it('produto que saiu da lista de compra', async () => {
      await bloqueio({ itemNaLista: false }, 'O produto não está mais na lista de compra da quinzena 11-1.');
    });

    it('quinzena inexistente (404)', async () => {
      await bloqueio({ relatorio: new ApiError(404, null) }, 'Quinzena não encontrada (pode ter sido excluída).');
    });

    it('lista de produtos indisponivel (500)', async () => {
      await bloqueio({ produtos: new ApiError(500, null) }, 'Não foi possível ler o vínculo com o catálogo.');
    });
  });

  it.each(['abc', '7-42-1', '', '0-1', '7-2147483648'])('link malformado %j: aviso e ZERO consulta ao Forecast/catalogo', async (valor) => {
    mockApi();
    routerState.search = `fromForecast=${encodeURIComponent(valor)}`;
    renderPage();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(
      'O link do Forecast é inválido. Siga com uma cotação comum ou gere de novo pelo relatório de compras.',
    );
    expect(descricao()).toBe('');
    expect(chamadasForecast()).toEqual([]);
  });

  it('conflito com fromCommercialRequest: a Solicitacao vence, ZERO consulta ao Forecast e aviso de conflito', async () => {
    mockApi();
    get.mockImplementation(async (path: string) => {
      if (path.includes('/commercial-requests/9')) {
        return {
          id: 9,
          status: 'pending',
          items: [
            { catalogItemId: 10, commercialName: 'ITEM SINTETICO A', marketName: 'MERCADO A', quantity: 5, unit: 'KG', targetPrice: null, targetCurrency: null },
          ],
        };
      }
      return { data: [] };
    });
    routerState.search = 'fromForecast=7-42&fromCommercialRequest=9';
    post.mockResolvedValue({ id: 50 });
    renderPage();

    expect(await screen.findByText('Vinculada à solicitação #9 do comercial')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Este link pedia dois pré-preenchimentos; foi usado só o da Solicitação do comercial.',
    );
    expect(screen.queryByText(/Pré-preenchida pelo Forecast/)).toBeNull();
    expect(descricao()).toBe('Solicitação do comercial #9');
    await irParaPasso2();
    fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect((post.mock.calls[0]![1] as Record<string, unknown>).commercialRequestIds).toEqual([9]);
    expect(chamadasForecast()).toEqual([]);
  });

  it('sem permissao (gestor): tela de acesso negado e ZERO consulta ao Forecast', async () => {
    mockApi();
    routerState.role = 'gestor';
    routerState.search = 'fromForecast=7-42';
    renderPage();
    expect(await screen.findByText('Seu perfil não tem permissão para criar cotações.')).toBeTruthy();
    expect(chamadasForecast()).toEqual([]);
  });

  it('sem o parametro: ZERO consulta ao Forecast e nenhum aviso do Forecast', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Crie uma cotação e, opcionalmente, adicione itens iniciais.');
    expect(chamadasForecast()).toEqual([]);
    expect(container.querySelector('.fgc-aviso')).toBeNull();
  });

  it('aplica uma vez: refetch/re-render nao reaplica item removido nem descricao apagada pelo usuario', async () => {
    mockApi();
    routerState.search = 'fromForecast=7-42';
    const { client } = renderPage();
    await aguardarBanner();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: '' } });
    await irParaPasso2();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(screen.queryByText('ITEM SINTETICO A')).toBeNull());

    await client.refetchQueries({ queryKey: ['forecast'] });
    await waitFor(() => expect(get.mock.calls.filter(([p]) => p === '/v1/forecast/products')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('ITEM SINTETICO A')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(descricao()).toBe('');
  });

  it('descricao digitada antes do preenchimento nao e sobrescrita', async () => {
    mockApi();
    routerState.search = 'fromForecast=7-42';
    renderPage();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Digitada antes' } });
    await aguardarBanner();
    expect(descricao()).toBe('Digitada antes');
    await irParaPasso2();
    expect(screen.getByText('ITEM SINTETICO A')).toBeTruthy();
  });

  it('o usuario edita a quantidade (2000) e o POST do item leva 2000', async () => {
    mockApi();
    routerState.search = 'fromForecast=7-42';
    post.mockResolvedValueOnce({ id: 50 }).mockResolvedValueOnce({ id: 900 });
    renderPage();
    await aguardarBanner();
    await irParaPasso2();

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Quantidade *'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));

    await waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith('/cotacoes/50'));
    expect(post.mock.calls[1]).toEqual([
      '/v1/quote-requests/50/items',
      { catalogItemId: 10, quantity: 2000, unit: 'KG', notes: null },
    ]);
  });

  it('enquanto busca os dados, mostra o status e o formulario segue utilizavel', async () => {
    mockApi();
    const base = get.getMockImplementation() as (path: string) => Promise<unknown>;
    let liberar: () => void = () => {};
    const espera = new Promise<void>((r) => (liberar = r));
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/products') await espera;
      return base(path);
    });
    routerState.search = 'fromForecast=7-42';
    renderPage();
    expect((await screen.findByRole('status')).textContent).toBe('Buscando os dados do Forecast…');
    expect((screen.getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(false);
    liberar();
    await aguardarBanner();
    expect(screen.queryByText('Buscando os dados do Forecast…')).toBeNull();
  });
});
