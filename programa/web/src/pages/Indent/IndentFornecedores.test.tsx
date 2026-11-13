import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentFornecedores from './IndentFornecedores';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
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

import { api } from '@/api/client';

function fornecedor(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    country: 'China',
    contactName: 'Wei Zhang',
    type: 'FABRICANTE',
    defaultCurrency: 'USD',
    defaultIncoterm: 'CFR',
    hasPartnership: false,
    importedFromIq: false,
    isActive: true,
    createdAt: '2026-11-12T12:00:00.000Z',
    updatedAt: '2026-11-12T12:00:00.000Z',
    approvedBy: 0,
    blockedBy: 0,
    products: [],
    ...extra,
  };
}

const FORNECEDORES = [
  fornecedor(1, 'Shandong Haohua Chemical Co.', {
    hasPartnership: true,
    approvedBy: 2,
    blockedBy: 0,
    products: [
      { id: 1, name: 'Ácido cítrico anidro', isActive: true },
      { id: 2, name: 'Tripolifosfato de sódio', isActive: true },
      { id: 3, name: 'Carbonato de sódio denso', isActive: true },
      { id: 4, name: 'Hidróxido de sódio escamas 99%', isActive: true },
      { id: 5, name: 'Ureia técnica', isActive: false },
    ],
  }),
  fornecedor(2, 'Gujarat Alkalies Trading', {
    country: 'Índia',
    contactName: null,
    type: 'TRADING',
    defaultIncoterm: 'CIF',
    approvedBy: 1,
    blockedBy: 3,
    products: [{ id: 6, name: 'Sulfato de alumínio', isActive: true }],
  }),
  fornecedor(3, 'Nordic Solvents AB', { country: null, type: 'IMPORTADO', defaultCurrency: 'EUR' }),
];

function mockApi(rows: unknown[] = FORNECEDORES) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/suppliers') {
      return { data: rows, pagination: { page: 1, pageSize: 100, totalItems: rows.length, totalPages: 1 } };
    }
    if (url === '/api/v1/indent/products/options') return [];
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IndentFornecedores />
    </QueryClientProvider>,
  );
}

describe('IndentFornecedores', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    mockRole = 'comprador';
  });

  it('textos do mock: titulo, subtitulo, acoes, dica e cabecalhos (sem a coluna "Em aberto")', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');

    expect(screen.getByRole('heading', { level: 1, name: 'Fornecedores' })).toBeTruthy();
    expect(container.querySelector('.eyebrow')?.textContent).toBe('Indent');
    expect(screen.getByText('Cadastro próprio do Indent. Mostra quais clientes aprovam ou bloqueiam cada fornecedor.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar do IntelliQuote' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo fornecedor' })).toBeTruthy();
    expect(screen.getByText('Clique em um fornecedor para editar os dados e a parceria.')).toBeTruthy();

    const cabecalhos = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Fornecedor', 'Parceria', 'Contato', 'Produtos', 'Moeda · incoterm', 'Clientes']);
    expect(screen.queryByText('Em aberto')).toBeNull();
  });

  it('linha: "Pais · Tipo", parceria, contato, moeda · incoterm e clientes aprovado/bloqueado', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    const linhas = container.querySelectorAll('tbody tr');
    expect(linhas).toHaveLength(3);

    const [a, b, c] = Array.from(linhas) as HTMLElement[];
    expect(within(a as HTMLElement).getByText('China · Fabricante')).toBeTruthy();
    expect(within(a as HTMLElement).getByText('Parceria firmada')).toBeTruthy();
    expect(within(a as HTMLElement).getByText('Wei Zhang')).toBeTruthy();
    expect(within(a as HTMLElement).getByText('USD · CFR')).toBeTruthy();
    expect(within(a as HTMLElement).getByText('Aprovado por 2')).toBeTruthy();
    expect(within(a as HTMLElement).queryByText(/Bloqueado por/)).toBeNull();

    expect(within(b as HTMLElement).getByText('Índia · Trading')).toBeTruthy();
    expect(within(b as HTMLElement).getByText('Sem parceria')).toBeTruthy();
    expect(within(b as HTMLElement).getByText('USD · CIF')).toBeTruthy();
    expect(within(b as HTMLElement).getByText('Aprovado por 1')).toBeTruthy();
    expect(within(b as HTMLElement).getByText('Bloqueado por 3')).toBeTruthy();

    // sem pais: "—"; sem contato: "—"; EUR
    expect(within(c as HTMLElement).getByText('— · Importado')).toBeTruthy();
    expect(within(c as HTMLElement).getByText('EUR · CFR')).toBeTruthy();
    const celulas = (c as HTMLElement).querySelectorAll('td');
    expect(celulas[3]?.textContent).toBe('—'); // produtos
    expect(celulas[5]?.textContent).toBe('—'); // clientes
  });

  it('Produtos: ate 3 tags com as 2 primeiras palavras do nome + tag "+N"; sem produtos mostra "—"', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    const linhas = Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];

    const tags = Array.from(linhas[0]?.querySelectorAll('td')[3]?.querySelectorAll('.indent-tag') ?? []).map((t) => t.textContent);
    expect(tags).toEqual(['Ácido cítrico', 'Tripolifosfato de', 'Carbonato de', '+2']);

    const umProduto = Array.from(linhas[1]?.querySelectorAll('td')[3]?.querySelectorAll('.indent-tag') ?? []).map((t) => t.textContent);
    expect(umProduto).toEqual(['Sulfato de']);
    expect(linhas[1]?.querySelectorAll('td')[3]?.textContent).not.toContain('+');
  });

  it('linha clicavel (Enter e Espaco incluidos) abre o modal de edicao do fornecedor', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    const linha = container.querySelector('tbody tr') as HTMLElement;
    expect(linha.tabIndex).toBe(0);

    fireEvent.click(linha);
    const dialog = await screen.findByRole('dialog', { name: 'Shandong Haohua Chemical Co.' });
    expect(within(dialog).getByText('Editar fornecedor')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.keyDown(linha, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Shandong Haohua Chemical Co.' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.keyDown(linha, { key: ' ' });
    expect(await screen.findByRole('dialog', { name: 'Shandong Haohua Chemical Co.' })).toBeTruthy();
  });

  it('Novo fornecedor abre o modal de cadastro; Importar abre a importacao de fornecedores', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    fireEvent.click(screen.getByRole('button', { name: 'Novo fornecedor' }));
    const novo = await screen.findByRole('dialog', { name: 'Cadastro' });
    expect(within(novo).getByText('Novo fornecedor')).toBeTruthy();
    fireEvent.click(within(novo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Importar do IntelliQuote' }));
    expect(await screen.findByRole('dialog', { name: 'Importar fornecedores do IntelliQuote' })).toBeTruthy();
  });

  it('viewer: sem botoes de criar/importar, sem a dica e linhas nao clicaveis', async () => {
    mockRole = 'viewer';
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    expect(screen.queryByRole('button', { name: 'Novo fornecedor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar do IntelliQuote' })).toBeNull();
    expect(screen.queryByText('Clique em um fornecedor para editar os dados e a parceria.')).toBeNull();

    const linha = container.querySelector('tbody tr') as HTMLElement;
    expect(linha.hasAttribute('tabindex')).toBe(false);
    fireEvent.click(linha);
    fireEvent.keyDown(linha, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lista vazia: aviso', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText('Nenhum fornecedor cadastrado.')).toBeTruthy();
  });
});
