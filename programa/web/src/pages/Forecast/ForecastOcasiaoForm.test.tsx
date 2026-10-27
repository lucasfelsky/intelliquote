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
  fireEvent.click(await screen.findByRole('button', { name: 'Novo evento' }));
}

async function abrirEdicao(nome: string) {
  renderPanel();
  fireEvent.click(await screen.findByRole('button', { name: `Editar o evento ${nome}` }));
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

describe('novo evento', () => {
  it('abre inline com o foco no titulo', async () => {
    await abrirNova();
    const titulo = screen.getByRole('heading', { name: 'Novo evento' });
    expect(document.activeElement).toBe(titulo);
    expect(screen.queryByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('enviar vazio: erros ligados aos campos e foco no Nome, sem chamar a API', async () => {
    await abrirNova();
    salvar();
    const nome = campo('Nome');
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    const erroId = nome.getAttribute('aria-describedby');
    expect(erroId).toBeTruthy();
    expect(document.getElementById(erroId as string)?.textContent).toBe('Informe o nome do evento.');
    expect(document.activeElement).toBe(nome);
    expect(screen.getByText('Informe a data de início.')).toBeTruthy();
    expect(screen.getByText('Informe a data de fim.')).toBeTruthy();
    expect(screen.getByText('Informe os dias como inteiro de 0 a 120.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('alcance escolhido sem nada marcado: erro e foco no 1o pais, sem chamar a API', async () => {
    await abrirNova();
    preencherValido();
    fireEvent.click(screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }));
    salvar();
    expect(screen.getByText('Marque ao menos um país ou uma fonte.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getAllByRole('checkbox')[0]);
    expect(post).not.toHaveBeenCalled();
  });

  it('"Outro" com xx: codigo nao reconhecido; com um codigo valido o pais entra marcado', async () => {
    await abrirNova();
    preencherValido();
    fireEvent.click(screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }));
    const codigo = screen.getByLabelText('Outro país (código ISO, 2 letras)') as HTMLInputElement;
    fireEvent.change(codigo, { target: { value: 'xx' } });
    expect(codigo.value).toBe('XX');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar país' }));
    expect(screen.getByText('Código de país não reconhecido. Confira o código ISO de 2 letras.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /^XX/ })).toBeNull();
    salvar();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(codigo, { target: { value: 'ar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar país' }));
    const argentina = screen.getByRole('checkbox', { name: 'Argentina (AR) · nenhuma fonte ativa' }) as HTMLInputElement;
    expect(argentina.checked).toBe(true);
    expect(codigo.value).toBe('');
  });

  it('paises da lista com a contagem de fontes ativas e a dica do pais sem fonte', async () => {
    await abrirNova();
    fireEvent.click(screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }));
    const china = screen.getByRole('checkbox', { name: /^China \(CN\) · 1 fonte ativa$/ }) as HTMLInputElement;
    const alemanha = screen.getByRole('checkbox', { name: 'Alemanha (DE) · nenhuma fonte ativa' }) as HTMLInputElement;
    fireEvent.click(china);
    expect(china.checked).toBe(true);
    expect(screen.getByText('Vale para: China (CN). Ao salvar, cria 1 registro (um por país ou fonte).')).toBeTruthy();
    fireEvent.click(alemanha);
    expect(
      screen.getByText('Nenhuma fonte ativa tem Alemanha (DE) ainda: informe o país das fontes na aba Lead time por fonte.'),
    ).toBeTruthy();
  });

  it('o texto regional e o da soma por cima aparecem no formulario', async () => {
    await abrirNova();
    // Uma vez no topo do painel e outra no formulario, logo abaixo do Alcance.
    expect(screen.getAllByText(/Eventos de regiões diferentes não se somam entre si/)).toHaveLength(2);
    expect(screen.getByText(/Dias a MAIS, somados por cima do lead time cadastrado da fonte/)).toBeTruthy();
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
    fireEvent.click(screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }));
    salvar();
    expect(screen.getByText('Marque ao menos um país ou uma fonte.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'FONTE B · sem país' }));
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
    expect(await screen.findByText('Evento OCASIAO NOVA cadastrado.')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Eventos estrangeiros que afetam o lead time' })).toBeTruthy();
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
    [400, 'Fonte não encontrada ou inativa.', 'Fonte não encontrada ou inativa.'],
    [
      409,
      // Texto do backend (que nao muda), ainda com "ocasi\u00e3o": o web mostra a versao traduzida.
      'Já existe uma ocasi\u00e3o ativa com o mesmo alcance, período e etapa. Edite a existente.',
      'Já existe um evento ativo com o mesmo alcance, período e etapa. Edite o existente.',
    ],
  ])('%i do servidor: alerta com a mensagem e rascunho preservado', async (status, mensagem, esperado) => {
    post.mockRejectedValue(new ApiError(status, { message: mensagem }, mensagem));
    await abrirNova();
    preencherValido();
    salvar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(esperado);
    expect(campo('Nome').value).toBe('OCASIAO NOVA');
    expect(campo('Dias a mais').value).toBe('3');
    expect(campo('Nome').disabled).toBe(false);
  });

  it('404 com corpo JSON: evento nao existe mais', async () => {
    post.mockRejectedValue(new ApiError(404, { message: 'Ocasião não encontrada.' }));
    await abrirNova();
    preencherValido();
    salvar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Este evento não existe mais (pode ter sido excluído). A lista foi atualizada.');
  });

  it('Cancelar devolve o foco ao botao de origem', async () => {
    await abrirNova();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const nova = await screen.findByRole('button', { name: 'Novo evento' });
    await waitFor(() => expect(document.activeElement).toBe(nova));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('editar', () => {
  it('campos pre-preenchidos e PATCH so com o que mudou', async () => {
    await abrirEdicao('OCASIAO SINTETICA 1');
    expect(screen.getByRole('heading', { name: 'Editar o evento OCASIAO SINTETICA 1' })).toBeTruthy();
    expect(campo('Nome').value).toBe('OCASIAO SINTETICA 1');
    expect(campo('Início').value).toBe('2027-02-17');
    expect(campo('Fim').value).toBe('2027-02-25');
    expect(campo('Dias a mais').value).toBe('3');
    digitar('Dias a mais', '5');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/1`, { effectKind: 'dias', effectValue: 5 });
    expect(await screen.findByText('Evento OCASIAO SINTETICA 1 atualizado.')).toBeTruthy();
  });

  it('um registro so: sem selecao multipla, mas o alcance continua editavel (outro pais)', async () => {
    await abrirEdicao('OCASIAO SINTETICA 1');
    expect(screen.queryByRole('radio', { name: 'Países e/ou fontes escolhidos' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /China/ })).toBeNull();
    expect((screen.getByRole('radio', { name: 'Todas as fontes' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Um país' }));
    digitar('País', 'CN');
    expect(screen.getByText('1 fonte ativa com este país.')).toBeTruthy();
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/1`, { scopeType: 'pais', countryCode: 'CN', sourceId: null });
  });

  it('um registro so: troca para uma fonte unica pelo select', async () => {
    await abrirEdicao('OCASIAO SINTETICA 1');
    fireEvent.click(screen.getByRole('radio', { name: 'Uma fonte' }));
    digitar('Fonte', '2');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/1`, { scopeType: 'fonte', countryCode: null, sourceId: 2 });
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
        'Este evento usa percentual, que a tela não edita. O efeito fica como está; os demais campos podem ser alterados.',
      ),
    ).toBeTruthy();
    digitar('Nome', 'NOME NOVO');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/5`, { name: 'NOME NOVO' });
  });
});

describe('editar o que nao mudou', () => {
  it('so o nome de evento com pais desconhecido do Intl: sem erro de pais e PATCH so com o nome', async () => {
    lista = [oc({ id: 7, name: 'OCASIAO SINTETICA 7', scopeType: 'pais', countryCode: 'XX' })];
    await abrirEdicao('OCASIAO SINTETICA 7');
    digitar('Nome', 'NOME NOVO');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/7`, { name: 'NOME NOVO' });
    expect(screen.queryByText(/não reconhecido/)).toBeNull();
  });

  it('so o nome de evento de fonte removida: nao exige escolher fonte', async () => {
    lista = [oc({ id: 8, name: 'OCASIAO SINTETICA 8', scopeType: 'fonte', sourceId: null, source: null })];
    await abrirEdicao('OCASIAO SINTETICA 8');
    digitar('Nome', 'NOME NOVO');
    salvar();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(`${URL_EVENTOS}/8`, { name: 'NOME NOVO' });
  });
});

describe('modelo', () => {
  it('Ano Novo chines 2027 preenche o formulario sem gravar nada', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Novo evento' });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'ano-novo-chines' } });
    const anos = screen.getAllByLabelText('Ano');
    fireEvent.change(anos[0] as HTMLElement, { target: { value: '2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preencher o formulário' }));

    expect(screen.getByRole('heading', { name: 'Novo evento a partir do modelo Ano Novo chinês' })).toBeTruthy();
    expect(campo('Nome').value).toBe('Ano Novo chinês 2027');
    expect((screen.getByRole('radio', { name: 'Países e/ou fontes escolhidos' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /^China \(CN\)/ }) as HTMLInputElement).checked).toBe(true);
    expect(campo('Início').value).toBe('2027-01-30');
    expect(campo('Fim').value).toBe('2027-02-20');
    expect(campo('Etapa afetada').value).toBe('prontidao');
    expect(campo('Dias a mais').value).toBe('14');
    expect(campo('Repete todo ano').disabled).toBe(true);
    expect(campo('Repete todo ano').checked).toBe(false);
    expect(screen.getByText('Data móvel: cadastre um evento por ano.')).toBeTruthy();
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

  it('modelo sem pais pede um ou mais paises e o salvar so ocorre depois de escolher', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Novo evento' });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'ferias-agosto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preencher o formulário' }));
    expect(screen.getByText('Escolha um ou mais países.')).toBeTruthy();
    salvar();
    expect(screen.getByText('Marque ao menos um país ou uma fonte.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alemanha (DE) · nenhuma fonte ativa' }));
    salvar();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      name: 'Férias de verão europeias (agosto)',
      scopeType: 'pais',
      countryCode: 'DE',
      recurrence: 'anual',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
  });
});
