import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentCatalogo from './IndentCatalogo';

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

import { api, ApiError } from '@/api/client';

function produto(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    acronym: null,
    manufacturer: null,
    cas: null,
    unit: 'kg',
    synonyms: [],
    notes: null,
    origin: 'CADASTRADO',
    sourceRequestNumber: null,
    importedFromIq: false,
    isActive: true,
    createdAt: '2026-11-12T12:00:00.000Z',
    updatedAt: '2026-11-12T12:00:00.000Z',
    supplierCount: 0,
    ...extra,
  };
}

const PRODUTOS = [
  produto(1, 'Ácido cítrico anidro', { cas: '77-92-9', notes: 'Grau alimentício e técnico', supplierCount: 3 }),
  produto(2, 'Aditivo antiespumante base silicone 30%', {
    origin: 'LIVRE',
    sourceRequestNumber: '270/26',
    supplierCount: 0,
  }),
  produto(3, 'Ureia técnica', { cas: '57-13-6', notes: 'Granulada, 46% N', supplierCount: 1 }),
];

function resposta(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    data: rows,
    pagination: { page: 1, pageSize: 100, totalItems: rows.length, totalPages: 1 },
    counts: { total: 3, cadastrado: 2, livre: 1 },
    ...extra,
  };
}

function mockApi(rows: unknown[] = PRODUTOS, extra: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation((async (url: string, query?: Record<string, unknown>) => {
    if (url === '/api/v1/indent/products') {
      const origin = query?.origin as string | undefined;
      const lista = (rows as Array<{ origin: string }>).filter((p) => !origin || p.origin === origin);
      return resposta(lista, extra);
    }
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IndentCatalogo />
    </QueryClientProvider>,
  );
}

describe('IndentCatalogo', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    mockRole = 'comprador';
  });

  it('textos do mock: titulo, subtitulo, acoes, busca, chips com contagem, cabecalhos e linhas', async () => {
    mockApi();
    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeTruthy();
    expect(container.querySelector('.eyebrow')?.textContent).toBe('Indent');
    expect(container.querySelector('.indent-page.indent-catalogo-page')).not.toBeNull();
    expect(
      screen.getByText('Catálogo próprio do Indent, separado do IntelliQuote. Aceita item digitado à mão, sem cadastro.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar do IntelliQuote' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo produto' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Buscar por nome ou CAS')).toBeTruthy();
    expect(screen.getByText('Buscar produto', { selector: '.sr-only' })).toBeTruthy();

    await screen.findByText('Ácido cítrico anidro');
    expect(screen.getByRole('button', { name: /^Todos\s*3$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Cadastrados\s*2$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Digitados à mão\s*1$/ })).toBeTruthy();

    const cabecalhos = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(cabecalhos).toEqual(['Produto', 'CAS', 'Un.', 'Origem', 'Fornecedores', 'Ações']);

    const linhas = container.querySelectorAll('tbody tr');
    expect(linhas).toHaveLength(3);
    const primeira = linhas[0] as HTMLElement;
    expect(within(primeira).getByText('Grau alimentício e técnico')).toBeTruthy();
    expect(within(primeira).getByText('77-92-9')).toBeTruthy();
    expect(within(primeira).getByText('Cadastrado')).toBeTruthy();
    expect(primeira.querySelectorAll('td')[4]?.textContent).toBe('3');
    expect(primeira.querySelector('button')).toBeNull();

    const livre = linhas[1] as HTMLElement;
    expect(within(livre).getByText('Digitado na solicitação 270/26')).toBeTruthy();
    expect(within(livre).getByText('sem CAS')).toBeTruthy();
    expect(within(livre).getByText('Digitado à mão')).toBeTruthy();
    expect(within(livre).getByRole('button', { name: 'Promover ao catálogo' })).toBeTruthy();
    expect(livre.querySelectorAll('td')[4]?.textContent).toBe('0');
  });

  it('chip de origem pede ao servidor so aquela origem; a busca (com atraso) envia q', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Ácido cítrico anidro');

    fireEvent.click(screen.getByRole('button', { name: /^Digitados à mão/ }));
    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/indent/products', expect.objectContaining({ origin: 'LIVRE', page: 1 })),
    );
    await waitFor(() => expect(screen.queryByText('Ácido cítrico anidro')).toBeNull());
    expect(screen.getByRole('button', { name: /^Digitados à mão/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByPlaceholderText('Buscar por nome ou CAS'), { target: { value: '  silicone ' } });
    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/indent/products', expect.objectContaining({ q: 'silicone', origin: 'LIVRE' })),
    );
  });

  it('estado vazio: "Nenhum produto com esse filtro."', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText('Nenhum produto com esse filtro.')).toBeTruthy();
  });

  it('promover: POST em /products/:id/promote e toast com o nome do produto', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue(produto(2, 'Aditivo antiespumante base silicone 30%'));
    renderPage();
    const botao = await screen.findByRole('button', { name: 'Promover ao catálogo' });
    fireEvent.click(botao);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/indent/products/2/promote'));
    const toast = await screen.findByTestId('fc-toast');
    expect(toast.textContent).toContain('“Aditivo antiespumante base silicone 30%” agora faz parte do catálogo');
  });

  it('falha ao promover mostra o erro do servidor num alerta (sem toast)', async () => {
    mockApi();
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'O produto já está no catálogo.' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Promover ao catálogo' }));

    expect((await screen.findByRole('alert')).textContent).toBe('O produto já está no catálogo.');
    expect(screen.queryByTestId('fc-toast')).toBeNull();
  });

  it('viewer: sem Importar, Novo produto nem Promover (so consulta)', async () => {
    mockRole = 'viewer';
    mockApi();
    renderPage();
    await screen.findByText('Ácido cítrico anidro');
    expect(screen.queryByRole('button', { name: 'Importar do IntelliQuote' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo produto' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Promover ao catálogo' })).toBeNull();
    // a coluna de acoes continua (vazia) e a consulta segue completa
    expect(screen.getByText('Digitado à mão')).toBeTruthy();
  });

  it('Novo produto: campos do mock + sigla, fabricante e sinonimos; valida nome e CAS; envia e confirma por toast', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue(produto(9, 'Glicerina bidestilada'));
    renderPage();
    await screen.findByText('Ácido cítrico anidro');
    fireEvent.click(screen.getByRole('button', { name: 'Novo produto' }));

    const dialog = await screen.findByRole('dialog', { name: 'Novo produto' });
    for (const rotulo of ['Nome do produto', 'CAS (opcional)', 'Unidade', 'Sigla', 'Fabricante', 'Sinônimos (separados por vírgula)']) {
      expect(within(dialog).getByLabelText(rotulo), rotulo).toBeTruthy();
    }
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Nome do produto'));
    expect((within(dialog).getByLabelText('Unidade') as HTMLInputElement).value).toBe('kg');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByText('Informe o nome do produto.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Nome do produto'), { target: { value: ' Glicerina bidestilada ' } });
    fireEvent.change(within(dialog).getByLabelText('CAS (opcional)'), { target: { value: '5681-5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByText('CAS inválido.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('CAS (opcional)'), { target: { value: '56-81-5' } });
    fireEvent.change(within(dialog).getByLabelText('Sinônimos (separados por vírgula)'), { target: { value: 'glicerol, , glycerin ' } });
    fireEvent.change(within(dialog).getByLabelText('Sigla'), { target: { value: 'GLI' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/indent/products', {
        name: 'Glicerina bidestilada',
        cas: '56-81-5',
        unit: 'kg',
        acronym: 'GLI',
        manufacturer: null,
        synonyms: ['glicerol', 'glycerin'],
      }),
    );
    expect((await screen.findByTestId('fc-toast')).textContent).toContain('Produto Glicerina bidestilada cadastrado');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo produto' })).toBeNull());
  });

  it('erro do servidor no cadastro (nome repetido, 409) aparece no proprio modal', async () => {
    mockApi();
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Já existe um produto com este nome no Indent.' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo produto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo produto' });
    fireEvent.change(within(dialog).getByLabelText('Nome do produto'), { target: { value: 'Ureia técnica' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Já existe um produto com este nome no Indent.');
  });

  it('Importar do IntelliQuote abre o modal de importacao de produtos', async () => {
    mockApi();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Importar do IntelliQuote' }));
    expect(await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' })).toBeTruthy();
  });

  it('mais de uma pagina: mostra a paginacao e pede a pagina seguinte', async () => {
    mockApi(PRODUTOS, { pagination: { page: 1, pageSize: 100, totalItems: 150, totalPages: 2 } });
    renderPage();
    await screen.findByText('Ácido cítrico anidro');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/indent/products', expect.objectContaining({ page: 2 })),
    );
  });

  it('restoreFocus: fechar por Cancelar devolve o foco ao botao que abriu o modal', async () => {
    mockApi();
    renderPage();
    for (const nome of ["Novo produto","Importar do IntelliQuote"]) {
      const botao = await screen.findByRole('button', { name: nome });
      botao.focus();
      fireEvent.click(botao);
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement, nome).toBe(botao);
    }
  });

});
