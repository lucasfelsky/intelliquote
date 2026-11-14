import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { classesDoSeletor, parseRules, readSource, regioes, stripComments } from '@/test/rfCss';
import IndentIntegracao from './IndentIntegracao';

// IQ Indent (PR 5a.4): Integracao Pipedrive so com classes; nenhuma classe `indent-*` desta secao fica sem uso e nenhuma classe da tela fica
// sem regra na regiao `tela F14`. Padrao do IndentCotacoes.visual.test.tsx. Dados FICTICIOS (ids 9xxxxx).

let mockRole = 'admin';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Exemplo', email: 'ana@exemplo.com.br', role: mockRole } }),
}));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F14');
const MARCADOR = '/* ======================= Integracao Pipedrive (PR 5a.4)';
// O marcador volta para o inicio do trecho: sem ele o resto do comentario do titulo viraria "seletor".
const depoisDoMarcador = (regiao?.bruto ?? '').split(MARCADOR)[1];
const brutoPr5 = depoisDoMarcador === undefined ? '' : `${MARCADOR}${depoisDoMarcador}`;
const regrasPr5 = parseRules(stripComments(brutoPr5));
const classesDaSecao = new Set(
  regrasPr5.flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel))).filter((c) => c.startsWith('indent-')),
);
const classesDaRegiao = new Set(
  parseRules(stripComments(regiao?.bruto ?? ''))
    .flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel)))
    .filter((c) => c.startsWith('indent-') || c === 'modal-eyebrow'),
);
const corpo = (seletor: string) => regrasPr5.find((r) => r.prelude.split(',').some((s) => s.trim() === seletor))?.body.replace(/\s+/g, ' ') ?? '';
const classesDoDom = (root: ParentNode) => new Set(Array.from(root.querySelectorAll('[class]')).flatMap((el) => Array.from(el.classList)));

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
  pendingCount: 2,
  dailyTokensRemaining: 1_800_000,
  dailyTokensLimit: 2_000_000,
  intervalMinutes: 10,
};

const OPCOES = {
  pipelines: [{ id: 900001, name: 'Funil Exemplo' }],
  stages: [{ id: 900011, name: 'Coluna Exemplo A', pipelineId: 900001 }],
  slaOptions: [1, 2, 3],
  current: { pipelineId: 900001, stageId: 900011, slaBusinessDays: 2 },
};

const FILA = [
  { id: 501, requestId: 11, processNumber: '276/26', dealId: 900101, candidates: [{ orgId: 900201, name: 'Cliente Exemplo Alfa Ltda', cnpj: '11222333000181', city: null }], createdAt: '2026-11-12T12:00:00.000Z' },
  {
    id: 503,
    requestId: 13,
    processNumber: null,
    dealId: 900103,
    candidates: [
      { orgId: 900203, name: 'Cliente Exemplo Gama', cnpj: '11444777000161', city: null },
      { orgId: 900204, name: 'Cliente Exemplo Delta', cnpj: null, city: null },
    ],
    createdAt: '2026-11-12T12:00:00.000Z',
  },
];

let status: Record<string, unknown> = STATUS;

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/pipedrive/status') return status;
    if (url === '/api/v1/indent/pipedrive/options') return OPCOES;
    if (url === '/api/v1/indent/pending-orgs') return { data: FILA, total: FILA.length };
    if (url === '/api/v1/indent/clients') return { data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }, counts: { todos: 0, semCnpj: 0 } };
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

beforeEach(() => {
  mockRole = 'admin';
  status = STATUS;
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

describe('Integracao Pipedrive: marcacao x regiao `tela F14` (PR 5a.4)', () => {
  it('a regiao tem a secao da Integracao, so com seletores .indent-page, var(--rf-*), sem at-rule, sem !important e sem cor literal', () => {
    expect(brutoPr5.length).toBeGreaterThan(500);
    expect(regrasPr5.length).toBeGreaterThan(15);
    const limpo = stripComments(brutoPr5);
    expect(limpo).not.toMatch(/@/);
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(limpo).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect([...limpo.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '').filter((v) => !v.startsWith('--rf-'))).toEqual([]);
    expect(limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    const seletores = regrasPr5.flatMap((r) => r.prelude.split(',').map((s) => s.trim()));
    expect(seletores.filter((s) => !s.startsWith('.indent-page '))).toEqual([]);
  });

  it('metricas do mock v14: conn (ponto 10px com halo), campos em grade de 170px, linha da fila, fieldset de organizacoes e opcao', () => {
    expect(corpo('.indent-page .indent-conn')).toContain('flex-wrap: wrap');
    expect(corpo('.indent-page .indent-conn')).toContain('gap: 12px 20px');
    const ponto = corpo('.indent-page .indent-conn__ponto');
    expect(ponto).toContain('width: 10px');
    expect(ponto).toContain('height: 10px');
    expect(ponto).toContain('border-radius: 50%');
    expect(ponto).toContain('background: var(--rf-primary)');
    expect(ponto).toContain('box-shadow: 0 0 0 4px var(--rf-focus-halo)');
    expect(corpo('.indent-page .indent-conn__tag')).toContain('margin-left: auto');
    expect(corpo('.indent-page .indent-campos-config')).toContain('repeat(auto-fit, minmax(170px, 1fr))');
    expect(corpo('.indent-page .indent-campos-config')).toContain('gap: 14px');
    const item = corpo('.indent-page .indent-fila-item');
    expect(item).toContain('flex-wrap: wrap');
    expect(item).toContain('justify-content: space-between');
    expect(item).toContain('gap: 16px');
    expect(item).toContain('padding: 12px 0');
    expect(item).toContain('border-bottom: 1px solid var(--rf-divider)');
    expect(corpo('.indent-page .indent-fila-item:last-of-type')).toContain('border-bottom: 0');
    expect(corpo('.indent-page .indent-fila-item__texto')).toContain('gap: 2px');
    const orgs = corpo('.indent-page .indent-orgs');
    expect(orgs).toContain('border: 1px solid var(--rf-border)');
    expect(orgs).toContain('border-radius: var(--rf-radius-xs)');
    expect(orgs).toContain('padding: 10px 12px');
    expect(corpo('.indent-page .indent-orgs legend')).toContain('font-size: 12px');
    const opcao = corpo('.indent-page .indent-orgopt');
    expect(opcao).toContain('font-size: 14px');
    expect(opcao).toContain('font-weight: 600');
    expect(corpo('.indent-page .indent-orgopt input')).toContain('accent-color: var(--rf-primary-700)');
    expect(corpo('.indent-page .indent-seta')).toContain('color: var(--rf-ink-soft)');
    // D89: no celular o mapeamento guarda largura minima e rola dentro da caixa (sem at-rule), em vez de quebrar palavra a palavra
    expect(corpo('.indent-page .indent-painel .indent-mapa')).toMatch(/min-width: (?:[4-9]\d\d|\d{4,})px/);
  });

  it('acabamento (contrato de CSS): botoes secundarios so com medidas, sem borda/sombra/fundo proprios; ponto de cada estado so com token', () => {
    // Secundario padrao do sistema (.ghost-button, sem --sm): o contorno vem dos tokens do sistema; aqui so medidas (guard telaF12: so 1 borda em --rf-action).
    const ghost = corpo('.indent-page .indent-fila-item__acoes .ghost-button');
    expect(ghost).toContain('min-height: 36px');
    expect(ghost).toContain('font-size: 13px');
    expect(ghost).not.toMatch(/border|box-shadow|background/);
    expect(corpo('.indent-page .indent-conn__ponto--aviso')).toContain('background: var(--rf-tone-warning-solid)');
    expect(corpo('.indent-page .indent-conn__ponto--erro')).toContain('background: var(--rf-tone-danger-solid)');
    expect(corpo('.indent-page .indent-conn__ponto--neutro')).toContain('background: var(--rf-tone-neutral-solid)');
    // o foco do titulo da fila (devolvido depois de resolver) e visivel
    expect(corpo('.indent-page .indent-painel__cabeca h2:focus-visible')).toContain('outline: 2px solid var(--rf-action)');
    expect(corpo('.indent-page .indent-orgopt:focus-within')).toContain('outline: 2px solid var(--rf-action)');
    // nenhuma regra desta secao fixa altura: sem height, nada de min-height solto para os campos
    expect(stripComments(brutoPr5)).not.toMatch(/[^-]height:\s*\d+px;\s*\}/);
  });

  it('a pagina e os modais so usam classes (nenhum style inline), com a raiz .page.indent-page.indent-integracao-page', async () => {
    const { container } = renderTela();
    await screen.findByText('Conectado ao Pipedrive');
    await screen.findByText('2 pendentes');
    expect(container.querySelector('.page.indent-page.indent-integracao-page')).not.toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular a existente' })[0] as HTMLElement);
    await screen.findByRole('dialog', { name: 'Cliente Exemplo Alfa Ltda' });
    expect(container.querySelector('dialog [style]')).toBeNull();
    expect(container.querySelector('dialog form.indent-form > .modal-actions:last-child')).not.toBeNull();
  });

  it('toda classe indent-* usada pela tela tem regra na regiao e toda regra desta secao e usada no DOM (4 tons de conexao, fila com varias organizacoes e os 2 modais)', async () => {
    const todas = new Set<string>();
    const add = (root: ParentNode) => classesDoDom(root).forEach((c) => todas.add(c));

    // conectado (ponto padrao) + fila: 1 organizacao e varias (fieldset, radios) + modal "Vincular a existente"
    const conectado = renderTela();
    await screen.findByText('2 pendentes');
    add(conectado.container);
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular a existente' })[0] as HTMLElement);
    await screen.findByRole('dialog', { name: 'Cliente Exemplo Alfa Ltda' });
    add(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // "Criar cliente" de organizacao sem CNPJ (a Delta, escolhida pelo radio): modal "Novo cliente"
    fireEvent.click(screen.getByRole('radio', { name: /Cliente Exemplo Delta/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Criar cliente' })[1] as HTMLElement);
    await screen.findByRole('dialog', { name: 'Novo cliente' });
    add(document.body);
    conectado.unmount();

    // um estado por tom do ponto
    for (const connection of ['rate_limited', 'auth_failed', 'not_configured']) {
      status = { ...STATUS, connection, configured: connection !== 'not_configured' };
      const estado = renderTela();
      await screen.findByText(/Limite de chamadas atingido|Falha de autenticação no Pipedrive|Integração não configurada/);
      add(estado.container);
      estado.unmount();
    }

    expect(classesDaSecao.size).toBeGreaterThan(10);
    expect(classesDaSecao.has('indent-conn')).toBe(true);
    expect(classesDaSecao.has('indent-fila-item')).toBe(true);
    const semUso = Array.from(classesDaSecao).filter((c) => !todas.has(c));
    expect(semUso).toEqual([]);
    // a raiz da pagina (indent-integracao-page) e so marcador de rota, como indent-solicitacoes-page: sem regra propria
    const semRegra = Array.from(todas).filter((c) => c.startsWith('indent-') && !c.endsWith('-page') && !classesDaRegiao.has(c));
    expect(semRegra).toEqual([]);
  });
});
