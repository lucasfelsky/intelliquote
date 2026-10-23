import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastLinha } from '@/services/forecast';
import ForecastMesesAtipicosModal from './ForecastMesesAtipicosModal';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

// Dados 100% sinteticos; so os campos que o modal le (historico J..N, O, P e as marcas).
const LINHA = { item: 'PRODUTO 001', historico: [10, 20, 30, 40, 50], O: 60, P: 70, mesesForaDaMedia: [] } as unknown as ForecastLinha;

function abrir() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastMesesAtipicosModal productId={1} baseDate="2026-10-15" linha={LINHA} onFechar={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('ForecastMesesAtipicosModal - criterio do Comex (rodada 5)', () => {
  it('mostra o texto de ajuda fixo com o criterio de venda atipica, sem mudar a regra', () => {
    abrir();
    const dica = screen.getByText(
      'Critério usado pelo Comex: considere atípica a venda que não se repete nos próximos 15 dias ou cujo volume entrou na programação.',
    );
    expect(dica.className).toContain('fce-dica');
    // A regra de calculo segue explicada e o Salvar continua desabilitado sem alteracao.
    expect(screen.getByText(/O mês marcado sai das médias trimestral e semestral/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar meses atípicos' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
