import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/components/useConfirm';
import Cotacoes from './Cotacoes';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comprador' } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function quote(id: number, requestCode: string, hasNewResponse?: boolean) {
  return {
    id,
    requestCode,
    productName: `Produto ${requestCode}`,
    quantity: 10,
    description: null,
    desiredIncoterm: ['FOB'],
    currency: 'USD',
    deadlineAt: null,
    status: 'open',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    closedAt: null,
    purchaseOrderSentAt: null,
    createdById: 1,
    _count: { items: 2, quoteResponses: 3 },
    ...(hasNewResponse === undefined ? {} : { hasNewResponse }),
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConfirmProvider>
          <Cotacoes />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Cotacoes - Nova resposta (por usuário)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((async () => ({
      data: [quote(1, 'QR-001', true), quote(2, 'QR-002', false), quote(3, 'QR-003')],
      pagination: { page: 1, pageSize: 50, totalItems: 3, totalPages: 1 },
    })) as unknown as typeof api.get);
  });

  it('linha com hasNewResponse ganha cotacoes-linha--nova e o selo de texto "Nova resposta"', async () => {
    renderPage();
    const row = (await screen.findByText('QR-001')).closest('tr') as HTMLElement;

    expect(row.className).toContain('cotacoes-linha--nova');
    const selo = within(row).getByText('Nova resposta');
    expect(selo.className).toContain('cotacoes-selo-nova');
    expect(selo.className).toContain('badge--success');
    // o numero de respostas continua ao lado do selo
    expect(selo.closest('td')?.textContent).toContain('3');
  });

  it('sem hasNewResponse (false ou ausente) nao ha selo nem classe', async () => {
    renderPage();
    for (const code of ['QR-002', 'QR-003']) {
      const row = (await screen.findByText(code)).closest('tr') as HTMLElement;
      expect(row.className).not.toContain('cotacoes-linha--nova');
      expect(within(row).queryByText('Nova resposta')).toBeNull();
    }
    expect(screen.getAllByText('Nova resposta')).toHaveLength(1);
  });

  it('a lista envia withNewResponses=true', async () => {
    renderPage();
    await screen.findByText('QR-001');

    expect(api.get).toHaveBeenCalledWith(
      '/v1/quote-requests',
      expect.objectContaining({ withNewResponses: 'true' }),
    );
  });
});
