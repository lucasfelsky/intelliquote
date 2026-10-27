import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';

let mockRole = 'comprador';
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

// Dados 100% sinteticos.
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    status: 'pending',
    customerName: null,
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    statusChangedAt: null,
    isDevelopment: true,
    attachments: [
      { id: 3, kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf', fileSize: 2048, createdAt: 'x' },
    ],
    requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
    statusChangedBy: null,
    quoteRequest: null,
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
    ...overrides,
  };
}

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi(requestRow: unknown) {
  vi.mocked(api.get).mockImplementation((async (path: string) => {
    if (path === '/api/v1/commercial-requests') return page([requestRow]);
    if (path === '/api/v1/commercial-requests/requesters') return [{ id: 3, name: 'Ana Comercial' }];
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/solicitacoes']}>
        <Routes>
          <Route path="*" element={<Solicitacoes />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRole = 'comprador';
  vi.mocked(api.get).mockReset();
});

describe('ComexView - anexos tecnicos', () => {
  it('linha expandida lista os anexos so com download (sem Remover nem Anexar)', async () => {
    mockApi(row());
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver itens' }));

    expect(screen.getByText('Anexos técnicos')).toBeTruthy();
    expect(screen.getByText('tds.pdf · 2,0 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar tds.pdf' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remover tds/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Anexar/ })).toBeNull();
  });

  it('desenvolvimento sem anexo mostra "Sem anexos técnicos."', async () => {
    mockApi(row({ attachments: [] }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver itens' }));

    expect(screen.getByText('Sem anexos técnicos.')).toBeTruthy();
  });

  it('solicitacao comum nao mostra a secao de anexos', async () => {
    mockApi(row({ isDevelopment: false, attachments: [] }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver itens' }));

    expect(screen.queryByText('Sem anexos técnicos.')).toBeNull();
    expect(screen.queryByText('Anexos técnicos')).toBeNull();
  });

  it('viewer tambem baixa', async () => {
    mockRole = 'viewer';
    mockApi(row());
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver itens' }));

    expect(screen.getByRole('button', { name: 'Baixar tds.pdf' })).toBeTruthy();
  });
});
