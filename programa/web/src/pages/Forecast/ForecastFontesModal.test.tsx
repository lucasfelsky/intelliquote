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

const est = (media: number, chegadas = 12, poucas = false) => ({
  chegadas,
  media,
  mediana: media + 4,
  min: media - 10,
  max: media + 10,
  poucasChegadas: poucas,
});

// Dados 100% sinteticos.
const DADOS: ForecastPrazoReal = {
  quinzena: { id: 9, label: '11-1', baseDate: '2033-11-05' },
  disponivel: true,
  motivo: null,
  janelaDias: 365,
  minChegadas: 3,
  padraoEtdDias: 35,
  fontes: [
    { sourceId: 1, nome: 'FONTE A', leadTimeDays: 90, clearanceDays: 7, etdDiasUsado: 28, real: { po: est(92), etd: est(40) } },
    { sourceId: 2, nome: 'FONTE B', leadTimeDays: 60, clearanceDays: null, etdDiasUsado: 35, real: { po: est(102), etd: est(55) } },
    { sourceId: 3, nome: 'FONTE C', leadTimeDays: null, clearanceDays: null, etdDiasUsado: 35, real: { po: est(70, 2, true), etd: null } },
  ],
  semFonte: { chegadas: 4 },
};

let client: QueryClient;
const onFechar = vi.fn();

function renderModal(podeEditar: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastFontesModal podeEditar={podeEditar} onFechar={onFechar} />
    </QueryClientProvider>,
  );
}

const linhaDe = (nome: string) => screen.getByRole('rowheader', { name: nome }).closest('tr') as HTMLElement;
const nomesEmOrdem = () =>
  screen.getAllByRole('rowheader').map((th) => th.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: DADOS });
  patch.mockResolvedValue({ data: { id: 2, name: 'FONTE B', leadTimeDays: 100 } });
});

describe('ForecastFontesModal - leitura', () => {
  it('mostra o texto fixo, as colunas e as linhas ordenadas pela maior diferenca (sem dado no fim)', async () => {
    renderModal(false);
    expect(await screen.findByRole('heading', { name: 'Fontes e lead time' })).toBeTruthy();
    await screen.findByRole('table', { name: 'Lead time cadastrado e prazo real por fonte' });
    expect(
      screen.getByText(/Sugestão calculada das chegadas do FUP da quinzena 11-1 \(ETA FINAL nos últimos 365 dias\)\./),
    ).toBeTruthy();
    expect(screen.getByText(/O import da planilha \(aba LEADTIME\) sobrescreve o lead time das fontes que estão nela\./)).toBeTruthy();
    // B: |102 - 60| = 42; A: |92 - 90| = 2; C: poucas chegadas e sem lead time -> no fim.
    expect(nomesEmOrdem()).toEqual(['FONTE B', 'FONTE A', 'FONTE C']);
    expect(within(linhaDe('FONTE B')).getByText('102 dias (mediana 106 · 12 chegadas)')).toBeTruthy();
    expect(within(linhaDe('FONTE B')).getByText('+42 dias')).toBeTruthy();
    expect(within(linhaDe('FONTE A')).getByText('28 dias')).toBeTruthy(); // ETD + dias usado
    expect(screen.getByText('Chegadas sem fonte no cadastro: 4')).toBeTruthy();
  });

  it('viewer nao ve a coluna Acao nem o botao Editar', async () => {
    renderModal(false);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Editar lead time/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Ação' })).toBeNull();
  });

  it('poucas chegadas aparece como selo, sem a media', async () => {
    renderModal(false);
    await screen.findByRole('table');
    const c = within(linhaDe('FONTE C'));
    expect(c.getByText('poucas chegadas')).toBeTruthy();
    expect(c.queryByText(/70 dias/)).toBeNull();
  });

  it('sem quinzena DBCorp: texto de indisponivel e a tabela continua, com real em traco', async () => {
    get.mockResolvedValue({
      data: {
        ...DADOS,
        quinzena: null,
        disponivel: false,
        motivo: 'sem_quinzena_dbcorp',
        fontes: DADOS.fontes.map((f) => ({ ...f, real: null })),
        semFonte: { chegadas: 0 },
      } satisfies ForecastPrazoReal,
    });
    renderModal(true);
    expect(await screen.findByText('Importe uma quinzena pelos relatórios DBCorp para ver o prazo real.')).toBeTruthy();
    expect(within(linhaDe('FONTE A')).getByText('90 dias')).toBeTruthy();
    expect(screen.queryByText(/Chegadas sem fonte/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar lead time de FONTE A' })).toBeTruthy();
  });

  it('quinzena gravada antes do prazo real: explica e pede a proxima importacao', async () => {
    get.mockResolvedValue({
      data: {
        ...DADOS,
        disponivel: false,
        motivo: 'quinzena_sem_historico',
        fontes: DADOS.fontes.map((f) => ({ ...f, real: null })),
      } satisfies ForecastPrazoReal,
    });
    renderModal(false);
    expect(
      await screen.findByText(
        'A quinzena 11-1 foi importada antes do prazo real existir. Importe a próxima quinzena pelos relatórios DBCorp para ver o prazo real.',
      ),
    ).toBeTruthy();
  });

  it('erro na leitura: alerta e botao de tentar de novo', async () => {
    get.mockRejectedValueOnce(new ApiError(403, null));
    renderModal(false);
    expect(await screen.findByText('Seu perfil não tem acesso ao Forecast.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });
});

describe('ForecastFontesModal - edicao do lead time', () => {
  it('comprador edita: campo pre-preenchido, PATCH, invalida as fontes, confirma e devolve o foco', async () => {
    renderModal(true);
    await screen.findByRole('table');
    const invalidar = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: 'Editar lead time de FONTE B' }));
    const campo = screen.getByRole('textbox', { name: 'Lead time de FONTE B (dias)' }) as HTMLInputElement;
    expect(campo.value).toBe('60');
    fireEvent.change(campo, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/forecast/sources/2', { leadTimeDays: 100 }));
    expect(await screen.findByText('Lead time de FONTE B salvo: 100 dias.')).toBeTruthy();
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast', 'fontes'] });
    const botao = screen.getByRole('button', { name: 'Editar lead time de FONTE B' });
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });

  it('fonte sem lead time abre o campo vazio', async () => {
    renderModal(true);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Editar lead time de FONTE C' }));
    expect((screen.getByRole('textbox', { name: 'Lead time de FONTE C (dias)' }) as HTMLInputElement).value).toBe('');
  });

  it.each(['', '0', '1000', 'abc', '12,5'])('valor invalido %j nao chama o PATCH e mostra o erro acessivel', async (valor) => {
    renderModal(true);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Editar lead time de FONTE A' }));
    const campo = screen.getByRole('textbox', { name: 'Lead time de FONTE A (dias)' });
    fireEvent.change(campo, { target: { value: valor } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const erro = await screen.findByText('Informe o lead time em dias (1 a 999).');
    expect(patch).not.toHaveBeenCalled();
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe(erro.id);
  });

  it('erro 4xx do PATCH: alerta com a mensagem e o rascunho fica', async () => {
    patch.mockRejectedValueOnce(new ApiError(400, { message: 'Lead time invalido.' }, 'Lead time invalido.'));
    renderModal(true);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Editar lead time de FONTE A' }));
    const campo = screen.getByRole('textbox', { name: 'Lead time de FONTE A (dias)' }) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Lead time invalido.');
    expect((screen.getByRole('textbox', { name: 'Lead time de FONTE A (dias)' }) as HTMLInputElement).value).toBe('120');
    expect(screen.queryByText(/salvo:/)).toBeNull();
  });

  it('Cancelar volta ao valor cadastrado sem chamar o PATCH e devolve o foco ao botao', async () => {
    renderModal(true);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Editar lead time de FONTE A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(patch).not.toHaveBeenCalled();
    expect(within(linhaDe('FONTE A')).getByText('90 dias')).toBeTruthy();
    const botao = screen.getByRole('button', { name: 'Editar lead time de FONTE A' });
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });
});
