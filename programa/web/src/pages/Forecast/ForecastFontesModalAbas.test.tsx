import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastFontesModal from './ForecastFontesModal';

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
import type { ForecastPrazoReal } from '@/services/forecastFontes';

const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);

const URL_PRAZO = '/v1/forecast/sources/prazo-real';
const URL_FONTES = '/v1/forecast/sources';
const URL_EVENTOS = '/v1/forecast/lead-time-events';

const est = (media: number) => ({ chegadas: 12, media, mediana: media, min: media - 10, max: media + 10, poucasChegadas: false });

// Dados 100% sinteticos.
const PRAZO: ForecastPrazoReal = {
  quinzena: { id: 9, label: '11-1', baseDate: '2033-11-05' },
  disponivel: true,
  motivo: null,
  janelaDias: 365,
  minChegadas: 3,
  padraoEtdDias: 35,
  fontes: [
    { sourceId: 1, nome: 'FONTE A', leadTimeDays: 90, clearanceDays: 7, etdDiasUsado: 28, real: { po: est(92), etd: est(40) } },
    { sourceId: 2, nome: 'FONTE B', leadTimeDays: 60, clearanceDays: 5, etdDiasUsado: 35, real: { po: est(102), etd: est(55) } },
    { sourceId: 3, nome: 'FONTE C', leadTimeDays: 45, clearanceDays: 5, etdDiasUsado: 35, real: { po: est(70), etd: est(30) } },
  ],
  semFonte: { chegadas: 0 },
};

let paises: Record<number, string | null>;
let client: QueryClient;

function fonteDaLista(id: number, name: string) {
  return { id, name, leadTimeDays: 30, clearanceDays: null, isActive: true, countryCode: paises[id] ?? null };
}

function renderModal(podeEditar: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastFontesModal podeEditar={podeEditar} onFechar={vi.fn()} />
    </QueryClientProvider>,
  );
}

const linhaDe = (nome: string) => screen.getByRole('rowheader', { name: nome }).closest('tr') as HTMLElement;
const chamadasDeEventos = () => get.mock.calls.filter(([path]) => path === URL_EVENTOS);

beforeEach(() => {
  vi.clearAllMocks();
  paises = { 1: 'CN', 2: null, 3: 'IN' };
  get.mockImplementation(async (path: string) => {
    if (path === URL_PRAZO) return { data: PRAZO };
    if (path === URL_FONTES) {
      return { data: [fonteDaLista(1, 'FONTE A'), fonteDaLista(2, 'FONTE B'), fonteDaLista(3, 'FONTE C')] };
    }
    if (path === URL_EVENTOS) return { data: [] };
    throw new Error(`GET inesperado: ${path}`);
  });
  patch.mockResolvedValue({ data: { id: 2, name: 'FONTE B', countryCode: 'DE' } });
});

describe('abas', () => {
  it('tablist com 2 abas e a de lead time selecionada', async () => {
    renderModal(true);
    await screen.findByRole('rowheader', { name: 'FONTE A' });
    const abas = screen.getAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual(['Lead time por fonte', 'Ocasiões']);
    expect(abas.map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(screen.getByRole('tablist', { name: 'Seções do diálogo Fontes e lead time' })).toBeTruthy();
    const painel = screen.getByRole('tabpanel');
    expect(painel.getAttribute('aria-labelledby')).toBe(abas[0]?.id);
  });

  it('setas, Home e End trocam de aba e o painel acompanha', async () => {
    renderModal(true);
    await screen.findByRole('rowheader', { name: 'FONTE A' });
    const [aba1, aba2] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement];

    aba1.focus();
    fireEvent.keyDown(aba1, { key: 'ArrowRight' });
    await waitFor(() => expect(aba2.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(aba2);
    const painel = await screen.findByRole('tabpanel');
    expect(painel.getAttribute('aria-labelledby')).toBe(aba2.id);
    expect(await screen.findByText(/Ocasiões são períodos/)).toBeTruthy();
    expect(screen.queryByRole('rowheader', { name: 'FONTE A' })).toBeNull();

    fireEvent.keyDown(aba2, { key: 'ArrowLeft' });
    await waitFor(() => expect(aba1.getAttribute('aria-selected')).toBe('true'));
    expect(await screen.findByRole('rowheader', { name: 'FONTE A' })).toBeTruthy();

    fireEvent.keyDown(aba1, { key: 'End' });
    await waitFor(() => expect(aba2.getAttribute('aria-selected')).toBe('true'));
    fireEvent.keyDown(aba2, { key: 'Home' });
    await waitFor(() => expect(aba1.getAttribute('aria-selected')).toBe('true'));
  });

  it('trocar de aba nao descarta o rascunho do formulario de ocasiao (painel fica montado, oculto)', async () => {
    renderModal(true);
    await screen.findByRole('rowheader', { name: 'FONTE A' });
    const [aba1, aba2] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement];
    fireEvent.click(aba2);
    fireEvent.click(await screen.findByRole('button', { name: 'Nova ocasião' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'RASCUNHO SINTETICO' } });

    fireEvent.click(aba1);
    expect(await screen.findByRole('rowheader', { name: 'FONTE A' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Nome' })).toBeNull(); // painel oculto fora da arvore de acessibilidade
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);

    fireEvent.click(aba2);
    expect(((await screen.findByRole('textbox', { name: 'Nome' })) as HTMLInputElement).value).toBe('RASCUNHO SINTETICO');
    expect(screen.queryByRole('rowheader', { name: 'FONTE A' })).toBeNull();
    // a aba nao refez o carregamento so por reaparecer
    expect(chamadasDeEventos().filter(([, q]) => q === undefined)).toHaveLength(1);
  });

  it('a aba Ocasiões so busca as ocasioes depois de aberta', async () => {
    renderModal(true);
    await screen.findByRole('rowheader', { name: 'FONTE A' });
    expect(chamadasDeEventos()).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Ocasiões' }));
    await screen.findByText(/Ocasiões são períodos/);
    await waitFor(() => expect(chamadasDeEventos().length).toBeGreaterThan(0));
  });
});

describe('coluna Pais', () => {
  it('mostra o pais de cada fonte, o travessao e o aviso de fontes sem pais', async () => {
    renderModal(false);
    await screen.findByRole('rowheader', { name: 'FONTE A' });
    expect(screen.getByRole('columnheader', { name: 'País' })).toBeTruthy();
    expect(await within(linhaDe('FONTE A')).findByText('China (CN)')).toBeTruthy();
    expect(within(linhaDe('FONTE C')).getByText('Índia (IN)')).toBeTruthy();
    expect(within(linhaDe('FONTE B')).getAllByRole('cell')[0]?.textContent).toBe('—');
    expect(await screen.findByText('1 fonte sem país: ocasiões por país não a alcançam.')).toBeTruthy();
  });

  it('viewer nao ve o botao de editar o pais', async () => {
    renderModal(false);
    await within(await screen.findByRole('table')).findByText('China (CN)');
    expect(screen.queryByRole('button', { name: /Editar país de/ })).toBeNull();
  });

  it('lista de fontes indisponivel: travessao, aviso e sem botao de editar pais', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === URL_PRAZO) return { data: PRAZO };
      throw new ApiError(500, null);
    });
    renderModal(true);
    await screen.findByRole('rowheader', { name: 'FONTE A' });
    expect(await screen.findByText('Não foi possível carregar o país das fontes.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Editar país de/ })).toBeNull();
    // A edicao de lead time continua disponivel.
    expect(screen.getByRole('button', { name: 'Editar lead time de FONTE A' })).toBeTruthy();
  });

  it('comprador edita o pais: PATCH, invalidacao, aviso e foco de volta', async () => {
    renderModal(true);
    const editar = await screen.findByRole('button', { name: 'Editar país de FONTE B' });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(editar);
    fireEvent.change(screen.getByLabelText('País de FONTE B'), { target: { value: 'DE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar país de FONTE B' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/forecast/sources/2', { countryCode: 'DE' }));
    expect(await screen.findByText('País de FONTE B salvo: Alemanha (DE).')).toBeTruthy();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast', 'fontes'] });
    const voltou = await screen.findByRole('button', { name: 'Editar país de FONTE B' });
    await waitFor(() => expect(document.activeElement).toBe(voltou));
  });

  it('"Sem país" envia null e avisa a remocao', async () => {
    paises = { 1: 'CN', 2: 'IN', 3: 'IN' };
    renderModal(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar país de FONTE B' }));
    fireEvent.change(screen.getByLabelText('País de FONTE B'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar país de FONTE B' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/forecast/sources/2', { countryCode: null }));
    expect(await screen.findByText('País de FONTE B removido.')).toBeTruthy();
  });

  it('codigo invalido em "Outro": erro e nenhuma chamada', async () => {
    renderModal(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar país de FONTE B' }));
    fireEvent.change(screen.getByLabelText('País de FONTE B'), { target: { value: '__outro' } });
    fireEvent.change(screen.getByLabelText('Código ISO do país (2 letras)'), { target: { value: 'xx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar país de FONTE B' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Código de país não reconhecido. Confira o código ISO de 2 letras.');
    expect(patch).not.toHaveBeenCalled();
  });

  it('Cancelar fecha a edicao e devolve o foco', async () => {
    renderModal(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar país de FONTE B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar país de FONTE B' }));
    const voltou = await screen.findByRole('button', { name: 'Editar país de FONTE B' });
    await waitFor(() => expect(document.activeElement).toBe(voltou));
    expect(patch).not.toHaveBeenCalled();
  });

  it('403 no PATCH: mensagem de perfil', async () => {
    patch.mockRejectedValue(new ApiError(403, null));
    renderModal(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar país de FONTE B' }));
    fireEvent.change(screen.getByLabelText('País de FONTE B'), { target: { value: 'DE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar país de FONTE B' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Seu perfil não pode alterar o país das fontes.');
  });
});
