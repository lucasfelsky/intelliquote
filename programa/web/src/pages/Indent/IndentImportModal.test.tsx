import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentImportModal, { LIMITE_IMPORTACAO, mensagemImportacao } from './IndentImportModal';

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

const PRODUTOS = [
  { id: 1, name: 'Ácido fosfórico 85%', marketName: 'Phosphoric acid 85%', alreadyInIndent: false },
  { id: 2, name: 'Glicerina bidestilada', marketName: 'Glycerin', alreadyInIndent: false },
  { id: 3, name: 'Ácido cítrico anidro', marketName: 'Citric acid', alreadyInIndent: true },
];

const FORNECEDORES = [
  { id: 10, name: 'Jiangsu Huaxing Chemical Co.', country: 'China', alreadyInIndent: false },
  { id: 11, name: 'Nordic Solvents AB', country: 'Suécia', alreadyInIndent: true },
];

function pagina(rows: unknown[], totalPages = 1) {
  return { data: rows, pagination: { page: 1, pageSize: 100, totalItems: rows.length, totalPages } };
}

function mockApi(produtos: unknown[] = PRODUTOS, fornecedores: unknown[] = FORNECEDORES, totalPages = 1) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/import/products') return pagina(produtos, totalPages);
    if (url === '/api/v1/indent/import/suppliers') return pagina(fornecedores, totalPages);
    return [];
  }) as typeof api.get);
}

function renderModal(kind: 'produtos' | 'fornecedores') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <IndentImportModal kind={kind} onClose={onClose} onImported={onImported} />
    </QueryClientProvider>,
  );
  return { onImported, onClose };
}

describe('IndentImportModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset().mockResolvedValue({ created: 0, skipped: [] });
  });

  it('mensagem do toast: singular e plural', () => {
    expect(mensagemImportacao(1)).toBe('1 registro importado do IntelliQuote, sem vínculo');
    expect(mensagemImportacao(2)).toBe('2 registros importados do IntelliQuote, sem vínculo');
    expect(mensagemImportacao(0)).toBe('0 registros importados do IntelliQuote, sem vínculo');
  });

  it('produtos: titulo, alerta de copia, itens com o nome de mercado e sem a linha "Lista de exemplo do mock-up."', async () => {
    mockApi();
    renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    expect(within(dialog).getByText('Os dados são copiados. Depois de importar, o cadastro do Indent não acompanha mais o do IntelliQuote.')).toBeTruthy();
    await within(dialog).findByText('Ácido fosfórico 85%');
    expect(within(dialog).getByText('Phosphoric acid 85%')).toBeTruthy();
    expect(within(dialog).queryByText(/Lista de exemplo do mock-up/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Importar selecionados' })).toBeTruthy();
  });

  it('fornecedores: titulo proprio e a sub-linha mostra o pais', async () => {
    mockApi();
    renderModal('fornecedores');
    const dialog = await screen.findByRole('dialog', { name: 'Importar fornecedores do IntelliQuote' });
    await within(dialog).findByText('Jiangsu Huaxing Chemical Co.');
    expect(within(dialog).getByText('China')).toBeTruthy();
    expect(within(dialog).getByText('Suécia')).toBeTruthy();
  });

  it('os que ja estao no Indent ficam desabilitados com a tag "Já no Indent"; o botao so habilita com selecao', async () => {
    mockApi();
    renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    await within(dialog).findByText('Ácido cítrico anidro');

    const existente = within(dialog).getByRole('checkbox', { name: /Ácido cítrico anidro/ }) as HTMLInputElement;
    expect(existente.disabled).toBe(true);
    expect(existente.checked).toBe(false);
    expect(within(dialog).getByText('Já no Indent')).toBeTruthy();
    expect((within(dialog).getByRole('checkbox', { name: /Glicerina/ }) as HTMLInputElement).disabled).toBe(false);

    const importar = within(dialog).getByRole('button', { name: 'Importar selecionados' }) as HTMLButtonElement;
    expect(importar.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Glicerina/ }));
    expect(importar.disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Glicerina/ }));
    expect(importar.disabled).toBe(true);
  });

  it('importar produtos: POST com os ids escolhidos e toast "N registro(s) importado(s) do IntelliQuote, sem vínculo"', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue({ created: 2, skipped: [] });
    const { onImported } = renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    await within(dialog).findByText('Ácido fosfórico 85%');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Ácido fosfórico/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Glicerina/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar selecionados' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/indent/import/products', { ids: [1, 2] }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('2 registros importados do IntelliQuote, sem vínculo'));
  });

  it('importar fornecedores usa a rota de fornecedores; 1 registro no singular', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue({ created: 1, skipped: [] });
    const { onImported } = renderModal('fornecedores');
    const dialog = await screen.findByRole('dialog', { name: 'Importar fornecedores do IntelliQuote' });
    await within(dialog).findByText('Jiangsu Huaxing Chemical Co.');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Jiangsu/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar selecionados' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/indent/import/suppliers', { ids: [10] }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('1 registro importado do IntelliQuote, sem vínculo'));
  });

  it(`limite de ${LIMITE_IMPORTACAO}: acima dele o botao fica desabilitado com aviso`, async () => {
    const muitos = Array.from({ length: LIMITE_IMPORTACAO + 1 }, (_, i) => ({
      id: i + 1,
      name: `Produto ${i + 1}`,
      marketName: `Product ${i + 1}`,
      alreadyInIndent: false,
    }));
    mockApi(muitos);
    renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    await within(dialog).findByText('Produto 1');
    const importar = within(dialog).getByRole('button', { name: 'Importar selecionados' }) as HTMLButtonElement;

    for (const caixa of within(dialog).getAllByRole('checkbox').slice(0, LIMITE_IMPORTACAO)) fireEvent.click(caixa);
    expect(importar.disabled).toBe(false);
    expect(within(dialog).queryByRole('alert')).toBeNull();

    fireEvent.click(within(dialog).getAllByRole('checkbox')[LIMITE_IMPORTACAO] as HTMLElement);
    expect(importar.disabled).toBe(true);
    expect(within(dialog).getByRole('alert').textContent).toBe(`Selecione no máximo ${LIMITE_IMPORTACAO} registros por vez.`);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a busca (com atraso) vai ao servidor e a selecao sobrevive a nova busca', async () => {
    mockApi();
    renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    await within(dialog).findByText('Glicerina bidestilada');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Glicerina/ }));

    fireEvent.change(within(dialog).getByPlaceholderText('Buscar por nome'), { target: { value: ' fosfórico ' } });
    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/indent/import/products', expect.objectContaining({ q: 'fosfórico', page: 1 })),
    );
    expect((within(dialog).getByRole('checkbox', { name: /Glicerina/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('erro do servidor aparece no modal e nao fecha; lista vazia mostra aviso', async () => {
    mockApi();
    vi.mocked(api.post).mockRejectedValue(new ApiError(400, { message: 'Selecione ao menos um registro.' }));
    const { onImported } = renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    await within(dialog).findByText('Glicerina bidestilada');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Glicerina/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar selecionados' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Selecione ao menos um registro.');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('sem resultados: "Nenhum produto encontrado."', async () => {
    mockApi([]);
    renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    expect(await within(dialog).findByText('Nenhum produto encontrado.')).toBeTruthy();
  });

  it('Cancelar fecha sem importar', async () => {
    mockApi();
    const { onClose } = renderModal('produtos');
    const dialog = await screen.findByRole('dialog', { name: 'Importar produtos do IntelliQuote' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });
});
