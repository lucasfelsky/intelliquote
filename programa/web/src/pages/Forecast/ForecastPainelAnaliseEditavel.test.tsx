import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import Forecast from '../Forecast';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: mockRole } }),
}));

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
const put = vi.mocked(api.put);

// Dados 100% sinteticos.
const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Record<string, unknown> = {}) {
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
    AN: -40,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO A',
    codigos: ['C0001'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: 50,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  };
}

// A: na lista, com decisao | B: sem cadastro | C: fora da lista (sem falta) | D: com cotacao aberta | E: na lista, sem decisao
const LINHAS = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0002'], analiseForecast: 70, productId: null, AN: -5 }),
  linha({ linha: 5, n: 3, item: 'PRODUTO C', codigos: ['C0003'], analiseForecast: null, productId: 43, AN: 120 }),
  linha({ linha: 6, n: 4, item: 'PRODUTO D', codigos: ['C0004'], analiseForecast: 10, productId: 44, AN: -10 }),
  linha({ linha: 7, n: 5, item: 'PRODUTO E', codigos: ['C0005'], analiseForecast: 20, productId: 45, AN: -10, status: 'cotando' }),
];

const resumo = {
  id: 7,
  label: '10-2',
  baseDate: '2026-10-15T00:00:00.000Z',
  half: 2,
  origin: 'planilha',
  months: MONTHS,
  files: [],
  createdById: 1,
  createdAt: '2026-10-20T12:00:00.000Z',
};

const detalhe = {
  id: 7,
  label: '10-2',
  baseDate: '2026-10-15',
  half: 2,
  origin: 'planilha',
  hoje: '2026-10-20',
  months: MONTHS,
  files: [],
  createdAt: '2026-10-20T12:00:00.000Z',
  linhas: LINHAS,
  conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
};

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 42,
    quantidadeKg: 1600,
    status: 'cotando',
    observacao: 'OBS SINTETICA',
    sugeridaKg: 40,
    demandaKg: -40,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

let decisoes: ForecastDecisao[] = [];

function mockApi() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: [resumo] };
    if (path === '/v1/forecast/products') return { data: [] };
    if (path.endsWith('/decisoes')) return { data: { decisoes } };
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    return { data: detalhe };
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const decisoesChamadas = () => get.mock.calls.map((c) => String(c[0])).filter((p) => p.endsWith('/decisoes'));
const rotulo = (item: string) => `Quantidade fechada de ${item}`;
const botao = (item: string) => screen.findByRole('button', { name: rotulo(item) });

async function abrir(item: string): Promise<HTMLInputElement> {
  fireEvent.click(await botao(item));
  return (await screen.findByRole('textbox', { name: rotulo(item) })) as HTMLInputElement;
}

/** `td` da coluna ANALISE FORECAST da linha do item. */
async function celula(item: string): Promise<HTMLTableCellElement> {
  const grade = await screen.findByRole('region', { name: 'Grade do Forecast' });
  const rotulos = Array.from(grade.querySelectorAll('tr.fc-rotulos th'));
  const i = rotulos.findIndex((th) => th.textContent === 'ANÁLISE FORECAST');
  const link = Array.from(grade.querySelectorAll('a.fc-item')).find((b) => b.textContent?.includes(item));
  return link!.closest('tr')!.querySelectorAll('td')[i + 2] as HTMLTableCellElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
  decisoes = [decisao(), decisao({ productId: 44, quantidadeKg: 300, cotacao: { id: 9, requestCode: 'COT-0099', statusCotacao: 'enviada' } })];
  mockApi();
});

describe('Painel - ANALISE FORECAST editavel', () => {
  it.each(['admin', 'comprador'])('%s edita: a celula tem botao rotulado e o campo abre com a quantidade', async (papel) => {
    mockRole = papel;
    renderPage();
    const campo = await abrir('PRODUTO A');
    expect(campo.value).toBe('1600');
    expect(document.activeElement).toBe(campo);
  });

  it.each(['gestor', 'viewer'])('%s so le: valor visivel, sem botao nem campo', async (papel) => {
    mockRole = papel;
    renderPage();
    const td = await celula('PRODUTO A');
    await waitFor(async () => expect((await celula('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('1.600,0'));
    expect(td.querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: rotulo('PRODUTO A') })).toBeNull();
    expect(screen.queryByText(/Clique na ANÁLISE FORECAST/)).toBeNull();
  });

  it('Enter grava so a quantidade (status e observacao ficam), atualiza o cache e a celula sem novo GET', async () => {
    put.mockResolvedValue({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 2000, atualizadaEm: '2026-10-27T15:00:00.000Z' }) } });
    const client = renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '2.000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    await waitFor(async () => expect((await celula('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('2.000,0'));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/42', { quantidadeKg: 2000 });
    expect(decisoesChamadas()).toHaveLength(1);
    expect(client.getQueryData<ForecastDecisao[]>(['forecast', 'decisoes', 7])?.find((d) => d.productId === 42)?.quantidadeKg).toBe(2000);
    expect(await screen.findByText(/Quantidade fechada de PRODUTO A salva: 2\.000 kg\./)).toBeTruthy();
    // o teclado devolve o foco ao botao
    await waitFor(async () => expect(document.activeElement).toBe(await botao('PRODUTO A')));
  });

  it('sair do campo (blur) grava; sem mudanca nao envia nada', async () => {
    put.mockResolvedValue({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 1700 }) } });
    renderPage();
    let campo = await abrir('PRODUTO A');
    fireEvent.blur(campo);
    await botao('PRODUTO A');
    expect(put).not.toHaveBeenCalled();

    campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '1700' } });
    fireEvent.blur(campo);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/42', { quantidadeKg: 1700 }));
  });

  it('Esc cancela sem gravar, mesmo com o campo alterado', async () => {
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '5' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    await botao('PRODUTO A');
    expect(put).not.toHaveBeenCalled();
    expect((await celula('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('1.600,0');
  });

  it('campo vazio apaga a decisao (corpo so com quantidadeKg: null)', async () => {
    put.mockResolvedValue({ data: { acao: 'delete', decisao: null } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '  ' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() => expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/42', { quantidadeKg: null }));
    await waitFor(async () => expect((await celula('PRODUTO A')).querySelector('.fcad-decidida')).toBeNull());
    expect(await screen.findByText(/Quantidade fechada de PRODUTO A removida\./)).toBeTruthy();
  });

  it('item da lista sem decisao: cria com o status do item e sem a flag de fora da lista', async () => {
    put.mockResolvedValue({ data: { acao: 'create', decisao: decisao({ productId: 45, quantidadeKg: 500, status: 'cotando' }) } });
    renderPage();
    const campo = await abrir('PRODUTO E');
    fireEvent.change(campo, { target: { value: '500,5' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/45', { quantidadeKg: 500.5, status: 'cotando' }),
    );
  });

  it('item fora da lista (sem falta): envia incluidoManualmente, mostra a dica e avisa o efeito ao salvar', async () => {
    put.mockResolvedValue({
      data: { acao: 'create', decisao: decisao({ productId: 43, quantidadeKg: 100, status: 'nao', incluidoManualmente: true }) },
    });
    renderPage();
    await botao('PRODUTO C');
    expect((await celula('PRODUTO C')).getAttribute('title')).toContain('candidato a cotação');
    const campo = await abrir('PRODUTO C');
    fireEvent.change(campo, { target: { value: '100' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/decisoes/43', { quantidadeKg: 100, status: 'nao', incluidoManualmente: true }),
    );
    expect(await screen.findByText(/Quantidade fechada de PRODUTO C salva: 100 kg\. Item fora da lista de compra: passou a ser candidato a cotação\./)).toBeTruthy();
  });

  it('a frase de apoio saiu da tela: o texto segue no DOM so para leitor de tela e o icone "i" do titulo abre o balao', async () => {
    renderPage();
    const apoio = await screen.findByText(/Coluna ANÁLISE FORECAST: Clique na célula/);
    expect(apoio.className).toContain('sr-only');
    expect(apoio.textContent).toContain('Enter grava, Esc cancela e campo vazio apaga');
    expect(apoio.textContent).toContain('candidato a cotação');
    expect(apoio.textContent).toContain('Item já em cotação fica só para leitura');
    const dica = await screen.findByRole('button', { name: 'Como preencher a análise forecast' });
    expect(dica.closest('th')?.textContent).toBe('ANÁLISE FORECAST');
    expect(screen.queryByTestId('fc-analise-dica-balao')).toBeNull();
    fireEvent.mouseEnter(dica);
    const balao = screen.getByTestId('fc-analise-dica-balao');
    expect(balao.getAttribute('role')).toBe('tooltip');
    expect(balao.textContent).toContain('Enter grava, Esc cancela e campo vazio apaga');
    expect(balao.textContent).toContain('candidato a cotação');
    expect(balao.textContent).toContain('Item já em cotação fica só para leitura');
  });

  it('valor invalido: avisa, nao envia e mantem o digitado', async () => {
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: 'abc' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('Informe a quantidade em kg');
    expect(put).not.toHaveBeenCalled();
    const ainda = screen.getByRole('textbox', { name: rotulo('PRODUTO A') }) as HTMLInputElement;
    expect(ainda.value).toBe('abc');
    expect(ainda.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(ainda, { target: { value: '-3' } });
    fireEvent.keyDown(ainda, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('não pode ser negativa');
    fireEvent.change(ainda, { target: { value: '1,2345' } });
    fireEvent.keyDown(ainda, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('3 casas decimais');
  });

  it('409: recarrega a lista, informa e preserva o digitado', async () => {
    put.mockRejectedValue(new ApiError(409, null, 'conflito'));
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '3000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('A lista foi recarregada');
    await waitFor(() => expect(decisoesChamadas()).toHaveLength(2));
    const ainda = screen.getByRole('textbox', { name: rotulo('PRODUTO A') }) as HTMLInputElement;
    expect(ainda.value).toBe('3000');
    expect(ainda.disabled).toBe(false);
  });

  it('erro de rede: mostra o erro, mantem o campo e permite tentar de novo com Enter', async () => {
    put.mockRejectedValueOnce(new Error('rede'));
    put.mockResolvedValueOnce({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 3000 }) } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '3000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('Sem conexão');
    fireEvent.keyDown(screen.getByRole('textbox', { name: rotulo('PRODUTO A') }), { key: 'Enter' });
    await waitFor(async () => expect((await celula('PRODUTO A')).querySelector('.fcad-decidida')?.textContent).toBe('3.000,0'));
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('item sem productId: somente leitura, com o valor congelado e o motivo', async () => {
    renderPage();
    await botao('PRODUTO A');
    const td = await celula('PRODUTO B');
    expect(td.querySelector('button')).toBeNull();
    expect(td.firstChild?.textContent).toBe('70,0');
    expect(td.getAttribute('title')).toContain('fora do cadastro');
  });

  it('item com cotacao aberta: somente leitura, com a dica do motivo', async () => {
    renderPage();
    await botao('PRODUTO A');
    const td = await celula('PRODUTO D');
    expect(td.querySelector('button')).toBeNull();
    expect(td.querySelector('.fcad-decidida')?.textContent).toBe('300,0');
    expect(td.getAttribute('title')).toContain('já em cotação (COT-0099)');
    expect(td.querySelector('.sr-only')?.textContent).toContain('COT-0099');
  });

  it('cotacao fechada nao trava a edicao', async () => {
    decisoes = [decisao({ productId: 44, quantidadeKg: 300, cotacao: { id: 9, requestCode: 'COT-0099', statusCotacao: 'fechada' } })];
    renderPage();
    expect((await abrir('PRODUTO D')).value).toBe('300');
  });

  it('decisoes indisponiveis (erro sem cache): a celula nao edita e mostra o congelado', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/snapshots') return { data: [resumo] };
      if (path === '/v1/forecast/products') return { data: [] };
      if (path.endsWith('/decisoes')) throw new ApiError(500, null);
      if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
      return { data: detalhe };
    });
    renderPage();
    await celula('PRODUTO A');
    await waitFor(() => expect(decisoesChamadas().length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: rotulo('PRODUTO A') })).toBeNull();
  });
});

describe('Painel - aviso flutuante da quantidade fechada', () => {
  it('salvar mostra o toast (role=status) com titulo e texto, destaca a celula e nao deixa linha de texto fixa', async () => {
    put.mockResolvedValue({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 2000 }) } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '2.000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    const toast = await screen.findByTestId('fc-toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.querySelector('.fct__titulo')?.textContent).toBe('Quantidade salva');
    expect(toast.querySelector('.fct__texto')?.textContent).toBe('Quantidade fechada de PRODUTO A salva: 2.000 kg.');
    expect(toast.className).toContain('fct--salvo');
    expect(document.querySelector('.fcae-retorno')).toBeNull();
    expect((await botao('PRODUTO A')).className).toContain('fcae-botao--piscar');
  });

  it('remover mostra "Quantidade removida" (lixeira) e a celula nao pisca', async () => {
    put.mockResolvedValue({ data: { acao: 'delete', decisao: null } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    const toast = await screen.findByTestId('fc-toast');
    expect(toast.querySelector('.fct__titulo')?.textContent).toBe('Quantidade removida');
    expect(toast.querySelector('.fct__texto')?.textContent).toBe('Quantidade fechada de PRODUTO A removida.');
    expect(toast.className).toContain('fct--removido');
    expect((await botao('PRODUTO A')).className).not.toContain('piscar');
  });

  it('gravacoes seguidas: um aviso por vez, o novo substitui o anterior', async () => {
    put.mockResolvedValueOnce({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 2000 }) } });
    put.mockResolvedValueOnce({ data: { acao: 'create', decisao: decisao({ productId: 45, quantidadeKg: 500, status: 'cotando' }) } });
    renderPage();
    let campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '2000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect((await screen.findByTestId('fc-toast')).textContent).toContain('PRODUTO A');
    campo = await abrir('PRODUTO E');
    fireEvent.change(campo, { target: { value: '500' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('fc-toast').textContent).toContain('PRODUTO E'));
    expect(screen.getAllByTestId('fc-toast')).toHaveLength(1);
  });

  it('o botao fechar tira o aviso', async () => {
    put.mockResolvedValue({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 2000 }) } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '2000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    await screen.findByTestId('fc-toast');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    await waitFor(() => expect(screen.queryByTestId('fc-toast')).toBeNull());
  });

  it('erro e conflito (409) seguem como alerta persistente (role=alert), sem toast; salvar depois limpa o alerta', async () => {
    put.mockRejectedValueOnce(new ApiError(409, null, 'conflito'));
    put.mockResolvedValueOnce({ data: { acao: 'update', decisao: decisao({ quantidadeKg: 3000 }) } });
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: '3000' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('A lista foi recarregada');
    expect(alerta.className).toContain('fcae-retorno--erro');
    expect(screen.queryByTestId('fc-toast')).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox', { name: rotulo('PRODUTO A') }), { key: 'Enter' });
    await screen.findByTestId('fc-toast');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('valor invalido: alerta, sem toast', async () => {
    renderPage();
    const campo = await abrir('PRODUTO A');
    fireEvent.change(campo, { target: { value: 'abc' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('Informe a quantidade em kg');
    expect(screen.queryByTestId('fc-toast')).toBeNull();
  });

  it('item fora da lista: o toast carrega o aviso do efeito (candidato a cotacao)', async () => {
    put.mockResolvedValue({
      data: { acao: 'create', decisao: decisao({ productId: 43, quantidadeKg: 100, status: 'nao', incluidoManualmente: true }) },
    });
    renderPage();
    const campo = await abrir('PRODUTO C');
    fireEvent.change(campo, { target: { value: '100' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect((await screen.findByTestId('fc-toast')).textContent).toContain('passou a ser candidato a cotação');
  });
});
