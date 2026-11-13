import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IndentNovaSolicitacaoModal from './IndentNovaSolicitacaoModal';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Souza', email: 'u@b.c', role: 'comprador' } }),
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

const CLIENTES = [
  { id: 3, name: 'Cliente Alfa Ltda', city: 'Itajaí' },
  { id: 4, name: 'Beta Química SA', city: null },
];
const PRODUTOS = [
  { id: 1, name: 'Ácido cítrico anidro', cas: '77-92-9', isActive: true },
  { id: 2, name: 'Ureia técnica', cas: null, isActive: true },
];

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/requests/client-options') return CLIENTES;
    if (url === '/api/v1/indent/products/options') return PRODUTOS;
    return [];
  }) as typeof api.get);
  vi.mocked(api.post).mockResolvedValue({ id: 99, processNumber: '278/26' });
}

function Sonda() {
  const location = useLocation();
  return (
    <p data-testid="destino" data-toast={(location.state as { toast?: string } | null)?.toast ?? ''}>
      {location.pathname}
    </p>
  );
}

const onClose = vi.fn();

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/indent/solicitacoes']}>
        <Routes>
          <Route path="/indent/solicitacoes" element={<IndentNovaSolicitacaoModal onClose={onClose} />} />
          <Route path="/indent/solicitacoes/:id" element={<Sonda />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pronto() {
  await screen.findByRole('option', { name: 'Cliente Alfa Ltda' });
}

function preencher(produto: string, quantidade: string, indice = 0) {
  fireEvent.change(screen.getAllByLabelText('Produto')[indice] as HTMLElement, { target: { value: produto } });
  fireEvent.change(screen.getAllByLabelText('Quantidade (kg)')[indice] as HTMLElement, { target: { value: quantidade } });
}

describe('IndentNovaSolicitacaoModal', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    onClose.mockReset();
    mockApi();
  });

  it('cabecalho do mock, foco inicial no select Cliente (data-autofocus), responsavel "<nome> (voce)" e textos', async () => {
    const { container } = renderModal();
    await pronto();

    const dialog = screen.getByRole('dialog', { name: 'Nova solicitação' });
    expect(within(dialog).getByText('Origem: IQ Indent').className).toContain('modal-eyebrow');
    const cliente = screen.getByLabelText('Cliente') as HTMLSelectElement;
    expect(cliente.hasAttribute('data-autofocus')).toBe(true);
    expect(document.activeElement).toBe(cliente);
    expect(container.querySelector('[autofocus]')).toBeNull();

    expect(Array.from(cliente.options).map((o) => o.textContent)).toEqual(['Cliente Alfa Ltda', 'Beta Química SA']);
    expect(cliente.value).toBe('3');
    expect(screen.getByText('Ana Souza (você)')).toBeTruthy();
    expect(screen.getByText('Preenchido automaticamente com o seu usuário.').className).toContain('field-hint');
    expect(screen.getByText('Itens')).toBeTruthy();
    expect((screen.getByLabelText('Produto') as HTMLInputElement).placeholder).toBe('Digite ou escolha do catálogo');
    expect(screen.getByLabelText('Quantidade (kg)').getAttribute('inputmode')).toBe('decimal');
    // "item livre" em negrito, como no mock.
    const livre = screen.getByText('item livre');
    expect(livre.tagName).toBe('B');
    expect(livre.parentElement?.textContent).toBe('Se o produto não estiver no catálogo, ele entra como item livre e você pode promovê-lo depois.');
    expect(screen.getByRole('button', { name: 'Adicionar outro item' }).className).toContain('ghost-button--sm');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar solicitação' })).toBeTruthy();
    // estrutura de modal com cabecalho/rodape fixos: .modal-actions e o ultimo filho do form
    const form = container.querySelector('form.indent-form') as HTMLElement;
    expect(form.lastElementChild?.className).toBe('modal-actions');
  });

  it('o datalist traz os produtos do catalogo', async () => {
    const { container } = renderModal();
    await pronto();
    await waitFor(() => expect(container.querySelectorAll('datalist#ns-catalogo option')).toHaveLength(2));
    expect(Array.from(container.querySelectorAll('datalist option')).map((o) => o.getAttribute('value'))).toEqual([
      'Ácido cítrico anidro',
      'Ureia técnica',
    ]);
    expect(screen.getByLabelText('Produto').getAttribute('list')).toBe('ns-catalogo');
  });

  it('adicionar e remover item: "Remover item" so a partir da 2a linha', async () => {
    renderModal();
    await pronto();
    expect(screen.queryByRole('button', { name: /Remover item/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro item' }));
    expect(screen.getAllByLabelText('Produto')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Remover item/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remover item 2' }));
    expect(screen.getAllByLabelText('Produto')).toHaveLength(1);
  });

  it('produto do catalogo envia productId; digitado a mao envia so a descricao; quantidade em pt-BR', async () => {
    renderModal();
    await pronto();
    await waitFor(() => expect(document.querySelectorAll('datalist#ns-catalogo option')).toHaveLength(2));

    preencher('  ácido  CÍTRICO anidro ', '25.000');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro item' }));
    preencher('  Produto   Novo X ', '1,5', 1);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar solicitação' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/requests', {
      clientId: 4,
      items: [
        { productId: 1, description: 'ácido  CÍTRICO anidro', quantityKg: 25000 },
        { description: 'Produto   Novo X', quantityKg: 1.5 },
      ],
    });
  });

  it('erros inline: produto vazio e quantidade invalida/zero; nada e enviado', async () => {
    renderModal();
    await pronto();

    fireEvent.click(screen.getByRole('button', { name: 'Criar solicitação' }));
    const alertas = await screen.findAllByRole('alert');
    expect(alertas.map((a) => a.textContent)).toEqual(['Informe o produto.', 'Informe a quantidade em kg.']);
    expect(screen.getByLabelText('Produto').getAttribute('aria-invalid')).toBe('true');

    preencher('Zinco', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Criar solicitação' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Informe a quantidade em kg.']));

    preencher('Zinco', 'abc');
    fireEvent.click(screen.getByRole('button', { name: 'Criar solicitação' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Informe a quantidade em kg.']));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('erro do backend aparece inline (alert) e o modal continua aberto', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(400, { message: 'Cliente inexistente ou inativo.' }));
    renderModal();
    await pronto();
    preencher('Zinco', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Criar solicitação' }));

    expect(await screen.findByText('Cliente inexistente ou inativo.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Nova solicitação' })).toBeTruthy();
    expect(screen.queryByTestId('destino')).toBeNull();
  });

  it('sucesso: navega para o detalhe levando o toast "Solicitação NNN/AA criada. Escolha os fornecedores"', async () => {
    renderModal();
    await pronto();
    preencher('Zinco', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Criar solicitação' }));

    const destino = await screen.findByTestId('destino');
    expect(destino.textContent).toBe('/indent/solicitacoes/99');
    expect(destino.getAttribute('data-toast')).toBe('Solicitação 278/26 criada. Escolha os fornecedores');
  });

  it('Cancelar chama onClose', async () => {
    renderModal();
    await pronto();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('erro ao carregar os clientes: alerta em pt-BR e "Criar solicitação" desabilitado', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === '/api/v1/indent/requests/client-options') throw new ApiError(500, { message: 'Erro interno do servidor.' });
      return [];
    }) as typeof api.get);
    renderModal();

    expect(await screen.findByText('Não foi possível carregar os clientes: Erro interno do servidor.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Criar solicitação' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Nenhum cliente ativo cadastrado.')).toBeNull();
  });

  it('carregando: opção "Carregando clientes…" e botão desabilitado; sem cliente ativo: dica "Nenhum cliente ativo cadastrado."', async () => {
    let liberar: (lista: unknown[]) => void = () => undefined;
    vi.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === '/api/v1/indent/requests/client-options') return new Promise<unknown[]>((resolve) => { liberar = resolve; });
      return [];
    }) as typeof api.get);
    renderModal();

    expect(screen.getByRole('option', { name: 'Carregando clientes…' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Criar solicitação' }) as HTMLButtonElement).disabled).toBe(true);

    liberar([]);
    expect(await screen.findByText('Nenhum cliente ativo cadastrado.')).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Carregando clientes…' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Criar solicitação' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Não foi possível carregar os clientes/)).toBeNull();
  });

});
