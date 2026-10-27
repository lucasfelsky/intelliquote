import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
import { SolicitacaoDesenvolvimentoPanel } from './SolicitacaoDesenvolvimentoPanel';

// Dados 100% sinteticos.
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    status: 'quoting',
    customerName: null,
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    statusChangedAt: null,
    isDevelopment: true,
    attachments: [
      { id: 3, kind: 'MSDS', fileName: 'msds.pdf', mimeType: 'application/pdf', fileSize: 1024, createdAt: 'x' },
    ],
    requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
    statusChangedBy: null,
    quoteRequest: { id: 50, requestCode: 'QR-50', status: 'open' },
    items: [
      {
        id: 91,
        catalogItemId: 10,
        commercialName: 'Resina X',
        isNewItem: false,
        notes: null,
        proposedName: null,
        marketName: 'RX-100',
        dbcorpCode: null,
        quantity: 5,
        unit: 'KG',
        targetPrice: null,
        targetCurrency: null,
        quoteRequestItemId: 501,
      },
      {
        id: 92,
        catalogItemId: 20,
        commercialName: 'Aditivo Catalogado',
        isNewItem: true,
        notes: 'aplicação em tintas',
        proposedName: 'Aditivo Novo',
        marketName: 'ADT-1',
        dbcorpCode: null,
        quantity: 2,
        unit: 'KG',
        targetPrice: null,
        targetCurrency: null,
        quoteRequestItemId: 502,
      },
    ],
    ...overrides,
  };
}

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SolicitacaoDesenvolvimentoPanel quoteRequestId={50} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe('SolicitacaoDesenvolvimentoPanel', () => {
  it('consulta as solicitacoes ligadas a cotacao e lista itens novos e anexos', async () => {
    vi.mocked(api.get).mockResolvedValue(page([row()]));
    renderPanel();

    expect(await screen.findByText('Solicitação #9')).toBeTruthy();
    // pageSize 100: todas as solicitacoes ligadas (a pagina padrao de 20 truncaria).
    expect(api.get).toHaveBeenCalledWith('/api/v1/commercial-requests', {
      page: 1,
      pageSize: 100,
      status: undefined,
      requestedById: undefined,
      quoteRequestId: 50,
    });
    expect(screen.getByText(/solicitante: Ana Comercial/)).toBeTruthy();
    // Nome digitado -> item do catalogo vinculado + observacao; item de catalogo comum fica de fora.
    expect(
      screen.getByText('Aditivo Novo → Aditivo Catalogado (catálogo) — Observação: aplicação em tintas', {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/Resina X/)).toBeNull();
    expect(screen.getByText('Anexos técnicos')).toBeTruthy();
    expect(screen.getByText('msds.pdf · 1,0 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar msds.pdf' })).toBeTruthy();
    // Somente leitura: o painel da cotacao nao remove anexo.
    expect(screen.queryByRole('button', { name: /Remover/ })).toBeNull();
  });

  it('item novo ainda sem vinculo e solicitacao sem anexo', async () => {
    vi.mocked(api.get).mockResolvedValue(
      page([
        row({
          attachments: [],
          items: [
            {
              id: 92,
              catalogItemId: null,
              commercialName: 'Aditivo Novo',
              isNewItem: true,
              notes: null,
              proposedName: 'Aditivo Novo',
              marketName: null,
              dbcorpCode: null,
              quantity: 2,
              unit: 'KG',
              targetPrice: null,
              targetCurrency: null,
              quoteRequestItemId: null,
            },
          ],
        }),
      ]),
    );
    renderPanel();

    expect(await screen.findByText(/sem vínculo ao catálogo/)).toBeTruthy();
    expect(screen.getByText('Sem anexos técnicos.')).toBeTruthy();
  });

  it('ignora solicitacao comum ligada a mesma cotacao', async () => {
    vi.mocked(api.get).mockResolvedValue(page([row({ isDevelopment: false })]));
    renderPanel();

    expect(await screen.findByText('Nenhuma solicitação de desenvolvimento ligada a esta cotação.')).toBeTruthy();
    expect(screen.queryByText('Solicitação #9')).toBeNull();
  });

  it('erro de carga aparece como alerta', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('falhou'));
    renderPanel();

    expect((await screen.findByRole('alert')).textContent).toContain('falhou');
  });
});
