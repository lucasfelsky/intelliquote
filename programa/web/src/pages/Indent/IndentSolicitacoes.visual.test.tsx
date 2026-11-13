import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { classesDoSeletor, parseRules, readSource, regioes, stripComments } from '@/test/rfCss';
import IndentSolicitacaoDetalhe from './IndentSolicitacaoDetalhe';
import IndentSolicitacoes from './IndentSolicitacoes';

// IQ Indent (PR 2): Solicitacoes (lista, detalhe, seletor de fornecedores e modal) so com classes; nenhuma classe `indent-*` do PR 2 fica sem
// regra na regiao `tela F14` e nenhuma regra do PR 2 fica sem uso. Padrao do Indent.visual.test.tsx.

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Souza', email: 'u@b.c', role: 'comprador' } }),
}));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

const linhaLista = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  processNumber: `${id}/26`,
  createdAt: '2026-11-12T15:05:00.000Z',
  origin: 'PIPEDRIVE',
  pipedriveDealId: 4412,
  ownerName: 'Ana Souza',
  status: 'NOVA',
  clientPending: false,
  client: { id: 3, name: 'Cliente Alfa Ltda', city: 'Itajaí', supplierRuleMode: 'APROVADOS' },
  itemsSummary: { firstName: 'Ácido cítrico anidro', count: 2, totalKg: 40500 },
  quotes: { total: 2, answered: 1 },
  queueBusinessDays: 3,
  ...extra,
});

const item = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  position: id - 21,
  description: 'Ácido cítrico anidro',
  name: 'Ácido cítrico anidro',
  quantityKg: 25000,
  confirmed: true,
  productId: 1,
  product: { id: 1, name: 'Ácido cítrico anidro', cas: '77-92-9', origin: 'CADASTRADO' },
  isFree: false,
  ...extra,
});

const detalhe = (extra: Record<string, unknown> = {}) => ({
  id: 11,
  processNumber: '275/26',
  origin: 'PIPEDRIVE',
  pipedriveDealId: 4412,
  dealTitle: '275/26 INDENT - ALFA',
  dealType: 'Regular',
  rawNote: 'CFR Itajaí - Shandong',
  ownerName: 'Ana Souza',
  createdByName: 'Ana Souza',
  status: 'NOVA',
  clientPending: false,
  createdAt: '2026-11-12T15:05:00.000Z',
  stageEnteredAt: '2026-11-12T15:05:00.000Z',
  queueBusinessDays: 1,
  client: {
    id: 3,
    name: 'Cliente Alfa Ltda',
    cnpj: '11222333000181',
    city: 'Itajaí',
    pipedriveOrgId: 5521,
    supplierRuleMode: 'APROVADOS',
    ruleReason: 'Auditoria',
    supplierRules: [{ supplierId: 1, name: 'Shandong Haohua Chemical Co.' }],
  },
  items: [item(21), item(22, { name: 'Livre', isFree: true, productId: 9, product: { id: 9, name: 'Livre', cas: null, origin: 'LIVRE' } })],
  quotes: [],
  ...extra,
});

const OPCOES = {
  clientRuleMode: 'APROVADOS',
  suppliers: [
    {
      id: 1,
      name: 'Shandong Haohua Chemical Co.',
      country: 'China',
      type: 'FABRICANTE',
      hasPartnership: true,
      defaultCurrency: 'USD',
      defaultIncoterm: 'CFR',
      allowed: true,
      blockedReason: null,
      approvedByClient: true,
      coverage: { covered: 2, total: 2 },
    },
    {
      id: 3,
      name: 'Nordic Solvents AB',
      country: null,
      type: 'IMPORTADO',
      hasPartnership: false,
      defaultCurrency: 'EUR',
      defaultIncoterm: 'CFR',
      allowed: false,
      blockedReason: 'Fora da lista de fornecedores aprovados do cliente',
      approvedByClient: false,
      coverage: { covered: 0, total: 2 },
    },
  ],
};

let corpoDetalhe: Record<string, unknown> = detalhe();

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/requests') {
      return {
        data: [linhaLista(275), linhaLista(277, { clientPending: true, client: null })],
        pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 2 },
        counts: { todas: 2, pipedrive: 2, iq: 0, nova: 1, pendente: 1 },
        kpis: { novas: 1, emCotacao: 0, respondidas: 0, convertidasNoMes: 0 },
      };
    }
    if (url === '/api/v1/indent/requests/11') return corpoDetalhe;
    if (url === '/api/v1/indent/requests/11/supplier-options') return OPCOES;
    if (url === '/api/v1/indent/requests/client-options') return [{ id: 3, name: 'Cliente Alfa Ltda', city: 'Itajaí' }];
    if (url === '/api/v1/indent/products/options') return [{ id: 1, name: 'Ácido cítrico anidro', cas: '77-92-9', isActive: true }];
    return [];
  }) as typeof api.get);
}

function renderTela(caminho: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/indent/solicitacoes" element={<IndentSolicitacoes />} />
          <Route path="/indent/solicitacoes/:id" element={<IndentSolicitacaoDetalhe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const classesDoDom = (root: HTMLElement) => new Set(Array.from(root.querySelectorAll('[class]')).flatMap((el) => Array.from(el.classList)));

const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F14');
// So as regras do PR 2: a parte da regiao depois do marcador "Solicitacoes (PR 2)" (as do PR 1 sao conferidas no Indent.visual.test.tsx).
const MARCADOR_PR2 = '/* ======================= Solicitacoes (PR 2)';
const brutoPr2 = (regiao?.bruto ?? '').split(MARCADOR_PR2)[1] ?? '';
const classesDoCss = new Set(
  parseRules(stripComments(brutoPr2))
    .flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel)))
    .filter((c) => c.startsWith('indent-')),
);

describe('Solicitacoes do Indent: marcacao x regiao `tela F14`', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset().mockResolvedValue({});
    corpoDetalhe = detalhe();
    mockApi();
  });

  it('Lista: raiz, KPIs, busca, chips, tabela com referencia, tags, badges de fila e paginacao', async () => {
    const { container } = renderTela('/indent/solicitacoes');
    await screen.findByText('275/26');
    const classes = classesDoDom(container);
    expect(container.querySelector('.page.indent-page.indent-solicitacoes-page')).not.toBeNull();
    for (const c of [
      'indent-kpis',
      'indent-kpi',
      'indent-kpi__valor',
      'indent-kpi__sub',
      'indent-toolbar',
      'indent-busca',
      'indent-chips',
      'indent-chip-conta',
      'indent-tabela-caixa',
      'indent-tabela',
      'indent-alerta',
      'indent-ref',
      'indent-linha-clicavel',
      'indent-cell-main',
      'indent-cell-sub',
      'indent-tag',
      'indent-tag--pd',
      'indent-tag--lock',
      'indent-paginacao',
    ]) {
      expect(classes.has(c), c).toBe(true);
    }
    expect(container.querySelector('.badge.badge--danger')).not.toBeNull();
    expect(container.querySelector('.badge.badge--dot')).not.toBeNull();
    expect(container.querySelector('.alert.alert--warning')).not.toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('Modal "Nova solicitacao": form com .modal-actions, campos, linha de item, leitura e alerta', async () => {
    const { container } = renderTela('/indent/solicitacoes');
    fireEvent.click(await screen.findByRole('button', { name: 'Nova solicitação' }));
    await screen.findByRole('dialog', { name: 'Nova solicitação' });
    await screen.findByRole('option', { name: 'Cliente Alfa Ltda' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro item' }));
    const classes = classesDoDom(container);
    for (const c of ['modal-eyebrow', 'indent-form', 'indent-campos', 'indent-leitura', 'indent-itens', 'indent-item-linha', 'indent-input-mono', 'field-hint']) {
      expect(classes.has(c), c).toBe(true);
    }
    expect(container.querySelector('form.indent-form > .modal-actions:last-child')).not.toBeNull();
    expect(container.querySelector('.indent-form .alert.alert--warning')).not.toBeNull();
    expect(container.querySelector('dialog [style]')).toBeNull();
  });

  it('Detalhe NOVA: colunas, paineis, seletor (cartoes, trava, excecao, faixa e caixa gerar), itens, nota e cliente', async () => {
    const { container } = renderTela('/indent/solicitacoes/11');
    await screen.findByText('Nordic Solvents AB');
    fireEvent.click(screen.getByRole('button', { name: 'Liberar exceção' }));
    fireEvent.change(await screen.findByLabelText('Motivo da exceção'), { target: { value: 'Autorizado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exceção' }));

    const classes = classesDoDom(container);
    expect(container.querySelector('.page.indent-page.indent-solicitacao-page')).not.toBeNull();
    for (const c of [
      'indent-ref',
      'indent-ref--indent',
      'indent-cols',
      'indent-coluna',
      'indent-pilha',
      'indent-pilha--curta',
      'indent-restricao__motivo',
      'indent-painel',
      'indent-painel__cabeca',
      'indent-painel__nota',
      'indent-dl',
      'indent-dl__mono',
      'indent-itemrow',
      'indent-itemrow__qtd',
      'indent-nota',
      'indent-sup',
      'indent-sup__nome',
      'indent-sup__direita',
      'indent-sup__nota',
      'indent-excbanner',
      'indent-tag--exc',
      'indent-tag--ok',
      'indent-tag--manual',
      'indent-tag--lock',
      'indent-gerar',
      'indent-gerar__refs',
    ]) {
      expect(classes.has(c), c).toBe(true);
    }
    expect(container.querySelector('.indent-sup.is-on.is-exc')).not.toBeNull();
    expect(container.querySelector('.indent-sup input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector('.indent-excbanner[role="alert"]')).not.toBeNull();
    expect(container.querySelector('.indent-sup.is-blocked')).toBeNull(); // o travado virou excecao
    expect(container.querySelector('.indent-linkbtn')).toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('Detalhe: trava (is-blocked), botao "Liberar excecao", campo de motivo e linha de excecao da tabela de cotacoes', async () => {
    const aberto = renderTela('/indent/solicitacoes/11');
    await screen.findByText('Nordic Solvents AB');
    expect(aberto.container.querySelector('.indent-sup.is-blocked')).not.toBeNull();
    expect(aberto.container.querySelector('button.indent-linkbtn')?.textContent).toBe('Liberar exceção');
    fireEvent.click(screen.getByRole('button', { name: 'Liberar exceção' }));
    await screen.findByLabelText('Motivo da exceção');
    expect(aberto.container.querySelector('.indent-sup__motivo')).not.toBeNull();
    aberto.unmount();

    corpoDetalhe = detalhe({
      status: 'COTACAO',
      quotes: [
        { id: 100, status: 'RASCUNHO', revision: 1, supplier: { id: 3, name: 'Nordic Solvents AB' }, exception: { reason: 'x', byName: 'Ana', at: null } },
      ],
    });
    const cotacoes = renderTela('/indent/solicitacoes/11');
    await screen.findByText('Nordic Solvents AB');
    const classes = classesDoDom(cotacoes.container);
    for (const c of ['indent-linha-exc', 'indent-tag--exc', 'indent-tabela-caixa', 'indent-tabela', 'indent-num', 'indent-ref--indent']) {
      expect(classes.has(c), c).toBe(true);
    }
    expect(cotacoes.container.querySelector('[style]')).toBeNull();
  });

  it('acabamento do mock na regiao: eyebrow do KPI verde, colunas 1,7:1, link e caixa "Gerar" nos tokens do mock, motivo 36px com botao contornado, modal em tinta', () => {
    const regras = parseRules(stripComments(brutoPr2));
    const corpo = (seletor: string) =>
      regras.find((r) => r.prelude.split(',').some((s) => s.trim() === seletor))?.body.replace(/\s+/g, ' ') ?? '';

    expect(corpo('.indent-page .indent-kpi .eyebrow')).toContain('color: var(--rf-primary-700)');
    // Bases na mesma proporcao do grow (480 : 282 = 1,7 : 1): a divisao fica 1,7fr / 1fr em qualquer largura.
    expect(corpo('.indent-page .indent-coluna:first-child')).toContain('flex: 1.7 1 480px');
    expect(corpo('.indent-page .indent-coluna:last-child')).toContain('flex: 1 1 282px');
    expect(corpo('.indent-page .indent-linkbtn')).toContain('color: var(--rf-primary-700)');
    expect(corpo('.indent-page .indent-gerar')).toContain('background: var(--rf-action-hover-bg)');
    expect(corpo('.indent-page .indent-gerar .primary-button')).toContain('padding: 0 18px');
    expect(corpo('.indent-page .indent-sup__motivo .input')).toContain('min-height: 36px');
    // Contorno por borda real: box-shadow/background aqui anulariam o anel de foco e o hover do .ghost-button do sistema.
    const confirmar = corpo('.indent-page .indent-sup__motivo .ghost-button');
    expect(confirmar).toContain('border: 1.5px solid var(--rf-action)');
    expect(confirmar).not.toContain('box-shadow');
    expect(confirmar).not.toContain('background');
    expect(corpo('.indent-page .indent-excbanner strong')).toContain('line-height: normal');
    expect(corpo('.indent-page dialog.modal-dialog')).toContain('color: var(--rf-ink)');
    expect(corpo('.indent-page .indent-form select.input')).toContain('font-weight: 500');
    const alerta = corpo('.indent-page .indent-alerta');
    expect(alerta).toContain('padding: 14px 16px');
    expect(alerta).toContain('gap: 12px');
    expect(alerta).toContain('line-height: normal');
    expect(corpo('.indent-page .indent-alerta > svg')).toContain('flex: none');
  });

  it('toda classe indent-* do PR 2 existe na regiao e toda regra desta tela e usada no DOM', async () => {
    const todas = new Set<string>();
    const add = (root: HTMLElement) => classesDoDom(root).forEach((c) => todas.add(c));

    const lista = renderTela('/indent/solicitacoes');
    fireEvent.click(await screen.findByRole('button', { name: 'Nova solicitação' }));
    await screen.findByRole('option', { name: 'Cliente Alfa Ltda' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro item' }));
    add(lista.container);
    lista.unmount();

    const detalheNova = renderTela('/indent/solicitacoes/11');
    await screen.findByText('Nordic Solvents AB');
    add(detalheNova.container); // com o botao "Liberar excecao" ainda na tela
    fireEvent.click(screen.getByRole('button', { name: 'Liberar exceção' }));
    fireEvent.change(await screen.findByLabelText('Motivo da exceção'), { target: { value: 'Autorizado' } });
    add(detalheNova.container);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exceção' }));
    add(detalheNova.container);
    detalheNova.unmount();

    corpoDetalhe = detalhe({
      status: 'COTACAO',
      quotes: [{ id: 100, status: 'RASCUNHO', revision: 1, supplier: { id: 3, name: 'Nordic Solvents AB' }, exception: { reason: 'x', byName: 'Ana', at: null } }],
    });
    const cotacoes = renderTela('/indent/solicitacoes/11');
    await screen.findByText('Nordic Solvents AB');
    add(cotacoes.container);

    expect(classesDoCss.size).toBeGreaterThan(30);
    expect(classesDoCss.has('indent-sup')).toBe(true);
    const semUso = Array.from(classesDoCss).filter((c) => !todas.has(c));
    expect(semUso).toEqual([]);
  });
});
