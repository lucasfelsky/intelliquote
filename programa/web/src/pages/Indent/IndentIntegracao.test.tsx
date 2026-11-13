import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentIntegracao from './IndentIntegracao';

// Integracao Pipedrive (mock v14, viewIntegracao): cabecalho, sincronizar, conexao, configuracao, mapeamento e a fila de vinculo (com o modal
// "Novo cliente"; o modal "Vincular a existente" tem o proprio arquivo). Dados FICTICIOS (ids 9xxxxx, "Funil Exemplo"); nada real do Pipedrive.

let mockRole = 'admin';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Exemplo', email: 'ana@exemplo.com.br', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

const STATUS_URL = '/api/v1/indent/pipedrive/status';
const OPTIONS_URL = '/api/v1/indent/pipedrive/options';
const CONFIG_URL = '/api/v1/indent/pipedrive/config';
const SYNC_URL = '/api/v1/indent/pipedrive/sync';

const STATUS = {
  configured: true,
  connection: 'ok',
  mode: 'polling',
  webhook: 'not_configured',
  connectionCheckedAt: '2026-11-12T12:42:00.000Z',
  lastSyncAt: '2026-11-12T12:42:00.000Z',
  lastSyncNewDeals: 2,
  lastSyncErrors: 0,
  pipelineId: 900001,
  pipelineName: 'Funil Exemplo',
  stageId: 900011,
  stageName: 'Coluna Exemplo A',
  slaBusinessDays: 2,
  pendingCount: 0,
  dailyTokensRemaining: 1_800_000,
  dailyTokensLimit: 2_000_000,
  intervalMinutes: 10,
};

const OPCOES = {
  pipelines: [
    { id: 900001, name: 'Funil Exemplo' },
    { id: 900002, name: 'Funil Exemplo Dois' },
  ],
  stages: [
    { id: 900011, name: 'Coluna Exemplo A', pipelineId: 900001 },
    { id: 900012, name: 'Coluna Exemplo B', pipelineId: 900001 },
  ],
  slaOptions: [1, 2, 3],
  current: { pipelineId: 900001, stageId: 900011, slaBusinessDays: 2 },
};

const OPCOES_FUNIL_2 = {
  ...OPCOES,
  stages: [{ id: 900021, name: 'Coluna Exemplo C', pipelineId: 900002 }],
};

const organizacao = (orgId: number, name: string, cnpj: string | null, city: string | null = null) => ({ orgId, name, cnpj, city });
const pendencia = (id: number, processNumber: string | null, dealId: number, candidates: unknown[]) => ({
  id,
  requestId: id - 490,
  processNumber,
  dealId,
  candidates,
  createdAt: '2026-11-12T12:00:00.000Z',
});
const ALFA = organizacao(900201, 'Cliente Exemplo Alfa Ltda', '11222333000181', 'Itajaí, SC');
const BETA = organizacao(900202, 'Cliente Exemplo Beta S.A.', null, 'Joinville, SC');
const GAMA = organizacao(900203, 'Cliente Exemplo Gama', '11444777000161');
const DELTA = organizacao(900204, 'Cliente Exemplo Delta', null);
const FILA = [
  pendencia(501, '276/26', 900101, [ALFA]),
  pendencia(502, '277/26', 900102, [BETA]),
  pendencia(503, null, 900103, [GAMA, DELTA]),
  pendencia(504, '278/26', 900104, []),
];

let status: Record<string, unknown> = STATUS;
let statusFalha: Error | null = null;
let fila: unknown[] = [];

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string, query?: Record<string, unknown>) => {
    if (url === STATUS_URL) {
      if (statusFalha) throw statusFalha;
      return status;
    }
    if (url === OPTIONS_URL) return query?.pipelineId === 900002 ? OPCOES_FUNIL_2 : OPCOES;
    if (url === '/api/v1/indent/pending-orgs') return { data: fila, total: fila.length };
    return {};
  }) as typeof api.get);
}

function renderTela() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IndentIntegracao />
    </QueryClientProvider>,
  );
}

const botaoSync = () => screen.getByRole('button', { name: /Sincroniza/ });

beforeEach(() => {
  mockRole = 'admin';
  status = STATUS;
  statusFalha = null;
  fila = [];
  // So o Date e falso (17:00 em Sao Paulo de 12/11/2026): "hoje as 09:42" fica deterministico sem travar os timers do React Query.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T20:00:00.000Z') });
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
  mockApi();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Integracao Pipedrive: cabecalho', () => {
  it('cabecalho: eyebrow "Administração", h1 e subtitulo do mock, botao primario com icone refresh', async () => {
    const { container } = renderTela();
    expect(container.querySelector('.page.indent-page.indent-integracao-page')).not.toBeNull();
    expect(container.querySelector('.page-header .eyebrow')?.textContent).toBe('Administração');
    expect(screen.getByRole('heading', { level: 1, name: 'Integração Pipedrive' })).toBeTruthy();
    expect(container.querySelector('.page-subtitle')?.textContent).toBe(
      'Conexão com o CRM da empresa para puxar as solicitações de cotação indent. Somente leitura.',
    );
    const botao = screen.getByRole('button', { name: 'Sincronizar agora' });
    expect(botao.className).toBe('primary-button');
    expect(botao.querySelector('svg')).not.toBeNull();
    await screen.findByText('Conectado ao Pipedrive');
  });
});

describe('Integracao Pipedrive: conexao', () => {
  it('conectado: ponto, titulo, ultima sincronizacao "hoje as HH:mm" com plural correto, tags e orcamento diario', async () => {
    const { container } = renderTela();
    expect(await screen.findByText('Conectado ao Pipedrive')).toBeTruthy();
    expect(screen.getByText('Última sincronização hoje às 09:42 · 2 negócios novos · 0 erros')).toBeTruthy();
    expect(container.querySelector('.indent-conn .indent-conn__ponto')?.className).toBe('indent-conn__ponto');
    expect(screen.getByText('Somente leitura').className).toContain('indent-tag');
    const consulta = screen.getByText('Consulta automática a cada 10 min');
    expect(consulta.className).toBe('indent-tag indent-tag--ok');
    expect(screen.queryByText('Webhook ativo')).toBeNull();
    expect(screen.getByText('Orçamento diário de chamadas: 1.800.000 de 2.000.000 restantes')).toBeTruthy();
  });

  it('singular (1 negócio novo · 1 erro) e data de outro dia em "dd/MM às HH:mm"', async () => {
    status = { ...STATUS, lastSyncAt: '2026-11-11T12:42:00.000Z', lastSyncNewDeals: 1, lastSyncErrors: 1 };
    renderTela();
    expect(await screen.findByText('Última sincronização 11/11 às 09:42 · 1 negócio novo · 1 erro')).toBeTruthy();
  });

  it('sem sincronizacao ainda e sem orcamento informado', async () => {
    status = { ...STATUS, lastSyncAt: null, dailyTokensRemaining: null, dailyTokensLimit: null };
    renderTela();
    expect(await screen.findByText('Nenhuma sincronização ainda.')).toBeTruthy();
    expect(screen.queryByText(/Orçamento diário de chamadas:/)).toBeNull();
  });

  it('webhook ativo (5b): a tag troca a "Consulta automatica" por "Webhook ativo"', async () => {
    status = { ...STATUS, webhook: 'active', mode: 'webhook' };
    renderTela();
    expect(await screen.findByText('Webhook ativo')).toBeTruthy();
    expect(screen.queryByText(/Consulta automática/)).toBeNull();
  });

  it.each([
    ['not_configured', 'Integração não configurada', 'neutro'],
    ['auth_failed', 'Falha de autenticação no Pipedrive', 'erro'],
    ['rate_limited', 'Limite de chamadas atingido', 'aviso'],
    ['budget_low', 'Orçamento diário de chamadas quase no fim', 'aviso'],
    ['config_mismatch', 'Funil ou coluna não conferem com o Pipedrive', 'erro'],
    ['error', 'Falha na última sincronização', 'erro'],
  ])('estado %s: titulo "%s" e ponto %s', async (connection, titulo, tom) => {
    status = { ...STATUS, connection, configured: connection !== 'not_configured' };
    const { container } = renderTela();
    expect(await screen.findByText(titulo)).toBeTruthy();
    expect(container.querySelector('.indent-conn__ponto')?.className).toBe(`indent-conn__ponto indent-conn__ponto--${tom}`);
    expect(screen.queryByText('Conectado ao Pipedrive')).toBeNull();
    // so o estado conectado mostra a linha da ultima sincronizacao
    expect(screen.queryByText(/Última sincronização/)).toBeNull();
  });

  it('falha de autenticacao: subtitulo orienta avisar o administrador; sem a tag de consulta automatica no "nao configurado"', async () => {
    status = { ...STATUS, connection: 'auth_failed' };
    const { unmount } = renderTela();
    expect(await screen.findByText('O token pode ter sido trocado ou revogado. Avise o administrador.')).toBeTruthy();
    unmount();
    status = { ...STATUS, connection: 'not_configured', configured: false };
    renderTela();
    await screen.findByText('Integração não configurada');
    expect(screen.queryByText(/Consulta automática/)).toBeNull();
    expect(screen.getByText('Somente leitura')).toBeTruthy();
  });

  it('erro ao carregar o estado: alerta com a mensagem do backend', async () => {
    statusFalha = new ApiError(500, { message: 'Falha interna.' }, 'Falha interna.');
    renderTela();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar o estado da integração: Falha interna.');
  });
});

describe('Integracao Pipedrive: sincronizar agora', () => {
  it('sucesso sem negocio novo: toast "nenhum negócio novo desde HH:mm" (hora da sincronizacao anterior) e o estado e relido', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ outcome: 'run_ok', processed: 3, created: 0, errors: 0, missed: 0, durationMs: 800 });
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    const chamadasAntes = vi.mocked(api.get).mock.calls.filter((c) => c[0] === STATUS_URL).length;
    fireEvent.click(botaoSync());
    expect(await screen.findByText('Pipedrive sincronizado: nenhum negócio novo desde 09:42')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith(SYNC_URL);
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter((c) => c[0] === STATUS_URL).length).toBeGreaterThan(chamadasAntes));
  });

  it('negocios novos: toast com plural correto; erros e pendentes entram no texto', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ outcome: 'run_ok', processed: 5, created: 1, errors: 2, missed: 3, durationMs: 800 });
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    fireEvent.click(botaoSync());
    expect(await screen.findByText('Pipedrive sincronizado: 1 negócio novo')).toBeTruthy();
    expect(screen.getByText('2 negócios com erro · 3 negócios ficaram para a próxima execução')).toBeTruthy();
  });

  it('varios negocios novos: "N negócios novos"', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ outcome: 'run_ok', processed: 5, created: 4, errors: 0, missed: 0, durationMs: 800 });
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    fireEvent.click(botaoSync());
    expect(await screen.findByText('Pipedrive sincronizado: 4 negócios novos')).toBeTruthy();
  });

  it('429 (limite do Pipedrive): alerta inline com a mensagem do backend', async () => {
    const mensagem = 'Limite de chamadas do Pipedrive atingido. Tente de novo em alguns minutos.';
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(429, { message: mensagem, outcome: 'rate_limited' }, mensagem));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    fireEvent.click(botaoSync());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(mensagem);
    expect(alerta.className).toContain('alert--warning');
  });

  it('409 em andamento / nao configurado: alerta inline de aviso com a mensagem do backend', async () => {
    const mensagem = 'Sincronização em andamento. Tente de novo em instantes.';
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { message: mensagem, outcome: 'in_progress' }, mensagem));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    fireEvent.click(botaoSync());
    expect((await screen.findByRole('alert')).textContent).toBe(mensagem);
  });

  it('502 (falha de autenticacao no Pipedrive): alerta de erro com a mensagem do backend e o estado e relido', async () => {
    const mensagem = 'Falha de autenticação no Pipedrive. O token pode ter sido trocado ou revogado. Avise o administrador.';
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(502, { message: mensagem, outcome: 'auth_failed' }, mensagem));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    status = { ...STATUS, connection: 'auth_failed' };
    fireEvent.click(botaoSync());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(mensagem);
    expect(alerta.className).toContain('alert--error');
    expect(await screen.findByText('Falha de autenticação no Pipedrive')).toBeTruthy();
  });

  it('timeout do Hosting (504 sem JSON): reconsulta o estado e, se a varredura terminou, mostra o toast de sucesso', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(504, { contentType: 'text/html', body: '<html>' }, 'Resposta não-JSON'));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    status = { ...STATUS, lastSyncAt: '2026-11-12T19:59:00.000Z', lastSyncNewDeals: 3, lastSyncErrors: 0 };
    fireEvent.click(botaoSync());
    expect(await screen.findByText('Pipedrive sincronizado: 3 negócios novos')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(await screen.findByText('Última sincronização hoje às 16:59 · 3 negócios novos · 0 erros')).toBeTruthy();
  });

  it('queda de rede sem avanco da ultima sincronizacao: aviso informativo (status), sem toast de sucesso e sem alerta de erro', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    fireEvent.click(botaoSync());
    const aviso = await screen.findByText(/A resposta demorou mais que o esperado/);
    expect(aviso.getAttribute('role')).toBe('status');
    expect(screen.queryByText(/^Pipedrive sincronizado/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('timeout e a reconsulta tambem falha: aviso de que o resultado nao pode ser confirmado', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(504, { contentType: 'text/html', body: '' }, 'Resposta não-JSON'));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    statusFalha = new ApiError(500, { message: 'x' }, 'x');
    fireEvent.click(botaoSync());
    expect(await screen.findByText(/Não foi possível confirmar o resultado da sincronização/)).toBeTruthy();
  });

  it('em andamento o botao mostra "Sincronizando…", fica aria-disabled (foco preservado) e ignora o segundo clique', async () => {
    let terminar: (valor: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => (terminar = resolve)));
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    const botao = botaoSync();
    botao.focus();
    fireEvent.click(botao);
    const ocupado = await screen.findByRole('button', { name: 'Sincronizando…' });
    expect(ocupado.getAttribute('aria-disabled')).toBe('true');
    expect(ocupado.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(ocupado);
    fireEvent.click(ocupado);
    expect(api.post).toHaveBeenCalledTimes(1);
    terminar({ outcome: 'run_ok', processed: 0, created: 0, errors: 0, missed: 0, durationMs: 1 });
    expect(await screen.findByText(/^Pipedrive sincronizado/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sincronizar agora' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('viewer le a tela mas o botao fica desabilitado', async () => {
    mockRole = 'viewer';
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    expect(botaoSync().hasAttribute('disabled')).toBe(true);
    fireEvent.click(botaoSync());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sem configuracao o botao fica desabilitado para quem pode escrever', async () => {
    status = { ...STATUS, configured: false, connection: 'not_configured' };
    renderTela();
    await screen.findByText('Integração não configurada');
    expect(botaoSync().hasAttribute('disabled')).toBe(true);
  });

  it.each(['comprador', 'gestor', 'admin'])('%s pode sincronizar', async (papel) => {
    mockRole = papel;
    vi.mocked(api.post).mockResolvedValueOnce({ outcome: 'run_ok', processed: 0, created: 0, errors: 0, missed: 0, durationMs: 1 });
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    expect(botaoSync().hasAttribute('disabled')).toBe(false);
  });
});

describe('Integracao Pipedrive: configuracao (O que vira solicitacao)', () => {
  it('admin: 3 selects rotulados com as opcoes ao vivo; prazo "1 dia útil", "2 dias úteis", "3 dias úteis"', async () => {
    renderTela();
    const funil = (await screen.findByLabelText('Funil')) as HTMLSelectElement;
    await waitFor(() => expect(funil.disabled).toBe(false));
    expect(Array.from(funil.options).map((o) => o.textContent)).toEqual(['Funil Exemplo', 'Funil Exemplo Dois']);
    expect(funil.value).toBe('900001');
    const coluna = screen.getByLabelText('Coluna de origem') as HTMLSelectElement;
    expect(Array.from(coluna.options).map((o) => o.textContent)).toEqual(['Coluna Exemplo A', 'Coluna Exemplo B']);
    expect(coluna.value).toBe('900011');
    const prazo = screen.getByLabelText('Prazo interno de resposta') as HTMLSelectElement;
    expect(Array.from(prazo.options).map((o) => o.textContent)).toEqual(['1 dia útil', '2 dias úteis', '3 dias úteis']);
    expect(prazo.value).toBe('2');
    expect(screen.getByRole('heading', { level: 2, name: 'O que vira solicitação' })).toBeTruthy();
  });

  it('trocar a coluna salva na hora (PUT com funil e coluna), toast "Configuração da integração salva" e o foco fica no select', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ ...STATUS, stageId: 900012, stageName: 'Coluna Exemplo B' });
    renderTela();
    const coluna = (await screen.findByLabelText('Coluna de origem')) as HTMLSelectElement;
    await waitFor(() => expect(coluna.disabled).toBe(false));
    coluna.focus();
    fireEvent.change(coluna, { target: { value: '900012' } });
    expect(await screen.findByText('Configuração da integração salva')).toBeTruthy();
    expect(api.put).toHaveBeenCalledWith(CONFIG_URL, { pipelineId: 900001, stageId: 900012 });
    expect(document.activeElement).toBe(coluna);
    await waitFor(() => expect((screen.getByLabelText('Coluna de origem') as HTMLSelectElement).value).toBe('900012'));
  });

  it('trocar o prazo salva com o funil e a coluna ja gravados; o texto do mapeamento acompanha o prazo salvo', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ ...STATUS, slaBusinessDays: 3 });
    renderTela();
    const prazo = (await screen.findByLabelText('Prazo interno de resposta')) as HTMLSelectElement;
    await waitFor(() => expect(prazo.disabled).toBe(false));
    fireEvent.change(prazo, { target: { value: '3' } });
    expect(await screen.findByText('Configuração da integração salva')).toBeTruthy();
    expect(api.put).toHaveBeenCalledWith(CONFIG_URL, { pipelineId: 900001, stageId: 900011, slaBusinessDays: 3 });
    expect(await screen.findByText(/Prazo interno de resposta de 3 dias úteis;/)).toBeTruthy();
  });

  it('funil novo: nada e salvo ate escolher a coluna (as colunas vem do funil escolhido); depois salva funil + coluna', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ ...STATUS, pipelineId: 900002, pipelineName: 'Funil Exemplo Dois', stageId: 900021, stageName: 'Coluna Exemplo C' });
    renderTela();
    const funil = (await screen.findByLabelText('Funil')) as HTMLSelectElement;
    await waitFor(() => expect(funil.disabled).toBe(false));
    fireEvent.change(funil, { target: { value: '900002' } });
    expect(api.put).not.toHaveBeenCalled();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(OPTIONS_URL, { pipelineId: 900002 }));
    const coluna = screen.getByLabelText('Coluna de origem') as HTMLSelectElement;
    await waitFor(() => expect(Array.from(coluna.options).map((o) => o.textContent)).toContain('Coluna Exemplo C'));
    expect(coluna.value).toBe('');
    expect(screen.getByText('Escolha a coluna do novo funil para salvar.')).toBeTruthy();
    // o prazo nao salva um funil sem coluna: o select continua com o funil gravado
    fireEvent.change(coluna, { target: { value: '900021' } });
    expect(await screen.findByText('Configuração da integração salva')).toBeTruthy();
    expect(api.put).toHaveBeenCalledWith(CONFIG_URL, { pipelineId: 900002, stageId: 900021 });
    await waitFor(() => expect(screen.queryByText('Escolha a coluna do novo funil para salvar.')).toBeNull());
  });

  it('voltar ao funil ja salvo descarta o rascunho', async () => {
    renderTela();
    const funil = (await screen.findByLabelText('Funil')) as HTMLSelectElement;
    await waitFor(() => expect(funil.disabled).toBe(false));
    fireEvent.change(funil, { target: { value: '900002' } });
    await screen.findByText('Escolha a coluna do novo funil para salvar.');
    fireEvent.change(funil, { target: { value: '900001' } });
    await waitFor(() => expect(screen.queryByText('Escolha a coluna do novo funil para salvar.')).toBeNull());
    expect((screen.getByLabelText('Coluna de origem') as HTMLSelectElement).value).toBe('900011');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('erro ao salvar (400 do backend): alerta inline com a mensagem e nenhum toast de sucesso', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new ApiError(400, { message: 'A coluna escolhida não pertence ao funil.' }, 'A coluna escolhida não pertence ao funil.'));
    renderTela();
    const coluna = (await screen.findByLabelText('Coluna de origem')) as HTMLSelectElement;
    await waitFor(() => expect(coluna.disabled).toBe(false));
    fireEvent.change(coluna, { target: { value: '900012' } });
    expect((await screen.findByRole('alert')).textContent).toBe('A coluna escolhida não pertence ao funil.');
    expect(screen.queryByText('Configuração da integração salva')).toBeNull();
  });

  it('opcoes indisponiveis (ex.: 502 do Pipedrive): alerta e selects desabilitados com o valor salvo', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === STATUS_URL) return STATUS;
      if (url === OPTIONS_URL) throw new ApiError(502, { message: 'O Pipedrive não respondeu como esperado. Tente de novo em alguns minutos.' }, 'x');
      return { data: [], total: 0 };
    }) as typeof api.get);
    renderTela();
    expect(await screen.findByText(/Não foi possível carregar as opções do Pipedrive: O Pipedrive não respondeu/)).toBeTruthy();
    const funil = (await screen.findByLabelText('Funil')) as HTMLSelectElement;
    expect(funil.disabled).toBe(true);
    expect(funil.selectedOptions[0]?.textContent).toBe('Funil Exemplo');
    expect((screen.getByLabelText('Coluna de origem') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Coluna Exemplo A');
  });

  it.each(['comprador', 'gestor', 'viewer'])('%s: selects desabilitados com o valor salvo e as opcoes ao vivo (rota so do admin) nem sao pedidas', async (papel) => {
    mockRole = papel;
    renderTela();
    const funil = (await screen.findByLabelText('Funil')) as HTMLSelectElement;
    await screen.findByText('Conectado ao Pipedrive');
    await waitFor(() => expect(funil.selectedOptions[0]?.textContent).toBe('Funil Exemplo'));
    expect(funil.disabled).toBe(true);
    expect((screen.getByLabelText('Coluna de origem') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Coluna de origem') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Coluna Exemplo A');
    const prazo = screen.getByLabelText('Prazo interno de resposta') as HTMLSelectElement;
    expect(prazo.disabled).toBe(true);
    expect(prazo.value).toBe('2');
    expect(vi.mocked(api.get).mock.calls.some((c) => c[0] === OPTIONS_URL)).toBe(false);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('Integracao Pipedrive: mapeamento', () => {
  it('tabela "Campo no Pipedrive | → | No IQ Indent" com as 6 linhas e subtextos do mock (sem a linha "Anexos")', async () => {
    const { container } = renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    const cabecalho = Array.from(container.querySelectorAll('.indent-mapa thead th')).map((th) => th.textContent);
    expect(cabecalho).toEqual(['Campo no Pipedrive', 'Corresponde a', 'No IQ Indent']);
    const linhas = Array.from(container.querySelectorAll('.indent-mapa tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
    );
    expect(linhas).toEqual([
      ['Organização', '→', 'ClienteCasa pelo CNPJ da organização; sem correspondência vai para a fila'],
      ['Título do negócio', '→', 'Número do processo (NNN/AA)Ex.: “274/26 INDENT - CLIENTE”. Prefixo “R2 -” indica revisão. Sem número, pede digitação'],
      [
        'Anotações do negócio',
        '→',
        'Itens da solicitaçãoPedido vem em texto livre; o sistema propõe os itens e o usuário confirma. Sem casamento no catálogo vira item livre',
      ],
      ['Proprietário', '→', 'Responsável'],
      ['Entrada na coluna', '→', 'Tempo na filaPrazo interno de resposta de 2 dias úteis; a data prevista de fechamento do negócio não é usada'],
      ['Tipo de negócio', '→', 'Tipo de negócioEx.: Contratipo'],
    ]);
    expect(screen.queryByText('Anexos')).toBeNull();
    expect(container.querySelectorAll('.indent-seta')).toHaveLength(6);
    expect(container.querySelector('.indent-mapa .indent-seta span')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('o prazo do mapeamento acompanha o prazo salvo: 1 dia útil (singular)', async () => {
    status = { ...STATUS, slaBusinessDays: 1 };
    renderTela();
    expect(await screen.findByText(/Prazo interno de resposta de 1 dia útil;/)).toBeTruthy();
  });

  it('o aside "Sugestões para esta tela" do mock fica de fora', async () => {
    const { container } = renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    expect(container.querySelector('aside')).toBeNull();
    expect(within(container).queryByText('Sugestões para esta tela')).toBeNull();
  });
});

const botoesDe = (nome: string) => screen.getAllByRole('button', { name: nome });

describe('Integracao Pipedrive: fila de vinculo', () => {
  it('fila: painel com tag "N pendentes", texto do mock, pendencias com 1 organizacao, sem CNPJ, varias e sem organizacao', async () => {
    fila = FILA;
    const { container } = renderTela();
    expect(await screen.findByRole('heading', { level: 2, name: 'Fila de vínculo' })).toBeTruthy();
    expect(await screen.findByText('4 pendentes')).toBeTruthy();
    expect(screen.getByText('Organizações do Pipedrive sem cliente cadastrado (sem CNPJ correspondente). As solicitações delas ficam paradas até o vínculo.')).toBeTruthy();
    const itens = Array.from(container.querySelectorAll('.indent-fila-item'));
    expect(itens).toHaveLength(4);
    // 1 organizacao: forte = nome; sub "Org #N · CNPJ ..." ou "Org #N · sem CNPJ"
    expect(itens[0]?.querySelector('strong')?.textContent).toBe('Cliente Exemplo Alfa Ltda');
    expect(itens[0]?.querySelector('small')?.textContent).toBe('Org #900201 · CNPJ 11.222.333/0001-81');
    expect(itens[1]?.querySelector('small')?.textContent).toBe('Org #900202 · sem CNPJ');
    // varias: forte "Solicitacao ...", sub "Pipedrive #id"
    expect(itens[2]?.querySelector('strong')?.textContent).toBe('Solicitação (referência pendente)');
    expect(itens[2]?.querySelector('.indent-fila-item__texto > small')?.textContent).toBe('Pipedrive #900103');
    // sem organizacao: so "Vincular a existente"
    expect(itens[3]?.querySelector('strong')?.textContent).toBe('Solicitação 278/26');
    expect(itens[3]?.querySelector('.indent-fila-item__texto > small')?.textContent).toBe('Pipedrive #900104 · negócio sem organização');
    expect(within(itens[3] as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Vincular a existente']);
    expect(within(itens[0] as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Vincular a existente', 'Criar cliente']);
  });

  it('fila vazia: tag "Em dia" e "Nenhuma pendência."', async () => {
    renderTela();
    expect(await screen.findByText('Nenhuma pendência.')).toBeTruthy();
    expect(screen.getByText('Em dia').className).toContain('indent-tag--ok');
    expect(screen.queryByText(/pendentes?$/)).toBeNull();
  });

  it('fila: 1 pendente no singular e aviso quando a lista vem cortada', async () => {
    fila = [FILA[0]];
    const { unmount } = renderTela();
    expect(await screen.findByText('1 pendente')).toBeTruthy();
    unmount();
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === STATUS_URL) return STATUS;
      if (url === OPTIONS_URL) return OPCOES;
      return { data: [FILA[0]], total: 250 };
    }) as typeof api.get);
    renderTela();
    expect(await screen.findByText('Mostrando as 1 mais antigas de 250 pendências.')).toBeTruthy();
  });

  it('varias organizacoes: fieldset com a pergunta do mock, radios (1a marcada) e a frase da solicitacao; o usuario escolhe, nunca vincula sozinha', async () => {
    fila = [FILA[2]];
    const { container } = renderTela();
    const grupo = (await screen.findByRole('group', { name: 'Negócio com 2 organizações. Qual é o cliente?' })) as HTMLElement;
    expect(grupo.tagName).toBe('FIELDSET');
    const gama = within(grupo).getByRole('radio', { name: /Cliente Exemplo Gama/ }) as HTMLInputElement;
    const delta = within(grupo).getByRole('radio', { name: /Cliente Exemplo Delta/ }) as HTMLInputElement;
    expect(gama.checked).toBe(true);
    expect(delta.checked).toBe(false);
    expect(gama.name).toBe('org-503');
    expect(within(grupo).getByText('Org #900203')).toBeTruthy();
    expect(within(grupo).getByText('Todas as organizações deste negócio vêm da mesma solicitação (referência pendente).')).toBeTruthy();
    fireEvent.click(delta);
    expect(delta.checked).toBe(true);
    expect(gama.checked).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.indent-orgopt')).toHaveLength(2);
  });

  it('varias com numero: "Solicitação NNN/AA" e a frase cita o numero', async () => {
    fila = [pendencia(505, '280/26', 900105, [GAMA, DELTA])];
    renderTela();
    expect(await screen.findByText('Solicitação 280/26')).toBeTruthy();
    expect(screen.getByText('Todas as organizações deste negócio vêm da mesma solicitação 280/26.')).toBeTruthy();
  });

  it('viewer le a fila mas sem botoes (e sem poder mexer nos radios)', async () => {
    mockRole = 'viewer';
    fila = FILA;
    renderTela();
    await screen.findByText('4 pendentes');
    expect(screen.queryByRole('button', { name: 'Vincular a existente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Criar cliente' })).toBeNull();
    expect((screen.getByRole('radio', { name: /Cliente Exemplo Gama/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('criar cliente com CNPJ valido na organizacao: cria direto, toast do mock e o foco volta para o titulo da fila', async () => {
    fila = [FILA[0]];
    vi.mocked(api.post).mockResolvedValueOnce({ client: { id: 7001, name: 'Cliente Exemplo Alfa Ltda', cnpj: '11222333000181', city: 'Itajaí, SC', pipedriveOrgId: 900201 }, resolved: [{ id: 501, requestId: 11 }] });
    renderTela();
    const botao = await screen.findByRole('button', { name: 'Criar cliente' });
    botao.focus();
    fila = [];
    fireEvent.click(botao);
    expect(await screen.findByText('Cliente “Cliente Exemplo Alfa Ltda” criado. Defina a restrição de fornecedores na aba Clientes')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/pending-orgs/501/create-client', { orgId: 900201 });
    expect(await screen.findByText('Nenhuma pendência.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Fila de vínculo' }));
  });

  it('criar cliente: erro do backend (CNPJ repetido, 409) aparece como alerta e o botao continua na tela com o foco', async () => {
    fila = [FILA[0]];
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { message: 'Já existe um cliente com este CNPJ.' }, 'Já existe um cliente com este CNPJ.'));
    renderTela();
    const botao = await screen.findByRole('button', { name: 'Criar cliente' });
    botao.focus();
    fireEvent.click(botao);
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe um cliente com este CNPJ.');
    expect(document.activeElement).toBe(botao);
  });

  it('criar cliente de varias organizacoes usa a escolhida: com CNPJ cria direto (orgId da escolhida)', async () => {
    fila = [FILA[2]];
    vi.mocked(api.post).mockResolvedValueOnce({ client: { id: 7005, name: 'Cliente Exemplo Gama', cnpj: '11444777000161', city: null, pipedriveOrgId: 900203 }, resolved: [] });
    renderTela();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar cliente' }));
    await screen.findByText(/^Cliente “Cliente Exemplo Gama” criado/);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/pending-orgs/503/create-client', { orgId: 900203 });
  });

  it('criar cliente sem CNPJ na organizacao: abre "Novo cliente" preenchido (razao social e cidade), CNPJ opcional, foco na razao social', async () => {
    fila = [FILA[1]];
    vi.mocked(api.post).mockResolvedValueOnce({ client: { id: 7006, name: 'Cliente Exemplo Beta S.A.', cnpj: null, city: 'Joinville, SC', pipedriveOrgId: 900202 }, resolved: [{ id: 502, requestId: 12 }] });
    renderTela();
    const origem = await screen.findByRole('button', { name: 'Criar cliente' });
    origem.focus();
    fireEvent.click(origem);
    const dialogo = await screen.findByRole('dialog', { name: 'Novo cliente' });
    const razao = within(dialogo).getByLabelText('Razão social') as HTMLInputElement;
    expect(razao.value).toBe('Cliente Exemplo Beta S.A.');
    expect(razao.hasAttribute('data-autofocus')).toBe(true);
    expect(document.activeElement).toBe(razao);
    expect((within(dialogo).getByLabelText('CNPJ') as HTMLInputElement).value).toBe('');
    expect(within(dialogo).getByText('Opcional. Sem CNPJ o cliente fica como CNPJ pendente.')).toBeTruthy();
    expect((within(dialogo).getByLabelText('Cidade') as HTMLInputElement).value).toBe('Joinville, SC');
    expect(within(dialogo).getByText(/A Org #900202 do Pipedrive será vinculada/)).toBeTruthy();
    expect(dialogo.querySelector('form.indent-form > .modal-actions:last-child')).not.toBeNull();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Cliente “Cliente Exemplo Beta S.A.” criado. Defina a restrição de fornecedores na aba Clientes')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/pending-orgs/502/create-client', { orgId: 900202, name: 'Cliente Exemplo Beta S.A.', city: 'Joinville, SC' });
  });

  it('criar cliente (Novo cliente): CNPJ digitado vai so em digitos; invalido e razao vazia sao barrados antes de enviar', async () => {
    fila = [FILA[1]];
    vi.mocked(api.post).mockResolvedValueOnce({ client: { id: 7007, name: 'Beta Exemplo', cnpj: '11222333000181', city: null, pipedriveOrgId: 900202 }, resolved: [] });
    renderTela();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar cliente' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Novo cliente' });
    fireEvent.change(within(dialogo).getByLabelText('Razão social'), { target: { value: '   ' } });
    fireEvent.change(within(dialogo).getByLabelText('CNPJ'), { target: { value: '11222333000180' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));
    expect((await within(dialogo).findAllByRole('alert')).map((a) => a.textContent)).toEqual(['Informe a razão social.', 'CNPJ inválido.']);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByLabelText('Razão social'), { target: { value: 'Beta Exemplo' } });
    fireEvent.change(within(dialogo).getByLabelText('CNPJ'), { target: { value: '11222333000181' } });
    expect((within(dialogo).getByLabelText('CNPJ') as HTMLInputElement).value).toBe('11.222.333/0001-81');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/indent/pending-orgs/502/create-client', { orgId: 900202, name: 'Beta Exemplo', cnpj: '11222333000181', city: 'Joinville, SC' }));
  });

  it('criar cliente (Novo cliente): erro do backend fica no modal; Cancelar fecha e devolve o foco ao botao', async () => {
    fila = [FILA[1]];
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { message: 'Já existe um cliente sem CNPJ com este nome.' }, 'x'));
    renderTela();
    const origem = await screen.findByRole('button', { name: 'Criar cliente' });
    origem.focus();
    fireEvent.click(origem);
    const dialogo = await screen.findByRole('dialog', { name: 'Novo cliente' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));
    expect((await within(dialogo).findByRole('alert')).textContent).toBe('Já existe um cliente sem CNPJ com este nome.');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo cliente' })).toBeNull());
    expect(document.activeElement).toBe(origem);
  });

  it('fila: nenhum botao usa --sm e a tela nunca fala com o Pipedrive (so rotas /api/v1/indent)', async () => {
    fila = FILA;
    const { container } = renderTela();
    await screen.findByText('4 pendentes');
    expect(container.querySelector('.ghost-button--sm')).toBeNull();
    expect(botoesDe('Vincular a existente')).toHaveLength(4);
    const urls = [api.get, api.post, api.put].flatMap((fn) => vi.mocked(fn).mock.calls.map((c) => String(c[0])));
    expect(urls.every((url) => url.startsWith('/api/v1/indent/'))).toBe(true);
  });
});
