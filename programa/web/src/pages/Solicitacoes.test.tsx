import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Solicitacoes from './Solicitacoes';

let mockRole = 'comercial';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

const MINE_ROW = {
  id: 5,
  status: 'pending',
  customerName: 'ACME',
  notes: null,
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-19T12:00:00.000Z',
  statusChangedAt: null,
  quote: null,
  items: [
    {
      id: 1,
      catalogItemId: 10,
      commercialName: 'Resina X',
      quantity: 5,
      unit: 'KG',
      targetPrice: null,
      targetCurrency: null,
      finalPrice: null,
    },
  ],
};

const COMEX_ROW = {
  id: 9,
  status: 'quoting',
  customerName: 'Beta SA',
  notes: 'Urgente',
  rejectionReason: null,
  fulfillmentNote: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  statusChangedAt: null,
  requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
  statusChangedBy: null,
  quoteRequest: { id: 4, requestCode: 'QR-2026-001', status: 'open' },
  items: [
    {
      id: 1,
      catalogItemId: 10,
      commercialName: 'Resina X',
      marketName: 'RX-100',
      dbcorpCode: 'DB-77',
      quantity: 5,
      unit: 'KG',
      targetPrice: '10.50',
      targetCurrency: 'USD',
      quoteRequestItemId: 501,
    },
  ],
};

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi(overrides: Record<string, unknown> = {}) {
  vi.mocked(api.get).mockImplementation((async (path: string) => {
    if (path in overrides) return overrides[path];
    if (path === '/api/v1/commercial-requests/mine') return page([MINE_ROW]);
    if (path === '/api/v1/commercial-requests/catalog-items') {
      return [{ id: 10, commercialName: 'Resina X', familyName: 'Resinas' }];
    }
    if (path === '/api/v1/commercial-requests/requesters') return [{ id: 3, name: 'Ana Comercial' }];
    if (path === '/api/v1/commercial-requests') return page([COMEX_ROW]);
    return [];
  }) as typeof api.get);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/solicitacoes']}>
        <Routes>
          <Route path="*" element={<Solicitacoes />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

describe('Solicitacoes - comercial', () => {
  beforeEach(() => {
    mockRole = 'comercial';
  });

  it('lista as proprias com status em portugues', async () => {
    renderPage();
    expect(await screen.findByText('Pendente')).toBeTruthy();
    expect(screen.getByText(/Resina X — 5 KG/)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests/mine', {
      page: 1,
      status: undefined,
    });
  });

  it('busca chama o endpoint do comercial, Enviar fica desabilitado sem item e POST nao leva requestedById', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW, id: 6 });
    renderPage();
    await screen.findByText('Pendente');

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    const enviar = screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests/catalog-items', {
        search: 're',
      }),
    );

    // "Nome comercial · Familia" quando ha familia
    const result = await screen.findByRole('button', { name: '+ Resina X · Resinas' });
    fireEvent.click(result);
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/v1/commercial-requests');
    expect(body).not.toHaveProperty('requestedById');
    expect(body.items).toEqual([{ catalogItemId: 10, quantity: 1, unit: 'KG' }]);
  });

  it('quantidade zero ou fracionada desabilita o Enviar', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));

    fireEvent.change(screen.getByLabelText('Quantidade *'), { target: { value: '0' } });
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Quantidade *'), { target: { value: '2.5' } });
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Quantidade *'), { target: { value: '3' } });
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('preco-alvo vai com a moeda escolhida', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW, id: 6 });
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));
    fireEvent.change(screen.getByLabelText('Preço-alvo'), { target: { value: '12,5' } });
    fireEvent.change(screen.getByLabelText('Unidade'), { target: { value: 'TON' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body.items).toEqual([
      { catalogItemId: 10, quantity: 1, unit: 'TON', targetPrice: 12.5, targetCurrency: 'USD' },
    ]);
  });

  it('escolher um item fecha a busca e coloca o foco na quantidade dele', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));

    expect(screen.queryByLabelText('Buscar item')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Resultados da busca' })).toBeNull();
    const qty = screen.getByLabelText('Quantidade *');
    await waitFor(() => expect(document.activeElement).toBe(qty));
    expect(screen.getByRole('button', { name: '+ Adicionar outro item' })).toBeTruthy();
  });

  it('"+ Adicionar outro item" reabre a busca vazia e "Fechar busca" volta ao botao', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar outro item' }));
    const search = screen.getByLabelText('Buscar item') as HTMLInputElement;
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(search);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar busca' }));
    expect(screen.queryByLabelText('Buscar item')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Adicionar outro item' })).toBeTruthy();
  });

  it('remover o unico item volta a mostrar a busca', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remover item' }));
    const search = screen.getByLabelText('Buscar item');
    expect(screen.queryByRole('button', { name: '+ Adicionar outro item' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('item ja adicionado aparece como "Adicionado ✓" nos resultados', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar outro item' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });

    const added = await screen.findByRole('button', { name: /Resina X · Resinas\s+Adicionado ✓/ });
    expect((added as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '+ Resina X · Resinas' })).toBeNull();
  });

  it('preco-alvo aceita virgula e separador de milhar (1.234,5)', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW, id: 6 });
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));
    fireEvent.change(screen.getByLabelText('Preço-alvo'), { target: { value: '1.234,5' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect((body.items as Array<Record<string, unknown>>)[0]?.targetPrice).toBe(1234.5);
  });

  async function openFormWithItem() {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));
  }

  it.each([
    ['1.500', 1500],
    ['1.500,25', 1500.25],
    ['1,85', 1.85],
    ['1.85', 1.85],
    ['12.345.678', 12345678],
  ])('preco-alvo "%s" vira %s', async (raw, expected) => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW, id: 6 });
    await openFormWithItem();
    fireEvent.change(screen.getByLabelText('Preço-alvo'), { target: { value: raw } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0]?.targetPrice).toBe(expected);
  });

  it('preco-alvo vazio: enviado sem targetPrice', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW, id: 6 });
    await openFormWithItem();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0]).not.toHaveProperty('targetPrice');
  });

  it('preco-alvo "1,234.5" (ordem americana) e rejeitado com a dica de virgula e nao envia', async () => {
    await openFormWithItem();
    fireEvent.change(screen.getByLabelText('Preço-alvo'), { target: { value: '1,234.5' } });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Use vírgula para decimais (ex.: 1.234,50)');
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['1,999', '1.500,255'])(
    'preco-alvo "%s" com mais de 2 casas decimais e rejeitado e nao envia',
    async (raw) => {
      await openFormWithItem();
      fireEvent.change(screen.getByLabelText('Preço-alvo'), { target: { value: raw } });

      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Use vírgula para decimais (ex.: 1.234,50)');
      expect(api.post).not.toHaveBeenCalled();
    },
  );

  it('lista do comercial formata quantidade e preco-alvo em pt-BR e deixa o codigo da cotacao sem quebra', async () => {
    mockApi({
      '/api/v1/commercial-requests/mine': page([
        {
          ...MINE_ROW,
          status: 'quoting',
          quote: { requestCode: 'QR-2026-009' },
          items: [
            { ...MINE_ROW.items[0], quantity: 12000, targetPrice: '1.85', targetCurrency: 'USD' },
          ],
        },
      ]),
    });
    renderPage();

    expect(await screen.findByText(/Resina X — 12\.000 KG — alvo 1,85 USD/)).toBeTruthy();
    expect(screen.getByText('QR-2026-009').className).toContain('cell-nowrap');
  });

  it('cada celula carrega data-label (a tabela vira card em telas estreitas)', async () => {
    renderPage();
    await screen.findByText('Pendente');
    const row = screen.getByText('Pendente').closest('tr') as HTMLElement;
    const labels = Array.from(row.querySelectorAll('td')).map((td) => td.getAttribute('data-label'));
    expect(labels).toEqual([
      'Solicitação',
      'Criada em',
      'Cliente',
      'Itens',
      'Status',
      'Cotação',
      'Anexos',
      'Observação do COMEX',
    ]);
  });

  it('termo com menos de 2 caracteres nao dispara a busca', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 'r' } });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(api.get).not.toHaveBeenCalledWith(
      '/api/v1/commercial-requests/catalog-items',
      expect.anything(),
    );
  });

  it('solicitacao recusada mostra o motivo; com cotacao mostra o codigo', async () => {
    mockApi({
      '/api/v1/commercial-requests/mine': page([
        { ...MINE_ROW, id: 1, status: 'rejected', rejectionReason: 'Fora de linha' },
        { ...MINE_ROW, id: 2, status: 'quoting', quote: { requestCode: 'QR-2026-009' } },
      ]),
    });
    renderPage();
    expect(await screen.findByText('Recusada')).toBeTruthy();
    expect(screen.getByText('Motivo: Fora de linha')).toBeTruthy();
    expect(screen.getByText('Em cotação')).toBeTruthy();
    expect(screen.getByText('QR-2026-009')).toBeTruthy();
  });
});

describe('Solicitacoes - COMEX', () => {
  beforeEach(() => {
    mockRole = 'viewer';
  });

  it('lista com solicitante e SEM botoes de acao para viewer', async () => {
    renderPage();
    expect(await screen.findByText('Ana Comercial', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Em cotação', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('QR-2026-001')).toBeTruthy();

    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const forbidden of [/vincular/i, /criar cota/i, /recusar/i, /atender/i, /nova solicita/i]) {
      expect(buttons.some((label) => forbidden.test(label))).toBe(false);
    }
  });

  it('"Ver itens" e o codigo da cotacao ficam em celulas rotuladas e filtros usam a classe responsiva', async () => {
    renderPage();
    await screen.findByText('Beta SA');

    expect(screen.getByRole('button', { name: 'Ver itens' }).closest('td')?.className).toContain(
      'sol-cell-actions',
    );
    expect(screen.getByText('QR-2026-001').closest('td')?.className).toContain('cell-nowrap');
    expect(screen.getByLabelText('Filtrar por status').className).toContain('sol-filter');
    expect(screen.getByLabelText('Filtrar por solicitante').className).toContain('sol-filter');
  });

  it('filtro de status vai na query', async () => {
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'pending' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests', {
        page: 1,
        status: 'pending',
        requestedById: undefined,
      }),
    );
  });

  it('filtro de solicitante vai na query', async () => {
    renderPage();
    await screen.findByText('Beta SA');
    await screen.findByRole('option', { name: 'Ana Comercial' });

    fireEvent.change(screen.getByLabelText('Filtrar por solicitante'), { target: { value: '3' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests', {
        page: 1,
        status: undefined,
        requestedById: 3,
      }),
    );
  });

  it('linha expansivel mostra nome de mercado e codigo DBCorp', async () => {
    renderPage();
    await screen.findByText('Beta SA');
    expect(screen.queryByText('RX-100')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ver itens' }));
    const marketCell = await screen.findByText('RX-100');
    const row = marketCell.closest('tr') as HTMLElement;
    expect(within(row).getByText('Resina X')).toBeTruthy();
    expect(within(row).getByText('DB-77')).toBeTruthy();
    expect(within(row).getByText('5 KG')).toBeTruthy();
    expect(within(row).getByText('10,50 USD')).toBeTruthy();
  });
});

const PENDING_ROW = { ...COMEX_ROW, id: 9, status: 'pending', quoteRequest: null };
const QUOTING_ROW = { ...COMEX_ROW, id: 10, status: 'quoting' };
const FULFILLED_ROW = {
  ...COMEX_ROW,
  id: 11,
  status: 'fulfilled',
  fulfillmentNote: 'Cliente fechou por fora',
  items: [{ ...COMEX_ROW.items[0], quoteRequestItemId: null }],
};

function comexList(rows: unknown[]) {
  mockApi({ '/api/v1/commercial-requests': page(rows) });
}

describe('Solicitacoes - COMEX acoes (PR2)', () => {
  it.each(['admin', 'comprador'])('%s ve as acoes de uma solicitacao pendente', async (role) => {
    mockRole = role;
    comexList([PENDING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    for (const name of ['Criar cotação', 'Vincular a cotação', 'Recusar']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Marcar atendida' })).toBeNull();
  });

  it.each(['admin', 'comprador'])('%s ve "Marcar atendida" e "Recusar" em cotacao', async (role) => {
    mockRole = role;
    comexList([QUOTING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    expect(screen.getByRole('button', { name: 'Marcar atendida' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Criar cotação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vincular a cotação' })).toBeNull();
  });

  it('solicitacao atendida nao tem acoes', async () => {
    mockRole = 'admin';
    comexList([FULFILLED_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    for (const name of ['Criar cotação', 'Vincular a cotação', 'Recusar', 'Marcar atendida']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it.each(['gestor', 'viewer'])('%s nao ve nenhum botao de acao nem a coluna Acoes', async (role) => {
    mockRole = role;
    comexList([PENDING_ROW, QUOTING_ROW]);
    renderPage();
    await screen.findAllByText('Beta SA');

    for (const name of ['Criar cotação', 'Vincular a cotação', 'Recusar', 'Marcar atendida']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).toBeNull();
    expect(screen.getByText(/somente leitura/)).toBeTruthy();
  });

  it('admin/comprador: subtitulo sem "(somente leitura)"', async () => {
    mockRole = 'comprador';
    renderPage();
    await screen.findByText('Beta SA');
    expect(screen.queryByText(/somente leitura/)).toBeNull();
  });

  it('"Criar cotacao" abre a Nova cotacao pre-preenchida pela query', async () => {
    mockRole = 'comprador';
    comexList([PENDING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Criar cotação' }));
    expect((await screen.findByTestId('loc')).textContent).toBe(
      '/cotacoes/nova?fromCommercialRequest=9',
    );
  });

  it('Recusar: motivo vazio desabilita e com motivo faz POST /reject', async () => {
    mockRole = 'admin';
    comexList([PENDING_ROW]);
    vi.mocked(api.post).mockResolvedValue({ ...PENDING_ROW, status: 'rejected' });
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    const confirm = (await screen.findByRole('button', {
      name: 'Confirmar recusa',
    })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Motivo da recusa *'), { target: { value: '  ab  ' } });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Motivo da recusa *'), {
      target: { value: 'Fora do portfolio' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/commercial-requests/9/reject', {
      reason: 'Fora do portfolio',
    });
  });

  it('Vincular: busca cotacoes abertas e confirma com POST /link-quote', async () => {
    mockRole = 'comprador';
    comexList([PENDING_ROW]);
    mockApi({
      '/api/v1/commercial-requests': page([PENDING_ROW]),
      '/api/v1/quote-requests': page([
        { id: 77, requestCode: 'QR-OPEN-1', description: 'Cotacao de resinas', createdAt: '2026-10-01T00:00:00Z' },
      ]),
    });
    vi.mocked(api.post).mockResolvedValue({ ...PENDING_ROW, status: 'quoting' });
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Vincular a cotação' }));
    const vincular = (await screen.findByRole('button', { name: 'Vincular' })) as HTMLButtonElement;
    expect(vincular.disabled).toBe(true);
    expect(screen.getByText(/Itens novos não entram nos links já enviados/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Buscar cotação aberta'), { target: { value: 'qr' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/v1/quote-requests', {
        status: 'open',
        search: 'qr',
        page: 1,
        pageSize: 10,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /QR-OPEN-1/ }));
    expect(vincular.disabled).toBe(false);
    fireEvent.click(vincular);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/commercial-requests/9/link-quote', {
      quoteRequestId: 77,
    });
  });

  it('Vincular: termo com menos de 2 caracteres nao busca', async () => {
    mockRole = 'comprador';
    comexList([PENDING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Vincular a cotação' }));
    fireEvent.change(await screen.findByLabelText('Buscar cotação aberta'), { target: { value: 'q' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.get).not.toHaveBeenCalledWith('/api/v1/quote-requests', expect.anything());
  });

  it('Marcar atendida: 409 mostra a mensagem do backend', async () => {
    mockRole = 'comprador';
    comexList([QUOTING_ROW]);
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(409, { message: 'A cotacao vinculada ainda nao tem vencedor; marque o vencedor.' }),
    );
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar atendida' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/ainda nao tem vencedor/)).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/api/v1/commercial-requests/10/fulfill', {});
  });

  it('comprador nao ve "Atender sem preco"', async () => {
    mockRole = 'comprador';
    comexList([QUOTING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar atendida' }));
    await screen.findByRole('button', { name: 'Confirmar' });
    expect(screen.queryByLabelText('Atender sem preço')).toBeNull();
  });

  it('admin atende sem preco: motivo obrigatorio e envia { force: true, note }', async () => {
    mockRole = 'admin';
    comexList([QUOTING_ROW]);
    vi.mocked(api.post).mockResolvedValue({ ...QUOTING_ROW, status: 'fulfilled' });
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar atendida' }));
    const confirm = (await screen.findByRole('button', { name: 'Confirmar' })) as HTMLButtonElement;
    fireEvent.click(screen.getByLabelText('Atender sem preço'));
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Motivo *'), {
      target: { value: 'Cliente fechou por fora' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/commercial-requests/10/fulfill', {
      force: true,
      note: 'Cliente fechou por fora',
    });
  });

  it('linha expandida mostra "Na cotacao" (Sim/Nao) e a nota de atendimento', async () => {
    mockRole = 'viewer';
    comexList([FULFILLED_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Ver itens' }));
    expect(await screen.findByText('Na cotação', { selector: 'th' })).toBeTruthy();
    expect(screen.getByText('Não', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText(/Cliente fechou por fora/)).toBeTruthy();
    expect(screen.getByText(/Atendida sem preço:/)).toBeTruthy();
  });

  it('item vinculado mostra "Sim" em "Na cotacao"', async () => {
    mockRole = 'viewer';
    comexList([QUOTING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Ver itens' }));
    expect(await screen.findByText('Sim', { selector: 'td' })).toBeTruthy();
  });

  it('codigo da cotacao vira link para a cotacao', async () => {
    mockRole = 'viewer';
    comexList([QUOTING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'QR-2026-001' }));
    expect((await screen.findByTestId('loc')).textContent).toBe('/cotacoes/4');
  });
});

describe('Solicitacoes - comercial preco final (PR2)', () => {
  beforeEach(() => {
    mockRole = 'comercial';
  });

  const FULFILLED_MINE = {
    ...MINE_ROW,
    id: 21,
    status: 'fulfilled',
    quote: { requestCode: 'QR-9' },
    fulfillmentNote: null,
    items: [
      {
        ...MINE_ROW.items[0],
        id: 1,
        finalPrice: { unitPrice: '1.85', currency: 'EUR', incoterm: 'CIF', unit: 'KG' },
      },
      { ...MINE_ROW.items[0], id: 2, catalogItemId: 11, commercialName: 'Solvente Y', finalPrice: null },
    ],
  };

  it('preco final so aparece na linha atendida; item sem preco mostra "Sem preco"', async () => {
    const QUOTING_MINE = {
      ...MINE_ROW,
      id: 22,
      status: 'quoting',
      items: [
        {
          ...MINE_ROW.items[0],
          id: 3,
          commercialName: 'Acetona Z',
          // mesmo que o backend mandasse algo, fora de fulfilled a tela nao mostra preco
          finalPrice: { unitPrice: '9.99', currency: 'USD', incoterm: 'FOB', unit: 'KG' },
        },
      ],
    };
    mockApi({ '/api/v1/commercial-requests/mine': page([FULFILLED_MINE, QUOTING_MINE]) });
    renderPage();

    expect(await screen.findByText(/Resina X — 5 KG — preço final 1,85 EUR\/KG CIF/)).toBeTruthy();
    expect(screen.getByText(/Solvente Y — 5 KG — sem preço final/)).toBeTruthy();
    const quotingItem = screen.getByText(/Acetona Z — 5 KG/);
    expect(quotingItem.textContent).not.toContain('preço final');
    expect(screen.queryByText(/9,99/)).toBeNull();
  });

  it('fulfillmentNote aparece em "Observacao do COMEX" quando atendida', async () => {
    mockApi({
      '/api/v1/commercial-requests/mine': page([
        { ...FULFILLED_MINE, fulfillmentNote: 'Cliente fechou por fora' },
      ]),
    });
    renderPage();

    expect(await screen.findByText('Cliente fechou por fora')).toBeTruthy();
  });
});

describe('Solicitacoes - ajustes de modal (QA)', () => {
  it('Q1: o dialog dos modais herda text-align esquerdo (nao o do card mobile)', async () => {
    mockRole = 'admin';
    comexList([PENDING_ROW]);
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    const confirm = await screen.findByRole('button', { name: 'Confirmar recusa' });
    const dialog = confirm.closest('dialog') as HTMLElement;
    expect(dialog.parentElement?.style.textAlign).toBe('left');
    expect((confirm.closest('.modal-body')?.firstElementChild as HTMLElement).style.textAlign).toBe('left');
  });

  it('Q1: botoes da lista de cotacoes abertas alinhados a esquerda', async () => {
    mockRole = 'comprador';
    mockApi({
      '/api/v1/commercial-requests': page([PENDING_ROW]),
      '/api/v1/quote-requests': page([
        { id: 77, requestCode: 'QR-OPEN-1', description: 'Cotacao de resinas', createdAt: '2026-10-01T00:00:00Z' },
      ]),
    });
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Vincular a cotação' }));
    fireEvent.change(await screen.findByLabelText('Buscar cotação aberta'), { target: { value: 'qr' } });
    const option = await screen.findByRole('button', { name: /QR-OPEN-1/ });
    expect(option.style.textAlign).toBe('left');
  });

  it('Q2: erro do fulfill some ao alternar "Atender sem preco" e ao editar a nota', async () => {
    mockRole = 'admin';
    comexList([QUOTING_ROW]);
    vi.mocked(api.post).mockRejectedValue(
      new ApiError(409, { message: 'A cotacao vinculada ainda nao tem vencedor.' }),
    );
    renderPage();
    await screen.findByText('Beta SA');

    fireEvent.click(screen.getByRole('button', { name: 'Marcar atendida' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Atender sem preço'));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(screen.getByLabelText('Motivo *'), { target: { value: 'Cliente fechou por fora' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Motivo *'), { target: { value: 'Cliente fechou por fora!' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('A1: preco final mostra a unidade da cotacao (USD/TON)', async () => {
    mockRole = 'comercial';
    mockApi({
      '/api/v1/commercial-requests/mine': page([
        {
          ...MINE_ROW,
          id: 31,
          status: 'fulfilled',
          items: [
            {
              ...MINE_ROW.items[0],
              finalPrice: { unitPrice: '1720.00', currency: 'USD', incoterm: 'CIF', unit: 'TON' },
            },
          ],
        },
      ]),
    });
    renderPage();
    expect(await screen.findByText(/preço final 1\.720,00 USD\/TON CIF/)).toBeTruthy();
  });
});
