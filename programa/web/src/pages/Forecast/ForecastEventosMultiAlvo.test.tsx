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
const post = vi.mocked(api.post);

const URL_EVENTOS = '/v1/forecast/lead-time-events';
const HOJE = '2026-10-27';

// Paises XC/XD (o Intl nao os conhece: o nome e o proprio codigo). Dados 100% sinteticos.
const fonte = (id: number, countryCode: string | null, isActive = true) => ({
  id,
  name: `FONTE ${String(id).padStart(3, '0')}`,
  leadTimeDays: 30,
  clearanceDays: null,
  isActive,
  countryCode,
});
const FONTES_PADRAO = [fonte(1, 'XC'), fonte(2, 'XD'), fonte(3, null), fonte(4, null)];

let fontes: ReturnType<typeof fonte>[];
let lista: ForecastOcasiao[];
let client: QueryClient;

const evento = (parcial: Partial<ForecastOcasiao>): ForecastOcasiao => ({
  id: 1,
  name: 'EVENTO 001',
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
});

function renderPanel() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastOcasioesPanel podeEditar hoje={HOJE} />
    </QueryClientProvider>,
  );
}

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const digitar = (rotulo: string, valor: string) => fireEvent.change(campo(rotulo), { target: { value: valor } });
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
const marcar = (nome: string | RegExp) => fireEvent.click(screen.getByRole('checkbox', { name: nome }));

async function abrirNovo() {
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Novo evento' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }));
  digitar('Nome', 'EVENTO 001');
  digitar('Início', '2027-02-01');
  digitar('Fim', '2027-02-03');
  digitar('Dias a mais', '3');
}

const corpoPais = (codigo: string) => expect.objectContaining({ scopeType: 'pais', countryCode: codigo, sourceId: null });
const regiaoViva = () => document.querySelector('.fco-form .fco-vivo') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  fontes = FONTES_PADRAO;
  lista = [evento({ id: 1 })];
  get.mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/v1/forecast/sources') return { data: fontes };
    if (path === URL_EVENTOS && query === undefined) return { data: lista };
    if (path === URL_EVENTOS) return { data: [] };
    throw new Error(`GET inesperado: ${path}`);
  });
  post.mockResolvedValue({ data: { id: 99 } });
});

describe('novo evento com varios alvos', () => {
  it('2 paises + 1 fonte: 3 POSTs na ordem, corpos exatos, aviso, volta a lista e 1 invalidacao', async () => {
    await abrirNovo();
    marcar('XD · 1 fonte ativa');
    marcar('XC · 1 fonte ativa');
    marcar('FONTE 003 · sem país');
    expect(
      screen.getByText('Vale para: XC, XD, FONTE 003. Ao salvar, cria 3 registros (um por país ou fonte).'),
    ).toBeTruthy();
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const comum = {
      name: 'EVENTO 001',
      startDate: '2027-02-01',
      endDate: '2027-02-03',
      recurrence: 'nenhuma',
      component: 'total',
      effectKind: 'dias',
      effectValue: 3,
      notes: null,
    };
    expect(post.mock.calls.map((c) => c[0])).toEqual([URL_EVENTOS, URL_EVENTOS, URL_EVENTOS]);
    expect(post.mock.calls[0]?.[1]).toEqual({ ...comum, scopeType: 'pais', countryCode: 'XC', sourceId: null });
    expect(post.mock.calls[1]?.[1]).toEqual({ ...comum, scopeType: 'pais', countryCode: 'XD', sourceId: null });
    expect(post.mock.calls[2]?.[1]).toEqual({ ...comum, scopeType: 'fonte', countryCode: null, sourceId: 3 });
    expect(await screen.findByText('Evento EVENTO 001: 3 criados.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' })).toBeTruthy();
    expect(invalidar).toHaveBeenCalledTimes(1);
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast', 'ocasioes'] });
  });

  it('envia um de cada vez (a 2a chamada so depois de a 1a resolver)', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    post.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    await abrirNovo();
    marcar('XC · 1 fonte ativa');
    marcar('XD · 1 fonte ativa');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: 'Salvando…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Salvando…' }).getAttribute('aria-busy')).toBe('true');
    resolvers[0]?.({ data: {} });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    resolvers[1]?.({ data: {} });
    expect(await screen.findByText('Evento EVENTO 001: 2 criados.')).toBeTruthy();
  });

  it('409 em 1 alvo: conta "ja existia" e volta a lista', async () => {
    post.mockResolvedValueOnce({ data: {} }).mockRejectedValueOnce(new ApiError(409, { message: 'dup' })).mockResolvedValueOnce({ data: {} });
    await abrirNovo();
    marcar('XC · 1 fonte ativa');
    marcar('XD · 1 fonte ativa');
    marcar('FONTE 003 · sem país');
    salvar();
    expect(await screen.findByText('Evento EVENTO 001: 2 criados, 1 já existia.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' })).toBeTruthy();
  });

  it('500 no 2o: fica no formulario, resumo na regiao viva, so o que falhou continua marcado e o novo Salvar envia so ele', async () => {
    post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new ApiError(500, null))
      .mockResolvedValueOnce({ data: {} });
    await abrirNovo();
    marcar('XC · 1 fonte ativa');
    marcar('XD · 1 fonte ativa');
    marcar('FONTE 003 · sem país');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));

    const viva = regiaoViva();
    expect(viva.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(viva.textContent).toContain('Evento EVENTO 001: 2 criados, 1 com erro.'));
    const itens = within(viva)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(itens).toEqual([
      'XC: criado',
      'XD: erro — Não foi possível salvar o evento (HTTP 500).',
      'FONTE 003: criado',
    ]);
    expect(viva.textContent).toContain('Os que deram erro continuam marcados: salve de novo para tentar só eles.');
    expect(screen.queryByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' })).toBeNull();

    expect((screen.getByRole('checkbox', { name: 'XC · 1 fonte ativa' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'XD · 1 fonte ativa' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'FONTE 003 · sem país' }) as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Salvar' })));

    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(post.mock.calls[3]?.[1]).toEqual(corpoPais('XD'));
    // Reenvio de 1 alvo so: caminho de 1 registro (aviso padrao).
    expect(await screen.findByText('Evento EVENTO 001 cadastrado.')).toBeTruthy();
  });

  it('401 no 1o: 1 POST so, 1 com erro e 2 nao enviados', async () => {
    post.mockRejectedValue(new ApiError(401, null));
    await abrirNovo();
    marcar('XC · 1 fonte ativa');
    marcar('XD · 1 fonte ativa');
    marcar('FONTE 003 · sem país');
    salvar();
    await waitFor(() => expect(regiaoViva().textContent).toContain('Evento EVENTO 001: 1 com erro, 2 não enviados.'));
    expect(post).toHaveBeenCalledTimes(1);
    const itens = within(regiaoViva())
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(itens).toEqual(['XC: erro — Sua sessão expirou. Entre de novo.', 'XD: não enviado', 'FONTE 003: não enviado']);
  });

  it('tudo 409: fica no formulario e diz que nada foi criado', async () => {
    post.mockRejectedValue(new ApiError(409, { message: 'dup' }));
    await abrirNovo();
    marcar('XC · 1 fonte ativa');
    marcar('XD · 1 fonte ativa');
    salvar();
    await waitFor(() => expect(regiaoViva().textContent).toContain('Evento EVENTO 001: 2 já existiam. Nada foi criado.'));
    expect(post).toHaveBeenCalledTimes(2);
    expect(regiaoViva().textContent).toContain('XC: já existia (há outro evento ativo com o mesmo período e etapa; nada mudou)');
    expect(screen.getByRole('heading', { name: 'Novo evento' })).toBeTruthy();
  });

  it('pais e a propria fonte marcados: erro e nenhum POST', async () => {
    await abrirNovo();
    marcar('XC · 1 fonte ativa');
    marcar('FONTE 001 · XC');
    salvar();
    expect(screen.getByText('FONTE 001 já recebe este evento pelo país XC: desmarque a fonte ou o país.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo('Buscar fonte'));
  });

  it('31 fontes marcadas: erro e nenhum POST', async () => {
    fontes = Array.from({ length: 31 }, (_, i) => fonte(i + 1, null));
    await abrirNovo();
    for (const f of fontes) marcar(`${f.name} · sem país`);
    expect(screen.getByText(/^31 fontes marcadas/)).toBeTruthy();
    salvar();
    expect(screen.getByText('Marque no máximo 30 países e fontes por vez.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('modelo por fonte (Sexta-feira Santa 2027): nada marcado, aviso, 2 fontes = 2 POSTs', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Novo evento' });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'sexta-santa' } });
    fireEvent.change(screen.getAllByLabelText('Ano')[0] as HTMLElement, { target: { value: '2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preencher o formulário' }));

    expect((screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }) as HTMLInputElement).checked).toBe(true);
    for (const c of screen.getAllByRole('checkbox')) {
      if ((c as HTMLInputElement).disabled) continue;
      expect((c as HTMLInputElement).checked).toBe(false);
    }
    expect(
      screen.getByText('Marque as fontes alemãs que param nesses feriados. O alcance é por fonte, não pelo país inteiro.'),
    ).toBeTruthy();
    expect(campo('Nome').value).toBe('Sexta-feira Santa (Alemanha) 2027');
    expect(campo('Repete todo ano').disabled).toBe(true);

    marcar('FONTE 003 · sem país');
    marcar('FONTE 004 · sem país');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const corpo = (n: number) => post.mock.calls[n]?.[1];
    expect(corpo(0)).toEqual(
      expect.objectContaining({
        name: 'Sexta-feira Santa (Alemanha) 2027',
        scopeType: 'fonte',
        sourceId: 3,
        startDate: '2027-03-26',
        endDate: '2027-03-26',
        recurrence: 'nenhuma',
      }),
    );
    expect(corpo(1)).toEqual(expect.objectContaining({ scopeType: 'fonte', sourceId: 4, startDate: '2027-03-26' }));
    expect(await screen.findByText('Evento Sexta-feira Santa (Alemanha) 2027: 2 criados.')).toBeTruthy();
  });

  it('busca de fonte filtra a lista e a contagem mostra as marcadas mesmo as filtradas', async () => {
    await abrirNovo();
    marcar('FONTE 003 · sem país');
    marcar('FONTE 004 · sem país');
    digitar('Buscar fonte', '003');
    expect(screen.queryByRole('checkbox', { name: 'FONTE 004 · sem país' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'FONTE 003 · sem país' })).toBeTruthy();
    expect(screen.getByText('2 fontes marcadas: FONTE 003, FONTE 004')).toBeTruthy();
    digitar('Buscar fonte', 'nao existe');
    expect(screen.getByText('Nenhuma fonte com esse nome.')).toBeTruthy();
  });

  it('sem fontes carregadas: aviso na lista de fontes e os paises seguem funcionando', async () => {
    fontes = [];
    await abrirNovo();
    expect(screen.getByText('Nenhuma fonte ativa carregada.')).toBeTruthy();
    marcar('Alemanha (DE) · nenhuma fonte ativa');
    expect(screen.getByText('Vale para: Alemanha (DE). Ao salvar, cria 1 registro (um por país ou fonte).')).toBeTruthy();
  });

  it('todas as fontes: um POST global e o texto com a contagem de fontes ativas', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo evento' }));
    expect(screen.getByText('Vale para todas as fontes ativas (4).')).toBeTruthy();
    digitar('Nome', 'EVENTO 001');
    digitar('Início', '2027-02-01');
    digitar('Fim', '2027-02-03');
    digitar('Dias a mais', '3');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ scopeType: 'global', countryCode: null, sourceId: null }),
    );
    expect(await screen.findByText('Evento EVENTO 001 cadastrado.')).toBeTruthy();
  });

  it('1 alvo com erro 400: alerta com a mensagem e rascunho preservado (igual ao comportamento antigo)', async () => {
    post.mockRejectedValue(new ApiError(400, { message: 'Fonte não encontrada ou inativa.' }, 'Fonte não encontrada ou inativa.'));
    await abrirNovo();
    marcar('FONTE 003 · sem país');
    salvar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Fonte não encontrada ou inativa.');
    expect(campo('Nome').value).toBe('EVENTO 001');
    expect((screen.getByRole('checkbox', { name: 'FONTE 003 · sem país' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('edicao (um registro so)', () => {
  it('sem selecao multipla; o alcance continua editavel', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar o evento EVENTO 001' }));
    expect(screen.queryByRole('radio', { name: 'Países e/ou fontes escolhidos' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /fonte ativa/ })).toBeNull();
    expect(screen.queryByText('Buscar fonte')).toBeNull();
    expect((screen.getByRole('radio', { name: 'Todas as fontes' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radio', { name: 'Um país' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Uma fonte' })).toBeTruthy();
  });
});
