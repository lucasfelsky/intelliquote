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
const controles = vi.hoisted(() => ({ precos: new Map<number, unknown>(), analise: new Map<number, { quantidadeKg: number }>() }));
vi.mock('./ForecastDecisaoCompra', () => ({ useDecisoesDaQuinzena: () => ({ mapa: controles.analise, carregando: false, erro: false }) }));
vi.mock('./ForecastCriarCotacao', () => ({ useCriarCotacao: () => ({ precoFechado: (id: number) => controles.precos.get(id) }) }));
vi.mock('@/services/forwarders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/forwarders')>()),
  listForwarders: vi.fn(),
}));

import { api, ApiError } from '@/api/client';
import { listForwarders } from '@/services/forwarders';
import ForecastPoDiretaModal, { lerQuantidadePo, referenciaDaPo } from './ForecastPoDiretaModal';

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
  purchaseOrderIds: [9],
  itens: [{ productId: 42, purchaseOrderId: 9, qtdFinalKg: 25000, statusDaDecisao: 'po' }],
  jaEnviada: false,
  registro: 'ok' as const,
  qtdFinalKg: 25000,
  statusDaDecisao: 'po',
  fornecedor: 'FORNECEDOR SINTETICO',
  para: 'mei@fornecedor.example',
  copia: ['wang@fornecedor.example'],
};

const item2 = { ...item, linha: 4, n: 2, productId: 43, item: 'PRODUTO SINTETICO B', quantidadeFinal: 12000 } as unknown as ForecastItemRelatorio;

function renderModal(itens: ForecastItemRelatorio[] = [item], posicao?: { atual: number; total: number }) {
  const onEnviada = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ForecastPoDiretaModal snapshotId={7} quinzena="11-1" itens={itens} posicao={posicao} onClose={onClose} onEnviada={onEnviada} />
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
  controles.analise.clear();
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

describe('referenciaDaPo', () => {
  it('usa a quantidade da Analise Forecast quando existe e e positiva; senao, a sugerida (Qtd. final calculada)', () => {
    expect(referenciaDaPo(item, 5000)).toEqual({ kg: 5000, origem: 'analise' });
    expect(referenciaDaPo(item, 0)).toEqual({ kg: 25000, origem: 'sugerida' });
    expect(referenciaDaPo(item, null)).toEqual({ kg: 25000, origem: 'sugerida' });
    expect(referenciaDaPo(item, undefined)).toEqual({ kg: 25000, origem: 'sugerida' });
  });
});

describe('ForecastPoDiretaModal', () => {
  it('com Analise Forecast preenchida a PO nasce com ELA (nao com a sugerida) e o rotulo diz "Análise Forecast"', async () => {
    controles.analise.set(42, { quantidadeKg: 5000 });
    const { scope } = renderModal();
    await scope.findByText(/FORNECEDOR SINTETICO/);
    expect(quantidade(scope).value).toBe('5000');
    expect(scope.getByText('Análise Forecast:')).toBeTruthy();
    expect(scope.queryByText('Sugerida pelo Forecast:')).toBeNull();
  });

  it('varios itens: cada um usa a sua analise; quem nao tem usa a sugerida', async () => {
    controles.analise.set(42, { quantidadeKg: 5000 });
    const { scope } = renderModal([item, item2]);
    await scope.findByText(/FORNECEDOR SINTETICO/);
    expect((scope.getByLabelText('Quantidade da PO de PRODUTO SINTETICO A (kg)') as HTMLInputElement).value).toBe('5000');
    expect((scope.getByLabelText('Quantidade da PO de PRODUTO SINTETICO B (kg)') as HTMLInputElement).value).toBe('12000');
  });

  it('mostra fornecedor, Para/Cc e a quantidade sugerida como padrao, sem nenhum preco', async () => {
    const { scope } = renderModal();
    expect(await scope.findByText(/Enviar Ordem de Compra — FORNECEDOR SINTETICO/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/po-preco-fechado/destinatarios?productIds=42');
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
      itens: [{ productId: 42, quantidadeKg: 1500.5 }],
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

  it('durante o envio Cancelar fica desabilitado e fechar nao chama o pai (evita segunda tentativa com chave nova)', async () => {
    post.mockReturnValue(new Promise(() => {}) as never);
    const { scope, onClose } = renderModal();
    await preparar(scope);
    fireEvent.click(botaoEnviar(scope));
    await waitFor(() => expect(botaoEnviar(scope).disabled).toBe(true));
    const cancelar = scope.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement;
    expect(cancelar.disabled).toBe(true);
    fireEvent.click(cancelar);
    expect(onClose).not.toHaveBeenCalled();
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

  describe('varios itens num envio (um e-mail, um PDF)', () => {
    const quantidadeDe = (s: Scope, nome: string) => s.getByLabelText(`Quantidade da PO de ${nome} (kg)`) as HTMLInputElement;
    const resultadoLote = {
      ...resultado,
      purchaseOrderIds: [9, 10],
      itens: [
        { productId: 42, purchaseOrderId: 9, qtdFinalKg: 25000, statusDaDecisao: 'po' },
        { productId: 43, purchaseOrderId: 10, qtdFinalKg: 12000, statusDaDecisao: 'po' },
      ],
    };

    it('consulta os destinatarios de todos os itens e lista cada um com a sua quantidade sugerida', async () => {
      const { scope } = renderModal([item, item2]);
      expect(await scope.findByText(/Enviar Ordem de Compra — FORNECEDOR SINTETICO/)).toBeTruthy();
      expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/po-preco-fechado/destinatarios?productIds=42,43');
      expect(scope.getByText('Itens da PO (2)')).toBeTruthy();
      expect(quantidadeDe(scope, 'PRODUTO SINTETICO A').value).toBe('25000');
      expect(quantidadeDe(scope, 'PRODUTO SINTETICO B').value).toBe('12000');
      expect((scope.getByLabelText('Assunto') as HTMLInputElement).value).toBe('Purchase Order - PRODUTO SINTETICO A, PRODUTO SINTETICO B');
    });

    it('envia UM corpo com os dois itens e as quantidades editadas, sem preco', async () => {
      post.mockResolvedValue({ data: resultadoLote });
      const { scope, onEnviada } = renderModal([item, item2]);
      await preparar(scope);
      fireEvent.change(quantidadeDe(scope, 'PRODUTO SINTETICO B'), { target: { value: '5000,5' } });
      fireEvent.click(botaoEnviar(scope));
      await waitFor(() => expect(onEnviada).toHaveBeenCalledWith(resultadoLote));
      expect(post).toHaveBeenCalledTimes(1);
      const corpo = post.mock.calls[0]![1] as Record<string, unknown>;
      expect(corpo.itens).toEqual([
        { productId: 42, quantidadeKg: 25000 },
        { productId: 43, quantidadeKg: 5000.5 },
      ]);
      expect(Object.keys(corpo).some((k) => /preco|price|valor|moeda|incoterm/i.test(k))).toBe(false);
    });

    it('quantidade invalida em UM item bloqueia o envio e diz qual', async () => {
      const { scope } = renderModal([item, item2]);
      await preparar(scope);
      await waitFor(() => expect(botaoEnviar(scope).disabled).toBe(false));
      fireEvent.change(quantidadeDe(scope, 'PRODUTO SINTETICO B'), { target: { value: '0' } });
      expect(botaoEnviar(scope).disabled).toBe(true);
      expect(scope.getByText('Corrija a quantidade de: PRODUTO SINTETICO B.')).toBeTruthy();
    });

    it('o total estimado soma por moeda so dos itens com preco valido', async () => {
      controles.precos.set(42, { productId: 42, estado: 'ok', valorPorKg: 2, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' });
      controles.precos.set(43, { productId: 43, estado: 'ok', valorPorKg: 3, moeda: 'EUR', incoterm: 'CFR', validoAte: '2026-12-31' });
      const { scope } = renderModal([item, item2]);
      // 25.000 x US$ 2 = US$ 50.000,00 ; 12.000 x € 3 = € 36.000,00 (moedas nunca se misturam)
      const total = (await scope.findByTestId('po-total')).textContent as string;
      expect(total).toContain('US$ 50.000,00');
      expect(total).toContain('€ 36.000,00');
    });

    it('fornecedores diferentes (409 nos destinatarios) bloqueiam o envio', async () => {
      get.mockRejectedValue(new ApiError(409, { message: 'Os itens escolhidos são de fornecedores diferentes (A, B).' }, 'Os itens escolhidos são de fornecedores diferentes (A, B).'));
      const { scope } = renderModal([item, item2]);
      expect(await scope.findByText(/fornecedores diferentes/)).toBeTruthy();
      await anexarPdf(scope);
      expect(botaoEnviar(scope).disabled).toBe(true);
    });

    it('na fila por fonte o titulo mostra "PO 2 de 3"', async () => {
      const { scope } = renderModal([item, item2], { atual: 2, total: 3 });
      expect(await scope.findByText(/\(PO 2 de 3\)/)).toBeTruthy();
    });
  });

  describe('arrastar o PDF para o campo de anexo', () => {
    const arquivos = (files: File[]) => ({ dataTransfer: { files, types: ['Files'] } });
    const campo = (s: Scope) => s.getByText('Nenhum arquivo selecionado').closest('label') as HTMLLabelElement;
    const pdf = (nome = 'po.pdf', tipo = 'application/pdf') => new File(['%PDF-1.4 fake'], nome, { type: tipo });

    it('soltar um PDF no campo anexa, igual a escolher pelo seletor, e habilita o envio', async () => {
      const { scope } = renderModal();
      await scope.findByText(/FORNECEDOR SINTETICO/);
      expect(campo(scope).textContent).toContain('Arraste o PDF para cá ou clique');
      fireEvent.drop(campo(scope), arquivos([pdf('PO-0007.pdf')]));
      expect(await scope.findByText(/Selecionado: PO-0007\.pdf/)).toBeTruthy();
      await waitFor(() => expect((scope.getByLabelText('Contato do despachante (forwarder)') as HTMLTextAreaElement).value).toContain('Atlas Sintetico'));
      await waitFor(() => expect(botaoEnviar(scope).disabled).toBe(false));
    });

    it('o campo ganha o destaque enquanto o arquivo esta sobre ele e perde ao soltar', async () => {
      const { scope } = renderModal();
      await scope.findByText(/FORNECEDOR SINTETICO/);
      const label = campo(scope);
      fireEvent.dragEnter(label, arquivos([pdf()]));
      expect(label.className).toContain('cmp-po__arquivo--arrastando');
      fireEvent.drop(label, arquivos([pdf()]));
      await scope.findByText(/Selecionado: po\.pdf/);
      expect(scope.getByText(/Selecionado:/).closest('div')!.querySelector('label.cmp-po__arquivo')!.className).not.toContain('--arrastando');
    });

    it('PDF sem tipo informado pelo sistema (so a extensao) tambem anexa', async () => {
      const { scope } = renderModal();
      await scope.findByText(/FORNECEDOR SINTETICO/);
      fireEvent.drop(campo(scope), arquivos([pdf('PO-0008.pdf', '')]));
      expect(await scope.findByText(/Selecionado: PO-0008\.pdf/)).toBeTruthy();
    });

    it('arquivo que nao e PDF, mais de um arquivo e queda fora do campo sao recusados sem anexar', async () => {
      const { scope } = renderModal();
      await scope.findByText(/FORNECEDOR SINTETICO/);
      fireEvent.drop(campo(scope), arquivos([new File(['x'], 'a.txt', { type: 'text/plain' })]));
      expect(await scope.findByText('Selecione um arquivo PDF.')).toBeTruthy();
      fireEvent.drop(campo(scope), arquivos([pdf('um.pdf'), pdf('dois.pdf')]));
      expect(await scope.findByText('Solte um arquivo PDF por vez.')).toBeTruthy();
      // queda fora do campo: o navegador nao pode abrir o PDF; nada e anexado
      const fora = scope.getByLabelText('Assunto');
      expect(fireEvent.drop(fora, arquivos([pdf()]))).toBe(false);
      expect(scope.queryByText(/Selecionado:/)).toBeNull();
      expect(botaoEnviar(scope).disabled).toBe(true);
    });
  });
});
