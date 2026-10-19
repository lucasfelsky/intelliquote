import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

import { api } from '@/api/client';

const MINE_ROW = {
  id: 5,
  status: 'pending',
  customerName: 'ACME',
  notes: null,
  rejectionReason: null,
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
    },
  ],
};

const COMEX_ROW = {
  id: 9,
  status: 'quoting',
  customerName: 'Beta SA',
  notes: 'Urgente',
  rejectionReason: null,
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Solicitacoes />
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

    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
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

  it('item ja adicionado aparece como "Adicionado ✓" nos resultados', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
    fireEvent.change(screen.getByLabelText('Buscar item'), { target: { value: 're' } });
    fireEvent.click(await screen.findByRole('button', { name: '+ Resina X · Resinas' }));

    const added = await screen.findByRole('button', { name: /Resina X · Resinas\s+Adicionado ✓/ });
    expect((added as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '+ Resina X · Resinas' })).toBeNull();
  });

  it('preco-alvo aceita virgula e separador de milhar (1.234,5)', async () => {
    vi.mocked(api.post).mockResolvedValue({ ...MINE_ROW, id: 6 });
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
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
      'Observação do COMEX',
    ]);
  });

  it('termo com menos de 2 caracteres nao dispara a busca', async () => {
    renderPage();
    await screen.findByText('Pendente');
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
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
    expect(screen.getByText('QR-2026-001').className).toContain('cell-nowrap');
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
