import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMarkQuoteRequestSeen, markQuoteRequestSeen } from './quoteRequestViews';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { api } from '@/api/client';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
}

describe('quoteRequestViews', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.post).mockResolvedValue({ quoteRequestId: 7, lastSeenAt: '2026-11-18T12:00:00.000Z' });
  });

  it('markQuoteRequestSeen faz POST em /v1/quote-requests/:id/seen', async () => {
    await markQuoteRequestSeen(7);

    expect(api.post).toHaveBeenCalledWith('/v1/quote-requests/7/seen', {});
  });

  it('marca como vista uma vez por id e invalida a lista', async () => {
    const { invalidate, wrapper } = setup();
    const { rerender } = renderHook(({ id, enabled }) => useMarkQuoteRequestSeen(id, enabled), {
      wrapper,
      initialProps: { id: 7, enabled: false },
    });
    expect(api.post).not.toHaveBeenCalled();

    rerender({ id: 7, enabled: true });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['quote-requests'] }));

    rerender({ id: 7, enabled: true });
    rerender({ id: 7, enabled: false });
    rerender({ id: 7, enabled: true });
    expect(api.post).toHaveBeenCalledTimes(1);

    rerender({ id: 8, enabled: true });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenLastCalledWith('/v1/quote-requests/8/seen', {});
  });

  it('id inválido não dispara', () => {
    const { wrapper } = setup();
    renderHook(() => useMarkQuoteRequestSeen(Number.NaN, true), { wrapper });

    expect(api.post).not.toHaveBeenCalled();
  });
});
