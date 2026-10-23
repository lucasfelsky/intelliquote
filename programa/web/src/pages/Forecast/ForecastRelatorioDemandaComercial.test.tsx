import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastItemDemandaComercial } from '@/services/forecast';
import ForecastRelatorioDemandaComercial from './ForecastRelatorioDemandaComercial';
import { APOIO_DEMANDA_COMERCIAL } from './forecastRelatorioTextos';

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

const patch = vi.mocked(api.patch);

// Dados 100% sinteticos.
function pedido(over: Partial<ForecastItemDemandaComercial> = {}): ForecastItemDemandaComercial {
  return {
    id: 1,
    linha: 3,
    productId: 7,
    item: 'PRODUTO 001',
    fonte: 'FONTE 001',
    kg: 1600,
    necessidade: '2027-02-10',
    anoMes: '2027-02',
    motivo: 'MOTIVO SINTETICO',
    cliente: 'CLIENTE SINTETICO',
    solicitacaoId: null,
    situacao: 'alem-do-horizonte',
    programacaoDoMes: null,
    saldoLivre: 500,
    sugerido: 1100,
    noRelatorio: false,
    obs: '',
    ...over,
  };
}

const onConcluido = vi.fn();
let client: QueryClient;

function renderSecao(itens: ForecastItemDemandaComercial[], podeEditar: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sugeridoKg = itens.reduce((t, i) => t + i.sugerido, 0);
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioDemandaComercial
        dados={{ itens, totais: { abertas: itens.length, sugeridoKg } }}
        podeEditar={podeEditar}
        hoje="2026-10-20"
        onConcluido={onConcluido}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  patch.mockResolvedValue({ data: { id: 1 } });
});

describe('ForecastRelatorioDemandaComercial - leitura', () => {
  it('tabela com titulo, colunas e a linha do caso E (alem do horizonte: saldo 500, sugerido 1.100)', () => {
    renderSecao([pedido({ obs: 'OBS SINTETICA', solicitacaoId: 12 })], false);
    expect(screen.getByRole('region', { name: 'Demanda do comercial' })).toBeTruthy();
    expect(screen.getByText('Demanda do comercial · 1 pedido aberto')).toBeTruthy();
    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(cabecalhos).toEqual([
      'Item',
      'Fonte',
      'Necessidade',
      'Pedido (kg)',
      'Saldo livre no mês',
      'Sugerido',
      'Motivo',
      'Cliente',
      'Solicitação',
      'Situação',
    ]);
    const linha = screen.getAllByRole('row')[1] as HTMLElement;
    const celulas = within(linha).getAllByRole('cell').map((c) => c.textContent);
    expect(within(linha).getByRole('rowheader').textContent).toContain('PRODUTO 001');
    expect(within(linha).getByText('Obs.: OBS SINTETICA')).toBeTruthy();
    expect(celulas).toEqual([
      'FONTE 001',
      '10/02/2027',
      '1.600',
      '500',
      '1.100',
      'MOTIVO SINTETICO',
      'CLIENTE SINTETICO',
      '#12',
      'Além do horizonte: soma ao Forecast',
    ]);
    expect(screen.getByText(APOIO_DEMANDA_COMERCIAL)).toBeTruthy();
  });

  it('leitura (sem permissao): sem coluna Acoes e sem botoes', () => {
    renderSecao([pedido()], false);
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('dentro do horizonte: nao soma, sugerido e saldo com traco e o aviso com a programacao do mes', () => {
    renderSecao(
      [pedido({ situacao: 'no-horizonte', sugerido: 0, saldoLivre: null, programacaoDoMes: 250, necessidade: '2026-12-01', anoMes: '2026-12' })],
      false,
    );
    const linha = screen.getAllByRole('row')[1] as HTMLElement;
    const celulas = within(linha).getAllByRole('cell').map((c) => c.textContent);
    expect(celulas[3]).toBe('—'); // saldo
    expect(celulas[4]).toBe('—'); // sugerido
    expect(within(linha).getByText('Dentro do horizonte: não soma')).toBeTruthy();
    expect(
      within(linha).getByText(
        'Programação de dez/2026: 250. Confira se já está nas programações; se estiver, marque "virou programação".',
      ),
    ).toBeTruthy();
  });

  it('pedido coberto pelo saldo mostra sugerido 0 e a situacao "coberta pelo saldo"', () => {
    renderSecao([pedido({ sugerido: 0, kg: 300 })], false);
    const linha = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(linha).getByText('Além do horizonte: coberta pelo saldo')).toBeTruthy();
    expect(within(linha).getAllByRole('cell')[4]?.textContent).toBe('0');
  });

  it('produto fora da quinzena: sem calculo e aviso; item tambem na lista ganha o selo da lista', () => {
    renderSecao(
      [
        pedido({ id: 2, linha: null, situacao: 'fora-da-quinzena', sugerido: 0, saldoLivre: null }),
        pedido({ id: 3, noRelatorio: true, item: 'PRODUTO 002' }),
      ],
      false,
    );
    expect(screen.getByText('Fora desta quinzena: sem cálculo')).toBeTruthy();
    expect(screen.getByText('O produto não tem linha nesta quinzena.')).toBeTruthy();
    expect(screen.getAllByText('Também na lista de compra')).toHaveLength(1);
  });
});

describe('ForecastRelatorioDemandaComercial - fechar o pedido', () => {
  it('admin/comprador veem os botoes com nome acessivel por pedido', () => {
    renderSecao([pedido()], true);
    expect(screen.getByRole('columnheader', { name: 'Ações' })).toBeTruthy();
    const grupo = screen.getByRole('group', { name: 'Ações do pedido de PRODUTO 001' });
    expect(within(grupo).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Editar o pedido de PRODUTO 001 para 10/02/2027',
      'Marcar comprada: pedido de PRODUTO 001 para 10/02/2027',
      'Virou programação: pedido de PRODUTO 001 para 10/02/2027',
      'Cancelar: pedido de PRODUTO 001 para 10/02/2027',
    ]);
  });

  it('marcar comprada: dialogo, confirmar grava {status} sem nota, avisa a tela e devolve o foco', async () => {
    renderSecao([pedido()], true);
    const botao = screen.getByRole('button', { name: /^Marcar comprada:/ });
    botao.focus();
    fireEvent.click(botao);
    expect(await screen.findByRole('heading', { name: 'Marcar como comprada' })).toBeTruthy();
    expect(screen.getByText(/A compra já foi feita: o pedido sai desta seção/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar comprada' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/v1/forecast/commercial-demands/1', { status: 'comprada', nota: null }));
    await waitFor(() => expect(onConcluido).toHaveBeenCalledWith('Demanda marcada como comprada.'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Marcar como comprada' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });

  it('"virou programacao" aceita nota opcional', async () => {
    renderSecao([pedido()], true);
    fireEvent.click(screen.getByRole('button', { name: /^Virou programação:/ }));
    await screen.findByRole('heading', { name: 'Marcar como "virou programação"' });
    fireEvent.change(screen.getByLabelText('Nota (opcional)'), { target: { value: '  PROGRAMACAO SINTETICA 77  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Virou programação' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/forecast/commercial-demands/1', {
        status: 'virou_programacao',
        nota: 'PROGRAMACAO SINTETICA 77',
      }),
    );
    expect(onConcluido).toHaveBeenCalledWith('Demanda marcada como "virou programação".');
  });

  it('cancelar exige o motivo: sem texto mostra o erro e nao grava; com texto grava', async () => {
    renderSecao([pedido()], true);
    fireEvent.click(screen.getByRole('button', { name: /^Cancelar:/ }));
    await screen.findByRole('heading', { name: 'Cancelar demanda' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar demanda' }));
    expect(await screen.findByText('Informe o motivo do cancelamento.')).toBeTruthy();
    expect((screen.getByLabelText('Motivo do cancelamento') as HTMLTextAreaElement).getAttribute('aria-invalid')).toBe('true');
    expect(patch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Motivo do cancelamento'), { target: { value: 'CLIENTE DESISTIU SINTETICO' } });
    expect(screen.queryByText('Informe o motivo do cancelamento.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar demanda' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/forecast/commercial-demands/1', {
        status: 'cancelada',
        nota: 'CLIENTE DESISTIU SINTETICO',
      }),
    );
    expect(onConcluido).toHaveBeenCalledWith('Demanda cancelada.');
  });

  it('409 (pedido ja fechado por outra pessoa): mostra a mensagem do servidor e o dialogo continua aberto', async () => {
    patch.mockRejectedValue(new ApiError(409, { message: 'Demanda ja fechada: nao pode ser alterada nem reaberta.' }));
    renderSecao([pedido()], true);
    fireEvent.click(screen.getByRole('button', { name: /^Marcar comprada:/ }));
    await screen.findByRole('heading', { name: 'Marcar como comprada' });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar comprada' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Demanda ja fechada: nao pode ser alterada nem reaberta.');
    expect(onConcluido).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Marcar como comprada' })).toBeTruthy();
  });

  it('Voltar fecha sem gravar e devolve o foco ao botao', async () => {
    renderSecao([pedido()], true);
    const botao = screen.getByRole('button', { name: /^Cancelar:/ });
    botao.focus();
    fireEvent.click(botao);
    await screen.findByRole('heading', { name: 'Cancelar demanda' });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Cancelar demanda' })).toBeNull());
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(botao));
  });
});
