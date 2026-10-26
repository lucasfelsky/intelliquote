import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastDemandaComercialModal, { type DemandaParaEditar } from './ForecastDemandaComercialModal';

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

// Dados 100% sinteticos.
const FONTE = { id: 1, name: 'FONTE 001' };
const PRODUTOS = [
  { id: 5, name: 'PRODUTO 001', isActive: true, source: FONTE, codes: [{ code: 'C0001', catalogItemId: 101 }, { code: 'C0002', catalogItemId: 101 }] },
  { id: 6, name: 'PRODUTO 002', isActive: true, source: FONTE, codes: [{ code: 'C0003', catalogItemId: 102 }] },
  { id: 7, name: 'PRODUTO 003', isActive: true, source: FONTE, codes: [{ code: 'C0004', catalogItemId: 103 }] },
  { id: 8, name: 'PRODUTO 004', isActive: true, source: FONTE, codes: [{ code: 'C0005', catalogItemId: 103 }] },
  { id: 9, name: 'PRODUTO 005 INATIVO', isActive: false, source: FONTE, codes: [{ code: 'C0006', catalogItemId: 104 }] },
  { id: 10, name: 'PRODUTO 006', isActive: true, source: FONTE, codes: [{ code: 'C0007', catalogItemId: null }] },
];

const item = (id: number, catalogItemId: number, quantity: number, unit: string) => ({
  id,
  catalogItemId,
  commercialName: `ITEM CATALOGO ${catalogItemId}`,
  marketName: 'NOME DE MERCADO SINTETICO',
  dbcorpCode: null,
  quantity,
  unit,
  targetPrice: null,
  targetCurrency: null,
  quoteRequestItemId: null,
});

const solicitacao = (
  id: number,
  status: string,
  customerName: string | null,
  items: ReturnType<typeof item>[],
  createdAt = '2026-10-19T12:00:00.000Z',
) => ({
  id,
  status,
  customerName,
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt,
  statusChangedAt: null,
  requestedBy: { id: 1, name: 'COMERCIAL SINTETICO', email: 'comercial@example.test' },
  statusChangedBy: null,
  quoteRequest: null,
  items,
});

const S12 = solicitacao(12, 'quoting', 'CLIENTE SINTETICO A', [
  item(1, 101, 1600, 'KG'),
  item(2, 102, 3, 'TON'),
  item(3, 105, 10, 'KG'),
]);
const S11 = solicitacao(11, 'pending', null, [
  item(4, 101, 20, 'BOX'),
  item(5, 103, 5, 'KG'),
  item(6, 104, 7, 'KG'),
  item(7, 102, 10_001, 'TON'),
]);

const pagina = (data: unknown[], totalItems = data.length) => ({
  data,
  pagination: { page: 1, pageSize: 100, totalItems, totalPages: 1 },
});

type Respostas = { pending?: unknown; quoting?: unknown };

/** `/v1/forecast/products` e `/api/v1/commercial-requests` (por status). */
function responder(resp: Respostas | (() => Respostas | Promise<never>)) {
  get.mockImplementation(async (path: string, q?: unknown) => {
    if (path === '/v1/forecast/products') return { data: PRODUTOS };
    if (path === '/api/v1/commercial-requests') {
      const r = typeof resp === 'function' ? resp() : resp;
      if (r instanceof Promise) return r;
      return (r as Record<string, unknown>)[(q as { status: string }).status];
    }
    throw new Error(`rota inesperada ${path}`);
  });
}

const padrao = (): Respostas => ({ pending: pagina([S11]), quoting: pagina([S12]) });

const onFechar = vi.fn();
const onSalvo = vi.fn();

function renderModal(demanda?: DemandaParaEditar) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastDemandaComercialModal hoje="2026-10-20" demanda={demanda} onFechar={onFechar} onSalvo={onSalvo} />
    </QueryClientProvider>,
  );
}

const campo = (rotulo: string | RegExp) => screen.getByLabelText(rotulo) as HTMLInputElement;
const preencher = (rotulo: string | RegExp, valor: string) => fireEvent.change(campo(rotulo), { target: { value: valor } });
const botaoPuxar = () => screen.getByRole('button', { name: 'Puxar de uma Solicitação' });
const chamadasDeSolicitacoes = () => get.mock.calls.filter(([p]) => p === '/api/v1/commercial-requests');
const CABECALHO_12 = 'Solicitação nº 12 · Em cotação · criada em 19/10/2026 · Cliente: CLIENTE SINTETICO A';
const CABECALHO_11 = 'Solicitação nº 11 · Pendente · criada em 19/10/2026 · Sem cliente';

async function abrirPainel() {
  await screen.findByText('5 produtos');
  fireEvent.click(botaoPuxar());
  return screen.findByRole('heading', { name: 'Solicitações pendentes e em cotação' });
}

const usarItem = (produto: string, numero: number) =>
  fireEvent.click(screen.getByRole('button', { name: `Usar este item: ${produto} da Solicitação nº ${numero}` }));

beforeEach(() => {
  vi.clearAllMocks();
  responder(padrao());
  post.mockResolvedValue({ data: { id: 9 } });
});

describe('ForecastPuxarSolicitacao - painel', () => {
  it('C1: no lancamento o botao existe fechado e nada e consultado antes do clique', async () => {
    renderModal();
    await screen.findByText('5 produtos');
    expect(botaoPuxar().getAttribute('aria-expanded')).toBe('false');
    expect(chamadasDeSolicitacoes()).toHaveLength(0);
  });

  it('C2: na edicao o botao nao existe', async () => {
    renderModal({
      id: 3,
      productId: 5,
      item: 'PRODUTO 001',
      kg: 1600,
      necessidade: '2027-02-10',
      motivo: 'MOTIVO SINTETICO',
      cliente: null,
      solicitacaoId: null,
    });
    await screen.findByRole('heading', { name: /Editar demanda do comercial/ });
    expect(screen.queryByRole('button', { name: 'Puxar de uma Solicitação' })).toBeNull();
    expect(chamadasDeSolicitacoes()).toHaveLength(0);
  });

  it('C3: carregando mostra o estado com role status', async () => {
    responder(() => new Promise<never>(() => undefined));
    renderModal();
    await screen.findByText('5 produtos');
    fireEvent.click(botaoPuxar());
    const carregando = await screen.findByText(/Carregando Solicitações/);
    expect(carregando.getAttribute('role')).toBe('status');
    expect(botaoPuxar().getAttribute('aria-expanded')).toBe('true');
  });

  it('C4: erro 500 mostra o alerta e a retentativa refaz as chamadas', async () => {
    let falhar = true;
    get.mockImplementation(async (path: string, q?: unknown) => {
      if (path === '/v1/forecast/products') return { data: PRODUTOS };
      if (falhar) throw new ApiError(500, null);
      return padrao()[(q as { status: 'pending' | 'quoting' }).status];
    });
    renderModal();
    await screen.findByText('5 produtos');
    fireEvent.click(botaoPuxar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar as Solicitações (HTTP 500).');
    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo: carregar as Solicitações' }));
    expect(await screen.findByText(CABECALHO_12)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(chamadasDeSolicitacoes().length).toBeGreaterThanOrEqual(4);
  });

  it('C5: erro 403 mostra a mensagem, sem retentativa, e o formulario segue habilitado', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/products') return { data: PRODUTOS };
      throw new ApiError(403, null);
    });
    renderModal();
    await screen.findByText('5 produtos');
    fireEvent.click(botaoPuxar());
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Seu perfil não pode consultar as Solicitações. Preencha a demanda à mão.');
    expect(screen.queryByRole('button', { name: /Tentar de novo/ })).toBeNull();
    expect(campo('Quantidade pedida (kg)').disabled).toBe(false);
    expect(campo('Data de necessidade').disabled).toBe(false);
    expect(campo(/Cliente/).disabled).toBe(false);
  });

  it('C6: sem Solicitacoes pendentes ou em cotacao mostra o estado vazio', async () => {
    responder({ pending: pagina([]), quoting: pagina([]) });
    renderModal();
    await abrirPainel();
    const vazio = await screen.findByText('Nenhuma Solicitação pendente ou em cotação.');
    expect(vazio.getAttribute('role')).toBe('status');
  });

  it('C7: item sem produto, ambiguo, inativo ou acima do maximo fica desabilitado com o motivo', async () => {
    renderModal();
    await abrirPainel();
    await screen.findByText(CABECALHO_12);
    const casos: Array<[string, number, string]> = [
      ['ITEM CATALOGO 105', 12, 'Sem produto do Forecast para este item do catálogo.'],
      [
        'ITEM CATALOGO 103',
        11,
        'Item ligado a mais de um produto do Forecast (PRODUTO 003, PRODUTO 004): escolha o produto na lista à mão.',
      ],
      [
        'ITEM CATALOGO 104',
        11,
        'O produto do Forecast deste item está inativo: reative-o no cadastro antes de lançar.',
      ],
      [
        'ITEM CATALOGO 102',
        11,
        'A quantidade convertida passa de 10.000.000 kg, o limite da demanda.',
      ],
    ];
    for (const [nome, numero, texto] of casos) {
      const botao = screen.getByRole('button', { name: `Usar este item: ${nome} da Solicitação nº ${numero}` }) as HTMLButtonElement;
      expect(botao.disabled).toBe(true);
      const id = botao.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      expect(document.getElementById(id as string)?.textContent).toBe(texto);
    }
  });

  it('C13: abrir leva o foco ao titulo; Esc fecha so o painel, devolve o foco ao botao e nao fecha o modal', async () => {
    renderModal();
    const titulo = await abrirPainel();
    await waitFor(() => expect(document.activeElement).toBe(titulo));
    expect(fireEvent.keyDown(titulo, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Solicitações pendentes e em cotação' })).toBeNull();
    expect(botaoPuxar().getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(botaoPuxar()));
    expect(onFechar).not.toHaveBeenCalled();
  });

  it('C14: "Fechar lista de Solicitações" fecha e devolve o foco ao botao', async () => {
    renderModal();
    await abrirPainel();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar lista de Solicitações' }));
    expect(screen.queryByRole('heading', { name: 'Solicitações pendentes e em cotação' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botaoPuxar()));
  });

  it('C15: mais Solicitacoes na API do que a pagina trouxe mostra o aviso de truncamento', async () => {
    responder({ pending: pagina([S11], 134), quoting: pagina([S12]) });
    renderModal();
    await abrirPainel();
    expect(
      await screen.findByText(
        'Mostrando 1 de 134 Solicitações pendentes (as mais recentes). As demais estão no módulo Solicitações.',
      ),
    ).toBeTruthy();
  });

  it('C16: descarta fulfilled, mostra a repetida 1 vez e trava o botao durante o salvar', async () => {
    responder({
      pending: pagina([S11, solicitacao(13, 'fulfilled', null, [item(8, 101, 1, 'KG')])]),
      quoting: pagina([S11, S12]),
    });
    renderModal();
    await abrirPainel();
    await screen.findByText(CABECALHO_12);
    expect(screen.getAllByText(CABECALHO_11)).toHaveLength(1);
    expect(screen.queryByText(/Solicitação nº 13/)).toBeNull();

    post.mockReturnValue(new Promise<never>(() => undefined));
    usarItem('PRODUTO 001', 12);
    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    await waitFor(() => expect((botaoPuxar() as HTMLButtonElement).disabled).toBe(true));
  });
});

describe('ForecastPuxarSolicitacao - usar um item', () => {
  it('C8: KG preenche produto, busca, kg, cliente e numero; a data fica vazia e com o foco', async () => {
    renderModal();
    await abrirPainel();
    await screen.findByText(CABECALHO_12);
    usarItem('PRODUTO 001', 12);

    expect(botaoPuxar().getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByRole('radio', { name: /PRODUTO 001/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('C0001');
    expect(campo('Quantidade pedida (kg)').value).toBe('1600');
    expect(campo('Cliente (opcional)').value).toBe('CLIENTE SINTETICO A');
    expect(campo(/Nº da Solicitação/).value).toBe('12');
    expect(campo('Data de necessidade').value).toBe('');
    expect(campo('Motivo do pedido').value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(campo('Data de necessidade')));
    expect(
      screen.getByText(
        'Solicitação nº 12 aplicada: produto, quantidade (1.600 kg), cliente e número preenchidos. Informe a data de necessidade e o motivo.',
      ).getAttribute('role'),
    ).toBe('status');
  });

  it('C9: TON vira kg x 1000', async () => {
    renderModal();
    await abrirPainel();
    await screen.findByText(CABECALHO_12);
    expect(screen.getByText('3 TON = 3.000 kg')).toBeTruthy();
    usarItem('PRODUTO 002', 12);
    expect(campo('Quantidade pedida (kg)').value).toBe('3000');
    expect((screen.getByRole('radio', { name: /PRODUTO 002/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('C10: BOX deixa o kg vazio, leva o foco ao kg e o envio sem kg e barrado', async () => {
    renderModal();
    await abrirPainel();
    await screen.findByText(CABECALHO_11);
    expect(screen.getByText('Unidade BOX: informe a quantidade em kg depois de usar o item.')).toBeTruthy();
    usarItem('PRODUTO 001', 11);

    expect(campo('Quantidade pedida (kg)').value).toBe('');
    expect(campo('Cliente (opcional)').value).toBe('');
    expect(campo(/Nº da Solicitação/).value).toBe('11');
    await waitFor(() => expect(document.activeElement).toBe(campo('Quantidade pedida (kg)')));
    expect(
      screen.getByText(
        'Solicitação nº 11 aplicada: a Solicitação pede 20 BOX. Informe a quantidade em kg, a data de necessidade e o motivo.',
      ),
    ).toBeTruthy();

    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    expect(await screen.findByText('Informe a quantidade em kg.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('C11: depois de puxar, data e motivo manuais completam o envio', async () => {
    renderModal();
    await abrirPainel();
    await screen.findByText(CABECALHO_12);
    usarItem('PRODUTO 001', 12);
    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');
    fireEvent.click(screen.getByRole('button', { name: 'Lançar demanda' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/v1/forecast/commercial-demands', {
      productId: 5,
      quantidadeKg: 1600,
      necessidade: '2027-02-10',
      motivo: 'MOTIVO SINTETICO',
      cliente: 'CLIENTE SINTETICO A',
      solicitacaoId: 12,
    });
    await waitFor(() => expect(onSalvo).toHaveBeenCalledWith('Demanda do comercial lançada.'));
  });

  it('C12: usar outro item substitui produto, kg, cliente e numero; data e motivo ficam', async () => {
    renderModal();
    await screen.findByText('5 produtos');
    fireEvent.click(screen.getByRole('radio', { name: /PRODUTO 001/ }));
    preencher('Quantidade pedida (kg)', '999');
    preencher('Cliente (opcional)', 'CLIENTE DIGITADO SINTETICO');
    preencher(/Nº da Solicitação/, '99');
    preencher('Data de necessidade', '2027-02-10');
    preencher('Motivo do pedido', 'MOTIVO SINTETICO');

    fireEvent.click(botaoPuxar());
    await screen.findByText(CABECALHO_12);
    usarItem('PRODUTO 002', 12);

    expect((screen.getByRole('radio', { name: /PRODUTO 002/ }) as HTMLInputElement).checked).toBe(true);
    expect(campo('Quantidade pedida (kg)').value).toBe('3000');
    expect(campo('Cliente (opcional)').value).toBe('CLIENTE SINTETICO A');
    expect(campo(/Nº da Solicitação/).value).toBe('12');
    expect(campo('Data de necessidade').value).toBe('2027-02-10');
    expect(campo('Motivo do pedido').value).toBe('MOTIVO SINTETICO');
  });

  it('lista cada Solicitacao com o produto do Forecast casado', async () => {
    renderModal();
    await abrirPainel();
    const cabecalho = await screen.findByText(CABECALHO_12);
    const bloco = cabecalho.closest('li') as HTMLElement;
    expect(within(bloco).getByText('Produto do Forecast: PRODUTO 001')).toBeTruthy();
    expect(within(bloco).getByText('Produto do Forecast: PRODUTO 002')).toBeTruthy();
  });
});
