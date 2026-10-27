import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastLinha } from '@/services/forecast';
import ForecastMemoria from './ForecastMemoria';

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

// Dados 100% sinteticos.
function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
  return {
    linha: 3,
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
    AP: '2026-11-19',
    AR: 0,
    AS: 0,
    item: 'PRODUTO SINTETICO A',
    codigos: ['TST0001', 'TST0002'],
    fonte: 'FONTE 001',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    ...over,
  } as ForecastLinha;
}

const OCASIOES_HOJE = {
  extraDias: 5,
  leadTimeAjustado: 35,
  chegadaEstimada: '2026-11-24',
  ocasioes: [
    { id: 1, nome: 'OCASIAO 001', etapa: 'total' as const, dias: 3 },
    { id: 2, nome: 'OCASIAO 002', etapa: 'prontidao' as const, dias: 2 },
  ],
};

function montar(l: ForecastLinha) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ForecastMemoria linha={l} half={2} baseDate="2026-10-15" hoje="2026-10-20" podeEditar={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastMemoria com ocasioes (PR 3)', () => {
  it('com ocasioesHoje: a frase "Com ocasiões: chega em ..." e a etiqueta "estimativa" abaixo da chegada normal', () => {
    const { container } = montar(linha({ ocasioesHoje: OCASIOES_HOJE }));
    expect(screen.getByText('Se a PO sair hoje, chega em')).toBeTruthy();
    expect(screen.getByText('19/11/2026')).toBeTruthy();
    const frase = container.querySelector('.fcoc-memoria') as HTMLElement;
    expect(frase.textContent).toBe('Com ocasiões: chega em 24/11/2026 (+5 dias: OCASIAO 001, OCASIAO 002) estimativa');
    expect(frase.querySelector('.fcoc-estimativa')?.textContent).toBe('estimativa');
    // Entre a data normal e o texto de risco.
    const medio = container.querySelector('.fc-lado__medio') as HTMLElement;
    expect(medio.nextElementSibling).toBe(frase);
    expect(frase.nextElementSibling?.className).toContain('fc-risco');
  });

  it('sem ocasioesHoje: nada de ocasiao na memoria', () => {
    const { container } = montar(linha());
    expect(container.querySelector('[class*="fcoc-"]')).toBeNull();
    expect(screen.queryByText(/Com ocasiões/)).toBeNull();
  });

  it('o texto de risco e o mesmo com e sem as ocasioes (a frase e so apoio)', () => {
    const sem = montar(linha());
    const riscoSem = sem.container.querySelector('.fc-risco')?.textContent;
    sem.unmount();
    const com = montar(linha({ ocasioesHoje: OCASIOES_HOJE }));
    const riscoCom = com.container.querySelector('.fc-risco')?.textContent;
    expect(riscoSem).toBeTruthy();
    expect(riscoCom).toBe(riscoSem);
  });

  it('componentes ausentes: mostra o aviso junto da frase', () => {
    montar(linha({ ocasioesHoje: { ...OCASIOES_HOJE, componentesAusentes: true } }));
    expect(
      screen.getByText(
        'Etapas da fonte não cadastradas (ou somam mais que o lead time): cada ocasião foi comparada com o lead time inteiro.',
      ),
    ).toBeTruthy();
  });
});
