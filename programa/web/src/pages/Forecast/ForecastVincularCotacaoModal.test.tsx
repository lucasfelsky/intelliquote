import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Dados 100% sinteticos. Modal "Vincular cotacao" do Relatorio de compras: lista as cotacoes abertas do produto e liga/troca/desliga.

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
import type { CotacaoAbertaParaVinculo } from '@/services/forecastVincularCotacao';
import ForecastVincularCotacaoModal from './ForecastVincularCotacaoModal';

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);
const del = vi.mocked(api.del);

const cotacao = (over: Partial<CotacaoAbertaParaVinculo> = {}): CotacaoAbertaParaVinculo => ({
  id: 90,
  requestCode: 'QR-20261118-AAA111',
  createdAt: '2026-11-18T15:00:00.000Z',
  listedAt: '2026-11-18T15:00:00.000Z',
  statusCotacao: 'criada',
  fornecedores: ['FORNECEDOR SINTETICO UM', 'FORNECEDOR SINTETICO DOIS'],
  itens: [{ quoteRequestItemId: 300, productName: 'PRODUTO SINTETICO A', quantity: 1500, unit: 'KG', emKg: true, vinculo: null }],
  vinculadaAEsteItem: false,
  podeVincular: true,
  motivo: null,
  ...over,
});

const emUn = cotacao({
  id: 91,
  requestCode: 'QR-20261118-BBB222',
  fornecedores: [],
  itens: [{ quoteRequestItemId: 301, productName: 'PRODUTO SINTETICO A', quantity: 5, unit: 'UN', emKg: false, vinculo: null }],
  podeVincular: false,
  motivo: 'O item está em UN; só itens em KG entram no Forecast.',
});

const enviada = cotacao({ id: 92, requestCode: 'QR-20261118-CCC333', statusCotacao: 'enviada' });

function mostrar(cotacoes: CotacaoAbertaParaVinculo[]) {
  get.mockResolvedValue({ data: { snapshotId: 7, productId: 42, cotacoes } });
}

function renderizar(cotacaoAtual: { id: number; requestCode: string; statusCotacao: 'criada' | 'enviada' } | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  const onFechar = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ForecastVincularCotacaoModal
        snapshotId={7}
        productId={42}
        nomeItem="PRODUTO SINTETICO A"
        cotacaoAtual={cotacaoAtual}
        onFechar={onFechar}
      />
    </QueryClientProvider>,
  );
  return { invalidar, onFechar };
}

const chavesInvalidadas = (invalidar: { mock: { calls: unknown[][] } }) =>
  invalidar.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom nao implementa <dialog>.showModal.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

describe('ForecastVincularCotacaoModal', () => {
  it('lista as cotacoes abertas com codigo, fornecedores e status', async () => {
    mostrar([cotacao(), enviada]);
    renderizar();
    expect(await screen.findByText('QR-20261118-AAA111')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/7/cotacoes-abertas/42');
    expect(screen.getAllByText(/FORNECEDOR SINTETICO UM, FORNECEDOR SINTETICO DOIS/)).toHaveLength(2);
    expect(screen.getByText('Criada')).toBeTruthy();
    expect(screen.getByText('Enviada')).toBeTruthy();
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Vincular' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cotacao sem fornecedor mostra "Sem fornecedor ainda"; item em UN fica desabilitado com o motivo', async () => {
    mostrar([cotacao(), emUn]);
    renderizar();
    await screen.findByText('QR-20261118-BBB222');
    expect(screen.getByText(/Sem fornecedor ainda/)).toBeTruthy();
    const motivo = screen.getByText('O item está em UN; só itens em KG entram no Forecast.');
    const radio = screen.getByRole('radio', { name: /QR-20261118-BBB222/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(radio.getAttribute('aria-describedby')).toBe(motivo.id);
    expect((screen.getByRole('radio', { name: /QR-20261118-AAA111/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('a cotacao ja ligada a este item aparece marcada e nao e selecionavel', async () => {
    mostrar([cotacao({ vinculadaAEsteItem: true, podeVincular: false })]);
    renderizar();
    expect(await screen.findByText('Vinculada a este item')).toBeTruthy();
    expect((screen.getByRole('radio') as HTMLInputElement).disabled).toBe(true);
  });

  it('sem cotacoes: mensagem vazia', async () => {
    mostrar([]);
    renderizar();
    expect(await screen.findByText('Nenhuma cotação aberta contém este produto.')).toBeTruthy();
  });

  it('Vincular envia PUT com { quoteRequestId } (sem substituir), invalida as decisoes e fecha', async () => {
    mostrar([cotacao()]);
    put.mockResolvedValue({ data: { acao: 'vincular' } });
    const { invalidar, onFechar } = renderizar();
    fireEvent.click(await screen.findByRole('radio', { name: /QR-20261118-AAA111/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/vinculo-cotacao/42', { quoteRequestId: 90 });
    const chaves = chavesInvalidadas(invalidar);
    expect(chaves).toContain(JSON.stringify(['forecast', 'decisoes', 7]));
    expect(chaves).toContain(JSON.stringify(['forecast', 'candidatos', 7]));
    expect(chaves).toContain(JSON.stringify(['quote-requests']));
    expect(chaves).toContain(JSON.stringify(['quote-request', 90]));
  });

  it('com cotacao atual o botao vira Trocar, avisa e envia substituir: true', async () => {
    mostrar([cotacao({ id: 92, requestCode: 'QR-NOVA' })]);
    put.mockResolvedValue({ data: { acao: 'trocar' } });
    const { invalidar, onFechar } = renderizar({ id: 80, requestCode: 'QR-ATUAL', statusCotacao: 'enviada' });
    fireEvent.click(await screen.findByRole('radio', { name: /QR-NOVA/ }));
    expect(screen.getByText(/deixa de estar ligada a este item/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vincular' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar' }));
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
    expect(put).toHaveBeenCalledWith('/v1/forecast/snapshots/7/vinculo-cotacao/42', { quoteRequestId: 92, substituir: true });
    const chaves = chavesInvalidadas(invalidar);
    expect(chaves).toContain(JSON.stringify(['quote-request', 92]));
    expect(chaves).toContain(JSON.stringify(['quote-request', 80]));
  });

  it('Desvincular pede confirmacao e envia DELETE', async () => {
    mostrar([cotacao()]);
    del.mockResolvedValue({ data: { acao: 'desvincular', decisao: null } });
    const { onFechar, invalidar } = renderizar({ id: 80, requestCode: 'QR-ATUAL', statusCotacao: 'criada' });
    await screen.findByText('QR-20261118-AAA111');
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }));
    expect(screen.getByText(/O status volta a Cotação não enviada e a Qtd\. final é apagada/)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desvinculação' }));
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith('/v1/forecast/snapshots/7/vinculo-cotacao/42');
    expect(chavesInvalidadas(invalidar)).toContain(JSON.stringify(['quote-request', 80]));
  });

  it('sem cotacao atual nao ha Desvincular', async () => {
    mostrar([cotacao()]);
    renderizar();
    await screen.findByText('QR-20261118-AAA111');
    expect(screen.queryByRole('button', { name: 'Desvincular' })).toBeNull();
  });

  it('erro 409 mostra a mensagem em role="alert" e mantem o modal aberto', async () => {
    mostrar([cotacao()]);
    put.mockRejectedValue(new ApiError(409, { message: 'O item já está na cotação aberta QR-Y. Use Trocar.' }));
    const { onFechar } = renderizar();
    fireEvent.click(await screen.findByRole('radio', { name: /QR-20261118-AAA111/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('O item já está na cotação aberta QR-Y. Use Trocar.');
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeTruthy();
  });

  it('falha ao carregar a lista mostra o erro', async () => {
    get.mockRejectedValue(new ApiError(404, { message: 'Quinzena nao encontrada.' }));
    renderizar();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Quinzena nao encontrada.');
  });

  it('Cancelar fecha sem gravar', async () => {
    mostrar([cotacao()]);
    const { onFechar } = renderizar();
    await screen.findByText('QR-20261118-AAA111');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onFechar).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
