import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastDemandaComercialModal, {
  filtrarProdutosParaDemanda,
  type DemandaParaEditar,
} from './ForecastDemandaComercialModal';

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
const PRODUTOS = [
  { id: 5, name: 'PRODUTO 001', isActive: true, source: { name: 'FONTE 001', id: 1 }, codes: [{ code: 'C0001' }, { code: 'C0002' }] },
  { id: 6, name: 'PRODUTO ÁGUA 002', isActive: true, source: null, codes: [{ code: 'C0003' }] },
  { id: 7, name: 'PRODUTO 003 INATIVO', isActive: false, source: { name: 'FONTE 001' }, codes: [{ code: 'C0004' }] },
];

const onFechar = vi.fn();
const onSalvo = vi.fn();
let client: QueryClient;

function renderModal(demanda?: DemandaParaEditar) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastDemandaComercialModal hoje="2026-10-20" demanda={demanda} onFechar={onFechar} onSalvo={onSalvo} />
    </QueryClientProvider>,
  );
}

const campo = (rotulo: string | RegExp) => screen.getByLabelText(rotulo) as HTMLInputElement;
const preencher = (rotulo: string | RegExp, valor: string) => fireEvent.change(campo(rotulo), { target: { value: valor } });

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: PRODUTOS });
  post.mockResolvedValue({ data: { id: 9 } });
  patch.mockResolvedValue({ data: { id: 9 } });
});

describe('filtrarProdutosParaDemanda', () => {
  it('so produtos ativos; busca por nome (sem acento) ou por codigo', () => {
    const p = PRODUTOS.map((x) => ({ ...x, source: x.source ? { name: x.source.name } : null }));
    expect(filtrarProdutosParaDemanda(p, '').map((x) => x.id)).toEqual([5, 6]);
    expect(filtrarProdutosParaDemanda(p, 'agua').map((x) => x.id)).toEqual([6]);
    expect(filtrarProdutosParaDemanda(p, 'c0002').map((x) => x.id)).toEqual([5]);
    expect(filtrarProdutosParaDemanda(p, 'inativo')).toEqual([]);
  });
});

describe('ForecastDemandaComercialModal - lancar', () => {
  it('carrega os produtos ativos do cadastro e mostra o titulo e a regra do horizonte', async () => {
    renderModal();
    expect(await screen.findByRole('heading', { name: 'Lançar demanda do comercial' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/products');
    expect(await screen.findByText('2 produtos')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText('PRODUTO 003 INATIVO')).toBeNull();
    expect(screen.getByText(/Só soma ao Forecast quando a data de necessidade é posterior ao último mês de programação/)).toBeTruthy();
    // A data nova nao pode ser anterior a hoje: o campo ja nasce com o minimo.
    expect(campo('Data de necessidade').getAttribute('min')).toBe('2026-10-20');
    expect(campo(/Nº da Solicitação/).closest('.fcd-campo')?.textContent).toContain('não é consultada nem alterada');
  });

  it('a busca filtra a lista; a escolha que sai da lista e desfeita', async () => {
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    expect((screen.getByRole('radio', { name: /PRODUTO 001/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar produto por nome ou código' }), { target: { value: 'agua' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText('1 produto')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nada' } });
    expect(screen.getByText('Nenhum produto ativo encontrado.')).toBeTruthy();
    // O PRODUTO 001 saiu da lista pela busca: a escolha dele nao vale mais (nao chega ao envio).
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'agua' } });
    preencher('Quantidade pedida (kg)', '100');
    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    expect(screen.getByText('Escolha o produto.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('envio vazio: erros por campo em portugues, aria-invalid e foco no primeiro campo com erro; nada e enviado', async () => {
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    expect(await screen.findByText('Escolha o produto.')).toBeTruthy();
    expect(screen.getByText('Informe a quantidade em kg.')).toBeTruthy();
    expect(screen.getByText('Informe a data de necessidade.')).toBeTruthy();
    expect(screen.getByText('Informe o motivo (ao menos 3 caracteres).')).toBeTruthy();
    expect(campo('Quantidade pedida (kg)').getAttribute('aria-invalid')).toBe('true');
    expect(campo('Quantidade pedida (kg)').getAttribute('aria-describedby')).toContain('-kg-erro');
    expect(document.activeElement).toBe(screen.getAllByRole('radio')[0]);
    expect(post).not.toHaveBeenCalled();

    // Corrigir o campo limpa o erro dele.
    preencher('Quantidade pedida (kg)', '1.600');
    expect(screen.queryByText('Informe a quantidade em kg.')).toBeNull();
  });

  it('data anterior a hoje e kg com 4 casas sao barrados no cliente', async () => {
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    preencher('Quantidade pedida (kg)', '1,2345');
    preencher('Data de necessidade', '2026-10-19');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    expect(await screen.findByText('A quantidade aceita no máximo 3 casas decimais.')).toBeTruthy();
    expect(screen.getByText('A data de necessidade não pode ser anterior a hoje.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('lanca o pedido do caso E: POST com o corpo, aviso para a tela e fecha o dialogo', async () => {
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    preencher('Quantidade pedida (kg)', '1.600');
    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', '  MOTIVO SINTETICO  ');
    preencher('Cliente (opcional)', 'CLIENTE SINTETICO');
    preencher(/Nº da Solicitação/, '12');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/forecast/commercial-demands', {
        productId: 5,
        quantidadeKg: 1600,
        necessidade: '2027-02-10',
        motivo: 'MOTIVO SINTETICO',
        cliente: 'CLIENTE SINTETICO',
        solicitacaoId: 12,
      }),
    );
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith('Demanda do comercial lançada.'));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('cliente e solicitacao sao opcionais: vao como null', async () => {
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO ÁGUA 002/ }));
    preencher('Quantidade pedida (kg)', '250,5');
    preencher('Data de necessidade', '2027-03-01');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/forecast/commercial-demands', {
        productId: 6,
        quantidadeKg: 250.5,
        necessidade: '2027-03-01',
        motivo: 'MOTIVO SINTETICO',
        cliente: null,
        solicitacaoId: null,
      }),
    );
  });

  it('erro do servidor (400) aparece no dialogo, que continua aberto com os dados', async () => {
    post.mockRejectedValue(new ApiError(400, { message: 'Produto inativo: reative o produto no cadastro do Forecast antes de lancar a demanda.' }));
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    preencher('Quantidade pedida (kg)', '1600');
    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Produto inativo');
    expect(onFechar).not.toHaveBeenCalled();
    expect(campo('Quantidade pedida (kg)').value).toBe('1600');
  });

  it('falha ao carregar os produtos: mensagem e "Tentar de novo"', async () => {
    get.mockRejectedValueOnce(new ApiError(500, null));
    renderModal();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível salvar a demanda do comercial (HTTP 500).');
    get.mockResolvedValue({ data: PRODUTOS });
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('2 produtos')).toBeTruthy();
  });

  it('Cancelar fecha sem enviar', async () => {
    renderModal();
    await screen.findByText('2 produtos');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('ForecastDemandaComercialModal - editar', () => {
  const demanda: DemandaParaEditar = {
    id: 9,
    productId: 5,
    item: 'PRODUTO 001',
    kg: 1600.5,
    necessidade: '2020-01-01',
    motivo: 'MOTIVO SINTETICO',
    cliente: 'CLIENTE SINTETICO',
    solicitacaoId: 12,
  };

  it('produto fixo (sem busca nem lista), campos preenchidos e sem minimo na data', async () => {
    renderModal(demanda);
    expect(await screen.findByRole('heading', { name: 'Editar demanda do comercial · PRODUTO 001' })).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('Para trocar o produto, cancele este pedido e lance outro.')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(campo('Quantidade pedida (kg)').value).toBe('1600,5');
    expect(campo('Data de necessidade').value).toBe('2020-01-01');
    expect(campo('Data de necessidade').getAttribute('min')).toBeNull();
    expect(campo('Motivo do pedido').value).toBe('MOTIVO SINTETICO');
    expect(campo('Cliente (opcional)').value).toBe('CLIENTE SINTETICO');
    expect(campo(/Nº da Solicitação/).value).toBe('12');
  });

  it('pedido antigo: editar o motivo com a mesma data (ja passada) e permitido; PATCH com os campos e aviso', async () => {
    renderModal(demanda);
    preencher('Motivo do pedido', 'MOTIVO ATUALIZADO');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/forecast/commercial-demands/9', {
        quantidadeKg: 1600.5,
        necessidade: '2020-01-01',
        motivo: 'MOTIVO ATUALIZADO',
        cliente: 'CLIENTE SINTETICO',
        solicitacaoId: 12,
      }),
    );
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith('Demanda do comercial atualizada.'));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('mudar a data para antes de hoje -> erro; apagar cliente e solicitacao -> null', async () => {
    renderModal(demanda);
    preencher('Data de necessidade', '2026-10-19');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('A data de necessidade não pode ser anterior a hoje.')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();

    preencher('Data de necessidade', '2027-02-10');
    preencher('Cliente (opcional)', '');
    preencher(/Nº da Solicitação/, '');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/forecast/commercial-demands/9', {
        quantidadeKg: 1600.5,
        necessidade: '2027-02-10',
        motivo: 'MOTIVO SINTETICO',
        cliente: null,
        solicitacaoId: null,
      }),
    );
  });
});
