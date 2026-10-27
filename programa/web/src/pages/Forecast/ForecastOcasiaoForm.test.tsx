import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const patch = vi.mocked(api.patch);

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

// Dados 100% sinteticos.
const A = oc({ id: 1, name: 'OCASIAO SINTETICA 1' });
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
];

let lista: ForecastOcasiao[];

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastOcasioesPanel podeEditar hoje={HOJE} />
    </QueryClientProvider>,
  );
}

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
const digitar = (rotulo: string, valor: string) => fireEvent.change(campo(rotulo), { target: { value: valor } });
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

async function abrirNova() {
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Nova ocasião' }));
}

async function abrirEdicao(nome: string) {
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: `Editar a ocasião ${nome}` }));
}

function preencherValido() {
  digitar('Nome', 'OCASIAO NOVA');
  digitar('Início', '2027-02-01');
  digitar('Fim', '2027-02-03');
  digitar('Dias a mais', '3');
}

beforeEach(() => {
  vi.clearAllMocks();
  lista = [A, E];
  get.mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/v1/forecast/sources') return { data: FONTES };
    if (path === URL_EVENTOS && query === undefined) return { data: lista };
    if (path === URL_EVENTOS) return { data: [] };
    throw new Error(`GET inesperado: ${path}`);
  });
  post.mockResolvedValue({ data: { id: 99 } });
  patch.mockResolvedValue({ data: { id: 1 } });
});

describe('nova ocasiao', () => {
  it('abre inline com o foco no titulo', async () => {
    await abrirNova();
    const titulo = screen.getByRole('heading', { name: 'Nova ocasião' });
    expect(document.activeElement).toBe(titulo);
    expect(screen.queryByRole('table', { name: 'Ocasiões que afetam o lead time' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('enviar vazio: erros ligados aos campos e foco no Nome, sem chamar a API', async () => {
    await abrirNova();
    salvar();
    const nome = campo('Nome');
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    const erroId = nome.getAttribute('aria-describedby');
    expect(erroId).toBeTruthy();
    expect(document.getElementById(erroId as string)?.textContent).toBe('Informe o nome da ocasião.');
    expect(document.activeElement).toBe(nome);
    expect(screen.getByText('Informe a data de início.')).toBeTruthy();
    expect(screen.getByText('Informe a data de fim.')).toBeTruthy();
    expect(screen.getByText('Informe os dias como inteiro de 0 a 120.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('escopo pais sem pais', async () => {
    await abrirNova();
    preencherValido();
    fireEvent.click(screen.getByRole('radio', { name: 'Um país' }));
    salvar();
    expect(screen.getByText('Informe o país da ocasião.')).toBeTruthy();
    expect(campo('País').getAttribute('aria-invalid')).toBe('true');
    expect(post).not.toHaveBeenCalled();
  });

  it('"Outro (codigo ISO)" com xx: codigo nao reconhecido', async () => {
    await abrirNova();
    preencherValido();
    fireEvent.click(screen.getByRole('radio', { name: 'Um país' }));
    digitar('País', '__outro');
    const codigo = screen.getByLabelText('Código ISO do país (2 letras)') as HTMLInputElement;
    fireEvent.change(codigo, { target: { value: 'xx' } });
    expect(codigo.value).toBe('XX');
    salvar();
    expect(screen.getByText('Código de país não reconhecido. Confira o código ISO de 2 letras.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('pais da lista e dica de quantas fontes ativas o tem', async () => {
    await abrirNova();
    fireEvent.click(screen.getByRole('radio', { name: 'Um país' }));
    digitar('País', 'CN');
    expect(screen.getByText('1 fonte ativa com este país.')).toBeTruthy();
    digitar('País', 'DE');
    expect(
      screen.getByText('Nenhuma fonte ativa tem este país ainda: informe o país das fontes na aba Lead time por fonte.'),
    ).toBeTruthy();
  });

  it('fim antes do inicio, 121 dias de periodo e 121 dias de efeito', async () => {
    await abrirNova();
    preencherValido();
    digitar('Início', '2027-02-10');
    digitar('Fim', '2027-02-09');
    salvar();
    expect(screen.getByText('O fim não pode ser anterior ao início.')).toBeTruthy();

    digitar('Início', '2027-01-01');
    digitar('Fim', '2027-05-01');
    salvar();
    expect(screen.getByText('O período aceita no máximo 120 dias.')).toBeTruthy();

    digitar('Fim', '2027-04-30');
    digitar('Dias a mais', '121');
    salvar();
    expect(screen.getByText('Informe os dias como inteiro de 0 a 120.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('fonte: escolha obrigatoria entre as ativas', async () => {
    await abrirNova();
    preencherValido();
    fireEvent.click(screen.getByRole('radio', { name: 'Uma fonte' }));
    salvar();
    expect(screen.getByText('Informe a fonte da ocasião.')).toBeTruthy();
    digitar('Fonte', '2');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ scopeType: 'fonte', sourceId: 2, countryCode: null });
  });

  it('POST com o corpo exato, aviso e volta para a lista', async () => {
    await abrirNova();
    preencherValido();
    digitar('Etapa afetada', 'prontidao');
    digitar('Observação (opcional)', '  nota sintetica  ');
    fireEvent.click(screen.getByLabelText('Repete todo ano'));
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(URL_EVENTOS, {
      name: 'OCASIAO NOVA',
      scopeType: 'global',
      countryCode: null,
      sourceId: null,
      startDate: '2027-02-01',
      endDate: '2027-02-03',
      recurrence: 'anual',
      component: 'prontidao',
      effectKind: 'dias',
      effectValue: 3,
      notes: 'nota sintetica',
    });
    expect(await screen.findByText('Ocasião OCASIAO NOVA cadastrada.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Ocasiões que afetam o lead time' })).toBeTruthy();
  });

  it('com a promessa pendente: campos e botoes desabilitados e aria-busy', async () => {
    post.mockImplementation(() => new Promise(() => undefined));
    await abrirNova();
    preencherValido();
    salvar();
    const botao = await screen.findByRole('button', { name: 'Salvando…' });
    expect(botao.getAttribute('aria-busy')).toBe('true');
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(campo('Nome').disabled).toBe(true);
    expect(campo('Dias a mais').disabled).toBe(true);
  });

  it.each([
    [400, 'Fonte não encontrada ou inativa.'],
    [409, 'Já existe uma ocasião ativa com o mesmo alcance, período e etapa. Edite a existente.'],
  ])('%i do servidor: alerta com a mensagem e rascunho preservado', async (status, mensagem) => {
    post.mockRejectedValue(new ApiError(status, { message: mensagem }, mensagem));
    await abrirNova();
    preencherValido();
    salvar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(mensagem);
    expect(campo('Nome').value).toBe('OCASIAO NOVA');
    expect(campo('Dias a mais').value).toBe('3');
    expect(campo('Nome').disabled).toBe(false);
  });

  it('404 com corpo JSON: ocasiao nao existe mais', async () => {
    post.mockRejectedValue(new ApiError(404, { message: 'Ocasião não encontrada.' }));
    await abrirNova();
    preencherValido();
    salvar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Esta ocasião não existe mais (pode ter sido excluída). A lista foi atualizada.');
  });

  it('Cancelar devolve o foco ao botao de origem', async () => {
    await abrirNova();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const nova = await screen.findByRole('button', { name: 'Nova ocasião' });
    await waitFor(() => expect(document.activeElement).toBe(nova));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('editar', () => {
  it('campos pre-preenchidos e PATCH so com o que mudou', async () => {
    await abrirEdicao('OCASIAO SINTETICA 1');
    expect(screen.getByRole('heading', { name: 'Editar a ocasião OCASIAO SINTETICA 1' })).toBeTruthy();
    expect(campo('Nome').value).toBe('OCASIAO SINTETICA 1');
    expect(campo('Início').value).toBe('2027-02-17');
    expect(campo('Fim').value).toBe('2027-02-25');
    expect(campo('Dias a mais').value).toBe('3');
    digitar('Dias a mais', '5');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/1`, { effectKind: 'dias', effectValue: 5 });
    expect(await screen.findByText('Ocasião OCASIAO SINTETICA 1 atualizada.')).toBeTruthy();
  });

  it('sem mudanca: aviso e nenhuma chamada', async () => {
    await abrirEdicao('OCASIAO SINTETICA 1');
    salvar();
    expect(screen.getByText('Nenhuma alteração para salvar.')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('percentual: sem campo de dias, aviso e PATCH sem efeito', async () => {
    await abrirEdicao('OCASIAO SINTETICA 5');
    expect(screen.queryByLabelText('Dias a mais')).toBeNull();
    expect(screen.getByText('Efeito: +12,5% da etapa')).toBeTruthy();
    expect(
      screen.getByText(
        'Esta ocasião usa percentual, que a tela não edita. O efeito fica como está; os demais campos podem ser alterados.',
      ),
    ).toBeTruthy();
    digitar('Nome', 'NOME NOVO');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/5`, { name: 'NOME NOVO' });
  });
});

describe('modelo', () => {
  it('Ano Novo chines 2027 preenche o formulario sem gravar nada', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Nova ocasião' });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'ano-novo-chines' } });
    const anos = screen.getAllByLabelText('Ano');
    fireEvent.change(anos[0] as HTMLElement, { target: { value: '2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preencher o formulário' }));

    expect(screen.getByRole('heading', { name: 'Nova ocasião a partir do modelo Ano Novo chinês' })).toBeTruthy();
    expect(campo('Nome').value).toBe('Ano Novo chinês 2027');
    expect((screen.getByRole('radio', { name: 'Um país' }) as HTMLInputElement).checked).toBe(true);
    expect(campo('País').value).toBe('CN');
    expect(campo('Início').value).toBe('2027-01-30');
    expect(campo('Fim').value).toBe('2027-02-20');
    expect(campo('Etapa afetada').value).toBe('prontidao');
    expect(campo('Dias a mais').value).toBe('14');
    expect(campo('Repete todo ano').disabled).toBe(true);
    expect(campo('Repete todo ano').checked).toBe(false);
    expect(screen.getByText('Data móvel: cadastre uma ocasião por ano.')).toBeTruthy();
    expect(
      screen.getByText('Confirme a data no calendário oficial. A tabela do Ano Novo chinês cobre até 2032.'),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    // Cancelar volta ao botao que abriu o formulario.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const preencher = await screen.findByRole('button', { name: 'Preencher o formulário' });
    await waitFor(() => expect(document.activeElement).toBe(preencher));
    expect(post).not.toHaveBeenCalled();
  });

  it('modelo sem pais pede o pais e o salvar so ocorre depois de escolher', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Nova ocasião' });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'primeiro-maio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preencher o formulário' }));
    expect(screen.getByText('Escolha o país.')).toBeTruthy();
    salvar();
    expect(screen.getByText('Informe o país da ocasião.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    digitar('País', 'DE');
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      name: 'Dia do Trabalho (1º de maio)',
      scopeType: 'pais',
      countryCode: 'DE',
      recurrence: 'anual',
      startDate: '2026-05-01',
      endDate: '2026-05-01',
    });
  });
});
