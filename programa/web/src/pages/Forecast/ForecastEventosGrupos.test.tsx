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

function evento(parcial: Partial<ForecastOcasiao>): ForecastOcasiao {
  return {
    id: 1,
    name: 'EVENTO 001',
    scopeType: 'global',
    countryCode: null,
    sourceId: null,
    source: null,
    startDate: '2026-12-01',
    endDate: '2026-12-05',
    recurrence: 'nenhuma',
    component: 'prontidao',
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

// 3 registros com o MESMO conteudo e alvos diferentes (paises XC e XD, fonte FONTE 001). Dados 100% sinteticos.
const P1 = evento({ id: 1, scopeType: 'pais', countryCode: 'XC' });
const P2 = evento({ id: 2, scopeType: 'pais', countryCode: 'XD' });
const F1 = evento({ id: 3, scopeType: 'fonte', sourceId: 1, source: { id: 1, name: 'FONTE 001', isActive: true } });
const SOLTO = evento({ id: 4, name: 'EVENTO 002', startDate: '2026-11-10', endDate: '2026-11-11' });

const FONTES = [
  { id: 1, name: 'FONTE 001', leadTimeDays: 30, clearanceDays: null, isActive: true, countryCode: 'XC' },
  { id: 2, name: 'FONTE 002', leadTimeDays: 30, clearanceDays: null, isActive: true, countryCode: 'XD' },
];

let lista: ForecastOcasiao[];

function renderPanel(podeEditar = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastOcasioesPanel podeEditar={podeEditar} hoje={HOJE} />
    </QueryClientProvider>,
  );
}

const tabela = () => screen.getByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
const linhasDoCorpo = () => within(tabela()).getAllByRole('rowheader').map((th) => th.childNodes[0]?.textContent);
const selecionar = (rotulo: string, valor: string) => {
  const campos = screen.getAllByLabelText(rotulo);
  fireEvent.change(campos[campos.length - 1] as HTMLElement, { target: { value: valor } });
};
const botao = (nome: string | RegExp) => screen.getByRole('button', { name: nome });

beforeEach(() => {
  vi.clearAllMocks();
  lista = [P1, P2, F1];
  get.mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/v1/forecast/sources') return { data: FONTES };
    if (path === URL_EVENTOS && query === undefined) return { data: lista };
    if (path === URL_EVENTOS && query) {
      const ano = Number(String(query.de).slice(0, 4));
      return {
        data: lista
          .filter((o) => o.startDate.startsWith(String(ano)))
          .map((o) => ({ ...o, ocorrencias: [{ inicio: o.startDate, fim: o.endDate }] })),
      };
    }
    throw new Error(`GET inesperado: ${path}`);
  });
  patch.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: { id: 1 } });
});

describe('lista agrupada', () => {
  it('3 registros iguais viram 1 linha com 3 chips e "Ver alvos (3)" que abre a linha dos alvos', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    expect(linhasDoCorpo()).toEqual(['EVENTO 001']);
    const chips = within(screen.getByRole('list', { name: 'Alvos do evento EVENTO 001' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(chips).toEqual(['País: XC', 'País: XD', 'Fonte: FONTE 001']);
    expect(screen.getByText('1 evento')).toBeTruthy();

    const ver = botao('Ver alvos (3)');
    expect(ver.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(ver);
    const ocultar = botao('Ocultar alvos');
    expect(ocultar.getAttribute('aria-expanded')).toBe('true');
    const alvo = document.getElementById(ocultar.getAttribute('aria-controls') as string) as HTMLElement;
    expect(alvo).toBeTruthy();
    expect(alvo.closest('tr')?.className).toContain('fco-grupo');
    // Sem th scope=row: a leitura por linha nao se polui.
    expect(within(alvo.closest('tr') as HTMLElement).queryByRole('rowheader')).toBeNull();
    fireEvent.click(ocultar);
    expect(botao('Ver alvos (3)').getAttribute('aria-expanded')).toBe('false');
  });

  it('acoes por alvo com aria-labels exatos', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Ver alvos (3)'));
    for (const alcance of ['País: XC', 'País: XD', 'Fonte: FONTE 001']) {
      expect(botao(`Editar o evento EVENTO 001 (${alcance})`)).toBeTruthy();
      expect(botao(`Inativar o evento EVENTO 001 (${alcance})`)).toBeTruthy();
      expect(botao(`Excluir o evento EVENTO 001 (${alcance})`)).toBeTruthy();
      expect(screen.getByRole('group', { name: `Ações do evento EVENTO 001 (${alcance})` })).toBeTruthy();
    }
    expect(botao('Inativar o evento EVENTO 001 em todos os alvos').textContent).toBe('Inativar todos (3)');
    expect(botao('Excluir o evento EVENTO 001 em todos os alvos').textContent).toBe('Excluir todos');
    expect(screen.getByRole('group', { name: 'Ações do evento EVENTO 001' })).toBeTruthy();
  });

  it('acao por alvo: inativar so o registro escolhido', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Ver alvos (3)'));
    fireEvent.click(botao('Inativar o evento EVENTO 001 (País: XD)'));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/2`, { isActive: false });
    expect(await screen.findByText('Evento EVENTO 001 inativado.')).toBeTruthy();
  });

  it('observacao diferente separa em 2 linhas', async () => {
    lista = [P1, evento({ id: 2, scopeType: 'pais', countryCode: 'XD', notes: 'obs sintetica' })];
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    expect(linhasDoCorpo()).toEqual(['EVENTO 001', 'EVENTO 001']);
    expect(screen.queryByRole('button', { name: /Ver alvos/ })).toBeNull();
    expect(screen.getByText('obs sintetica')).toBeTruthy();
  });

  it('situacao mista com o filtro Todos: Misto e a contagem; Reativar todos so quando nao ha ativo', async () => {
    lista = [P1, P2, { ...F1, isActive: false }];
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    // Filtro padrao (Ativos): so os 2 ativos do grupo.
    expect(within(screen.getByRole('list', { name: 'Alvos do evento EVENTO 001' })).getAllByRole('listitem')).toHaveLength(2);
    selecionar('Situação', 'todas');
    expect(within(tabela()).getByText('Misto')).toBeTruthy();
    expect(within(tabela()).getByText('2 ativos, 1 inativo')).toBeTruthy();
    expect(botao('Inativar o evento EVENTO 001 em todos os alvos').textContent).toBe('Inativar todos (2)');
    selecionar('Situação', 'inativa');
    // So o inativo passa pelo filtro: o grupo vira linha unica com Reativar.
    expect(botao('Reativar o evento EVENTO 001')).toBeTruthy();
  });

  it('filtro de pais mostra o grupo so com o membro do pais', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    selecionar('Alcance', 'pais');
    selecionar('País', 'XC');
    expect(linhasDoCorpo()).toEqual(['EVENTO 001']);
    expect(screen.queryByRole('list', { name: 'Alvos do evento EVENTO 001' })).toBeNull();
    expect(within(tabela()).getByText('País: XC')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ver alvos/ })).toBeNull();
  });
});

describe('em grupo', () => {
  it('Inativar todos: 3 PATCH em sequencia e o aviso', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    patch.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Inativar o evento EVENTO 001 em todos os alvos'));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    resolvers[0]?.({ data: {} });
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    resolvers[1]?.({ data: {} });
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(3));
    resolvers[2]?.({ data: {} });
    expect(await screen.findByText('Evento EVENTO 001 inativado em 3 alvos.')).toBeTruthy();
    expect(patch.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [`${URL_EVENTOS}/1`, { isActive: false }],
      [`${URL_EVENTOS}/2`, { isActive: false }],
      [`${URL_EVENTOS}/3`, { isActive: false }],
    ]);
  });

  it('falha parcial: alerta com o resumo', async () => {
    patch.mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce(new ApiError(500, null)).mockResolvedValueOnce({ data: {} });
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Inativar o evento EVENTO 001 em todos os alvos'));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Evento EVENTO 001: 2 inativados, 1 com erro. Não foi possível salvar o evento (HTTP 500).');
    expect(patch).toHaveBeenCalledTimes(3);
  });

  it('Excluir todos: confirmacao, 3 DELETE (404 conta como feito) e aviso', async () => {
    del
      .mockResolvedValueOnce({ data: { id: 1 } })
      .mockRejectedValueOnce(new ApiError(404, { message: 'nao encontrado' }))
      .mockResolvedValueOnce({ data: { id: 3 } });
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Excluir o evento EVENTO 001 em todos os alvos'));
    const titulo = screen.getByRole('heading', { name: 'Excluir o evento EVENTO 001 em 3 alvos' });
    expect(document.activeElement).toBe(titulo);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['País: XC', 'País: XD', 'Fonte: FONTE 001']);
    fireEvent.click(botao('Excluir em 3 alvos'));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(3));
    expect(del.mock.calls.map((c) => c[0])).toEqual([`${URL_EVENTOS}/1`, `${URL_EVENTOS}/2`, `${URL_EVENTOS}/3`]);
    expect(await screen.findByText('Evento EVENTO 001 excluído em 3 alvos.')).toBeTruthy();
  });

  it('Excluir todos com falha: fica na confirmacao com o resumo', async () => {
    del.mockResolvedValueOnce({ data: { id: 1 } }).mockRejectedValueOnce(new ApiError(500, null)).mockResolvedValueOnce({ data: { id: 3 } });
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Excluir o evento EVENTO 001 em todos os alvos'));
    fireEvent.click(botao('Excluir em 3 alvos'));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Evento EVENTO 001: 2 excluídos, 1 com erro. Não foi possível excluir o evento (HTTP 500).');
    expect(screen.getByRole('heading', { name: 'Excluir o evento EVENTO 001 em 3 alvos' })).toBeTruthy();
  });
});

describe('linha do tempo, papeis e textos', () => {
  it('1 linha por grupo e Alcance unido na tabela textual', async () => {
    renderPanel();
    const datas = await screen.findByRole('table', { name: /Datas em 2026/ });
    const linhas = within(datas)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [within(r).getByRole('rowheader').textContent, ...within(r).getAllByRole('cell').map((c) => c.textContent)]);
    expect(linhas).toEqual([['EVENTO 001 (3 alvos)', 'País: XC, País: XD, Fonte: FONTE 001', '01/12/2026', '05/12/2026']]);
    expect(within(datas).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Evento', 'Alcance', 'De', 'Até']);
  });

  it('um grupo e um evento solto: 2 linhas na tabela textual', async () => {
    lista = [P1, P2, F1, SOLTO];
    renderPanel();
    const datas = await screen.findByRole('table', { name: /Datas em 2026/ });
    await waitFor(() =>
      expect(
        within(datas)
          .getAllByRole('rowheader')
          .map((r) => r.textContent),
      ).toEqual(['EVENTO 002', 'EVENTO 001 (3 alvos)']),
    );
  });

  it('leitor (sem edicao) ve "Ver alvos" mas nenhum botao de acao', async () => {
    renderPanel(false);
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    fireEvent.click(botao('Ver alvos (3)'));
    expect(botao('Ocultar alvos')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Editar|Inativar|Reativar|Excluir/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).toBeNull();
  });

  it('textos do escopo regional e da soma por cima', async () => {
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    expect(
      screen.getByText(/uma fonte recebe apenas os eventos do próprio país, os que a escolhem pelo nome e os de Todas as fontes/),
    ).toBeTruthy();
    expect(screen.getByText(/somados por cima do lead time cadastrado da fonte/)).toBeTruthy();
    fireEvent.click(botao('Novo evento'));
    expect(screen.getByText(/Dias a MAIS, somados por cima do lead time cadastrado da fonte/)).toBeTruthy();
  });
});

describe('varredura de interface', () => {
  it('nenhum texto, aria-label ou title com "ocasiao" na lista, no formulario novo (com modelo), na edicao e na exclusao', async () => {
    lista = [P1, P2, F1, SOLTO];
    renderPanel();
    await screen.findByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' });
    const limpo = (etapa: string) => {
      expect(document.body.textContent ?? '', etapa).not.toMatch(/ocasi[ãõ]/i);
      for (const el of Array.from(document.querySelectorAll('[aria-label],[title]'))) {
        expect(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`, etapa).not.toMatch(/ocasi[ãõ]/i);
      }
    };

    limpo('lista');
    fireEvent.click(botao('Ver alvos (3)'));
    limpo('lista com alvos abertos');

    // Formulario novo, a partir de um modelo de cada tipo (lunar, por fonte e fixo).
    for (const modelo of ['barco-dragao', 'sexta-santa', 'dia-trabalhador-cn']) {
      fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: modelo } });
      fireEvent.click(botao('Preencher o formulário'));
      limpo(`formulario do modelo ${modelo}`);
      fireEvent.click(botao('Cancelar'));
    }
    fireEvent.click(botao('Novo evento'));
    limpo('formulario novo');
    fireEvent.click(botao('Cancelar'));

    fireEvent.click(botao('Editar o evento EVENTO 002'));
    limpo('edicao');
    fireEvent.click(botao('Cancelar'));

    fireEvent.click(botao('Excluir o evento EVENTO 002'));
    limpo('confirmacao de exclusao');
    fireEvent.click(botao('Cancelar'));

    fireEvent.click(botao('Excluir o evento EVENTO 001 em todos os alvos'));
    limpo('confirmacao de exclusao em grupo');
  });
});
