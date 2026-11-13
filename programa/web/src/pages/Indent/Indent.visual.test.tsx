import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { classesDoSeletor, readSource, regioes } from '@/test/rfCss';
import IndentCatalogo from './IndentCatalogo';
import IndentClientes from './IndentClientes';
import IndentFornecedores from './IndentFornecedores';

// IQ Indent (PR 1): as 3 paginas e os modais so com classes (nenhum estilo inline com token). Mocks no padrao do Fornecedores.visual.test.tsx; aqui so a marcacao e
// as classes que a regiao `tela F14` consome (as regras ficam no telaF14.test.ts).

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comprador' } }),
}));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

const OPCOES_PRODUTO = [
  { id: 1, name: 'Ácido cítrico anidro', cas: '77-92-9', isActive: true },
  { id: 2, name: 'Ureia técnica', cas: null, isActive: true },
];

function pagina(rows: unknown[], totalPages = 2) {
  return { data: rows, pagination: { page: 1, pageSize: 100, totalItems: rows.length, totalPages } };
}

const produto = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Produto ${id}`,
  acronym: null,
  manufacturer: null,
  cas: id === 1 ? '77-92-9' : null,
  unit: 'kg',
  synonyms: [],
  notes: 'Grau técnico',
  origin: id === 2 ? 'LIVRE' : 'CADASTRADO',
  sourceRequestNumber: id === 2 ? '270/26' : null,
  importedFromIq: false,
  isActive: true,
  createdAt: '2026-11-12T12:00:00.000Z',
  updatedAt: '2026-11-12T12:00:00.000Z',
  supplierCount: id,
  ...extra,
});

const fornecedor = {
  id: 7,
  name: 'Shandong Haohua Chemical Co.',
  country: 'China',
  contactName: 'Wei Zhang',
  type: 'FABRICANTE',
  defaultCurrency: 'USD',
  defaultIncoterm: 'CFR',
  hasPartnership: true,
  importedFromIq: false,
  isActive: true,
  createdAt: '2026-11-12T12:00:00.000Z',
  updatedAt: '2026-11-12T12:00:00.000Z',
  approvedBy: 1,
  blockedBy: 1,
  products: [
    { id: 1, name: 'Ácido cítrico anidro', isActive: true },
    { id: 2, name: 'Ureia técnica', isActive: false },
  ],
};

const cliente = {
  id: 3,
  name: 'Indústria Química Vale do Itajaí Ltda',
  cnpj: '11222333000181',
  city: 'Itajaí, SC',
  ownerName: 'Mariana Souza',
  pipedriveOrgId: 5521,
  supplierRuleMode: 'APROVADOS',
  ruleReason: 'Auditoria',
  isActive: true,
  createdAt: '2026-11-12T12:00:00.000Z',
  updatedAt: '2026-11-12T12:00:00.000Z',
  supplierRules: [{ supplierId: 1, supplier: { name: 'Shandong Haohua Chemical Co.' } }],
};

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    switch (url) {
      case '/api/v1/indent/products':
        return { ...pagina([produto(1), produto(2)]), counts: { total: 2, cadastrado: 1, livre: 1 } };
      case '/api/v1/indent/products/options':
        return OPCOES_PRODUTO;
      case '/api/v1/indent/suppliers':
        return pagina([fornecedor]);
      case '/api/v1/indent/suppliers/options':
        return [{ id: 1, name: 'Shandong Haohua Chemical Co.', country: 'China' }];
      case '/api/v1/indent/clients':
        return pagina([cliente]);
      case '/api/v1/indent/import/products':
        return pagina([{ id: 1, name: 'Ácido fosfórico 85%', marketName: 'Phosphoric acid', alreadyInIndent: false }]);
      case '/api/v1/indent/import/suppliers':
        return pagina([{ id: 1, name: 'Nordic Solvents AB', country: 'Suécia', alreadyInIndent: true }]);
      default:
        return [];
    }
  }) as typeof api.get);
}

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const classesDoDom = (root: HTMLElement) => new Set(Array.from(root.querySelectorAll('[class]')).flatMap((el) => Array.from(el.classList)));

// classes `indent-*` e `.modal-eyebrow` que a regiao `tela F14` consome
const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F14');
const classesDoCss = new Set(
  (regiao?.regras ?? []).flatMap((r) => r.prelude.split(',').flatMap((sel) => classesDoSeletor(sel))).filter((c) => c.startsWith('indent-') || c === 'modal-eyebrow'),
);

describe('Indent: marcacao x regiao `tela F14`', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset().mockResolvedValue({});
    mockApi();
  });

  it('Catalogo: raiz .page.indent-page, eyebrow, barra de ferramentas, chips, tabela, tags e botao de promover', async () => {
    const { container } = renderPage(<IndentCatalogo />);
    await screen.findByText('Produto 1');
    const classes = classesDoDom(container);
    expect(container.querySelector('.page.indent-page.indent-catalogo-page')).not.toBeNull();
    expect(container.querySelector('.page.indent-page > .page-header .eyebrow')).not.toBeNull();
    for (const c of [
      'indent-toolbar',
      'indent-busca',
      'indent-busca__campo',
      'indent-chips',
      'indent-chip-conta',
      'indent-tabela-caixa',
      'indent-tabela',
      'indent-num',
      'indent-cell-main',
      'indent-cell-sub',
      'indent-tag',
      'indent-tag--ok',
      'indent-tag--manual',
      'indent-acao',
      'indent-promover',
      'indent-paginacao',
    ]) {
      expect(classes.has(c), c).toBe(true);
    }
    expect(container.querySelector('.chip.chip--active')).not.toBeNull();
    expect(container.querySelector('.table-wrapper > table.table.indent-tabela')).not.toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('Fornecedores: linha clicavel, tags de produto (+N), clientes aprovado/bloqueado e o modal com caixa rolavel de produtos, switch e eyebrow', async () => {
    const { container } = renderPage(<IndentFornecedores />);
    await screen.findByText('Shandong Haohua Chemical Co.');
    for (const c of ['indent-linha-clicavel', 'indent-tag-row', 'indent-tag--lock', 'indent-tag--ok', 'indent-dica']) {
      expect(classesDoDom(container).has(c), c).toBe(true);
    }
    fireEvent.click(container.querySelector('tbody tr') as HTMLElement);
    await screen.findByRole('dialog', { name: 'Shandong Haohua Chemical Co.' });
    await screen.findByRole('checkbox', { name: /Ureia técnica/ });
    const classes = classesDoDom(container);
    for (const c of [
      'modal-eyebrow',
      'indent-form',
      'indent-campos',
      'indent-produtos-caixa',
      'indent-check',
      'indent-parceria',
      'indent-switch',
    ]) {
      expect(classes.has(c), c).toBe(true);
    }
    // a caixa rolavel de produtos e uma classe (max-height: 190px vem da regiao), nunca estilo inline
    const caixa = container.querySelector('.indent-produtos-caixa') as HTMLElement;
    expect(caixa.hasAttribute('style')).toBe(false);
    expect(caixa.querySelectorAll('.indent-check')).toHaveLength(2);
    expect(container.querySelector('.indent-switch > input[role="switch"] + i')).not.toBeNull();
    expect(container.querySelector('.modal-header__titles > .modal-eyebrow + h2')).not.toBeNull();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('Clientes: badge, tags, cartoes de modo (is-selected), lista de fornecedores e campos do modal', async () => {
    const { container } = renderPage(<IndentClientes />);
    await screen.findByText('Indústria Química Vale do Itajaí Ltda');
    expect(container.querySelector('.badge.badge--warning')).not.toBeNull();
    expect(container.querySelector('.indent-tag--pd')).not.toBeNull();

    fireEvent.click(container.querySelector('tbody tr') as HTMLElement);
    await screen.findByRole('dialog', { name: 'Indústria Química Vale do Itajaí Ltda' });
    await screen.findByRole('checkbox', { name: /Shandong/ });
    const classes = classesDoDom(container);
    for (const c of ['indent-opcoes', 'indent-opcao', 'indent-lista-fornecedores', 'indent-check']) expect(classes.has(c), c).toBe(true);
    const cartoes = container.querySelectorAll('.indent-opcoes > .indent-opcao');
    expect(cartoes).toHaveLength(3);
    expect(Array.from(cartoes).map((c) => c.classList.contains('is-selected'))).toEqual([false, true, false]);
    expect(container.querySelector('.indent-opcoes[role="radiogroup"] [aria-checked]')).toBeNull();
    expect(Array.from(container.querySelectorAll('.indent-opcoes input[type="radio"]')).map((r) => (r as HTMLInputElement).checked)).toEqual([false, true, false]);
    expect(container.querySelector('.alert.alert--info')).not.toBeNull();
    expect(container.querySelector('.modal-actions > .ghost-button')).not.toBeNull();
    expect(container.querySelector('.modal-actions > .primary-button')).not.toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('Importacao: busca cheia, caixa da lista, item ja existente (tag) e paginacao', async () => {
    const { container } = renderPage(<IndentCatalogo />);
    fireEvent.click(await screen.findByRole('button', { name: 'Importar do IntelliQuote' }));
    await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    await screen.findByText('Ácido fosfórico 85%');
    const classes = classesDoDom(container);
    for (const c of ['indent-busca--cheia', 'indent-lista-caixa', 'indent-check', 'alert--info']) expect(classes.has(c), c).toBe(true);
    await waitFor(() => expect(container.querySelectorAll('.indent-paginacao').length).toBeGreaterThan(0));
    expect(container.querySelector('dialog [style]')).toBeNull();
  });

  it('toda classe indent-* da regiao existe no DOM de alguma tela e a regiao cobre as classes de layout usadas', async () => {
    const todas = new Set<string>();
    const add = (set: Set<string>) => set.forEach((c) => todas.add(c));

    const catalogo = renderPage(<IndentCatalogo />);
    await screen.findByText('Produto 1');
    fireEvent.click(screen.getByRole('button', { name: 'Novo produto' }));
    await screen.findByRole('dialog', { name: 'Novo produto' });
    add(classesDoDom(catalogo.container));
    catalogo.unmount();

    const imp = renderPage(<IndentCatalogo />);
    fireEvent.click(await screen.findByRole('button', { name: 'Importar do IntelliQuote' }));
    await screen.findByText('Ácido fosfórico 85%');
    add(classesDoDom(imp.container));
    imp.unmount();

    const forn = renderPage(<IndentFornecedores />);
    await screen.findByText('Shandong Haohua Chemical Co.');
    fireEvent.click(forn.container.querySelector('tbody tr') as HTMLElement);
    await screen.findByRole('checkbox', { name: /Ureia técnica/ });
    add(classesDoDom(forn.container));
    forn.unmount();

    const cli = renderPage(<IndentClientes />);
    await screen.findByText('Indústria Química Vale do Itajaí Ltda');
    add(classesDoDom(cli.container));
    fireEvent.click(cli.container.querySelector('tbody tr') as HTMLElement);
    await screen.findByRole('checkbox', { name: /Shandong/ });
    add(classesDoDom(cli.container));
    cli.unmount();

    // estado vazio: tabela de clientes sem linhas
    vi.mocked(api.get).mockImplementation((async () => pagina([], 1)) as typeof api.get);
    const vazio = renderPage(<IndentClientes />);
    await screen.findByText('Nenhum cliente cadastrado.');
    add(classesDoDom(vazio.container));

    const semEstilo = Array.from(classesDoCss).filter((c) => !todas.has(c));
    expect(semEstilo).toEqual([]);
    // as unicas classes "indent-*" de marcacao sem regra propria sao os marcadores de cada pagina
    const semRegra = Array.from(todas).filter((c) => c.startsWith('indent-') && !classesDoCss.has(c));
    expect(semRegra.sort()).toEqual(['indent-catalogo-page', 'indent-clientes-page', 'indent-fornecedores-page']);
  });
});
