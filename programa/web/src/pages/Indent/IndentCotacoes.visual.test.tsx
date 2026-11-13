import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { classesDoSeletor, parseRules, readSource, regioes, stripComments } from '@/test/rfCss';
import IndentCotacaoGaveta from './IndentCotacaoGaveta';
import IndentCotacoes from './IndentCotacoes';

// IQ Indent (PR 3): Cotacoes (lista agrupada e gaveta) so com classes; nenhuma classe `indent-*` do PR 3 fica sem regra na regiao `tela F14` e
// nenhuma regra do PR 3 fica sem uso. Padrao do IndentSolicitacoes.visual.test.tsx. As regras do PR 1 e do PR 2 sao conferidas nos testes deles.

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Souza', email: 'u@b.c', role: 'comprador' } }),
}));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F14');
const MARCADOR_PR3 = '/* ======================= Cotacoes (PR 3)';
// O marcador volta para o inicio do trecho: sem ele o resto do comentario do titulo viraria "seletor".
const depoisDoMarcador = (regiao?.bruto ?? '').split(MARCADOR_PR3)[1];
const brutoPr3 = depoisDoMarcador === undefined ? '' : `${MARCADOR_PR3}${depoisDoMarcador}`;
const regrasPr3 = parseRules(stripComments(brutoPr3));
const classesDoCss = new Set(
  regrasPr3.flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel))).filter((c) => c.startsWith('indent-')),
);
const classesDoDom = (root: HTMLElement) => new Set(Array.from(root.querySelectorAll('[class]')).flatMap((el) => Array.from(el.classList)));
const corpo = (seletor: string) =>
  regrasPr3.find((r) => r.prelude.split(',').some((s) => s.trim() === seletor))?.body.replace(/\s+/g, ' ') ?? '';

const item = (id: number, requestItemId: number, extra: Record<string, unknown> = {}) => ({
  id,
  requestItemId,
  name: 'Ureia técnica',
  cas: '57-13-6',
  productOrigin: 'CADASTRADO',
  isFree: false,
  quantityKg: '40000.000',
  packaging: null,
  fobPricePerKg: null,
  cfrPricePerKg: null,
  ...extra,
});

const linhaLista = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  ref: '270/26',
  revision: 1,
  status: 'RESPONDIDA',
  requestId: 11,
  processNumber: '270/26',
  requestStatus: 'COTACAO',
  client: { id: 3, name: 'Cliente Alfa Indústria Ltda', city: 'Itajaí' },
  supplier: { id: 5, name: 'Nordic Solvents AB', country: 'Suécia', contactName: 'Anna', hasPartnership: false },
  itemsSummary: { firstName: 'Ureia técnica', count: 2 },
  currency: 'USD',
  total: '1100.00',
  validUntil: '2026-11-26',
  exception: { reason: 'Cliente autorizou' },
  createdAt: '2026-11-12T12:00:00.000Z',
  ...extra,
});

const detalhe = (extra: Record<string, unknown> = {}) => ({
  ...linhaLista(100, { exception: null }),
  status: 'RASCUNHO',
  destination: 'Paranaguá',
  incoterm: 'CFR',
  sentAt: null,
  respondedAt: null,
  decidedAt: null,
  productionLeadTimeDays: null,
  paymentTerms: null,
  manufacturer: null,
  notes: null,
  base: null,
  acceptedQuote: null,
  client: { id: 3, name: 'Cliente Alfa Indústria Ltda', city: 'Itajaí', supplierRuleMode: 'APROVADOS' },
  supplier: { id: 5, name: 'Nordic Solvents AB', country: 'Suécia', contactName: 'Anna', hasPartnership: false, type: 'TRADING' },
  exception: { reason: 'Cliente autorizou', byName: 'Ana Souza', at: '2026-11-12T15:10:00.000Z' },
  items: [item(201, 21), item(202, 22, { isFree: true, cas: null, name: 'Livre' })],
  allowedActions: ['mark-sent', 'items'],
  ...extra,
});

let corpoDetalhe: Record<string, unknown> = detalhe();

function renderComQuery(ui: React.ReactElement, caminho = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  corpoDetalhe = detalhe();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/quotes') return { data: [linhaLista(1), linhaLista(2, { exception: null, supplier: { id: 6, name: 'Acme', country: null, contactName: null, hasPartnership: true } })], truncated: false };
    if (url === '/api/v1/indent/quotes/100') return corpoDetalhe;
    return {};
  }) as typeof api.get);
});

describe('Cotacoes: marcacao x regiao `tela F14` (PR 3)', () => {
  it('a regiao tem a secao do PR 3, so com seletores .indent-page, var(--rf-*), sem at-rule, sem !important e sem cor literal', () => {
    expect(brutoPr3.length).toBeGreaterThan(1000);
    expect(regrasPr3.length).toBeGreaterThan(30);
    const limpo = stripComments(brutoPr3);
    expect(limpo).not.toMatch(/@/);
    expect(limpo).not.toContain('!important');
    expect(limpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(limpo).not.toMatch(/\b(?:rgba?|hsla?)\(/);
    expect([...limpo.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '').filter((v) => !v.startsWith('--rf-'))).toEqual([]);
    expect(limpo).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/);
    const seletores = regrasPr3.flatMap((r) => r.prelude.split(',').map((s) => s.trim()));
    expect(seletores.filter((s) => !s.startsWith('.indent-page '))).toEqual([]);
  });

  it('metricas do mock: seg, grupo, gaveta a direita (640px, altura total), campo de preco 112x36 e total', () => {
    expect(corpo('.indent-page .indent-seg')).toContain('display: inline-grid');
    expect(corpo(".indent-page .indent-seg button[aria-pressed='true']")).toContain('box-shadow: var(--rf-shadow-rest)');
    expect(corpo('.indent-page .indent-grupo > summary')).toContain('padding: 16px 20px');
    expect(corpo('.indent-page .indent-grupo > summary::-webkit-details-marker')).toContain('display: none');
    expect(corpo('.indent-page .indent-grupo[open] .indent-grupo__seta')).toContain('transform: rotate(180deg)');
    const gaveta = corpo('.indent-page dialog.modal-dialog.indent-gaveta');
    expect(gaveta).toContain('width: min(640px, 100%)');
    expect(gaveta).toContain('height: 100%');
    expect(gaveta).toContain('margin: 0 0 0 auto');
    expect(corpo('.indent-page .indent-gaveta .modal-content')).toContain('border-radius: 0');
    expect(corpo('.indent-page .indent-gaveta .modal-header h2')).toContain('font-size: 18px');
    expect(corpo('.indent-page .indent-gaveta .modal-header h2')).toContain('font-family: var(--rf-font-mono)');
    const preco = corpo('.indent-page .indent-preco');
    expect(preco).toContain('width: 112px');
    expect(preco).toContain('height: 36px');
    expect(preco).toContain('text-align: right');
    expect(corpo('.indent-page .indent-total')).toContain('border-top: 1px solid var(--rf-divider)');
  });

  it('acabamento da gaveta (contrato de CSS): inputs de 36px com min-height, secundarios so com medidas, tag que nao estica', () => {
    for (const seletor of ['.indent-page .indent-preco', '.indent-page .indent-desc', '.indent-page .indent-data']) {
      expect(corpo(seletor), seletor).toContain('min-height: 36px');
    }
    // Botoes secundarios: so medidas; borda, sombra ou fundo proprios anulariam o anel de foco e o guard de borda do secundario (F12).
    const ghost = corpo('.indent-page .indent-gaveta .ghost-button');
    expect(ghost).toContain('min-height: 36px');
    expect(ghost).toContain('font-size: 13px');
    expect(ghost).not.toMatch(/border|box-shadow|background/);
    expect(corpo('.indent-page .indent-cell-main > .indent-tag')).toContain('align-self: flex-start');
  });

  it('toda classe indent-* do PR 3 existe na regiao e toda regra desta secao e usada no DOM (lista + gaveta em 3 estados + item livre)', async () => {
    const todas = new Set<string>();
    const add = (root: HTMLElement) => classesDoDom(root).forEach((c) => todas.add(c));

    const lista = renderComQuery(<IndentCotacoes />, '/indent/cotacoes');
    await screen.findAllByText('Nordic Solvents AB', { selector: 'strong' });
    add(lista.container);
    lista.unmount();

    // RASCUNHO: "Enviada em" + item livre aberto
    const rascunho = renderComQuery(<IndentCotacaoGaveta quoteId={100} onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar item livre' }));
    add(document.body);
    rascunho.unmount();

    // ENVIADA: bloco da resposta e inputs de preco
    corpoDetalhe = detalhe({ status: 'ENVIADA', allowedActions: ['response'], acceptedQuote: { id: 9, ref: '270/26', supplierName: 'Beta Corp' } });
    const enviada = renderComQuery(<IndentCotacaoGaveta quoteId={100} onClose={() => undefined} />);
    await screen.findByText('Resposta do fornecedor');
    add(document.body);
    enviada.unmount();

    // RESPONDIDA: so leitura (valores em mono)
    corpoDetalhe = detalhe({ status: 'RESPONDIDA', allowedActions: ['accept', 'refuse', 'revision'] });
    renderComQuery(<IndentCotacaoGaveta quoteId={100} onClose={() => undefined} />);
    await screen.findByRole('button', { name: 'Aceitar e abrir processo' });
    add(document.body);

    expect(classesDoCss.size).toBeGreaterThan(15);
    expect(classesDoCss.has('indent-grupo')).toBe(true);
    expect(classesDoCss.has('indent-gaveta')).toBe(true);
    const semUso = Array.from(classesDoCss).filter((c) => !todas.has(c));
    expect(semUso).toEqual([]);
    // marcacao so com classes (nenhum style inline com token)
    expect(document.querySelector('.indent-gaveta [style], .indent-cotacoes-page [style]')).toBeNull();
  });
});
