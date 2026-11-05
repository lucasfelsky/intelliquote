import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Itens from '../Itens';

const confirmMock = vi.fn(async (_texto: string) => true);
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => confirmMock }));
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
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const patch = vi.mocked(api.patch);

// Dados 100% sinteticos.
const produto = (id: number, name: string, codes: string[], over: Record<string, unknown> = {}) => ({
  id,
  name,
  isActive: true,
  origin: 'dbcorp',
  codes: codes.map((code, i) => ({ id: id * 100 + i, position: i + 1, code })),
  ...over,
});
const fonte = (id: number, name: string, leadTimeDays: number | null) => ({
  id,
  name,
  leadTimeDays,
  clearanceDays: null,
  isActive: true,
});
const item = (id: number, commercialName: string, over: Record<string, unknown> = {}) => ({
  id,
  commercialName,
  marketName: `Mercado ${commercialName}`,
  ncm: null,
  dbcorpCode: null,
  notes: null,
  isActive: true,
  familyId: null,
  family: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

let itens: unknown[];
let semForecast: unknown[];
let produtos: unknown[];
let fontes: unknown[];

function mockLeituras() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/catalog-items/sem-forecast') return { data: semForecast, total: semForecast.length };
    if (path === '/v1/catalog-items') {
      return { data: itens, pagination: { page: 1, pageSize: 50, totalItems: itens.length, totalPages: 1 } };
    }
    if (path === '/v1/forecast/products') return { data: produtos };
    if (path === '/v1/forecast/sources') return { data: fontes };
    if (path === '/v1/item-families') return { data: [{ id: 4, name: 'FAMILIA TST' }] };
    throw new Error(`GET inesperado: ${path}`);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Itens />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  confirmMock.mockResolvedValue(true);
  window.scrollTo = vi.fn();
  itens = [];
  semForecast = [];
  produtos = [
    produto(5, 'PRODUTO 5', ['TST0005']),
    produto(6, 'PRODUTO CHEIO', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']),
    produto(7, 'PRODUTO PLANILHA', ['TST0007'], { origin: 'planilha' }),
    produto(8, 'PRODUTO DONO', ['TST9500']),
  ];
  fontes = [fonte(3, 'FONTE SEM LT', null), fonte(4, 'FONTE COM LT', 30)];
  mockLeituras();
});

async function novoItem(codigo: string) {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Novo item' }));
  fireEvent.change(screen.getByLabelText(/Nome comercial/), { target: { value: 'Item TST' } });
  fireEvent.change(screen.getByLabelText(/Nome de mercado/), { target: { value: 'Mercado Item TST' } });
  fireEvent.change(screen.getByLabelText('Código DBCorp'), { target: { value: codigo } });
}

const cadastrar = () => fireEvent.click(screen.getByRole('button', { name: 'Cadastrar item' }));
const escolherProduto = async (nome: RegExp) => {
  fireEvent.click(await screen.findByLabelText('Produto existente'));
  fireEvent.click(await screen.findByRole('radio', { name: nome }));
};

describe('Itens - vinculo com o Forecast no formulario', () => {
  it('a. item novo com codigo livre e sem escolha: mostra o erro e NAO chama a API', async () => {
    await novoItem('TST9001');
    await screen.findByLabelText('Produto existente');
    cadastrar();
    expect((await screen.findAllByText('Escolha o produto do Forecast ou crie um produto novo.')).length).toBeGreaterThan(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('b. escolhe o produto: manda forecast existente e avisa quando o codigo entra no calculo', async () => {
    post.mockResolvedValue({
      id: 10,
      forecastVinculo: { situacao: 'adicionado', produto: { id: 5, nome: 'PRODUTO 5', origem: 'dbcorp' }, codigoId: 1 },
    });
    await novoItem('TST9001');
    await escolherProduto(/PRODUTO 5/);
    cadastrar();

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/catalog-items',
        expect.objectContaining({ dbcorpCode: 'TST9001', forecast: { modo: 'existente', productId: 5 } }),
      ),
    );
    expect(await screen.findByText(/próxima pré-visualização/)).toBeTruthy();
    expect(screen.getByText(/A quinzena já gravada não muda\./)).toBeTruthy();
    expect(screen.getByText(/Vinculado ao produto PRODUTO 5\./)).toBeTruthy();
  });

  it('c. codigo que ja esta no Forecast: avisa e manda o item SEM forecast', async () => {
    post.mockResolvedValue({ id: 10, forecastVinculo: { situacao: 'ja_no_forecast', produto: { id: 8, nome: 'PRODUTO DONO', origem: 'dbcorp' }, codigoId: 1 } });
    await novoItem('tst9500');
    expect(await screen.findByText(/Já está no Forecast: produto PRODUTO DONO \(1\/7 códigos\)/)).toBeTruthy();
    cadastrar();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('forecast');
  });

  it('d. produto com 7 codigos: radio desabilitado e marcado como cheio', async () => {
    await novoItem('TST9001');
    fireEvent.click(await screen.findByLabelText('Produto existente'));
    const radio = (await screen.findByRole('radio', { name: /PRODUTO CHEIO/ })) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText('7/7 códigos · cheio')).toBeTruthy();
  });

  it('e. produto da planilha: mostra o aviso do proximo import', async () => {
    await novoItem('TST9001');
    await escolherProduto(/PRODUTO PLANILHA/);
    expect(await screen.findByText(/Este produto vem da planilha\./)).toBeTruthy();
    expect(screen.getByText(/PO\.COMP\.01/)).toBeTruthy();
  });

  it('f. produto novo com fonte sem lead time: grava o lead time (patch) ANTES do item (post)', async () => {
    patch.mockResolvedValue({ data: fonte(3, 'FONTE SEM LT', 45) });
    post.mockResolvedValue({
      id: 10,
      forecastVinculo: { situacao: 'produto_novo', produto: { id: 55, nome: 'Item TST', origem: 'dbcorp' }, codigoId: 1 },
    });
    await novoItem('TST9001');
    fireEvent.click(await screen.findByLabelText('Criar produto novo'));
    await waitFor(() => expect((screen.getByLabelText('Nome do produto') as HTMLInputElement).value).toBe('Item TST'));
    await screen.findByRole('option', { name: /FONTE SEM LT/ });
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: '3' } });
    fireEvent.change(await screen.findByLabelText('Lead time da fonte (dias)'), { target: { value: '45' } });
    const familia = screen.getByLabelText('Família do produto');
    await within(familia).findByRole('option', { name: 'FAMILIA TST' });
    fireEvent.change(familia, { target: { value: '4' } });
    cadastrar();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/v1/forecast/sources/3', { leadTimeDays: 45 });
    expect(patch.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(post.mock.invocationCallOrder[0] ?? -1);
    expect(post).toHaveBeenCalledWith(
      '/v1/catalog-items',
      expect.objectContaining({ forecast: { modo: 'novo', nome: 'Item TST', sourceId: 3, familyId: 4 } }),
    );
  });

  it('g. 409 do backend aparece e o formulario continua preenchido', async () => {
    post.mockRejectedValue(new ApiError(409, { message: 'O código TST9001 já pertence ao produto PRODUTO DONO.' }));
    await novoItem('TST9001');
    await escolherProduto(/PRODUTO 5/);
    cadastrar();
    expect(await screen.findByText('O código TST9001 já pertence ao produto PRODUTO DONO.')).toBeTruthy();
    expect((screen.getByLabelText('Código DBCorp') as HTMLInputElement).value).toBe('TST9001');
    expect((screen.getByLabelText(/Nome comercial/) as HTMLInputElement).value).toBe('Item TST');
  });
});

describe('Itens - itens fora do Forecast', () => {
  const orfao = item(3, 'Item Orfao', { dbcorpCode: 'TST9100' });
  const dentro = item(4, 'Item Dentro', { dbcorpCode: 'TST9500' });
  const inativo = item(9, 'Item Inativo', { dbcorpCode: 'TST9200', isActive: false });
  const inativoNoForecast = item(11, 'Item Inativo Dentro', { dbcorpCode: 'TST9500', isActive: false });

  beforeEach(() => {
    itens = [orfao, dentro];
    semForecast = [{ ...orfao, familyId: null, family: null }];
  });

  it('h. painel com a contagem, selo no card e "Vincular" manda o produto escolhido', async () => {
    post.mockResolvedValue({ data: { situacao: 'adicionado', produto: { id: 5, nome: 'PRODUTO 5', origem: 'dbcorp' }, codigoId: 1 } });
    renderPage();
    expect(await screen.findByText('1 item com código DBCorp fora do Forecast')).toBeTruthy();
    expect(screen.getAllByText('Fora do Forecast')).toHaveLength(1);

    const painel = screen.getByLabelText('Catálogo sem Forecast');
    fireEvent.click(within(painel).getByRole('button', { name: 'Vincular ao Forecast' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(await within(dialogo).findByLabelText('Produto existente'));
    fireEvent.click(await within(dialogo).findByRole('radio', { name: /PRODUTO 5/ }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Vincular ao Forecast' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/catalog-items/3/forecast', { modo: 'existente', productId: 5 }),
    );
    expect(await screen.findByText(/Vinculado ao produto PRODUTO 5\./)).toBeTruthy();
  });

  it('painel escondido quando nao ha item fora do Forecast', async () => {
    semForecast = [];
    renderPage();
    await screen.findByText('Item Dentro');
    expect(screen.queryByText(/fora do Forecast/)).toBeNull();
    expect(screen.queryByLabelText('Catálogo sem Forecast')).toBeNull();
  });

  it('i. reativar com codigo livre abre o modal e manda put com isActive e forecast', async () => {
    itens = [inativo];
    semForecast = [];
    put.mockResolvedValue({ id: 9, forecastVinculo: { situacao: 'adicionado', produto: { id: 5, nome: 'PRODUTO 5', origem: 'dbcorp' }, codigoId: 1 } });
    renderPage();
    fireEvent.click(await screen.findByText('Reativar'));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(await within(dialogo).findByLabelText('Produto existente'));
    fireEvent.click(await within(dialogo).findByRole('radio', { name: /PRODUTO 5/ }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reativar e vincular' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/catalog-items/9', {
        isActive: true,
        forecast: { modo: 'existente', productId: 5 },
      }),
    );
  });

  it('i. reativar com codigo que ja esta no Forecast manda so isActive', async () => {
    itens = [inativoNoForecast];
    semForecast = [];
    put.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByText('Reativar'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/v1/catalog-items/11', { isActive: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('j. editar item legado so mudando a nota: put sem forecast e sem bloqueio', async () => {
    put.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByLabelText('Editar item Item Orfao'));
    expect(await screen.findByText('Forecast (opcional)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Observações'), { target: { value: 'nota nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar item' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith('/v1/catalog-items/3', expect.objectContaining({ notes: 'nota nova' }));
    expect(put.mock.calls[0]?.[1]).not.toHaveProperty('forecast');
  });

  it('j. trocar o codigo do item legado passa a exigir a escolha', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('Editar item Item Orfao'));
    fireEvent.change(screen.getByLabelText('Código DBCorp'), { target: { value: 'TST9101' } });
    await screen.findByLabelText('Produto existente');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar item' }));
    expect((await screen.findAllByText('Escolha o produto do Forecast ou crie um produto novo.')).length).toBeGreaterThan(0);
    expect(put).not.toHaveBeenCalled();
  });

  it('k. inativar item com codigo no Forecast avisa que o codigo continua la', async () => {
    del_mock();
    renderPage();
    const card = await screen.findByLabelText('Editar item Item Dentro');
    fireEvent.click(within(card).getByText('Inativar'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(confirmMock.mock.calls[0]?.[0]).toContain('continua no Forecast');
    expect(confirmMock.mock.calls[0]?.[0]).toContain('TST9500');
  });
});

function del_mock() {
  vi.mocked(api.del).mockResolvedValue({});
}
