import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastLinha, ForecastSnapshotDetail } from '@/services/forecast';
import { readSource } from '@/test/rfCss';
import ForecastItemPagina from './ForecastItemPagina';

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

// Dados 100% sinteticos.
function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
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
    item: 'PRODUTO SINTETICO A',
    codigos: ['TST0001', 'TST0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: true,
    qtdAmostra: '200 g',
    solicitarAmostra: 'SIM',
    sobDemanda: false,
    mesesForaDaMedia: [],
    ...over,
  } as ForecastLinha;
}

function detalhe(linhas: ForecastLinha[]): ForecastSnapshotDetail {
  return {
    id: 7,
    label: '11-1',
    baseDate: '2026-10-15',
    half: 2,
    origin: 'dbcorp',
    hoje: '2026-10-20',
    months: { consumo: [], chegada: [], programacao: [] },
    files: [],
    createdAt: '2026-10-15T10:00:00.000Z',
    linhas,
    conferencia: null,
  };
}

const COM_PRECO = {
  data: {
    productId: 42,
    motivo: null,
    ultimoPreco: {
      valorUnitario: '12.34',
      moeda: 'USD',
      unidade: 'KG',
      incoterm: 'FOB',
      fornecedor: 'FORNECEDOR SINTETICO 1',
      cotacao: { id: 901, codigo: 'QR-SINT-0001' },
      fechadaEm: '2031-03-10',
      poEnviadaEm: '2031-03-12',
      catalogItemId: 77,
      codigos: ['TST0001'],
    },
  },
};

function montar(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const pagina = (linhas: ForecastLinha[], numero: number, podeEditar = true) => (
  <ForecastItemPagina detail={detalhe(linhas)} linha={numero} podeEditar={podeEditar} />
);

const botaoVer = () => screen.getByRole('button', { name: 'Ver último preço negociado' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastItemPagina - a pagina do item (D6; board F2)', () => {
  it('mostra a memoria de calculo da linha pedida, sem grade e sem nenhum request ao abrir', () => {
    const { container } = montar(pagina([linha({ linha: 3 }), linha({ linha: 4, item: 'PRODUTO SINTETICO B' })], 4));
    const memoria = within(screen.getByRole('region', { name: 'Memória de cálculo' }));
    expect(memoria.getByText('MEMÓRIA DE CÁLCULO · LINHA 4 DA PLANILHA')).toBeTruthy();
    expect(memoria.getByRole('heading', { name: 'PRODUTO SINTETICO B' })).toBeTruthy();
    expect(memoria.queryByText('PRODUTO SINTETICO A')).toBeNull();
    expect(container.querySelector('.fc-grid')).toBeNull();
    expect(container.querySelector('.fci-pagina')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('nomes acessiveis estaveis: Embalagens do item, Meses fora da media, Ver ultimo preco negociado e Salvar', () => {
    montar(pagina([linha()], 3));
    expect(screen.getByRole('button', { name: 'Embalagens do item' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Meses fora da média' })).toBeTruthy();
    expect(botaoVer()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Motivo (opcional)' })).toBeTruthy();
  });

  it('linha inexistente: estado vazio "Item nao encontrado nesta quinzena", sem memoria e sem request', () => {
    const { container } = montar(pagina([linha({ linha: 3 })], 99));
    expect(screen.getByText('Item não encontrado nesta quinzena')).toBeTruthy();
    expect(container.querySelector('.empty-state')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Memória de cálculo' })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('item sem venda ha 6 meses (oculto no painel) abre pelo link: a pagina nao aplica os filtros do painel', () => {
    montar(pagina([linha({ linha: 5, item: 'PRODUTO SEM VENDA', O: 0, P: 0, Q: 0, R: 0, S: 0 })], 5));
    expect(screen.getByRole('heading', { name: 'PRODUTO SEM VENDA' })).toBeTruthy();
  });

  it('somente leitura (viewer/gestor): sem Compra editavel nem Meses fora da media; Embalagens abre em leitura', () => {
    montar(pagina([linha()], 3, false));
    expect(screen.getByText('Compra regular')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Meses fora da média' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Embalagens do item' })).toBeTruthy();
  });

  it('detalhe do item no cartao lateral: selo "Sim (o valor nao e exibido)", amostra em mono e codigos', () => {
    const { container } = montar(pagina([linha()], 3));
    const detalheItem = screen.getByRole('region', { name: 'Detalhe do item' });
    const selo = within(detalheItem).getByText('Sim (o valor não é exibido)');
    expect(selo.className).toBe('fcu-selo');
    expect(within(detalheItem).getByText('200 g').className).toMatch(/fcu-mono/);
    expect(container.querySelector('.fc-lado__codigos')?.textContent).toBe('TST0001 · TST0002');
  });

  it('risco: tom pela situacao (erro = falta antes da chegada; ok = sem falta), com o texto direto no aviso de status', () => {
    const { container, unmount } = montar(
      pagina([linha({ projecao: [400, -10, -20, -30, -40, -50], AP: '2027-02-01' })], 3),
    );
    const risco = container.querySelector('.fc-risco--erro');
    expect(risco?.getAttribute('role')).toBe('status');
    expect(risco?.textContent).toMatch(/^Falta em/);
    unmount();
    const ok = montar(pagina([linha()], 3));
    expect(ok.container.querySelector('.fc-risco--ok')?.textContent).toMatch(/^Sem falta projetada/);
  });

  it('passos: titulo e coluna ("col. Q") seguem no mesmo <strong> (o papel nao muda); a tela os empilha por CSS', () => {
    const { container } = montar(pagina([linha()], 3));
    const corpo = container.querySelector('.fc-passo .fc-passo__corpo');
    expect(corpo?.children[0]?.tagName).toBe('STRONG');
    expect(corpo?.children[0]?.textContent).toBe('Média trimestral col. Q');
    expect(corpo?.children[0]?.querySelector('.fc-passo__coluna')?.textContent).toBe('col. Q');
    expect(corpo?.children[1]?.className).toBe('fc-passo__conta');
  });
});

describe('ForecastItemPagina - cartao do ultimo preco negociado (so o estado atual)', () => {
  it('nao existe antes do clique; o clique abre o cartao inteiro abaixo (carregando -> resultado)', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    get.mockReturnValue(new Promise((r) => (resolver = r)) as never);
    const { container } = montar(pagina([linha()], 3));
    expect(container.querySelector('.fcu-cartao')).toBeNull();
    expect(container.querySelector('.fcu-resultado')).toBeNull();
    expect(get).not.toHaveBeenCalled();

    fireEvent.click(botaoVer());
    const cartao = container.querySelector('.fcu-cartao') as HTMLElement;
    expect(cartao).toBeTruthy();
    expect(within(cartao).getByRole('heading', { name: 'Detalhe do item · último preço negociado (sob demanda)' })).toBeTruthy();
    expect((await within(cartao).findByRole('status')).textContent).toBe('Buscando o último preço…');
    expect(botaoVer().getAttribute('aria-busy')).toBe('true');
    expect(botaoVer().getAttribute('aria-disabled')).toBe('true');
    expect(cartao.querySelector('.fcu-resultado')?.getAttribute('aria-live')).toBe('polite');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/v1/forecast/products/42/ultimo-preco');
    // o cartao NAO fica dentro do cartao lateral: e irmao dele, dentro da secao da memoria
    expect(cartao.closest('.fc-lado')).toBeNull();
    expect(cartao.parentElement?.className).toBe('fc-memoria');

    resolver(COM_PRECO);
    expect(await within(cartao).findByText('USD 12,34 / KG · FOB')).toBeTruthy();
    expect(within(cartao).getByText('Fornecedor: FORNECEDOR SINTETICO 1')).toBeTruthy();
    expect(within(cartao).getByRole('link', { name: 'Cotação QR-SINT-0001' }).getAttribute('href')).toBe('/cotacoes/901');
    expect(within(cartao).getByText(/Fechada em 10\/03\/2031/)).toBeTruthy();
    expect(within(cartao).getByText(/PO enviada em 12\/03\/2031/)).toBeTruthy();
    expect(within(cartao).queryByRole('status')).toBeNull();
    // a secao "Detalhe do item" do cartao lateral nao repete o resultado
    expect(within(screen.getByRole('region', { name: 'Detalhe do item' })).queryByText('USD 12,34 / KG · FOB')).toBeNull();
  });

  it('erro: alerta + "Tentar de novo" no cartao; refazer mostra o resultado (so 1 estado por vez)', async () => {
    get.mockRejectedValueOnce(new ApiError(403, null)).mockResolvedValueOnce(COM_PRECO);
    const { container } = montar(pagina([linha()], 3));
    fireEvent.click(botaoVer());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Seu perfil não tem acesso aos preços negociados.');
    expect(container.querySelector('.fcu-cartao')?.contains(alerta)).toBe(true);
    expect(container.querySelectorAll('.fcu-resultado')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('USD 12,34 / KG · FOB')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('vazio: o motivo aparece no cartao, sem alerta', async () => {
    get.mockResolvedValue({ data: { productId: 42, ultimoPreco: null, motivo: 'sem_vinculo_catalogo' } });
    const { container } = montar(pagina([linha()], 3));
    fireEvent.click(botaoVer());
    const texto = await screen.findByText('Nenhum código deste produto está vinculado a um item do catálogo.');
    expect(container.querySelector('.fcu-cartao')?.contains(texto)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('item sem produto no cadastro: texto proprio, sem botao e sem cartao', () => {
    const { container } = montar(pagina([linha({ productId: null })], 3));
    expect(screen.getByText('Sem produto no cadastro: não há cotação para buscar.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver último preço negociado' })).toBeNull();
    expect(container.querySelector('.fcu-cartao')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('trocar de item (outra linha) fecha o cartao e volta ao botao, sem repetir o request', async () => {
    get.mockResolvedValue(COM_PRECO);
    const dois = [linha({ linha: 3, productId: 42 }), linha({ linha: 4, productId: 43, item: 'PRODUTO SINTETICO B' })];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (numero: number) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{pagina(dois, numero)}</MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender, container } = render(ui(3));
    fireEvent.click(botaoVer());
    expect(await screen.findByText('USD 12,34 / KG · FOB')).toBeTruthy();
    rerender(ui(4));
    expect(screen.getByRole('heading', { name: 'PRODUTO SINTETICO B' })).toBeTruthy();
    expect(screen.queryByText('USD 12,34 / KG · FOB')).toBeNull();
    expect(container.querySelector('.fcu-cartao')).toBeNull();
    expect(botaoVer().getAttribute('aria-disabled')).toBe('false');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('ForecastItemPagina - o cartao do ultimo preco entra na tela ao abrir', () => {
  it('chama scrollIntoView({ block: "nearest" }) no cartao so depois do clique (botao no lateral, resultado abaixo)', async () => {
    const original = Element.prototype.scrollIntoView;
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    try {
      get.mockResolvedValue(COM_PRECO);
      const { container } = montar(pagina([linha()], 3));
      expect(rolar).not.toHaveBeenCalled();
      fireEvent.click(botaoVer());
      await screen.findByText('USD 12,34 / KG · FOB');
      expect(rolar).toHaveBeenCalledTimes(1);
      expect(rolar).toHaveBeenCalledWith({ block: 'nearest' });
      expect(rolar.mock.contexts[0]).toBe(container.querySelector('.fcu-cartao'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('ForecastItemPagina - chip de mes (CSS da pagina)', () => {
  // O chip e `display: inline-flex` e o markup e `{rotulo} <b>{valor}</b>`: em flex o espaco entre os dois some ("nov/20261.263").
  // Sem `gap` na regra o rotulo gruda no valor. A guarda le a regra no globals.css (par F13-B).
  it('a regra `.fc-pagina .fc-mes` (flex) declara gap entre o rotulo e o valor', () => {
    const css = readSource('../styles/globals.css').split(String.fromCharCode(13)).join('');
    const regra = css.match(/\.fc-pagina \.fc-mes \{([^}]*)\}/);
    expect(regra, 'regra .fc-pagina .fc-mes').not.toBeNull();
    const corpo = regra?.[1] ?? '';
    expect(corpo).toMatch(/display:\s*inline-flex/);
    expect(corpo).toMatch(/(^|[;\s])(column-)?gap:\s*[1-9]/);
  });

  it('o markup do chip separa rotulo e valor por espaco de texto (o gap do CSS o substitui em flex)', () => {
    const { container } = montar(
      pagina([linha({ projecao: [400, -10, -20, -30, -40, -50], AP: '2027-02-01' })], 3),
    );
    const chip = container.querySelector('.fc-mes');
    expect(chip?.querySelector('b')).toBeTruthy();
    expect(chip?.textContent).toMatch(/^\S+ \S+$/);
  });
});
