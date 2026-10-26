import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Forecast from '../Forecast';
import ForecastExcluirQuinzenaModal from './ForecastExcluirQuinzenaModal';
import type { ForecastSnapshotSummary } from '@/services/forecast';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: mockRole } }),
}));

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
const del = vi.mocked(api.del);

// Dados 100% sinteticos.
const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

const Q7: ForecastSnapshotSummary = {
  id: 7,
  label: '10-2',
  baseDate: '2026-10-15T00:00:00.000Z',
  half: 2,
  origin: 'planilha',
  months: MONTHS,
  files: [],
  createdById: 1,
  createdAt: '2026-10-20T12:00:00.000Z',
};
const Q8: ForecastSnapshotSummary = {
  id: 8,
  label: '11-1',
  baseDate: '2026-11-05T00:00:00.000Z',
  half: 1,
  origin: 'dbcorp',
  months: MONTHS,
  files: [],
  createdById: 1,
  createdAt: '2026-11-05T12:00:00.000Z',
};

function linha(n: number) {
  return {
    linha: n + 2,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: `PRODUTO ${n}`,
    codigos: [`C000${n}`],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    n,
    historico: [1, 2, 3, 4, 5],
    obs: '',
    precoFixo: false,
  };
}

function detalheDe(q: ForecastSnapshotSummary) {
  return {
    id: q.id,
    label: q.label,
    baseDate: q.baseDate.slice(0, 10),
    half: q.half,
    origin: q.origin,
    hoje: '2026-11-10',
    months: MONTHS,
    files: [],
    createdAt: q.createdAt,
    linhas: [linha(1), linha(2), linha(3)],
    conferencia: { celulas: 3, batem: 3, porColuna: {}, totalDivergencias: 0, divergencias: [] },
  };
}

const PENDENTES = {
  aplicavel: true,
  snapshotId: 8,
  label: '11-1',
  itens: [],
  totalItens: 0,
  omitidos: 0,
  soSaldo: { codigos: 0, kg: 0 },
};

/** API em memoria: o DELETE tira a quinzena da lista e o GET dela passa a dar 404. */
function mockApi(inicial: ForecastSnapshotSummary[]) {
  let lista = [...inicial];
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: lista };
    const id = Number(path.split('/')[4]);
    const q = lista.find((s) => s.id === id);
    if (!q) throw new ApiError(404, null);
    if (path.endsWith('/pendentes')) return { data: { ...PENDENTES, snapshotId: id, label: q.label } };
    if (path.endsWith('/relatorio-compras')) throw new ApiError(500, null);
    return { data: detalheDe(q) };
  });
  del.mockImplementation(async (path: string) => {
    const id = Number(path.split('/').pop());
    const q = lista.find((s) => s.id === id);
    lista = lista.filter((s) => s.id !== id);
    return { data: { id, label: q?.label ?? '', excluida: true } };
  });
}

function renderPage(url = '/forecast') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Forecast />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const dialogo = () => {
  const el = document.querySelector('dialog[open]');
  if (!el) throw new Error('nenhum dialogo aberto');
  return el as HTMLDialogElement;
};
const botaoConfirmar = () => within(dialogo()).getByRole('button', { name: 'Excluir quinzena' }) as HTMLButtonElement;
const botaoCancelar = () => within(dialogo()).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement;
const campo = () => within(dialogo()).getByLabelText(/Para confirmar, digite/) as HTMLInputElement;
const digitar = (texto: string) => fireEvent.change(campo(), { target: { value: texto } });

function renderModal(over: Partial<{ quinzena: ForecastSnapshotSummary; produtos: number | null }> = {}) {
  const onFechar = vi.fn();
  const onExcluida = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ForecastExcluirQuinzenaModal
        quinzena={over.quinzena ?? Q7}
        produtos={over.produtos === undefined ? 3 : over.produtos}
        onFechar={onFechar}
        onExcluida={onExcluida}
      />
    </QueryClientProvider>,
  );
  return { onFechar, onExcluida, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = 'comprador';
});

describe('ForecastExcluirQuinzenaModal', () => {
  it('mostra rotulo, data base, origem, produtos e o que nao e desfeito; foco inicial em Cancelar', () => {
    renderModal();
    const d = within(dialogo());
    expect(d.getByRole('heading', { name: 'Excluir a quinzena 10-2?' })).toBeTruthy();
    const dados = dialogo().querySelector('.fcx-dados')!;
    expect(dados.textContent).toContain('10-2');
    expect(dados.textContent).toContain('15/10/2026');
    expect(dados.textContent).toContain('planilha');
    expect(dados.textContent).toContain('3');
    expect(d.getByText(/Não dá para desfazer pela tela\./)).toBeTruthy();
    expect(d.getByText('Depois de excluir, a mesma quinzena pode ser importada de novo.')).toBeTruthy();
    expect(d.getByText('relatórios e XLSX já baixados.')).toBeTruthy();
    expect(document.activeElement).toBe(botaoCancelar());
  });

  it('sem o detalhe carregado, Produtos mostra o travessao', () => {
    renderModal({ produtos: null });
    expect(dialogo().querySelector('.fcx-dados')!.textContent).toContain('Produtos—');
  });

  it('origem planilha cita o cadastro e o historico gravados pela importacao', () => {
    renderModal();
    const d = within(dialogo());
    expect(d.getByText(/o cadastro de produtos, códigos e fontes e o histórico de vendas/)).toBeTruthy();
    expect(d.queryByText(/histórico de vendas do mês anterior/)).toBeNull();
  });

  it('origem dbcorp cita o historico do mes anterior e os prazos de chegada', () => {
    renderModal({ quinzena: Q8 });
    const d = within(dialogo());
    expect(d.getByText(/o histórico de vendas do mês anterior e os prazos de chegada por fonte/)).toBeTruthy();
    expect(d.getByText(/o prazo real por fonte passa a usar a quinzena DBCorp anterior/)).toBeTruthy();
    expect(d.queryByText(/o cadastro de produtos, códigos e fontes/)).toBeNull();
    expect(dialogo().querySelector('.fcx-dados')!.textContent).toContain('relatórios DBCorp');
  });

  it('so habilita com o rotulo exato (aparado) e desabilita de novo ao errar', () => {
    renderModal();
    expect(botaoConfirmar().disabled).toBe(true);
    for (const errado of ['10-1', '102', '11-1', '10-']) {
      digitar(errado);
      expect(botaoConfirmar().disabled).toBe(true);
    }
    digitar('10-2');
    expect(botaoConfirmar().disabled).toBe(false);
    digitar(' 10-2 ');
    expect(botaoConfirmar().disabled).toBe(false);
    digitar('10-22');
    expect(botaoConfirmar().disabled).toBe(true);
  });

  it('o campo tem rotulo e dica associados', () => {
    renderModal();
    expect(campo().getAttribute('aria-describedby')).toBe('fcx-rotulo-dica');
    expect(document.getElementById('fcx-rotulo-dica')?.textContent).toBe(
      'Digite o rótulo exatamente como aparece no seletor.',
    );
  });

  it('cancelar nao exclui e fecha; Esc (evento cancel) tambem nao exclui', () => {
    const { onFechar } = renderModal();
    fireEvent.click(botaoCancelar());
    expect(onFechar).toHaveBeenCalledTimes(1);
    dialogo().dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onFechar).toHaveBeenCalledTimes(2);
    expect(del).not.toHaveBeenCalled();
  });

  it('confirmar chama o DELETE UMA vez (2 cliques) e avisa a pagina', async () => {
    let liberar: (v: unknown) => void = () => undefined;
    del.mockImplementation(() => new Promise((resolve) => (liberar = resolve)));
    const { onExcluida } = renderModal();
    digitar('10-2');
    fireEvent.click(botaoConfirmar());
    fireEvent.click(botaoConfirmar());
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del).toHaveBeenCalledWith('/v1/forecast/snapshots/7');
    expect(await screen.findByText('Excluindo a quinzena 10-2…')).toBeTruthy();
    expect(botaoConfirmar().disabled).toBe(true);
    expect(botaoCancelar().disabled).toBe(true);
    liberar({ data: { id: 7, label: '10-2', excluida: true } });
    await waitFor(() => expect(onExcluida).toHaveBeenCalledWith(7, '10-2'));
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('Enter no campo com o rotulo errado nao exclui', () => {
    renderModal();
    digitar('10-1');
    fireEvent.submit(campo().closest('form')!);
    expect(del).not.toHaveBeenCalled();
  });

  it('erro 503: alerta com a mensagem, dialogo aberto e botao livre para tentar de novo', async () => {
    del.mockRejectedValue(new ApiError(503, null));
    const { onExcluida, onFechar } = renderModal();
    digitar('10-2');
    fireEvent.click(botaoConfirmar());
    const alerta = await within(dialogo()).findByRole('alert');
    expect(alerta.textContent).toBe(
      'Há uma importação do Forecast em andamento. Tente de novo em instantes; nada foi excluído.',
    );
    expect(onExcluida).not.toHaveBeenCalled();
    expect(onFechar).not.toHaveBeenCalled();
    expect(botaoConfirmar().disabled).toBe(false);
  });

  it('erro 404: alerta, dialogo aberto e a lista de quinzenas e invalidada', async () => {
    del.mockRejectedValue(new ApiError(404, null));
    const { invalidate, onExcluida } = renderModal();
    digitar('10-2');
    fireEvent.click(botaoConfirmar());
    const alerta = await within(dialogo()).findByRole('alert');
    expect(alerta.textContent).toBe('A quinzena 10-2 já foi excluída ou não existe mais. A lista foi atualizada.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['forecast', 'snapshots'] });
    expect(onExcluida).not.toHaveBeenCalled();
  });
});

describe('Forecast - excluir quinzena', () => {
  it.each(['viewer', 'gestor', 'comercial'])('%s nao ve o botao', async (role) => {
    mockRole = role;
    mockApi([Q7]);
    renderPage();
    await screen.findByText(/Quinzena 10-2 · base 15\/10\/2026/);
    expect(screen.queryByRole('button', { name: 'Excluir quinzena' })).toBeNull();
  });

  it.each(['comprador', 'admin'])('%s ve o botao', async (role) => {
    mockRole = role;
    mockApi([Q7]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Excluir quinzena' })).toBeTruthy();
  });

  it('sem quinzena o botao nao existe', async () => {
    mockApi([]);
    renderPage();
    await screen.findByText(/Nenhuma quinzena importada ainda/);
    expect(screen.queryByRole('button', { name: 'Excluir quinzena' })).toBeNull();
  });

  it('o modal da pagina mostra o nº de produtos do detalhe carregado', async () => {
    mockApi([Q7, Q8]);
    renderPage();
    await screen.findByText('Quinzena 10-2 · base 15/10/2026 · 3 produtos · origem planilha');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir quinzena' }));
    expect(dialogo().querySelector('.fcx-dados')!.textContent).toContain('Produtos3');
  });

  it('cancelar devolve o foco ao botao Excluir e nao chama o DELETE', async () => {
    mockApi([Q7, Q8]);
    renderPage();
    await screen.findByText(/Quinzena 10-2 · base 15\/10\/2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir quinzena' }));
    fireEvent.click(botaoCancelar());
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Excluir quinzena' }));
    expect(del).not.toHaveBeenCalled();
  });

  it('excluir a 7 com a 8 restante: avisa, passa para a 8, tira a 7 das opcoes, revalida e foca o seletor', async () => {
    mockApi([Q7, Q8]);
    renderPage();
    await screen.findByText('Quinzena 10-2 · base 15/10/2026 · 3 produtos · origem planilha');
    const listasAntes = get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots').length;

    fireEvent.click(screen.getByRole('button', { name: 'Excluir quinzena' }));
    digitar('10-2');
    fireEvent.click(botaoConfirmar());

    const aviso = await screen.findByText('Quinzena 10-2 excluída.');
    expect(aviso.getAttribute('role')).toBe('status');
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/v1/forecast/snapshots/7');
    expect(
      await screen.findByText('Quinzena 11-1 · base 05/11/2026 · 3 produtos · origem relatórios DBCorp'),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/8');

    const seletor = screen.getByLabelText('Quinzena') as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(['8']);
    expect(seletor.value).toBe('8');
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.activeElement).toBe(seletor);
    expect(get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots').length).toBeGreaterThan(listasAntes);
    // Nenhum GET do que foi excluido depois da exclusao (daria 404): so o detalhe inicial da 7.
    const da7 = get.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/snapshots/7'));
    expect(da7).toEqual(['/v1/forecast/snapshots/7']);
  });

  it('excluir a unica quinzena mostra o estado vazio e foca Importar quinzena', async () => {
    mockApi([Q7]);
    renderPage();
    await screen.findByText(/Quinzena 10-2 · base 15\/10\/2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir quinzena' }));
    digitar('10-2');
    fireEvent.click(botaoConfirmar());

    expect(await screen.findByText('Quinzena 10-2 excluída.')).toBeTruthy();
    expect(
      await screen.findByText(
        'Nenhuma quinzena importada ainda. Use “Importar quinzena” para enviar os relatórios do DBCorp.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluir quinzena' })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Importar quinzena' })),
    );
  });

  it('trocar de quinzena no seletor limpa o aviso de exclusao', async () => {
    mockApi([Q7, Q8, { ...Q8, id: 9, label: '11-2', half: 2 }]);
    renderPage();
    await screen.findByText(/Quinzena 10-2 · base 15\/10\/2026/);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir quinzena' }));
    digitar('10-2');
    fireEvent.click(botaoConfirmar());
    await screen.findByText('Quinzena 10-2 excluída.');
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '9' } });
    await waitFor(() => expect(screen.queryByText('Quinzena 10-2 excluída.')).toBeNull());
  });
});
