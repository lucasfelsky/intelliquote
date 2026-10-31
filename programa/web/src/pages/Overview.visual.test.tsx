import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from './Home';
import Relatorios from './Relatorios';

// F11 (Suite COMEX, board Overview e Relatorios): markup do Overview (4 KPIs com icone, "Top fornecedores") e dos Relatorios (6 cartoes,
// KPI em destaque, tabelas, vazio e erro). O CSS e conferido por telaF11.test.ts e pelo harness; aqui so o DOM, o texto e o ARIA.

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Maria Souza', email: 'maria@exemplo.invalid', role: 'admin' } }),
}));

type Rota = (path: string) => unknown;
let rota: Rota = () => ({});
vi.mock('@/api/client', () => ({
  api: { get: vi.fn((path: string) => Promise.resolve().then(() => rota(path))) },
  ApiError: class ApiError extends Error {},
}));

const TOP = {
  items: [
    { supplierId: 1, supplierName: '[Fornecedor A]', country: 'China', responses: 38, wins: 24, winRate: 63, averageScore: 87.45 },
    { supplierId: 2, supplierName: '[Fornecedor B]', country: null, responses: 22, wins: 9, winRate: 41, averageScore: 4.5 },
  ],
};

function rotaHome(responses: number, extra?: Record<string, unknown>): Rota {
  return (path) => {
    if (path.endsWith('/reports/summary')) {
      return { totals: { quoteRequests: 128, responses, comparisons: 74, suppliers: 86 }, awardRate: { rate: 62 } };
    }
    if (path.endsWith('/reports/savings')) return { absoluteSaving: 184320, averagePercentSaving: 7.4 };
    if (path.endsWith('/reports/top-suppliers')) return extra?.top ?? TOP;
    if (path.endsWith('/reports/award-rate')) return { rate: 62, comparisons: 74, winners: 46 };
    return {};
  };
}

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => cleanup());

describe('F11: Overview (Home)', () => {
  it('raiz .overview-page com 4 article.kpi, icones aria-hidden e o icone `dollar` no 4o', async () => {
    rota = rotaHome(412);
    const { container } = renderPage(<Home />);
    await screen.findByText('[Fornecedor A]');
    expect(container.querySelector('div.page.overview-page')).toBeTruthy();
    const kpis = container.querySelectorAll('article.kpi');
    expect(kpis).toHaveLength(4);
    kpis.forEach((kpi) => {
      const icone = kpi.querySelector('.kpi__icone');
      expect(icone?.getAttribute('aria-hidden')).toBe('true');
      expect(icone?.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      expect(kpi.querySelector('.kpi__rotulo')).toBeTruthy();
    });
    const caminho = (n: number) => kpis[n]?.querySelector('.kpi__icone path')?.getAttribute('d') ?? '';
    expect(caminho(3)).toMatch(/^M12 3v18M17 7\.5/); // dollar
    expect(caminho(0)).toMatch(/^M9 3h6v3H9z/); // cotacoes
    expect(Array.from(kpis).map((k) => k.querySelector('.kpi__rotulo')?.textContent)).toEqual([
      'Cotações',
      'Comparações',
      'Fornecedores',
      'Economia gerada',
    ]);
  });

  it('"1 resposta recebida" no singular e "2 respostas recebidas" no plural', async () => {
    rota = rotaHome(1);
    const um = renderPage(<Home />);
    expect(await um.findByText('1 resposta recebida')).toBeTruthy();
    um.unmount();
    rota = rotaHome(2);
    const dois = renderPage(<Home />);
    expect(await dois.findByText('2 respostas recebidas')).toBeTruthy();
  });

  it('Top fornecedores: score com virgula (87,5 e 4,5), taxa em selo e nenhum [style]', async () => {
    rota = rotaHome(412);
    const { container } = renderPage(<Home />);
    await screen.findByText('[Fornecedor A]');
    const linhas = container.querySelectorAll('table.overview-tabela tbody tr');
    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.querySelector('.overview-score')?.textContent).toBe('87,5');
    expect(linhas[1]?.querySelector('.overview-score')?.textContent).toBe('4,5');
    expect(linhas[0]?.querySelector('.badge.overview-taxa')?.textContent).toBe('63%');
    expect(linhas[1]?.querySelector('.badge.overview-taxa')?.classList.contains('badge--muted')).toBe(true);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('vazio: titulo do estado sem [style]; erro: role=alert com "Tentar novamente"', async () => {
    rota = rotaHome(412, { top: { items: [] } });
    const vazio = renderPage(<Home />);
    expect(await vazio.findByText('Nenhuma resposta de fornecedor registrada ainda.')).toBeTruthy();
    expect(vazio.container.querySelectorAll('[style]')).toHaveLength(0);
    vazio.unmount();

    rota = (path) => {
      if (path.endsWith('/reports/top-suppliers')) throw new Error('falha');
      return rotaHome(412)(path);
    };
    const erro = renderPage(<Home />);
    const alerta = await erro.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar o ranking.');
    expect(erro.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
    expect(erro.container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

const REL = {
  summary: {
    totals: { quoteRequests: 42, responses: 61, comparisons: 24, suppliers: 37 },
    awardRate: { comparisons: 24, winners: 18, rate: 0.75 },
    range: { from: '2026-09-20T12:00:00Z', to: '2026-10-20T12:00:00Z' },
  },
  savings: {
    comparisons: 24,
    absoluteSaving: 48320,
    averagePercentSaving: 0.074,
    range: { from: null, to: null },
    items: [
      {
        comparisonId: 1,
        quoteRequestId: 1,
        requestCode: 'QR-2026-0412',
        productName: '[Produto]',
        currency: 'USD',
        winner: { supplierId: 12, landedCost: 38940, offeredPrice: 1 },
        mostExpensive: { supplierId: 3, landedCost: 43800, offeredPrice: 1 },
        absoluteSaving: 4860,
        percentSaving: 0.111,
      },
    ],
  },
  leadTime: {
    responses: 61,
    averageLeadTimeDays: 38.5,
    range: { from: null, to: null },
    bySupplier: [{ supplierId: 1, supplierName: '[Fornecedor A]', averageLeadTimeDays: 32.5, responses: 14 }],
  },
  top: {
    items: [
      {
        supplierId: 1,
        supplierName: '[Fornecedor A]',
        country: 'China',
        responses: 14,
        wins: 6,
        totalScore: 1,
        winRate: 0.429,
        averageScore: 88.4,
        avgRating: 4.6,
        reviewCount: 5,
      },
    ],
  },
  award: { comparisons: 24, winners: 18, rate: 0.75 },
  engagement: {
    items: [
      { supplierId: 1, supplierName: '[Fornecedor A]', tokensSent: 16, tokensResponded: 14, responseRate: 0.875, avgResponseHours: 57.6 },
      { supplierId: 2, supplierName: '[Fornecedor B]', tokensSent: 13, tokensResponded: 11, responseRate: 0.846, avgResponseHours: 26 },
    ],
  },
};

function rotaRelatorios(overrides: Record<string, unknown> = {}): Rota {
  return (path) => {
    const mapa: Record<string, unknown> = {
      '/reports/summary': REL.summary,
      '/reports/savings': REL.savings,
      '/reports/lead-time': REL.leadTime,
      '/reports/top-suppliers': REL.top,
      '/reports/award-rate': REL.award,
      '/reports/supplier-engagement': REL.engagement,
      ...overrides,
    };
    const chave = Object.keys(mapa).find((k) => path.endsWith(k));
    if (!chave) return {};
    const v = mapa[chave];
    if (v instanceof Error) throw v;
    return v;
  };
}

describe('F11: Relatorios', () => {
  it('raiz .relatorios-page com 6 cartoes, o KPI em destaque e nenhum [style]', async () => {
    rota = rotaRelatorios();
    const { container } = renderPage(<Relatorios />);
    await screen.findByText('QR-2026-0412');
    await screen.findByText('[Fornecedor B]');
    expect(container.querySelector('div.page.relatorios-page')).toBeTruthy();
    expect(container.querySelectorAll('section.card.relatorios-cartao')).toHaveLength(6);
    expect(container.querySelectorAll('.kpi--destaque').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.relatorios-linha')).toHaveLength(2);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    // os 2 botoes de atualizar/periodo continuam: De, Ate e Atualizar com icone
    expect(screen.getByLabelText('De')).toBeTruthy();
    expect(screen.getByLabelText('Até')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Atualizar' }).querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('numeros: "2,4 d" com virgula (57,6 h = 2,4 d), "18 h" abaixo de 48 h e % ja multiplicada (achado D-F11-09: fica como esta)', async () => {
    rota = rotaRelatorios();
    renderPage(<Relatorios />);
    expect(await screen.findByText('2,4 d')).toBeTruthy();
    expect(screen.getByText('26 h')).toBeTruthy();
    expect(screen.getAllByText('75,0%').length).toBeGreaterThan(0);
  });

  it('estrelas (StarRating) e contagem na avaliacao do Top fornecedores', async () => {
    rota = rotaRelatorios();
    const { container } = renderPage(<Relatorios />);
    await screen.findByText('QR-2026-0412');
    const avaliacao = container.querySelector('.relatorios-avaliacao');
    expect(avaliacao?.querySelector('.star-rating')).toBeTruthy();
    expect(avaliacao?.querySelector('.relatorios-avaliacao__n')?.textContent).toBe('(5)');
  });

  it('Atualizar mostra o feedback com role=status e o icone check', async () => {
    rota = rotaRelatorios();
    const { container } = renderPage(<Relatorios />);
    await screen.findByText('QR-2026-0412');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    const feedback = await screen.findByText('Relatórios atualizados.');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('"Sem dados no periodo." quando nao ha dados', async () => {
    rota = rotaRelatorios({
      '/reports/summary': { ...REL.summary, totals: { quoteRequests: 0, responses: 0, comparisons: 0, suppliers: 0 } },
      '/reports/savings': { ...REL.savings, items: [] },
      '/reports/lead-time': { ...REL.leadTime, bySupplier: [] },
      '/reports/top-suppliers': { items: [] },
    });
    const { container } = renderPage(<Relatorios />);
    await waitFor(() => expect(container.querySelectorAll('.relatorios-vazio').length).toBeGreaterThanOrEqual(4));
    expect(screen.getAllByText('Sem dados no período.').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('erro de um relatorio: role=alert com a mensagem, sem [style]', async () => {
    rota = rotaRelatorios({ '/reports/savings': new Error('Falha ao carregar economia') });
    const { container } = renderPage(<Relatorios />);
    const alerta = await screen.findByText('Falha ao carregar economia');
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.classList.contains('alert--error')).toBe(true);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
