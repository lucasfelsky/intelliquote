import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { PrecoFechadoDoItem } from '@/services/forecastPrecoFechado';

// Dados 100% sinteticos. Cadastro do preco fechado (valor, moeda, incoterm e validade) de um item com o selo da planilha.

const controles = vi.hoisted(() => ({ confirm: vi.fn() }));

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
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => controles.confirm }));

import { api, ApiError } from '@/api/client';
import ForecastPrecoFechadoModal, { } from './ForecastPrecoFechadoModal';

const put = vi.mocked(api.put);

const item = { linha: 3, n: 1, productId: 42, item: 'PRODUTO SINTETICO A', codigos: ['C0001'], status: 'nao', quantidadeFinal: 25000, precoFixo: true } as unknown as ForecastItemRelatorio;

const preco = (over: Partial<PrecoFechadoDoItem> = {}): PrecoFechadoDoItem => ({
  productId: 42,
  estado: 'ok',
  valorPorKg: 1.8425,
  moeda: 'USD',
  incoterm: 'CFR',
  validoAte: '2026-12-31',
  ...over,
});
const semPreco = preco({ estado: 'sem_valor', valorPorKg: null, moeda: null, incoterm: null, validoAte: null });

function renderModal(atual: PrecoFechadoDoItem | undefined) {
  const onFechar = vi.fn();
  const onSalvo = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ForecastPrecoFechadoModal item={item} atual={atual} hoje="2026-11-17" onFechar={onFechar} onSalvo={onSalvo} />
    </QueryClientProvider>,
  );
  const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
  return { ...view, scope: within(dialog), onFechar, onSalvo };
}
type Scope = ReturnType<typeof renderModal>['scope'];

const campo = (s: Scope, rotulo: string) => s.getByLabelText(rotulo) as HTMLInputElement;
const salvar = (s: Scope) => s.getByRole('button', { name: /Salvar preço|Salvando/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  controles.confirm.mockResolvedValue(true);
  put.mockResolvedValue({ data: preco() });
});

describe('ForecastPrecoFechadoModal', () => {
  it('sem preco cadastrado: campos vazios, moeda USD e incoterm CFR de partida, sem "Remover preco"', () => {
    const { scope } = renderModal(semPreco);
    expect(campo(scope, 'Preço por kg').value).toBe('');
    expect(campo(scope, 'Moeda').value).toBe('USD');
    expect(campo(scope, 'Incoterm').value).toBe('CFR');
    expect(campo(scope, 'Válido até').value).toBe('');
    expect(scope.queryByRole('button', { name: 'Remover preço' })).toBeNull();
    expect(scope.getByText(/O valor aparece só para admin e comprador/)).toBeTruthy();
  });

  it('com preco: carrega os termos atuais e oferece "Remover preco"', () => {
    const { scope } = renderModal(preco({ valorPorKg: 0.412, moeda: 'EUR', incoterm: 'FOB', validoAte: '2027-03-31' }));
    expect(campo(scope, 'Preço por kg').value).toBe('0,412');
    expect(campo(scope, 'Moeda').value).toBe('EUR');
    expect(campo(scope, 'Incoterm').value).toBe('FOB');
    expect(campo(scope, 'Válido até').value).toBe('2027-03-31');
    expect(scope.getByRole('button', { name: 'Remover preço' })).toBeTruthy();
  });

  it('salvar valida o preco e a validade antes de enviar', () => {
    const { scope } = renderModal(semPreco);
    fireEvent.click(salvar(scope));
    expect(scope.getByText('Informe o preço por kg.')).toBeTruthy();
    expect(scope.getByText('Informe até quando o preço vale.')).toBeTruthy();
    fireEvent.change(campo(scope, 'Preço por kg'), { target: { value: '1,23456' } });
    expect(scope.getByText('O preço aceita no máximo 4 casas decimais.')).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('envia os termos certos (virgula vira ponto) e avisa o pai com o estado novo', async () => {
    const { scope, onSalvo } = renderModal(semPreco);
    fireEvent.change(campo(scope, 'Preço por kg'), { target: { value: '1,8425' } });
    fireEvent.change(campo(scope, 'Moeda'), { target: { value: 'EUR' } });
    fireEvent.change(campo(scope, 'Incoterm'), { target: { value: 'CIF' } });
    fireEvent.change(campo(scope, 'Válido até'), { target: { value: '2026-12-31' } });
    fireEvent.click(salvar(scope));

    await waitFor(() => expect(onSalvo).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/v1/forecast/products/42/preco-fechado', {
      valorPorKg: 1.8425,
      moeda: 'EUR',
      incoterm: 'CIF',
      validoAte: '2026-12-31',
    });
    expect(onSalvo.mock.calls[0]![1]).toBe(false);
  });

  it('validade que ja passou: avisa na tela, mas deixa salvar (o item fica vencido)', async () => {
    const { scope, onSalvo } = renderModal(semPreco);
    fireEvent.change(campo(scope, 'Preço por kg'), { target: { value: '2' } });
    fireEvent.change(campo(scope, 'Válido até'), { target: { value: '2026-11-01' } });
    expect(scope.getByText(/já passou: o item ficará como vencido/)).toBeTruthy();
    fireEvent.click(salvar(scope));
    await waitFor(() => expect(onSalvo).toHaveBeenCalled());
  });

  it('recusa do servidor: mostra a mensagem e nao fecha', async () => {
    put.mockRejectedValueOnce(new ApiError(409, { message: 'O item não está marcado como preço fechado na planilha (coluna AV).' }, 'O item não está marcado como preço fechado na planilha (coluna AV).'));
    const { scope, onSalvo } = renderModal(semPreco);
    fireEvent.change(campo(scope, 'Preço por kg'), { target: { value: '2' } });
    fireEvent.change(campo(scope, 'Válido até'), { target: { value: '2027-01-31' } });
    fireEvent.click(salvar(scope));
    expect(await scope.findByText(/não está marcado como preço fechado/)).toBeTruthy();
    expect(onSalvo).not.toHaveBeenCalled();
  });

  it('remover preco pede confirmacao e manda { limpar: true }', async () => {
    put.mockResolvedValueOnce({ data: semPreco });
    const { scope, onSalvo } = renderModal(preco());
    fireEvent.click(scope.getByRole('button', { name: 'Remover preço' }));
    await waitFor(() => expect(onSalvo).toHaveBeenCalledTimes(1));
    expect(controles.confirm).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/v1/forecast/products/42/preco-fechado', { limpar: true });
    expect(onSalvo.mock.calls[0]![1]).toBe(true);
  });

  it('remover preco cancelado na confirmacao nao chama o servidor', async () => {
    controles.confirm.mockResolvedValue(false);
    const { scope } = renderModal(preco());
    fireEvent.click(scope.getByRole('button', { name: 'Remover preço' }));
    await waitFor(() => expect(controles.confirm).toHaveBeenCalled());
    expect(put).not.toHaveBeenCalled();
  });
});
