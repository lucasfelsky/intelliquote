import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentIntegracao from './IndentIntegracao';

// Integracao Pipedrive: opcoes ao vivo (D88) e reconsultas estreitas depois de sincronizar/vincular (NB3). Dados FICTICIOS (ids 9xxxxx).

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Exemplo', email: 'ana@exemplo.com.br', role: 'admin' } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? 'HTTP ' + status);
      this.status = status;
      this.body = body;
    }
  },
}));

import { api, ApiError } from '@/api/client';

const STATUS_URL = '/api/v1/indent/pipedrive/status';
const OPTIONS_URL = '/api/v1/indent/pipedrive/options';
const CONFIG_URL = '/api/v1/indent/pipedrive/config';

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

const FILA = [
  {
    id: 501,
    requestId: 11,
    processNumber: '276/26',
    dealId: 900101,
    candidates: [{ orgId: 900201, name: 'Cliente Exemplo Alfa Ltda', cnpj: '11222333000181', city: 'Itajaí, SC' }],
    createdAt: '2026-11-12T12:00:00.000Z',
  },
];

let status: Record<string, unknown> = STATUS;
let fila: unknown[] = [];

function renderTela() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IndentIntegracao />
    </QueryClientProvider>,
  );
}

const botaoSync = () => screen.getByRole('button', { name: /Sincroniza/ });
const chamadasDaFila = () => vi.mocked(api.get).mock.calls.filter((c) => c[0] === '/api/v1/indent/pending-orgs').length;

beforeEach(() => {
  status = STATUS;
  fila = [];
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === STATUS_URL) return status;
    if (url === OPTIONS_URL) return OPCOES;
    if (url === '/api/v1/indent/pending-orgs') return { data: fila, total: fila.length };
    return {};
  }) as typeof api.get);
});

const chamadasDeOpcoes = () => vi.mocked(api.get).mock.calls.filter((c) => c[0] === OPTIONS_URL).length;

// D88: o estado ja explica a falha; NB3: sincronizar/vincular nao rechama as opcoes (chamada ao vivo ao Pipedrive).
describe('Integracao Pipedrive: opcoes ao vivo e reconsultas', () => {
  it.each(['not_configured', 'auth_failed'])('admin com a conexao %s: as opcoes nem sao pedidas e nenhum alerta duplica o estado', async (connection) => {
    status = { ...STATUS, connection, configured: connection !== 'not_configured' };
    renderTela();
    await screen.findByText(connection === 'auth_failed' ? 'Falha de autenticação no Pipedrive' : 'Integração não configurada');
    await waitFor(() => expect((screen.getByLabelText('Funil') as HTMLSelectElement).disabled).toBe(true));
    expect(chamadasDeOpcoes()).toBe(0);
    expect(screen.queryByText(/Não foi possível carregar as opções do Pipedrive/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('admin com a conexao rate_limited: so o estado aparece (falha das opcoes nao vira alerta)', async () => {
    status = { ...STATUS, connection: 'rate_limited' };
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === STATUS_URL) return status;
      if (url === OPTIONS_URL) throw new ApiError(429, { message: 'Limite de chamadas do Pipedrive atingido. Tente de novo em alguns minutos.' }, 'x');
      return { data: [], total: 0 };
    }) as typeof api.get);
    renderTela();
    await screen.findByText('Limite de chamadas atingido');
    await waitFor(() => expect(chamadasDeOpcoes()).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(/Não foi possível carregar as opções/)).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha real e inesperada das opcoes (502 com a conexao ok): o alerta aparece uma vez', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === STATUS_URL) return STATUS;
      if (url === OPTIONS_URL) throw new ApiError(502, { message: 'O Pipedrive não respondeu como esperado.' }, 'x');
      return { data: [], total: 0 };
    }) as typeof api.get);
    renderTela();
    expect(await screen.findAllByText(/Não foi possível carregar as opções do Pipedrive: O Pipedrive não respondeu/)).toHaveLength(1);
  });

  it('sincronizar reconsulta estado e fila, mas NAO rechama as opcoes ao vivo', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ outcome: 'run_ok', processed: 1, created: 1, errors: 0, missed: 0, durationMs: 5 });
    renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    await waitFor(() => expect(chamadasDeOpcoes()).toBe(1));
    const estado = () => vi.mocked(api.get).mock.calls.filter((c) => c[0] === STATUS_URL).length;
    const antes = estado();
    fireEvent.click(botaoSync());
    await screen.findByText('Pipedrive sincronizado: 1 negócio novo');
    await waitFor(() => expect(estado()).toBeGreaterThan(antes));
    expect(chamadasDeOpcoes()).toBe(1);
  });

  it('vincular a existente nao rechama as opcoes ao vivo', async () => {
    fila = [FILA[0]];
    const base = vi.mocked(api.get).getMockImplementation() as (url: string, query?: Record<string, unknown>) => Promise<unknown>;
    vi.mocked(api.get).mockImplementation((async (url: string, query?: Record<string, unknown>) =>
      url === '/api/v1/indent/clients'
        ? { data: [{ id: 7001, name: 'Cliente Exemplo X', cnpj: '11222333000181', city: null, pipedriveOrgId: null }], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }, counts: { todos: 1, semCnpj: 0 } }
        : base(url, query)) as typeof api.get);
    vi.mocked(api.post).mockResolvedValueOnce({ client: { id: 7001, name: 'Cliente Exemplo X', cnpj: '11222333000181', city: null, pipedriveOrgId: 900201 }, cnpjCompleted: false, cnpjDivergente: false, resolved: [] });
    renderTela();
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a existente' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Cliente Exemplo X/ }));
    await waitFor(() => expect(chamadasDeOpcoes()).toBe(1));
    fila = [];
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await screen.findByText('Organização vinculada a Cliente Exemplo X');
    expect(await screen.findByText('Nenhuma pendência.')).toBeTruthy();
    expect(chamadasDeOpcoes()).toBe(1);
  });

  it('criar cliente direto com 409 "Pendência já resolvida.": a fila e relida', async () => {
    fila = [FILA[0]];
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { message: 'Pendência já resolvida.' }, 'x'));
    renderTela();
    const botao = await screen.findByRole('button', { name: 'Criar cliente' });
    await waitFor(() => expect(chamadasDaFila()).toBeGreaterThan(0));
    const antes = chamadasDaFila();
    fila = [];
    fireEvent.click(botao);
    expect((await screen.findByText('Pendência já resolvida.')).getAttribute('role')).toBe('alert');
    await waitFor(() => expect(chamadasDaFila()).toBeGreaterThan(antes));
    expect(await screen.findByText('Nenhuma pendência.')).toBeTruthy();
  });

  it('trocar so o prazo com um funil novo ainda sem coluna NAO descarta o rascunho do funil', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ ...STATUS, slaBusinessDays: 3 });
    renderTela();
    const funil = (await screen.findByLabelText('Funil')) as HTMLSelectElement;
    await waitFor(() => expect(funil.disabled).toBe(false));
    fireEvent.change(funil, { target: { value: '900002' } });
    await screen.findByText('Escolha a coluna do novo funil para salvar.');
    fireEvent.change(screen.getByLabelText('Prazo interno de resposta'), { target: { value: '3' } });
    expect(await screen.findByText('Configuração da integração salva')).toBeTruthy();
    expect(api.put).toHaveBeenCalledWith(CONFIG_URL, { pipelineId: 900001, stageId: 900011, slaBusinessDays: 3 });
    expect(screen.getByText('Escolha a coluna do novo funil para salvar.')).toBeTruthy();
    expect((screen.getByLabelText('Funil') as HTMLSelectElement).value).toBe('900002');
  });
});
