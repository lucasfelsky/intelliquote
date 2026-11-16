import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import IndentCatalogo from './IndentCatalogo';

// Acoes por linha do Catalogo: editar (mesmo modal do Novo produto), inativar/reativar e excluir (com confirmacao).
// Usa o ConfirmProvider REAL; o IndentCatalogo.test.tsx cobre a lista com o useConfirm mockado.

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comprador' } }),
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

const LISTA = '/api/v1/indent/products';
const NOME = 'Ácido cítrico anidro';
const SEM_DADOS = 'Glicerina bidestilada';
const MSG_409_USO =
  'Não é possível excluir: o produto está vinculado a 2 fornecedores. Inative o produto para tirá-lo das listas de escolha.';

function produto(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    acronym: null,
    manufacturer: null,
    cas: null,
    unit: 'kg',
    synonyms: [] as string[],
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
  produto(1, NOME, {
    cas: '77-92-9',
    acronym: 'ACA',
    manufacturer: 'Fabricante Exemplo',
    synonyms: ['citric acid', 'E330'],
    supplierCount: 3,
  }),
  produto(2, 'Aditivo antiespumante base silicone 30%', { origin: 'LIVRE', sourceRequestNumber: '270/26' }),
  produto(3, 'Ureia técnica', { cas: '57-13-6', isActive: false }),
  // cas, sigla, fabricante e sinonimos vazios: exercita null x '' no payload so com o que mudou
  produto(4, SEM_DADOS, { unit: 'L' }),
];

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === LISTA) {
      return {
        data: PRODUTOS,
        pagination: { page: 1, pageSize: 100, totalItems: PRODUTOS.length, totalPages: 1 },
        counts: { total: 3, cadastrado: 2, livre: 1 },
      };
    }
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <IndentCatalogo />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

async function abrirEdicao(nome = NOME) {
  renderPage();
  const botao = await screen.findByRole('button', { name: `Editar ${nome}` });
  botao.focus();
  fireEvent.click(botao);
  const dialog = await screen.findByRole('dialog', { name: 'Editar produto' });
  return { botao, dialog };
}

async function abrirConfirmacao() {
  renderPage();
  const botao = await screen.findByRole('button', { name: `Excluir ${NOME}` });
  botao.focus();
  fireEvent.click(botao);
  const dialog = await screen.findByRole('dialog', { name: 'Excluir produto' });
  return { botao, dialog };
}

const toastTexto = () => screen.getByTestId('fc-toast').textContent ?? '';

describe('IndentCatalogo: acoes por linha', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset().mockResolvedValue(undefined);
    mockApi();
  });

  it('a lista pede inativos=1; a linha inativa tem a tag e Reativar, a ativa tem Inativar', async () => {
    renderPage();
    await screen.findByText(NOME);

    expect(api.get).toHaveBeenCalledWith(LISTA, expect.objectContaining({ inativos: 1 }));
    const inativa = screen.getByText('Ureia técnica').closest('tr') as HTMLElement;
    expect(within(inativa).getByText('Inativo')).toBeTruthy();
    expect(within(inativa).getByRole('button', { name: 'Reativar Ureia técnica' })).toBeTruthy();
    expect(within(inativa).queryByRole('button', { name: /^Inativar / })).toBeNull();
    const ativa = screen.getByText(NOME).closest('tr') as HTMLElement;
    expect(within(ativa).queryByText('Inativo')).toBeNull();
    expect(within(ativa).getByRole('button', { name: `Inativar ${NOME}` })).toBeTruthy();
  });

  it('linha LIVRE: Promover, Editar, Inativar e Excluir, nesta ordem', async () => {
    renderPage();
    const livre = (await screen.findByText('Aditivo antiespumante base silicone 30%')).closest('tr') as HTMLElement;

    const botoes = Array.from(livre.querySelectorAll('.row-actions button')).map((b) => b.textContent);
    expect(botoes).toEqual(['Promover ao catálogo', 'Editar', 'Inativar', 'Excluir']);
  });

  it('Editar abre o modal "Editar produto" com os campos preenchidos e o foco no nome', async () => {
    const { dialog } = await abrirEdicao();

    expect((within(dialog).getByLabelText('Nome do produto') as HTMLInputElement).value).toBe(NOME);
    expect((within(dialog).getByLabelText('CAS (opcional)') as HTMLInputElement).value).toBe('77-92-9');
    expect((within(dialog).getByLabelText('Unidade') as HTMLInputElement).value).toBe('kg');
    expect((within(dialog).getByLabelText('Sigla') as HTMLInputElement).value).toBe('ACA');
    expect((within(dialog).getByLabelText('Fabricante') as HTMLInputElement).value).toBe('Fabricante Exemplo');
    expect((within(dialog).getByLabelText('Sinônimos (separados por vírgula)') as HTMLInputElement).value).toBe(
      'citric acid, E330',
    );
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Nome do produto'));
  });

  it('salvar sem mudanca nao chama a API e fecha o modal', async () => {
    const { dialog } = await abrirEdicao();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar produto' })).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
  });

  it('mudar so o CAS envia so o CAS; limpar o CAS envia null; toast de atualizado', async () => {
    vi.mocked(api.put).mockResolvedValue(produto(1, NOME, { cas: '5949-29-1' }));
    const { dialog } = await abrirEdicao();

    fireEvent.change(within(dialog).getByLabelText('CAS (opcional)'), { target: { value: '5949-29-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/v1/indent/products/1', { cas: '5949-29-1' }));
    await waitFor(() => expect(toastTexto()).toContain(`Produto ${NOME} atualizado`));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar produto' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: `Editar ${NOME}` }));
    const segundo = await screen.findByRole('dialog', { name: 'Editar produto' });
    fireEvent.change(within(segundo).getByLabelText('CAS (opcional)'), { target: { value: '' } });
    fireEvent.click(within(segundo).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/api/v1/indent/products/1', { cas: null }));
  });

  it('validacao local: nome vazio e CAS invalido nao chamam a API', async () => {
    const { dialog } = await abrirEdicao();

    fireEvent.change(within(dialog).getByLabelText('Nome do produto'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByText('Informe o nome do produto.')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Nome do produto'), { target: { value: NOME } });
    fireEvent.change(within(dialog).getByLabelText('CAS (opcional)'), { target: { value: '7792-9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByText('CAS inválido.')).toBeTruthy();

    expect(api.put).not.toHaveBeenCalled();
  });

  it('nome de outro produto (409): erro no campo nome com aria-invalid e o modal continua aberto', async () => {
    vi.mocked(api.put).mockRejectedValue(
      new ApiError(409, { message: 'Já existe um produto com este nome no Indent.' }),
    );
    const { dialog } = await abrirEdicao();

    const campo = within(dialog).getByLabelText('Nome do produto') as HTMLInputElement;
    fireEvent.change(campo, { target: { value: 'Ureia técnica' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(campo.getAttribute('aria-invalid')).toBe('true'));
    expect(dialog.querySelector('.field-error')?.textContent).toBe('Já existe um produto com este nome no Indent.');
    expect(screen.getByRole('dialog', { name: 'Editar produto' })).toBeTruthy();
  });

  it('cancelar a edicao nao chama a API e devolve o foco ao botao Editar', async () => {
    const { botao, dialog } = await abrirEdicao();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar produto' })).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(botao);
  });

  it('inativar e reativar mandam so isActive e mostram o toast; falha vai ao alerta da pagina', async () => {
    vi.mocked(api.put).mockResolvedValueOnce(produto(1, NOME, { isActive: false }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `Inativar ${NOME}` }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/v1/indent/products/1', { isActive: false }));
    await waitFor(() => expect(toastTexto()).toContain(`Produto ${NOME} inativado`));

    vi.mocked(api.put).mockResolvedValueOnce(produto(3, 'Ureia técnica', { isActive: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Reativar Ureia técnica' }));

    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/api/v1/indent/products/3', { isActive: true }));
    await waitFor(() => expect(toastTexto()).toContain('Produto Ureia técnica reativado'));

    vi.mocked(api.put).mockRejectedValueOnce(new ApiError(404, { message: 'Produto não encontrado.' }));
    fireEvent.click(screen.getByRole('button', { name: `Inativar ${NOME}` }));

    expect((await screen.findByRole('alert')).textContent).toBe('Produto não encontrado.');
  });

  it('Excluir abre a confirmacao; Cancelar nao chama a API e devolve o foco ao botao', async () => {
    const { botao, dialog } = await abrirConfirmacao();

    expect(within(dialog).getByText(`Excluir “${NOME}”? Esta ação não pode ser desfeita.`)).toBeTruthy();
    // tira o foco do botao: so volta se o codigo o devolver
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).not.toBe(botao);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(document.activeElement).toBe(botao));
    expect(api.del).not.toHaveBeenCalled();
  });

  it('confirmar Excluir chama DELETE, recarrega a lista, mostra o toast e foca o titulo', async () => {
    const { dialog } = await abrirConfirmacao();
    const chamadasAntes = vi.mocked(api.get).mock.calls.filter((c) => c[0] === LISTA).length;

    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/api/v1/indent/products/1'));
    await waitFor(() => expect(toastTexto()).toContain(`Produto ${NOME} excluído`));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.filter((c) => c[0] === LISTA).length).toBeGreaterThan(chamadasAntes),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Catálogo' })),
    );
  });

  it('409 na exclusao: o alerta mostra a mensagem do servidor, sem toast, e o foco volta ao botao Excluir', async () => {
    vi.mocked(api.del).mockRejectedValue(new ApiError(409, { message: MSG_409_USO }));
    const { botao, dialog } = await abrirConfirmacao();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).not.toBe(botao);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    expect((await screen.findByRole('alert')).textContent).toBe(MSG_409_USO);
    expect(screen.queryByTestId('fc-toast')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });
});

describe('IndentCatalogo: payload da edicao so com o que mudou', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    mockApi();
  });

  async function salvarCom(nome: string, rotulo: string, valor: string) {
    vi.mocked(api.put).mockResolvedValue(produto(1, nome));
    const { dialog } = await abrirEdicao(nome);
    fireEvent.change(within(dialog).getByLabelText(rotulo), { target: { value: valor } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
  }

  it('produto com cas, sigla, fabricante e sinonimos vazios: salvar sem mudar nada fecha sem chamar a API', async () => {
    const { dialog } = await abrirEdicao(SEM_DADOS);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar produto' })).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
  });

  it.each([
    ['nome', SEM_DADOS, 'Nome do produto', '  Glicerina destilada ', { name: 'Glicerina destilada' }],
    ['unidade', SEM_DADOS, 'Unidade', 'kg', { unit: 'kg' }],
    ['unidade apagada volta a kg', SEM_DADOS, 'Unidade', '  ', { unit: 'kg' }],
    ['sigla', SEM_DADOS, 'Sigla', ' GLI ', { acronym: 'GLI' }],
    ['fabricante', SEM_DADOS, 'Fabricante', 'Fabricante Exemplo', { manufacturer: 'Fabricante Exemplo' }],
    ['sinonimos', SEM_DADOS, 'Sinônimos (separados por vírgula)', 'glicerol, , glycerin ', { synonyms: ['glicerol', 'glycerin'] }],
    ['sinonimos (acrescentar um)', NOME, 'Sinônimos (separados por vírgula)', 'citric acid, E330, x', { synonyms: ['citric acid', 'E330', 'x'] }],
    ['sigla apagada vira null', NOME, 'Sigla', '  ', { acronym: null }],
    ['fabricante apagado vira null', NOME, 'Fabricante', '', { manufacturer: null }],
  ])('alterar so %s envia so essa chave', async (_rotulo, nome, campo, valor, esperado) => {
    await salvarCom(nome, campo, valor);

    const id = nome === NOME ? 1 : 4;
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`/api/v1/indent/products/${id}`, esperado));
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});

describe('IndentCatalogo: mutacao pendente bloqueia as acoes (aria-disabled + guarda no onClick)', () => {
  const LIVRE = 'Aditivo antiespumante base silicone 30%';
  const PENDENTE = () => new Promise<never>(() => undefined);

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
    mockApi();
  });

  const botoesDaLinha = () => ({
    promover: screen.getByRole('button', { name: 'Promover ao catálogo' }),
    editar: screen.getByRole('button', { name: `Editar ${LIVRE}` }),
    inativar: screen.getByRole('button', { name: `Inativar ${LIVRE}` }),
    excluir: screen.getByRole('button', { name: `Excluir ${LIVRE}` }),
  });

  it.each([
    ['Promover ao catálogo', 'promover'],
    ['Inativar', 'inativar'],
    ['Excluir', 'excluir'],
  ] as const)('com %s pendente: 2o clique nao repete, os outros botoes nao disparam e o foco fica', async (_rotulo, qual) => {
    vi.mocked(api.post).mockImplementation(PENDENTE);
    vi.mocked(api.put).mockImplementation(PENDENTE);
    vi.mocked(api.del).mockImplementation(PENDENTE);
    renderPage();
    await screen.findByText(LIVRE);
    // Editar (que so abre o modal) e clicado junto com os demais enquanto a mutacao esta pendente.
    const inicio = qual;
    const botoes = botoesDaLinha();
    const origem = botoes[inicio];
    origem.focus();

    fireEvent.click(origem);
    if (inicio === 'excluir') {
      const confirmacao = await screen.findByRole('dialog', { name: 'Excluir produto' });
      fireEvent.click(within(confirmacao).getByRole('button', { name: 'Excluir' }));
    }
    await waitFor(() => expect(origem.getAttribute('aria-disabled')).toBe('true'));

    // 2o clique no mesmo botao e cliques em todos os outros (da linha e de outra linha)
    for (const botao of [origem, ...Object.values(botoes), ...[`Editar ${NOME}`, `Inativar ${NOME}`, `Excluir ${NOME}`].map((nome) => screen.getByRole('button', { name: nome }))]) {
      fireEvent.click(botao);
    }
    // o mutate do TanStack chama a funcao de forma assincrona: espera antes de contar as chamadas
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(vi.mocked(api.post).mock.calls.length).toBe(inicio === 'promover' ? 1 : 0);
    expect(vi.mocked(api.put).mock.calls.length).toBe(inicio === 'inativar' ? 1 : 0);
    expect(vi.mocked(api.del).mock.calls.length).toBe(inicio === 'excluir' ? 1 : 0);
    expect(screen.queryByRole('dialog', { name: 'Editar produto' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Excluir produto' })).toBeNull();
    for (const botao of Object.values(botoes)) expect(botao.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(origem);
  });

  it('sem mutacao pendente os botoes nao ficam aria-disabled', async () => {
    renderPage();
    await screen.findByText(LIVRE);

    for (const botao of Object.values(botoesDaLinha())) expect(botao.hasAttribute('aria-disabled')).toBe(false);
  });
});
