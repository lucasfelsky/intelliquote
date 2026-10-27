import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastOcasioesPanel from './ForecastOcasioesPanel';

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
import type { ForecastOcasiao } from '@/services/forecastOcasioes';

const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.del);

const URL_EVENTOS = '/v1/forecast/lead-time-events';
const HOJE = '2026-10-27';

function oc(parcial: Partial<ForecastOcasiao>): ForecastOcasiao {
  return {
    id: 1,
    name: 'OCASIAO SINTETICA 1',
    scopeType: 'global',
    countryCode: null,
    sourceId: null,
    source: null,
    startDate: '2027-02-17',
    endDate: '2027-02-25',
    recurrence: 'nenhuma',
    component: 'total',
    effectKind: 'dias',
    effectValue: 3,
    notes: null,
    isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ocorrencias: null,
    ...parcial,
  };
}

// Dados 100% sinteticos. Por padrao (ativas) aparecem B (2026-12-20), A (2027-02-17) e E (2027-06-01).
const A = oc({ id: 1, name: 'OCASIAO SINTETICA 1' });
const B = oc({
  id: 2,
  name: 'OCASIAO SINTETICA 2',
  scopeType: 'pais',
  countryCode: 'CN',
  startDate: '2026-12-20',
  endDate: '2027-01-05',
  recurrence: 'anual',
  component: 'embarque',
  effectValue: 7,
  notes: 'nota sintetica',
});
const C = oc({
  id: 3,
  name: 'OCASIAO SINTETICA 3',
  scopeType: 'fonte',
  sourceId: 1,
  source: { id: 1, name: 'FONTE A', isActive: true },
  startDate: '2026-01-05',
  endDate: '2026-01-09',
});
const D = oc({ id: 4, name: 'OCASIAO SINTETICA 4', isActive: false, startDate: '2027-05-03', endDate: '2027-05-04' });
const E = oc({
  id: 5,
  name: 'OCASIAO SINTETICA 5',
  scopeType: 'pais',
  countryCode: 'DE',
  startDate: '2027-06-01',
  endDate: '2027-06-02',
  effectKind: 'percentual',
  effectValue: 12.5,
});

const FONTES = [
  { id: 1, name: 'FONTE A', leadTimeDays: 30, clearanceDays: null, isActive: true, countryCode: 'CN' },
  { id: 2, name: 'FONTE B', leadTimeDays: 30, clearanceDays: null, isActive: true, countryCode: null },
  { id: 3, name: 'FONTE C', leadTimeDays: 30, clearanceDays: null, isActive: false, countryCode: null },
];

let lista: ForecastOcasiao[];
let client: QueryClient;

function mockLeituras() {
  get.mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/v1/forecast/sources') return { data: FONTES };
    if (path === URL_EVENTOS && query === undefined) return { data: lista };
    if (path === URL_EVENTOS && query) {
      const ano = Number(String(query.de).slice(0, 4));
      const doAno = lista
        .map((o) => {
          const ocorrencias: Array<{ inicio: string; fim: string }> = [];
          if (o.recurrence === 'anual') {
            ocorrencias.push({ inicio: `${ano - 1}${o.startDate.slice(4)}`, fim: `${ano}${o.endDate.slice(4)}` });
            ocorrencias.push({ inicio: `${ano}${o.startDate.slice(4)}`, fim: `${ano + 1}${o.endDate.slice(4)}` });
          } else if (o.startDate.startsWith(String(ano))) {
            ocorrencias.push({ inicio: o.startDate, fim: o.endDate });
          }
          return { ...o, ocorrencias };
        })
        .filter((o) => o.ocorrencias.length > 0);
      return { data: doAno };
    }
    throw new Error(`GET inesperado: ${path}`);
  });
}

function renderPanel(podeEditar = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastOcasioesPanel podeEditar={podeEditar} hoje={HOJE} />
    </QueryClientProvider>,
  );
}

const tabelaLista = () => screen.getByRole('table', { name: 'Ocasiões que afetam o lead time' });
const nomesDaLista = () =>
  within(tabelaLista())
    .getAllByRole('rowheader')
    .map((th) => th.childNodes[0]?.textContent);
const selecionar = (rotulo: string, valor: string) => {
  // "Ano" existe no seletor de modelo e no filtro: o do filtro e o ultimo da tela.
  const campos = screen.getAllByLabelText(rotulo);
  fireEvent.change(campos[campos.length - 1] as HTMLElement, { target: { value: valor } });
};

beforeEach(() => {
  vi.clearAllMocks();
  lista = [A, B, C, D, E];
  mockLeituras();
  patch.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: { id: 1 } });
});

describe('estados', () => {
  it('carregando', async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    renderPanel();
    expect(await screen.findByText(/Carregando ocasiões…/)).toBeTruthy();
  });

  it('erro 500 com "Tentar de novo" que recarrega', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === URL_EVENTOS) throw new ApiError(500, null);
      return { data: FONTES };
    });
    renderPanel();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar as ocasiões (HTTP 500).');
    mockLeituras();
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Nova ocasião' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('404 sem corpo JSON = backend antigo, sem os botoes de escrita', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === URL_EVENTOS) throw new ApiError(404, { contentType: 'text/html', body: '<html>' });
      return { data: FONTES };
    });
    renderPanel();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('O servidor ainda não tem o cadastro de ocasiões. Aguarde a atualização do sistema.');
    expect(screen.queryByRole('button', { name: 'Nova ocasião' })).toBeNull();
    expect(screen.queryByText('Usar um modelo')).toBeNull();
  });

  it('vazio: editor convida a usar um modelo; leitura so informa', async () => {
    lista = [];
    const { unmount } = renderPanel(true);
    expect(await screen.findByText('Nenhuma ocasião cadastrada. Use um modelo ou cadastre a primeira.')).toBeTruthy();
    unmount();
    renderPanel(false);
    expect(await screen.findByText('Nenhuma ocasião cadastrada.')).toBeTruthy();
    expect(screen.queryByText(/Use um modelo/)).toBeNull();
  });

  it('texto fixo informa que nada muda no calculo', async () => {
    renderPanel();
    expect(await screen.findByText(/Por enquanto só informam: nenhum cálculo do Forecast muda\./)).toBeTruthy();
  });

  it('avisa quantas fontes ativas estao sem pais', async () => {
    renderPanel();
    expect(await screen.findByText('1 fonte sem país: ocasiões por país não a alcançam.')).toBeTruthy();
  });
});

describe('papeis', () => {
  it('leitura (gestor/viewer): sem Nova ocasiao, sem modelo, sem coluna Acoes e com a dica', async () => {
    renderPanel(false);
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    expect(screen.getByText('Só administrador e comprador cadastram ou alteram ocasiões.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nova ocasião' })).toBeNull();
    expect(screen.queryByText('Usar um modelo')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar a ocasião/ })).toBeNull();
  });

  it('edicao (admin/comprador): tudo disponivel', async () => {
    renderPanel(true);
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    expect(screen.getByRole('button', { name: 'Nova ocasião' })).toBeTruthy();
    expect(screen.getByText('Usar um modelo')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Ações' })).toBeTruthy();
    expect(screen.queryByText('Só administrador e comprador cadastram ou alteram ocasiões.')).toBeNull();
  });
});

describe('lista e filtros', () => {
  it('tabela com caption e cabecalhos; so ativas e por data de inicio', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    const cabecalhos = within(tabelaLista())
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Ocasião', 'Alcance', 'Período', 'Etapa', 'Efeito', 'Situação', 'Ações']);
    expect(nomesDaLista()).toEqual(['OCASIAO SINTETICA 2', 'OCASIAO SINTETICA 1', 'OCASIAO SINTETICA 5']);
    expect(screen.getByText('nota sintetica')).toBeTruthy();
    expect(screen.getByText('20/12 a 05/01, todo ano')).toBeTruthy();
    expect(screen.getByText('País: China (CN)')).toBeTruthy();
    expect(screen.getByText('Mostrando 3 de 5 ocasiões.')).toBeTruthy();
  });

  it('Todas mostra passada e inativa com os textos Passada e Inativa', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    selecionar('Situação', 'todas');
    expect(nomesDaLista()).toEqual([
      'OCASIAO SINTETICA 3',
      'OCASIAO SINTETICA 2',
      'OCASIAO SINTETICA 1',
      'OCASIAO SINTETICA 4',
      'OCASIAO SINTETICA 5',
    ]);
    const tabela = within(tabelaLista());
    expect(tabela.getByText('Passada')).toBeTruthy();
    expect(tabela.getByText('Inativa')).toBeTruthy();
    expect(tabela.getByText('Fonte: FONTE A')).toBeTruthy();
  });

  it('filtros de alcance, pais, fonte e ano', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    selecionar('Situação', 'todas');

    selecionar('Alcance', 'pais');
    expect(nomesDaLista()).toEqual(['OCASIAO SINTETICA 2', 'OCASIAO SINTETICA 5']);
    expect(screen.queryByLabelText('Fonte')).toBeNull();
    selecionar('País', 'CN');
    expect(nomesDaLista()).toEqual(['OCASIAO SINTETICA 2']);

    selecionar('Alcance', 'fonte');
    expect(screen.queryByLabelText('País')).toBeNull();
    expect(nomesDaLista()).toEqual(['OCASIAO SINTETICA 3']);
    selecionar('Fonte', '1');
    expect(nomesDaLista()).toEqual(['OCASIAO SINTETICA 3']);

    selecionar('Alcance', 'todos');
    selecionar('Fonte', '');
    selecionar('Ano', '2026');
    expect(nomesDaLista()).toEqual(['OCASIAO SINTETICA 3', 'OCASIAO SINTETICA 2']);
  });

  it('sem resultado: aviso e Limpar filtros', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    selecionar('Situação', 'passada');
    selecionar('Alcance', 'global');
    expect(screen.getByText('Nenhuma ocasião com estes filtros.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(nomesDaLista()).toHaveLength(3);
    expect((screen.getByLabelText('Situação') as HTMLSelectElement).value).toBe('ativa');
  });

  it('lista cheia (500) avisa o corte', async () => {
    lista = Array.from({ length: 500 }, (_, i) => oc({ id: i + 1, name: `OCASIAO SINTETICA ${i + 1}` }));
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    expect(screen.getByText('500 ocasiões. Mostrando as 500 primeiras por data de início.')).toBeTruthy();
  });

  it('percentual: texto com selo', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    const linha = screen.getByRole('rowheader', { name: /OCASIAO SINTETICA 5/ }).closest('tr') as HTMLElement;
    expect(within(linha).getByText('+12,5% da etapa')).toBeTruthy();
    expect(within(linha).getByText('percentual')).toBeTruthy();
  });
});

describe('linha do tempo', () => {
  it('pede a janela do ano de hoje e mostra a tabela com as datas das ocorrencias e o marcador Hoje', async () => {
    renderPanel();
    const tabela = await screen.findByRole('table', { name: /Datas em 2026/ });
    expect(get).toHaveBeenCalledWith(URL_EVENTOS, { de: '2026-01-01', ate: '2026-12-31' });
    const celulas = within(tabela)
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(celulas).toEqual([
      ['20/12/2025', '05/01/2026'],
      ['20/12/2026', '05/01/2027'],
    ]);
    expect(screen.getByText('Hoje')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Linha do tempo de 2026' })).toBeTruthy();
  });

  it('trocar o ano refaz o GET da janela e mostra a tabela do ano', async () => {
    renderPanel();
    await screen.findByRole('table', { name: /Datas em 2026/ });
    selecionar('Ano', '2027');
    const tabela = await screen.findByRole('table', { name: /Datas em 2027/ });
    expect(get).toHaveBeenCalledWith(URL_EVENTOS, { de: '2027-01-01', ate: '2027-12-31' });
    expect(within(tabela).getByText('17/02/2027')).toBeTruthy();
    // Hoje (2026) fora do ano mostrado: sem marcador.
    expect(screen.queryByText('Hoje')).toBeNull();
  });

  it('erro na janela: alerta com Tentar de novo', async () => {
    get.mockImplementation(async (path: string, query?: Record<string, unknown>) => {
      if (path === URL_EVENTOS && query) throw new ApiError(500, null);
      if (path === URL_EVENTOS) return { data: lista };
      return { data: FONTES };
    });
    renderPanel();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar as ocasiões (HTTP 500).');
    expect(within(alerta).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('filtros sem ocorrencia no ano: texto de vazio', async () => {
    renderPanel();
    await screen.findByRole('table', { name: /Datas em 2026/ });
    selecionar('Situação', 'inativa');
    expect(await screen.findByText('Nenhuma ocasião em 2026 com estes filtros.')).toBeTruthy();
  });
});

describe('inativar, reativar e excluir', () => {
  it('inativar: PATCH, aviso e invalidacao', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Inativar a ocasião OCASIAO SINTETICA 1' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/1`, { isActive: false }));
    expect(await screen.findByText('Ocasião OCASIAO SINTETICA 1 inativada.')).toBeTruthy();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast', 'ocasioes'] });
  });

  it('reativar com 409 mostra a mensagem do servidor', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    selecionar('Situação', 'inativa');
    const duplicata = 'Já existe uma ocasião ativa com o mesmo alcance, período e etapa. Edite a existente.';
    patch.mockRejectedValue(new ApiError(409, { message: duplicata }, duplicata));
    fireEvent.click(screen.getByRole('button', { name: 'Reativar a ocasião OCASIAO SINTETICA 4' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(duplicata);
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/4`, { isActive: true });
  });

  it('botoes da linha ficam desabilitados com a mutacao pendente', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    patch.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Inativar a ocasião OCASIAO SINTETICA 1' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Editar a ocasião OCASIAO SINTETICA 2' }) as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it('excluir: confirmacao inline; Cancelar nao exclui e devolve o foco ao botao', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir a ocasião OCASIAO SINTETICA 1' }));
    const titulo = screen.getByRole('heading', { name: 'Excluir a ocasião OCASIAO SINTETICA 1' });
    expect(document.activeElement).toBe(titulo);
    expect(screen.getByText('A exclusão é definitiva. Para só deixar de considerar a ocasião, use Inativar.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Ocasiões que afetam o lead time' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(del).not.toHaveBeenCalled();
    const botao = await screen.findByRole('button', { name: 'Excluir a ocasião OCASIAO SINTETICA 1' });
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });

  it('excluir: confirmar chama DELETE e mostra o aviso', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir a ocasião OCASIAO SINTETICA 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir ocasião' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`${URL_EVENTOS}/1`));
    expect(await screen.findByText('Ocasião OCASIAO SINTETICA 1 excluída.')).toBeTruthy();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast', 'ocasioes'] });
  });

  it('excluir com 404 e corpo JSON: ocasiao nao existe mais e a lista e invalidada', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Ocasiões que afetam o lead time' });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    del.mockRejectedValue(new ApiError(404, { message: 'Ocasião não encontrada.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir a ocasião OCASIAO SINTETICA 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir ocasião' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Esta ocasião não existe mais (pode ter sido excluída). A lista foi atualizada.');
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast', 'ocasioes'] });
  });
});
