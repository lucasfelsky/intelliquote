import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastGruposModal from './ForecastGruposModal';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
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

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.del);

// Dados 100% sinteticos.
const GRUPO = {
  id: 7,
  nome: 'GRUPO SINTETICO',
  observacao: 'OBS SINTETICA',
  principalProdutoId: 1,
  membros: [
    { id: 1, nome: 'PRODUTO 001', fonte: 'FONTE 001', ativo: true, sobDemanda: false },
    { id: 2, nome: 'PRODUTO 002', fonte: 'FONTE 002', ativo: true, sobDemanda: true },
  ],
};

const PRODUTOS = [
  { id: 1, name: 'PRODUTO 001', isActive: true, source: { name: 'FONTE 001' }, codes: [{ code: 'C0001' }], equivalenceGroupId: 7 },
  { id: 2, name: 'PRODUTO 002', isActive: true, source: { name: 'FONTE 002' }, codes: [{ code: 'C0002' }], equivalenceGroupId: 7 },
  { id: 3, name: 'PRODUTO 003', isActive: true, source: null, codes: [{ code: 'C0003' }], equivalenceGroupId: null },
  { id: 4, name: 'PRODUTO 004', isActive: true, source: { name: 'FONTE 004' }, codes: [{ code: 'C0004' }], equivalenceGroupId: null },
  { id: 5, name: 'PRODUTO 005', isActive: true, source: { name: 'FONTE 001' }, codes: [{ code: 'C0005' }], equivalenceGroupId: 9 },
  { id: 6, name: 'PRODUTO 006 INATIVO', isActive: false, source: null, codes: [], equivalenceGroupId: null },
];

const onFechar = vi.fn();
let client: QueryClient;
let grupos: unknown[];

function renderModal(podeEditar: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastGruposModal podeEditar={podeEditar} onFechar={onFechar} />
    </QueryClientProvider>,
  );
}

const clicar = (alvo: string | RegExp | HTMLElement) =>
  fireEvent.click(alvo instanceof HTMLElement ? alvo : screen.getByRole('button', { name: alvo }));

beforeEach(() => {
  vi.clearAllMocks();
  grupos = [GRUPO];
  get.mockImplementation(async (path: string) => ({ data: path.includes('equivalence-groups') ? grupos : PRODUTOS }));
  post.mockResolvedValue({ data: { ...GRUPO, id: 8, nome: 'NOVO GRUPO SINTETICO' } });
  patch.mockResolvedValue({ data: GRUPO });
  del.mockResolvedValue({ data: { id: 7 } });
});

describe('ForecastGruposModal - leitura', () => {
  it('lista o grupo com os membros, o principal e a observacao; leitura nao tem botoes de edicao', async () => {
    renderModal(false);
    expect(await screen.findByRole('heading', { name: 'Grupos de equivalência' })).toBeTruthy();
    const grupo = (await screen.findByRole('heading', { name: 'GRUPO SINTETICO' })).closest('li') as HTMLElement;
    expect(within(grupo).getByText('OBS SINTETICA')).toBeTruthy();
    const membros = within(grupo).getAllByRole('listitem').map((li) => li.textContent);
    expect(membros).toEqual(['PRODUTO 001FONTE 001Principal', 'PRODUTO 002FONTE 002']);
    expect(screen.getByText(/Só administrador e comprador criam ou alteram grupos/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo grupo' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar o grupo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Desfazer o grupo/ })).toBeNull();
    expect(get).toHaveBeenCalledWith('/v1/forecast/equivalence-groups');
  });

  it('avisa que a marca "sob demanda" de um membro e ignorada dentro do grupo', async () => {
    renderModal(false);
    expect(await screen.findByText(/Um membro está marcado como compra sob demanda: dentro do grupo essa marca é ignorada/)).toBeTruthy();
  });

  it('sem grupos: estado vazio; sem principal: explica a regra automatica', async () => {
    grupos = [];
    renderModal(true);
    expect(await screen.findByText('Nenhum grupo de equivalência cadastrado.')).toBeTruthy();
    grupos = [{ ...GRUPO, principalProdutoId: null }];
    client.clear();
    renderModal(false);
    expect(await screen.findAllByText(/Sem produto principal: a compra sai pelo membro de maior média/)).toHaveLength(1);
  });

  it('erro de carga: alerta em portugues e botao para tentar de novo', async () => {
    get.mockRejectedValue(new ApiError(403, {}));
    renderModal(false);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Seu perfil não pode criar nem alterar grupos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});

describe('ForecastGruposModal - criar', () => {
  const abrirNovo = async () => {
    renderModal(true);
    clicar(await screen.findByRole('button', { name: 'Novo grupo' }));
    return screen.findByRole('heading', { name: 'Novo grupo de equivalência' });
  };

  it('candidatos: so ativos e livres; produto de outro grupo nao aparece e a contagem explica', async () => {
    await abrirNovo();
    expect(await screen.findByText(/2 produtos · 3 produtos já estão em outro grupo e não aparecem aqui\./)).toBeTruthy();
    const nomes = screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent);
    expect(nomes).toEqual(['PRODUTO 003Sem fonte', 'PRODUTO 004FONTE 004']);
  });

  it('formulario vazio: erros em portugues com aria-invalid e foco no primeiro campo invalido', async () => {
    await abrirNovo();
    clicar('Revisar e salvar');
    expect(await screen.findByText('Informe o nome do grupo.')).toBeTruthy();
    expect(screen.getByText('Escolha ao menos 2 produtos para formar um grupo.')).toBeTruthy();
    const nome = screen.getByLabelText('Nome do grupo') as HTMLInputElement;
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    expect(nome.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(nome);
    expect(post).not.toHaveBeenCalled();
  });

  it('escolher 2 produtos + principal -> confirmar mostra os produtos; so entao grava e volta com o aviso', async () => {
    await abrirNovo();
    fireEvent.change(screen.getByLabelText('Nome do grupo'), { target: { value: '  NOVO GRUPO SINTETICO  ' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /PRODUTO 003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 004/ }));
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 004 como produto principal/ }));
    clicar('Revisar e salvar');

    // Passo de confirmacao: grupo errado esconde compra, entao os produtos ficam a vista antes de gravar.
    expect(await screen.findByRole('heading', { name: 'Confirmar o grupo NOVO GRUPO SINTETICO' })).toBeTruthy();
    expect(screen.getByText(/passam a ser avaliados como o MESMO material/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    const itens = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(itens).toEqual(['PRODUTO 003', 'PRODUTO 004Principal']);

    clicar('Confirmar e salvar');
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/forecast/equivalence-groups', {
        nome: 'NOVO GRUPO SINTETICO',
        observacao: null,
        produtoIds: [3, 4],
        principalProdutoId: 4,
      }),
    );
    expect(await screen.findByText('Grupo NOVO GRUPO SINTETICO criado.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'GRUPO SINTETICO' })).toBeTruthy();
  });

  it('"Voltar e revisar" volta ao formulario sem gravar e mantem o que foi digitado', async () => {
    await abrirNovo();
    fireEvent.change(screen.getByLabelText('Nome do grupo'), { target: { value: 'OUTRO GRUPO SINTETICO' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /PRODUTO 003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 004/ }));
    clicar('Revisar e salvar');
    clicar(await screen.findByRole('button', { name: 'Voltar e revisar' }));
    expect((screen.getByLabelText('Nome do grupo') as HTMLInputElement).value).toBe('OUTRO GRUPO SINTETICO');
    expect((screen.getByRole('checkbox', { name: /PRODUTO 003/ }) as HTMLInputElement).checked).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('409 do backend (produto em outro grupo) aparece em portugues no passo de confirmacao', async () => {
    post.mockRejectedValue(
      new ApiError(409, { message: 'O produto PRODUTO 003 já está no grupo OUTRO.' }, 'O produto PRODUTO 003 já está no grupo OUTRO.'),
    );
    await abrirNovo();
    fireEvent.change(screen.getByLabelText('Nome do grupo'), { target: { value: 'GRUPO X SINTETICO' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /PRODUTO 003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 004/ }));
    clicar('Revisar e salvar');
    clicar(await screen.findByRole('button', { name: 'Confirmar e salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O produto PRODUTO 003 já está no grupo OUTRO.');
  });

  it('tirar o principal da selecao volta o principal para "automatico"', async () => {
    await abrirNovo();
    fireEvent.click(await screen.findByRole('checkbox', { name: /PRODUTO 003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 004/ }));
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 003 como produto principal/ }));
    expect((screen.getByRole('radio', { name: /PRODUTO 003 como produto principal/ }) as HTMLInputElement).checked).toBe(true);
    clicar('Tirar PRODUTO 003 do grupo');
    expect((screen.getByRole('radio', { name: /Automático/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('cancelar volta para a lista sem gravar', async () => {
    await abrirNovo();
    clicar('Cancelar');
    expect(await screen.findByRole('heading', { name: 'GRUPO SINTETICO' })).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('ForecastGruposModal - editar e desfazer', () => {
  it('editar: membros atuais ja marcados (livres para o proprio grupo); tirar um e salvar envia so produtoIds novos', async () => {
    renderModal(true);
    clicar(await screen.findByRole('button', { name: 'Editar o grupo GRUPO SINTETICO' }));
    expect(await screen.findByRole('heading', { name: 'Editar o grupo GRUPO SINTETICO' })).toBeTruthy();
    expect((await screen.findByRole('checkbox', { name: /PRODUTO 001/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /PRODUTO 002/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /PRODUTO 001 como produto principal/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 002/ }));
    clicar('Revisar e salvar');
    clicar(await screen.findByRole('button', { name: 'Confirmar e salvar' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/forecast/equivalence-groups/7', {
        nome: 'GRUPO SINTETICO',
        observacao: 'OBS SINTETICA',
        produtoIds: [1, 3],
        principalProdutoId: 1,
      }),
    );
    expect(await screen.findByText('Grupo GRUPO SINTETICO atualizado.')).toBeTruthy();
  });

  it('desfazer: pede confirmacao, chama DELETE e volta com o aviso', async () => {
    renderModal(true);
    clicar(await screen.findByRole('button', { name: 'Desfazer o grupo GRUPO SINTETICO' }));
    expect(await screen.findByRole('heading', { name: 'Desfazer o grupo GRUPO SINTETICO' })).toBeTruthy();
    expect(screen.getByText(/Os 2 produtos voltam a ser avaliados separadamente/)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
    clicar('Desfazer grupo');
    await waitFor(() => expect(del).toHaveBeenCalledWith('/v1/forecast/equivalence-groups/7'));
    expect(await screen.findByText('Grupo GRUPO SINTETICO desfeito.')).toBeTruthy();
  });

  it('desfazer com erro do servidor mostra o alerta e continua no passo', async () => {
    del.mockRejectedValue(new ApiError(404, {}));
    renderModal(true);
    clicar(await screen.findByRole('button', { name: 'Desfazer o grupo GRUPO SINTETICO' }));
    clicar(await screen.findByRole('button', { name: 'Desfazer grupo' }));
    expect(await screen.findByText(/Grupo não encontrado/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Desfazer o grupo GRUPO SINTETICO' })).toBeTruthy();
  });

  it('gravar invalida o relatorio e a memoria de TODAS as quinzenas (cadastro ATUAL)', async () => {
    renderModal(true);
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    clicar(await screen.findByRole('button', { name: 'Desfazer o grupo GRUPO SINTETICO' }));
    clicar(await screen.findByRole('button', { name: 'Desfazer grupo' }));
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: ['forecast'] }));
  });
});

describe('ForecastGruposModal - acessibilidade', () => {
  it('o modal tem titulo, a lista e semantica de lista e os botoes de acao tem nome por grupo', async () => {
    renderModal(true);
    expect(await screen.findByRole('group', { name: 'Ações do grupo GRUPO SINTETICO' })).toBeTruthy();
  });
});
