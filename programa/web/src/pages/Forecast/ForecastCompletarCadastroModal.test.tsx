import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastCompletarCadastroModal from './ForecastCompletarCadastroModal';

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

// Dados 100% sinteticos.
let fontes: unknown[];
let familias: unknown[];
let produtos: unknown[];
let client: QueryClient;
const onFechar = vi.fn();
const onConcluido = vi.fn();

function mockLeituras() {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/sources') return { data: fontes };
    if (path === '/v1/item-families') return { data: familias };
    if (path === '/v1/forecast/products') return { data: produtos };
    throw new Error(`GET inesperado: ${path}`);
  });
}

function renderModal(inativos?: Record<string, string>) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastCompletarCadastroModal codigo="TST0901" inativos={inativos} onFechar={onFechar} onConcluido={onConcluido} />
    </QueryClientProvider>,
  );
}

const fonte = (id: number, name: string, leadTimeDays: number | null, isActive = true) => ({
  id,
  name,
  leadTimeDays,
  clearanceDays: null,
  isActive,
});

beforeEach(() => {
  vi.clearAllMocks();
  fontes = [fonte(3, 'FONTE 001', 45), fonte(4, 'FONTE 002', null), fonte(5, 'FONTE 003', 10, false)];
  familias = [
    { id: 7, name: 'FAMILIA A', isActive: true },
    { id: 8, name: 'FAMILIA B', isActive: true },
  ];
  produtos = [
    { id: 1, name: 'PRODUTO 001', isActive: true, origin: 'planilha', codes: [{ id: 11, position: 1, code: 'TST0001' }] },
    { id: 2, name: 'PRODUTO 002', isActive: true, origin: 'dbcorp', codes: [{ id: 21, position: 1, code: 'TST0002' }] },
    {
      id: 3,
      name: 'PRODUTO 003',
      isActive: true,
      origin: 'dbcorp',
      codes: Array.from({ length: 7 }, (_, i) => ({ id: 300 + i, position: i + 1, code: `TST03${i}` })),
    },
    { id: 4, name: 'PRODUTO 004', isActive: false, origin: 'planilha', codes: [] },
  ];
  mockLeituras();
});

const campoNome = () => screen.getByLabelText('Nome do produto') as HTMLInputElement;
const campoFonte = () => screen.getByLabelText('Fonte') as HTMLSelectElement;
const campoFamilia = () => screen.getByLabelText('Família') as HTMLSelectElement;
const cadastrar = () => screen.getByRole('button', { name: /Cadastrar produto|Cadastrando/ }) as HTMLButtonElement;

async function abrirNovo() {
  renderModal();
  await screen.findByLabelText('Nome do produto');
}

describe('ForecastCompletarCadastroModal - novo produto', () => {
  it('abre como dialogo com titulo, codigo pendente pre-preenchido e fontes/familias ativas', async () => {
    await abrirNovo();
    expect(screen.getByRole('heading', { name: 'Completar cadastro' })).toBeTruthy();
    expect(screen.getByText('Código pendente:')).toBeTruthy();
    expect((screen.getByLabelText('Código 1') as HTMLInputElement).value).toBe('TST0901');
    expect(within(campoFonte()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Escolha a fonte',
      'FONTE 001 · 45 dias',
      'FONTE 002 · sem lead time',
    ]);
    expect(within(campoFamilia()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Escolha a família',
      'FAMILIA A',
      'FAMILIA B',
    ]);
    expect(screen.getByText(/A quinzena já gravada não muda\./)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/sources');
    expect(get).toHaveBeenCalledWith('/v1/item-families');
  });

  it('enviar vazio mostra os erros por campo, foca o primeiro e nao chama a API', async () => {
    await abrirNovo();
    fireEvent.click(cadastrar());
    expect(await screen.findByText('Informe o nome do produto.')).toBeTruthy();
    expect(screen.getByText('Escolha a fonte.')).toBeTruthy();
    expect(screen.getByText('Escolha a família.')).toBeTruthy();
    expect(campoNome().getAttribute('aria-invalid')).toBe('true');
    expect(campoNome().getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(campoNome());
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('o erro de um campo some quando ele muda (sem erro velho ao lado do valor novo)', async () => {
    await abrirNovo();
    fireEvent.click(cadastrar());
    expect(await screen.findByText('Informe o nome do produto.')).toBeTruthy();
    expect(screen.getByText('Escolha a fonte.')).toBeTruthy();
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 901' } });
    expect(screen.queryByText('Informe o nome do produto.')).toBeNull();
    expect(campoNome().getAttribute('aria-invalid')).toBeNull();
    // Os outros continuam ate serem corrigidos.
    expect(screen.getByText('Escolha a fonte.')).toBeTruthy();
    fireEvent.change(campoFonte(), { target: { value: '3' } });
    expect(screen.queryByText('Escolha a fonte.')).toBeNull();
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    expect(screen.queryByText('Escolha a família.')).toBeNull();
  });

  it('fonte COM lead time: cria o produto com o corpo certo, sem PATCH, e avisa o chamador', async () => {
    post.mockResolvedValue({ data: { id: 55, nome: 'PRODUTO 901', ativo: true, origem: 'dbcorp', fonteId: 3, familiaId: 7, codigos: [] } });
    await abrirNovo();
    fireEvent.change(campoNome(), { target: { value: '  PRODUTO   901 ' } });
    fireEvent.change(campoFonte(), { target: { value: '3' } });
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    expect(screen.queryByLabelText('Lead time da fonte (dias)')).toBeNull();
    fireEvent.click(cadastrar());
    await waitFor(() => expect(onConcluido).toHaveBeenCalledWith({ tipo: 'novo' }));
    expect(post).toHaveBeenCalledWith('/v1/forecast/products', {
      nome: 'PRODUTO 901',
      codigos: ['TST0901'],
      sourceId: 3,
      familyId: 7,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('fonte SEM lead time: pede os dias, valida e grava na fonte ANTES de criar o produto', async () => {
    const ordem: string[] = [];
    patch.mockImplementation(async () => {
      ordem.push('patch');
      return { data: fonte(4, 'FONTE 002', 60) };
    });
    post.mockImplementation(async () => {
      ordem.push('post');
      return { data: { id: 55 } };
    });
    await abrirNovo();
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(campoFonte(), { target: { value: '4' } });
    fireEvent.change(campoFamilia(), { target: { value: '8' } });
    const lead = screen.getByLabelText('Lead time da fonte (dias)') as HTMLInputElement;
    expect(screen.getByText(/Esta fonte não tem lead time\./)).toBeTruthy();

    fireEvent.click(cadastrar());
    expect(await screen.findByText('Informe o lead time da fonte em dias (1 a 999).')).toBeTruthy();
    expect(document.activeElement).toBe(lead);
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(lead, { target: { value: '60' } });
    fireEvent.click(cadastrar());
    await waitFor(() => expect(onConcluido).toHaveBeenCalledWith({ tipo: 'novo' }));
    expect(patch).toHaveBeenCalledWith('/v1/forecast/sources/4', { leadTimeDays: 60 });
    expect(post).toHaveBeenCalledWith('/v1/forecast/products', {
      nome: 'PRODUTO 901',
      codigos: ['TST0901'],
      sourceId: 4,
      familyId: 8,
    });
    expect(ordem).toEqual(['patch', 'post']);
  });

  it('409 do backend aparece em role=alert em portugues; o dialogo continua aberto', async () => {
    post.mockRejectedValue(new ApiError(409, { message: 'Já existe um produto com esse nome.' }));
    await abrirNovo();
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 001' } });
    fireEvent.change(campoFonte(), { target: { value: '3' } });
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    fireEvent.click(cadastrar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Já existe um produto com esse nome.');
    expect(onConcluido).not.toHaveBeenCalled();
    expect(cadastrar().disabled).toBe(false);
  });

  it('lead time gravado mas o produto recusado: a mensagem diz o que ja foi gravado', async () => {
    patch.mockResolvedValue({ data: fonte(4, 'FONTE 002', 60) });
    post.mockRejectedValue(new ApiError(409, { message: 'O código TST0901 já pertence ao produto PRODUTO 009.' }));
    await abrirNovo();
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(campoFonte(), { target: { value: '4' } });
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Lead time da fonte (dias)'), { target: { value: '60' } });
    fireEvent.click(cadastrar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(
      'O lead time da fonte foi gravado, mas o produto não foi cadastrado. O código TST0901 já pertence ao produto PRODUTO 009.',
    );
  });

  it('Esc e clique no fundo sao ignorados com a gravacao pendente; a falha parcial continua visivel', async () => {
    let rejeitar: (erro: unknown) => void = () => undefined;
    patch.mockResolvedValue({ data: fonte(4, 'FONTE 002', 60) });
    post.mockReturnValue(
      new Promise((_, rej) => {
        rejeitar = rej;
      }),
    );
    const { container } = renderModal();
    await screen.findByLabelText('Nome do produto');
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(campoFonte(), { target: { value: '4' } });
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Lead time da fonte (dias)'), { target: { value: '60' } });
    fireEvent.click(cadastrar());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(cadastrar().disabled).toBe(true);

    const dialogo = container.ownerDocument.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogo, new Event('cancel', { cancelable: true }));
    fireEvent.mouseDown(dialogo);
    fireEvent.click(dialogo);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onFechar).not.toHaveBeenCalled();

    rejeitar(new ApiError(409, { message: 'O código TST0901 já pertence ao produto PRODUTO 009.' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(
      'O lead time da fonte foi gravado, mas o produto não foi cadastrado. O código TST0901 já pertence ao produto PRODUTO 009.',
    );
    // Terminada a gravacao o dialogo volta a fechar (o estado "gravando" desce um render depois do botao): tenta
    // o Esc ate o dialogo aceitar.
    await waitFor(
      () => {
        fireEvent(dialogo, new Event('cancel', { cancelable: true }));
        expect(onFechar).toHaveBeenCalledTimes(1);
      },
      { timeout: 5000 },
    );
  });

  it('503 (importacao em andamento) mostra a mensagem de tentar de novo', async () => {
    post.mockRejectedValue(
      new ApiError(503, { message: 'O cadastro está ocupado por uma importação. Tente novamente em instantes.' }),
    );
    await abrirNovo();
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(campoFonte(), { target: { value: '3' } });
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    fireEvent.click(cadastrar());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'O cadastro está ocupado por uma importação. Tente novamente em instantes.',
    );
  });

  it('ate 7 codigos: adicionar desabilita no limite; remover volta a habilitar; 1 codigo nao tem Remover', async () => {
    await abrirNovo();
    expect(screen.queryByRole('button', { name: /Remover código/ })).toBeNull();
    const adicionar = () => screen.getByRole('button', { name: 'Adicionar outro código' }) as HTMLButtonElement;
    for (let i = 0; i < 6; i += 1) fireEvent.click(adicionar());
    expect(screen.getAllByLabelText(/^Código \d$/)).toHaveLength(7);
    expect(adicionar().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover código 7' }));
    expect(screen.getAllByLabelText(/^Código \d$/)).toHaveLength(6);
    expect(adicionar().disabled).toBe(false);
  });

  it('codigo repetido e codigo de produto inativo sao barrados no formulario', async () => {
    renderModal({ TST0902: 'PRODUTO 009' });
    await screen.findByLabelText('Nome do produto');
    fireEvent.change(campoNome(), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(campoFonte(), { target: { value: '3' } });
    fireEvent.change(campoFamilia(), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar outro código' }));
    fireEvent.change(screen.getByLabelText('Código 2'), { target: { value: 'tst0901' } });
    fireEvent.click(cadastrar());
    expect(await screen.findByText('Código repetido na lista: TST0901.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Código 2'), { target: { value: 'tst0902' } });
    fireEvent.click(cadastrar());
    expect(
      await screen.findByText(
        'O código TST0902 pertence ao produto inativo “PRODUTO 009”. Reative o produto para o código voltar ao cálculo.',
      ),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('carregando: mostra o estado; erro de leitura mostra alerta com "Tentar de novo" que refaz a leitura', async () => {
    let falhar = true;
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/sources') {
        if (falhar) throw new ApiError(500, null);
        return { data: fontes };
      }
      if (path === '/v1/item-families') return { data: familias };
      throw new Error(`GET inesperado: ${path}`);
    });
    renderModal();
    expect(screen.getByText('Carregando fontes e famílias…')).toBeTruthy();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar os dados do cadastro (HTTP 500).');
    falhar = false;
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByLabelText('Nome do produto')).toBeTruthy();
  });

  it('sem fonte ativa ou sem familia ativa: explica o que falta, sem formulario', async () => {
    fontes = [fonte(5, 'FONTE 003', 10, false)];
    renderModal();
    expect(await screen.findByText(/Não há fonte ativa no cadastro/)).toBeTruthy();
    expect(screen.queryByLabelText('Nome do produto')).toBeNull();
  });

  it('Esc (cancel do dialogo) e Cancelar chamam onFechar', async () => {
    const { container } = renderModal();
    await screen.findByLabelText('Nome do produto');
    const dialogo = container.ownerDocument.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogo, new Event('cancel', { cancelable: true }));
    expect(onFechar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onFechar).toHaveBeenCalledTimes(2);
  });

  it('abas com papel de tab, na ordem Novo / Existente', async () => {
    await abrirNovo();
    const abas = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(abas).toEqual(['Novo produto', 'Adicionar a produto existente']);
    expect(screen.getByRole('tab', { name: 'Novo produto' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('ForecastCompletarCadastroModal - adicionar a produto existente', () => {
  async function abrirExistente() {
    renderModal();
    await screen.findByLabelText('Nome do produto');
    fireEvent.click(screen.getByRole('tab', { name: 'Adicionar a produto existente' }));
    await screen.findByLabelText('Buscar produto por nome ou código');
  }

  it('lista so os produtos ativos com n/7 codigos; o de 7 codigos vem desabilitado', async () => {
    await abrirExistente();
    expect(get).toHaveBeenCalledWith('/v1/forecast/products');
    expect(screen.getByText('3 produtos')).toBeTruthy();
    expect(screen.queryByText('PRODUTO 004')).toBeNull();
    expect(screen.getAllByText('1/7 códigos')).toHaveLength(2);
    const cheio = screen.getByRole('radio', { name: /PRODUTO 003/ }) as HTMLInputElement;
    expect(cheio.disabled).toBe(true);
    expect(screen.getByText('7/7 códigos · cheio')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Acrescentar código' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('busca local por nome ou codigo e estado vazio', async () => {
    await abrirExistente();
    const busca = screen.getByLabelText('Buscar produto por nome ou código');
    fireEvent.change(busca, { target: { value: 'tst0002' } });
    expect(screen.getByRole('radio', { name: /PRODUTO 002/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /PRODUTO 001/ })).toBeNull();
    expect(screen.getByText('1 produto')).toBeTruthy();
    fireEvent.change(busca, { target: { value: 'nada disso' } });
    expect(screen.getByText('Nenhum produto encontrado.')).toBeTruthy();
  });

  it('escolher produto da PLANILHA mostra o aviso antes de gravar; acrescenta e devolve a origem', async () => {
    post.mockResolvedValue({
      data: { produtoId: 1, produtoOrigem: 'planilha', codigo: { id: 9, posicao: 2, codigo: 'TST0901' } },
    });
    await abrirExistente();
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    expect(screen.getByText(/Este produto vem da planilha\. Inclua o código também na planilha PO\.COMP\.01/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    await waitFor(() => expect(onConcluido).toHaveBeenCalledWith({ tipo: 'codigo', produtoOrigem: 'planilha' }));
    expect(post).toHaveBeenCalledWith('/v1/forecast/products/1/codigos', { codigo: 'TST0901' });
  });

  it('produto do DBCorp: sem aviso da planilha; erro 400/409 em role=alert', async () => {
    post.mockRejectedValue(new ApiError(409, { message: 'O código TST0901 já pertence ao produto PRODUTO 009.' }));
    await abrirExistente();
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 002/ }));
    expect(screen.queryByText(/Este produto vem da planilha/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O código TST0901 já pertence ao produto PRODUTO 009.');
    expect(onConcluido).not.toHaveBeenCalled();
  });

  it('produto escolhido que sai da lista pela busca deixa de contar: nao acrescenta o codigo', async () => {
    await abrirExistente();
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    const acrescentar = () => screen.getByRole('button', { name: 'Acrescentar código' }) as HTMLButtonElement;
    expect(acrescentar().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Buscar produto por nome ou código'), { target: { value: 'tst0002' } });
    expect(screen.queryByRole('radio', { name: /PRODUTO 001/ })).toBeNull();
    expect(acrescentar().disabled).toBe(true);
    expect(screen.queryByText(/Este produto vem da planilha/)).toBeNull();
    fireEvent.submit(acrescentar().closest('form') as HTMLFormElement);
    expect(post).not.toHaveBeenCalled();
  });

  it('lista cortada em 50 produtos avisa para refinar a busca', async () => {
    produtos = Array.from({ length: 60 }, (_, i) => ({
      id: 100 + i,
      name: `PRODUTO ${String(i).padStart(3, '0')}`,
      isActive: true,
      origin: 'dbcorp',
      codes: [],
    }));
    await abrirExistente();
    expect(screen.getByText('Mostrando 50 de 60 produtos. Refine a busca para ver os demais.')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(50);
  });

  it('sem produto ativo: mensagem de vazio apontando a outra aba', async () => {
    produtos = [];
    renderModal();
    await screen.findByLabelText('Nome do produto');
    fireEvent.click(screen.getByRole('tab', { name: 'Adicionar a produto existente' }));
    expect(await screen.findByText(/Não há produto ativo no cadastro/)).toBeTruthy();
  });
});
