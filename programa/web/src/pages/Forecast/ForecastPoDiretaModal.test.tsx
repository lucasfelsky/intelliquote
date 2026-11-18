import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { Forwarder } from '@/services/forwarders';

// Dados 100% sinteticos. O modal da PO direta (item de preco fechado) reusa o desenho do modal da PO da cotacao.

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
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
const controles = vi.hoisted(() => ({ precos: new Map<number, unknown>() }));
vi.mock('./ForecastCriarCotacao', () => ({ useCriarCotacao: () => ({ precoFechado: (id: number) => controles.precos.get(id) }) }));
vi.mock('@/services/forwarders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/forwarders')>()),
  listForwarders: vi.fn(),
}));

import { api, ApiError } from '@/api/client';
import { listForwarders } from '@/services/forwarders';
import ForecastPoDiretaModal, { lerQuantidadePo } from './ForecastPoDiretaModal';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const item = {
  linha: 3,
  n: 1,
  productId: 42,
  item: 'PRODUTO SINTETICO A',
  codigos: ['C0001'],
  status: 'nao',
  demanda: 24000,
  quantidadeSugerida: 24000,
  quantidadeFinal: 25000,
  naoFraciona: false,
  precoFixo: true,
} as unknown as ForecastItemRelatorio;

const forwarder: Forwarder = {
  id: 1,
  companyName: 'Atlas Sintetico',
  address: null,
  website: null,
  notes: null,
  isActive: true,
  isDefault: true,
  createdAt: '2026-10-08T12:00:00.000Z',
  updatedAt: '2026-10-08T12:00:00.000Z',
  contacts: [{ id: 11, name: 'Renato', email: 'renato@atlas.example', phone: null }],
};

const destinatarios = {
  fornecedor: 'FORNECEDOR SINTETICO',
  to: { name: 'Mei Lin', email: 'mei@fornecedor.example' },
  contactCc: [{ name: 'Wang Fei', email: 'wang@fornecedor.example' }],
  comexCc: ['comex@sq.example', 'compras@sq.example'],
  cc: ['wang@fornecedor.example', 'comex@sq.example', 'compras@sq.example'],
};

const resultado = {
  purchaseOrderId: 9,
  jaEnviada: false,
  registro: 'ok' as const,
  qtdFinalKg: 25000,
  statusDaDecisao: 'po',
  fornecedor: 'FORNECEDOR SINTETICO',
  para: 'mei@fornecedor.example',
  copia: ['wang@fornecedor.example'],
};

function renderModal() {
  const onEnviada = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ForecastPoDiretaModal snapshotId={7} quinzena="11-1" item={item} onClose={onClose} onEnviada={onEnviada} />
    </QueryClientProvider>,
  );
  const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
  return { ...view, scope: within(dialog), onEnviada, onClose };
}
type Scope = ReturnType<typeof renderModal>['scope'];

const botaoEnviar = (s: Scope) => s.getByRole('button', { name: /Enviar Ordem de Compra|Enviando/ }) as HTMLButtonElement;
const quantidade = (s: Scope) => s.getByLabelText('Quantidade da PO (kg)') as HTMLInputElement;

async function anexarPdf(s: Scope) {
  const file = new File(['%PDF-1.4 fake'], 'po.pdf', { type: 'application/pdf' });
  fireEvent.change(s.getByLabelText('PDF da Ordem de Compra'), { target: { files: [file] } });
  await s.findByText(/Selecionado: po\.pdf/);
}

async function preparar(s: Scope) {
  await s.findByText('FORNECEDOR SINTETICO', { exact: false });
  await waitFor(() => expect((s.getByLabelText('Contato do despachante (forwarder)') as HTMLTextAreaElement).value).toContain('Atlas Sintetico'));
  await anexarPdf(s);
}

beforeEach(() => {
  vi.clearAllMocks();
  controles.precos.clear();
  get.mockResolvedValue({ data: destinatarios });
  post.mockResolvedValue({ data: resultado });
  vi.mocked(listForwarders).mockResolvedValue([forwarder]);
});

describe('lerQuantidadePo', () => {
  it.each([
    ['25000', 25000],
    ['25.000,5', null],
    ['1234,567', 1234.567],
    ['0,001', 0.001],
  ])('%s', (texto, esperado) => {
    const r = lerQuantidadePo(texto);
    if (esperado === null) expect(r.ok).toBe(false);
    else expect(r).toEqual({ ok: true, valor: esperado });
  });

  it.each(['', '  ', '0', '-5', 'abc', '1,2345', '1000000001'])('recusa %j', (texto) => {
    expect(lerQuantidadePo(texto).ok).toBe(false);
  });
});

describe('ForecastPoDiretaModal', () => {
  it('mostra fornecedor, Para/Cc e a quantidade sugerida como padrao, sem nenhum preco', async () => {
    const { scope } = renderModal();
    expect(await scope.findByText(/Enviar Ordem de Compra — FORNECEDOR SINTETICO/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/po-preco-fechado/destinatarios?productId=42');
    expect(scope.getByText(/Mei Lin <mei@fornecedor\.example>/)).toBeTruthy();
    expect(scope.getByText(/Wang Fei <wang@fornecedor\.example>/)).toBeTruthy();
    expect(scope.getByText('Equipe COMEX em cópia (2).')).toBeTruthy();
    expect(quantidade(scope).value).toBe('25000');
    expect((scope.getByLabelText('Assunto') as HTMLInputElement).value).toBe('Purchase Order - PRODUTO SINTETICO A');
    expect(scope.queryByText(/US\$|R\$|€|\/kg/)).toBeNull();
  });

  it('o botao so habilita com destinatarios, quantidade valida, PDF e contato do forwarder', async () => {
    const { scope } = renderModal();
    expect(botaoEnviar(scope).disabled).toBe(true);
    await preparar(scope);
    await waitFor(() => expect(botaoEnviar(scope).disabled).toBe(false));

    fireEvent.change(quantidade(scope), { target: { value: '0' } });
    expect(botaoEnviar(scope).disabled).toBe(true);
    expect(scope.getByText('A quantidade deve ser maior que zero.')).toBeTruthy();
    fireEvent.change(quantidade(scope), { target: { value: '1500,5' } });
    expect(botaoEnviar(scope).disabled).toBe(false);
  });

  it('envia o corpo certo (sem preco), com chave de envio, e avisa o pai', async () => {
    const { scope, onEnviada } = renderModal();
    await preparar(scope);
    fireEvent.change(quantidade(scope), { target: { value: '1500,5' } });
    fireEvent.change(scope.getByLabelText('Mensagem'), { target: { value: 'Please confirm.' } });
    fireEvent.click(botaoEnviar(scope));

    await waitFor(() => expect(onEnviada).toHaveBeenCalledWith(resultado));
    expect(post).toHaveBeenCalledTimes(1);
    const [url, corpo] = post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(url).toBe('/v1/forecast/snapshots/7/po-preco-fechado');
    expect(corpo).toMatchObject({
      productId: 42,
      quantidadeKg: 1500.5,
      subject: 'Purchase Order - PRODUTO SINTETICO A',
      message: 'Please confirm.',
      forwarderId: 1,
      fileName: 'po.pdf',
      fileType: 'application/pdf',
      fileSize: 13,
    });
    expect(String(corpo.chaveEnvio)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(String(corpo.contentBase64)).toContain('base64,');
    expect(Object.keys(corpo).some((k) => /preco|price|valor/i.test(k))).toBe(false);
  });

  it('recusa do servidor (409): mostra a mensagem e a proxima tentativa usa chave NOVA', async () => {
    post.mockRejectedValueOnce(new ApiError(409, { message: 'Este envio falhou.' }, 'Este envio falhou.'));
    const { scope, onEnviada } = renderModal();
    await preparar(scope);
    fireEvent.click(botaoEnviar(scope));
    expect(await scope.findByText('Este envio falhou.')).toBeTruthy();
    expect(onEnviada).not.toHaveBeenCalled();

    fireEvent.click(botaoEnviar(scope));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const k1 = (post.mock.calls[0]![1] as { chaveEnvio: string }).chaveEnvio;
    const k2 = (post.mock.calls[1]![1] as { chaveEnvio: string }).chaveEnvio;
    expect(k2).not.toBe(k1);
  });

  it.each([
    ['sem resposta (rede)', () => new Error('Failed to fetch')],
    ['500 "nao deu para confirmar"', () => new ApiError(500, { message: 'Não foi possível confirmar o envio da PO.' }, 'Não foi possível confirmar o envio da PO.')],
  ])('%s: a proxima tentativa REPETE a chave (o servidor reconhece e nao envia outra PO)', async (_nome, erro) => {
    post.mockRejectedValueOnce(erro());
    const { scope } = renderModal();
    await preparar(scope);
    fireEvent.click(botaoEnviar(scope));
    await scope.findByRole('alert');

    fireEvent.click(botaoEnviar(scope));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect((post.mock.calls[1]![1] as { chaveEnvio: string }).chaveEnvio).toBe((post.mock.calls[0]![1] as { chaveEnvio: string }).chaveEnvio);
  });

  it('fonte sem fornecedor (409 nos destinatarios): mostra o motivo e bloqueia o envio', async () => {
    get.mockRejectedValue(new ApiError(409, { message: 'A fonte deste item não está ligada a um fornecedor do IntelliQuote.' }, 'A fonte deste item não está ligada a um fornecedor do IntelliQuote.'));
    const { scope } = renderModal();
    expect(await scope.findByText(/não está ligada a um fornecedor/)).toBeTruthy();
    await anexarPdf(scope);
    expect(botaoEnviar(scope).disabled).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('PDF que nao e PDF ou passa de 10 MB e recusado antes do envio', async () => {
    const { scope } = renderModal();
    await scope.findByText(/FORNECEDOR SINTETICO/);
    fireEvent.change(scope.getByLabelText('PDF da Ordem de Compra'), { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
    expect(await scope.findByText('Selecione um arquivo PDF.')).toBeTruthy();
    const grande = new File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(scope.getByLabelText('PDF da Ordem de Compra'), { target: { files: [grande] } });
    expect(await scope.findByText('O PDF excede o limite de 10MB.')).toBeTruthy();
  });

  describe('preco fechado no modal (quem abre e admin/comprador)', () => {
    const precoOk = { productId: 42, estado: 'ok', valorPorKg: 1.8425, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' };

    it('mostra o preco, o incoterm e a validade, e o total estimado acompanha a quantidade', async () => {
      controles.precos.set(42, precoOk);
      const { scope } = renderModal();
      expect((await scope.findAllByText(/US\$ 1,8425\/kg/)).length).toBeGreaterThanOrEqual(1);
      expect(scope.getByText(/Preço fechado:/)).toBeTruthy();
      expect(scope.getByText(/válido até 31\/12\/2026/)).toBeTruthy();
      // 25.000 kg x US$ 1,8425 = US$ 46.062,50
      expect(scope.getByTestId('po-total').textContent).toContain('US$ 46.062,50');
      fireEvent.change(quantidade(scope), { target: { value: '1000' } });
      expect(scope.getByTestId('po-total').textContent).toContain('US$ 1.842,50');
      fireEvent.change(quantidade(scope), { target: { value: '0' } });
      expect(scope.queryByTestId('po-total')).toBeNull();
    });

    it('o corpo enviado continua sem preco (o servidor le o cadastro)', async () => {
      controles.precos.set(42, precoOk);
      const { scope, onEnviada } = renderModal();
      await preparar(scope);
      fireEvent.click(botaoEnviar(scope));
      await waitFor(() => expect(onEnviada).toHaveBeenCalled());
      const corpo = post.mock.calls[0]![1] as Record<string, unknown>;
      expect(Object.keys(corpo).some((k) => /preco|price|valor|moeda|incoterm/i.test(k))).toBe(false);
    });

    it('preco sem valor ou vencido: o modal nao mostra preco nem total', async () => {
      controles.precos.set(42, { ...precoOk, estado: 'vencido' });
      const { scope } = renderModal();
      await scope.findByText(/FORNECEDOR SINTETICO/);
      expect(scope.queryByTestId('po-total')).toBeNull();
      expect(scope.queryByText(/US\$/)).toBeNull();
    });
  });
});
