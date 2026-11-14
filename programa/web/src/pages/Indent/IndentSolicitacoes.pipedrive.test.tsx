import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CHAVES_APOS_ACAO } from '@/services/indentPipedrive';
import { formatarHora } from './indentFila';
import IndentSolicitacoes from './IndentSolicitacoes';
import { rotuloDoBotao, rotuloHa } from './IndentSolicitacoesPipedrive';

// IQ Indent (PR 5a.5): partes do Pipedrive na lista de Solicitacoes: botao "Pipedrive · funil · ha N min" (D10), "Abrir fila de vinculo" no alerta (D12),
// "Referencia pendente", "Itens a digitar" e o prazo interno (slaBusinessDays) no "Na fila ha". Dados FICTICIOS.

let mockRole = 'comprador';
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

type Obj = Record<string, unknown>;

const MIN = 60_000;

function status(extra: Obj = {}) {
  return {
    configured: true,
    connection: 'ok',
    mode: 'polling',
    webhook: 'not_configured',
    connectionCheckedAt: null,
    lastSyncAt: new Date(Date.now() - 3 * MIN).toISOString(),
    lastSyncNewDeals: 1,
    lastSyncErrors: 0,
    pipelineId: 900001,
    pipelineName: 'Funil Exemplo',
    stageId: 900011,
    stageName: 'Coluna Exemplo A',
    slaBusinessDays: 2,
    pendingCount: 0,
    dailyTokensRemaining: null,
    dailyTokensLimit: null,
    intervalMinutes: 10,
    ...extra,
  };
}

function linha(id: number, extra: Obj = {}) {
  return {
    id,
    processNumber: `${id}/26`,
    referencePending: false,
    createdAt: '2026-11-12T15:05:00.000Z',
    origin: 'PIPEDRIVE',
    pipedriveDealId: 900100 + id,
    ownerName: 'Vendedora Exemplo',
    status: 'NOVA',
    clientPending: false,
    client: { id: 3, name: 'Cliente Exemplo Alfa Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
    itemsSummary: { firstName: 'RESINA EXEMPLO 223 (RXE)', count: 1, totalKg: 2000 },
    quotes: { total: 0, answered: 0 },
    queueBusinessDays: 1,
    ...extra,
  };
}

let linhas: Obj[] = [linha(274)];
let counts: Obj = { todas: 1, pipedrive: 1, iq: 0, nova: 1, pendente: 0 };
let sla = 2;
let estado: Obj = status();

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/requests') {
      return {
        data: linhas,
        pagination: { page: 1, pageSize: 20, totalItems: linhas.length, totalPages: 1 },
        counts,
        kpis: { novas: 1, emCotacao: 0, respondidas: 0, convertidasNoMes: 0 },
        slaBusinessDays: sla,
      };
    }
    if (url === '/api/v1/indent/pipedrive/status') return estado;
    return [];
  }) as typeof api.get);
}

const chamadasDe = (url: string) => vi.mocked(api.get).mock.calls.filter((c) => c[0] === url).length;

function Sonda() {
  const location = useLocation();
  return <p data-testid="integracao">{location.pathname}</p>;
}

function renderPage(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/indent/solicitacoes']}>
          <Routes>
            <Route path="/indent/solicitacoes" element={<IndentSolicitacoes />} />
            <Route path="/indent/integracao" element={<Sonda />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockRole = 'comprador';
  linhas = [linha(274)];
  counts = { todas: 1, pipedrive: 1, iq: 0, nova: 1, pendente: 0 };
  sla = 2;
  estado = status();
  mockApi();
});

describe('rotulo do botao Pipedrive', () => {
  const agora = new Date('2026-11-13T15:00:00.000Z');
  const antes = (min: number) => new Date(agora.getTime() - min * MIN).toISOString();

  it('"há N min" cresce com o tempo: menos de 1 min, minutos, horas e dias (nunca negativo)', () => {
    expect(rotuloHa(antes(0), agora)).toBe('há menos de 1 min');
    expect(rotuloHa(antes(3), agora)).toBe('há 3 min');
    expect(rotuloHa(antes(59), agora)).toBe('há 59 min');
    expect(rotuloHa(antes(60), agora)).toBe('há 1 h');
    expect(rotuloHa(antes(23 * 60 + 59), agora)).toBe('há 23 h');
    expect(rotuloHa(antes(24 * 60), agora)).toBe('há 1 d');
    expect(rotuloHa(antes(-5), agora)).toBe('há menos de 1 min');
    expect(rotuloHa(null, agora)).toBeNull();
    expect(rotuloHa('lixo', agora)).toBeNull();
  });

  it('monta "Pipedrive · funil · há N min" so com as partes que existem', () => {
    const base = status({ lastSyncAt: antes(3) }) as never;
    expect(rotuloDoBotao(base, agora)).toBe('Pipedrive · Funil Exemplo · há 3 min');
    expect(rotuloDoBotao(status({ lastSyncAt: null }) as never, agora)).toBe('Pipedrive · Funil Exemplo · sem sincronização');
    expect(rotuloDoBotao(status({ lastSyncAt: null, pipelineName: null, configured: false }) as never, agora)).toBe('Pipedrive');
    expect(rotuloDoBotao(undefined, agora)).toBe('Pipedrive');
  });
});

describe('botao Pipedrive na lista (D10)', () => {
  it('fica antes de "Nova solicitação", e ghost padrao (sem --sm), com o icone de atualizar e o rotulo do estado', async () => {
    const { container } = renderPage();
    const botao = await screen.findByRole('button', { name: 'Pipedrive · Funil Exemplo · há 3 min' });

    const acoes = Array.from(container.querySelectorAll('.page-header__actions > button'));
    expect(acoes.map((el) => el.textContent)).toEqual(['Pipedrive · Funil Exemplo · há 3 min', 'Nova solicitação']);
    expect(botao.className).toBe('ghost-button');
    expect(botao.hasAttribute('title')).toBe(false);
    expect(botao.querySelector('svg')).not.toBeNull();
    expect((botao as HTMLButtonElement).disabled).toBe(false);
  });

  it('sem configuracao ou sem estado o botao fica desabilitado; o estado vem do backend (nunca chama o Pipedrive)', async () => {
    estado = status({ configured: false, connection: 'not_configured', pipelineName: null, lastSyncAt: null });
    renderPage();
    const botao = (await screen.findByRole('button', { name: 'Pipedrive' })) as HTMLButtonElement;
    await waitFor(() => expect(chamadasDe('/api/v1/indent/pipedrive/status')).toBe(1));
    expect(botao.disabled).toBe(true);
    // NB4: o botao desabilitado explica o porque
    expect(botao.getAttribute('title')).toBe('Integração não configurada');
    fireEvent.click(botao);
    expect(api.post).not.toHaveBeenCalled();
    expect(vi.mocked(api.get).mock.calls.every((c) => String(c[0]).startsWith('/api/v1/indent/'))).toBe(true);
  });

  it('viewer le a lista mas nao ve o botao nem pede o estado da integracao', async () => {
    mockRole = 'viewer';
    renderPage();
    await screen.findByText('274/26');
    expect(screen.queryByRole('button', { name: /^Pipedrive ·/ })).toBeNull();
    expect(chamadasDe('/api/v1/indent/pipedrive/status')).toBe(0);
  });

  it('o "há N min" avanca sozinho, sem nova consulta ao estado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      estado = status({ lastSyncAt: new Date(Date.now() - 3 * MIN).toISOString() });
      renderPage();
      await screen.findByRole('button', { name: 'Pipedrive · Funil Exemplo · há 3 min' });
      await act(async () => {
        vi.advanceTimersByTime(2 * MIN);
      });
      expect(screen.getByRole('button', { name: 'Pipedrive · Funil Exemplo · há 5 min' })).toBeTruthy();
      expect(chamadasDe('/api/v1/indent/pipedrive/status')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sincronizar pela lista', () => {
  it('chama POST /pipedrive/sync uma vez, mostra "Sincronizando…", toast com os novos e relê a lista e o estado', async () => {
    let liberar: (valor: unknown) => void = () => undefined;
    vi.mocked(api.post).mockImplementation((() =>
      new Promise<unknown>((resolve) => {
        liberar = (valor) => resolve(valor);
      })) as typeof api.post);
    renderPage();
    const botao = await screen.findByRole('button', { name: 'Pipedrive · Funil Exemplo · há 3 min' });
    const listasAntes = chamadasDe('/api/v1/indent/requests');
    botao.focus();
    fireEvent.click(botao);

    const ocupado = await screen.findByRole('button', { name: 'Sincronizando…' });
    expect(ocupado.getAttribute('aria-busy')).toBe('true');
    expect(ocupado.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(ocupado);
    // segundo clique durante a chamada: ignorado
    fireEvent.click(ocupado);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/pipedrive/sync');

    estado = status({ lastSyncAt: new Date().toISOString(), lastSyncNewDeals: 2 });
    await act(async () => liberar({ outcome: 'run_ok', processed: 2, created: 2, errors: 0, missed: 0, durationMs: 800 }));

    expect(await screen.findByText('Pipedrive sincronizado: 2 negócios novos')).toBeTruthy();
    await waitFor(() => expect(chamadasDe('/api/v1/indent/requests')).toBeGreaterThan(listasAntes));
    expect(await screen.findByRole('button', { name: 'Pipedrive · Funil Exemplo · há menos de 1 min' })).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Pipedrive');
  });

  it('nenhum negocio novo: "desde HH:mm" da ultima sincronizacao; erros e adiados entram no detalhe do toast', async () => {
    const ultima = new Date(Date.now() - 3 * MIN).toISOString();
    estado = status({ lastSyncAt: ultima });
    vi.mocked(api.post).mockResolvedValue({ outcome: 'run_ok', processed: 4, created: 0, errors: 1, missed: 2, durationMs: 800 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pipedrive · Funil Exemplo/ }));
    expect(await screen.findByText(`Pipedrive sincronizado: nenhum negócio novo desde ${formatarHora(ultima)}`)).toBeTruthy();
    expect(screen.getByText('1 negócio com erro · 2 negócios ficaram para a próxima execução')).toBeTruthy();
  });

  it.each([
    [409, 'Sincronização em andamento. Tente de novo em instantes.', 'alert--warning'],
    [429, 'Limite de chamadas do Pipedrive atingido. Tente de novo em alguns minutos.', 'alert--warning'],
    [502, 'O Pipedrive recusou o token da integração.', 'alert--error'],
  ])('resposta %s do backend vira alerta inline com a mensagem do servidor', async (http, mensagem, classe) => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(http, { message: mensagem }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Pipedrive · Funil Exemplo/ }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(mensagem);
    expect(alerta.className).toContain(classe);
    // o botao volta ao normal
    expect((await screen.findByRole('button', { name: /^Pipedrive · Funil Exemplo/ })).getAttribute('aria-busy')).toBeNull();
  });

  it('timeout do Hosting (sem resposta do backend): reconsulta o estado; sincronizacao nova vira toast, sem mudanca vira aviso informativo', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(504, { contentType: 'text/html', body: '<html>' }, 'Resposta não-JSON'));
    const antes = new Date(Date.now() - 20 * MIN).toISOString();
    estado = status({ lastSyncAt: antes });
    renderPage();
    const botao = await screen.findByRole('button', { name: /^Pipedrive · Funil Exemplo/ });

    // 1) a varredura gravou o resultado mesmo com a resposta perdida
    estado = status({ lastSyncAt: new Date().toISOString(), lastSyncNewDeals: 1 });
    fireEvent.click(botao);
    expect(await screen.findByText('Pipedrive sincronizado: 1 negócio novo')).toBeTruthy();

    // 2) nada mudou: o usuario e avisado de que a sincronizacao pode ainda estar em andamento
    fireEvent.click(await screen.findByRole('button', { name: /^Pipedrive · Funil Exemplo/ }));
    expect(await screen.findByText(/pode ainda estar em andamento/)).toBeTruthy();
  });

  it('depois de sincronizar, invalida status, fila de vinculo, solicitacoes e clientes (e NUNCA as opcoes ao vivo do Pipedrive)', async () => {
    expect(CHAVES_APOS_ACAO).toEqual([
      ['indent', 'pipedrive', 'status'],
      ['indent', 'pending-orgs'],
      ['indent', 'requests'],
      ['indent', 'clients'],
    ]);
    vi.mocked(api.post).mockResolvedValue({ outcome: 'run_ok', processed: 0, created: 0, errors: 0, missed: 0, durationMs: 10 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(qc, 'invalidateQueries');
    renderPage(qc);
    fireEvent.click(await screen.findByRole('button', { name: /^Pipedrive · Funil Exemplo/ }));
    await screen.findByText(/Pipedrive sincronizado/);
    await waitFor(() => expect(invalidar).toHaveBeenCalledTimes(4));
    expect(invalidar.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)).toEqual(CHAVES_APOS_ACAO.map((chave) => [...chave]));
    expect(invalidar.mock.calls.some((c) => JSON.stringify(c[0]).includes('options'))).toBe(false);
  });
});

describe('alerta de pendentes: "Abrir fila de vínculo" (D12)', () => {
  it('leva para /indent/integracao; o botao e o .ghost-button padrao (sem --sm) dentro do alerta com cadeado', async () => {
    counts = { todas: 1, pipedrive: 1, iq: 0, nova: 0, pendente: 2 };
    renderPage();
    const botao = await screen.findByRole('button', { name: 'Abrir fila de vínculo' });
    expect(botao.className).toBe('ghost-button');
    const alerta = botao.closest('.alert');
    expect(alerta?.className).toBe('alert alert--warning indent-alerta');
    expect(alerta?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(alerta?.querySelector('.indent-alerta__texto')?.textContent).toBe('2 solicitações aguardam vínculo de cliente antes de cotar.');

    fireEvent.click(botao);
    expect((await screen.findByTestId('integracao')).textContent).toBe('/indent/integracao');
  });

  it('sem pendentes nao ha alerta nem botao', async () => {
    renderPage();
    await screen.findByText('274/26');
    expect(screen.queryByRole('button', { name: 'Abrir fila de vínculo' })).toBeNull();
  });

  it('viewer tambem ve o alerta e pode abrir a fila (so le)', async () => {
    mockRole = 'viewer';
    counts = { todas: 1, pipedrive: 1, iq: 0, nova: 0, pendente: 1 };
    renderPage();
    expect(await screen.findByRole('button', { name: 'Abrir fila de vínculo' })).toBeTruthy();
  });
});

describe('linhas com Pipedrive', () => {
  it('"Referência pendente" (badge de aviso) no lugar do numero quando processNumber e nulo; a linha continua abrindo o detalhe', async () => {
    linhas = [linha(31, { processNumber: null, referencePending: true }), linha(274)];
    counts = { todas: 2, pipedrive: 2, iq: 0, nova: 2, pendente: 0 };
    const { container } = renderPage();
    const badge = await screen.findByText('Referência pendente');
    expect(badge.className).toBe('badge badge--warning');
    const primeira = badge.closest('tr') as HTMLElement;
    expect(primeira.querySelector('.indent-ref')).toBeNull();
    expect(primeira.textContent).toContain('12/11 12:05');
    expect(primeira.textContent).toContain('Pipedrive #900131');
    // a outra linha segue com o numero
    expect(container.querySelectorAll('.indent-ref').length).toBeGreaterThan(0);
    expect(screen.getByText('274/26').className).toBe('indent-ref');
  });

  it('"Itens a digitar" (tag de aviso) no lugar do resumo quando a nota nao deu itens', async () => {
    linhas = [linha(274, { itemsSummary: { firstName: null, count: 0, totalKg: 0 } })];
    renderPage();
    const tag = await screen.findByText('Itens a digitar');
    expect(tag.className).toBe('indent-tag indent-tag--manual');
    expect(screen.queryByText('0 kg no total')).toBeNull();
  });

  it.each([
    [2, 1, 'badge badge--muted', '1 dia'],
    [2, 2, 'badge badge--warning', '2 dias · no limite'],
    [2, 3, 'badge badge--danger', '3 dias · atrasada'],
    [3, 2, 'badge badge--muted', '2 dias'],
    [3, 3, 'badge badge--warning', '3 dias · no limite'],
    [1, 2, 'badge badge--danger', '2 dias · atrasada'],
  ])('prazo interno de %s dia(s) util(eis): fila de %s dia(s) = "%s" (%s)', async (prazo, dias, classe, texto) => {
    sla = prazo;
    linhas = [linha(274, { queueBusinessDays: dias })];
    renderPage();
    const selo = await screen.findByText(texto);
    expect(selo.className).toBe(classe);
  });
});
