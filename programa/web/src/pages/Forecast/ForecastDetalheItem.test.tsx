import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastLinha } from '@/services/forecast';
import ForecastDetalheItem from './ForecastDetalheItem';
import ForecastMemoria from './ForecastMemoria';

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
    precoFixo: false,
    ...over,
  } as ForecastLinha;
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

function cliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function montar(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={cliente()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const botaoVer = () => screen.getByRole('button', { name: 'Ver último preço negociado' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastDetalheItem - preco fechado e amostra', () => {
  it.each([
    [true, 'Sim (o valor não é exibido)'],
    [false, 'Não'],
    [undefined, '—'],
  ])('precoFixo %s -> "%s", sem o texto exato "Fixo"', (precoFixo, texto) => {
    const { container } = montar(<ForecastDetalheItem linha={linha({ precoFixo })} />);
    const dd = screen.getByText('Preço fechado').nextElementSibling as HTMLElement;
    expect(dd.textContent).toBe(texto);
    expect(screen.queryByText('Fixo')).toBeNull();
    expect(container.textContent).not.toMatch(/Margem|Clientes ativos/);
  });

  it('amostra preenchida, null e ausente (backend antigo)', () => {
    const { unmount } = montar(
      <ForecastDetalheItem linha={linha({ qtdAmostra: '2 PACOTES SINT', solicitarAmostra: 'SIM' })} />,
    );
    expect(screen.getByText('Amostra por pacote (AY)').nextElementSibling?.textContent).toBe('2 PACOTES SINT');
    expect(screen.getByText('Pedir amostra na próxima compra (AZ)').nextElementSibling?.textContent).toBe('SIM');
    unmount();

    const nulos = montar(<ForecastDetalheItem linha={linha({ qtdAmostra: null, solicitarAmostra: null })} />);
    expect(screen.getByText('Amostra por pacote (AY)').nextElementSibling?.textContent).toBe('—');
    expect(screen.getByText('Pedir amostra na próxima compra (AZ)').nextElementSibling?.textContent).toBe('—');
    nulos.unmount();

    montar(<ForecastDetalheItem linha={linha()} />);
    expect(screen.getByText('Amostra por pacote (AY)').nextElementSibling?.textContent).toBe('—');
    expect(screen.getByText('Pedir amostra na próxima compra (AZ)').nextElementSibling?.textContent).toBe('—');
  });

  it('a secao tem nome acessivel "Detalhe do item"', () => {
    montar(<ForecastDetalheItem linha={linha()} />);
    expect(screen.getByRole('region', { name: 'Detalhe do item' })).toBeTruthy();
  });
});

describe('ForecastDetalheItem - ultimo preco negociado', () => {
  it('sem produto no cadastro: texto proprio, sem botao e sem request', () => {
    montar(<ForecastDetalheItem linha={linha({ productId: null })} />);
    expect(screen.getByText('Sem produto no cadastro: não há cotação para buscar.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Produto fora do cadastro')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('nada e pedido antes do clique; clique -> carregando -> preco, fornecedor, cotacao e datas', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    get.mockReturnValue(new Promise((r) => (resolver = r)) as never);
    montar(<ForecastDetalheItem linha={linha()} />);
    expect(get).not.toHaveBeenCalled();
    expect(document.querySelector('.fcu-resultado')).toBeNull();

    fireEvent.click(botaoVer());
    expect((await screen.findByRole('status')).textContent).toBe('Buscando o último preço…');
    expect(botaoVer().getAttribute('aria-busy')).toBe('true');
    expect(botaoVer().getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.fcu-resultado')?.getAttribute('aria-live')).toBe('polite');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/v1/forecast/products/42/ultimo-preco');

    resolver(COM_PRECO);
    expect(await screen.findByText('USD 12,34 / KG · FOB')).toBeTruthy();
    expect(screen.getByText('Fornecedor: FORNECEDOR SINTETICO 1')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Cotação QR-SINT-0001' });
    expect(link.getAttribute('href')).toBe('/cotacoes/901');
    expect(screen.getByText(/Fechada em 10\/03\/2031/)).toBeTruthy();
    expect(screen.getByText(/PO enviada em 12\/03\/2031/)).toBeTruthy();
    expect(screen.getByText('Só propostas diretas de fornecedor (Credit Support não entra).')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('cotacao so com PO enviada: nao mostra "Fechada em"', async () => {
    get.mockResolvedValue({
      data: { ...COM_PRECO.data, ultimoPreco: { ...COM_PRECO.data.ultimoPreco, fechadaEm: null } },
    });
    montar(<ForecastDetalheItem linha={linha()} />);
    fireEvent.click(botaoVer());
    expect(await screen.findByText(/PO enviada em 12\/03\/2031/)).toBeTruthy();
    expect(screen.queryByText(/Fechada em/)).toBeNull();
  });

  it.each([
    ['sem_cotacao_vencedora', 'Nenhuma proposta vencedora em cotação fechada ou com PO enviada para este item.'],
    ['sem_vinculo_catalogo', 'Nenhum código deste produto está vinculado a um item do catálogo.'],
  ])('motivo %s -> texto proprio', async (motivo, texto) => {
    get.mockResolvedValue({ data: { productId: 42, ultimoPreco: null, motivo } });
    montar(<ForecastDetalheItem linha={linha()} />);
    fireEvent.click(botaoVer());
    expect(await screen.findByText(texto)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('erro 403 -> alerta com a mensagem; "Tentar de novo" refaz o GET e mostra o sucesso', async () => {
    get.mockRejectedValueOnce(new ApiError(403, null)).mockResolvedValueOnce(COM_PRECO);
    montar(<ForecastDetalheItem linha={linha()} />);
    fireEvent.click(botaoVer());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Seu perfil não tem acesso aos preços negociados.');
    expect(get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('USD 12,34 / KG · FOB')).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resposta fora do contrato -> alerta (nunca "sem preco")', async () => {
    get.mockResolvedValue({ data: undefined });
    montar(<ForecastDetalheItem linha={linha()} />);
    fireEvent.click(botaoVer());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Nenhuma proposta vencedora/)).toBeNull();
  });

  it('outro produto (via key) volta ao botao, sem repetir o pedido', async () => {
    get.mockResolvedValue(COM_PRECO);
    const client = cliente();
    const ui = (id: number) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ForecastDetalheItem key={id} linha={linha({ productId: id })} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(ui(42));
    fireEvent.click(botaoVer());
    expect(await screen.findByText('USD 12,34 / KG · FOB')).toBeTruthy();
    rerender(ui(43));
    expect(screen.queryByText('USD 12,34 / KG · FOB')).toBeNull();
    expect(botaoVer().getAttribute('aria-disabled')).toBe('false');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('ForecastMemoria com o detalhe do item', () => {
  it('mostra "Detalhe do item" dentro da memoria de calculo e nao dispara nenhum request', () => {
    montar(<ForecastMemoria linha={linha()} half={2} baseDate="2026-10-15" hoje="2026-10-20" podeEditar={false} />);
    const memoria = screen.getByRole('region', { name: 'Memória de cálculo' });
    expect(within(memoria).getByRole('heading', { name: 'Detalhe do item' })).toBeTruthy();
    expect(within(memoria).getByRole('button', { name: 'Ver último preço negociado' })).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('item sem cadastro: a memoria mostra os dois textos distintos', () => {
    montar(
      <ForecastMemoria
        linha={linha({ productId: null })}
        half={2}
        baseDate="2026-10-15"
        hoje="2026-10-20"
        podeEditar={false}
      />,
    );
    expect(screen.getByText('Produto fora do cadastro')).toBeTruthy();
    expect(screen.getByText('Sem produto no cadastro: não há cotação para buscar.')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});
