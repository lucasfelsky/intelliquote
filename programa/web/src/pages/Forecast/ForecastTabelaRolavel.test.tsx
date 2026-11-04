import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastFontesModal from './ForecastFontesModal';
import TabelaRolavel from './ForecastTabelaRolavel';

// FZ2: regioes que rolam precisam ser focaveis por teclado (o viewer a 390 nao tem campo nem botao para parar o Tab), mas so quando de fato rolam.

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

import { api } from '@/api/client';

const get = vi.mocked(api.get);

let largura = { scroll: 300, client: 300 };

function medidas(scroll: number, client: number) {
  largura = { scroll, client };
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(() => largura.scroll);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => largura.client);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Guarda estrutural: todo .table-wrapper de componente do Forecast passa por TabelaRolavel (um <div className="table-wrapper"> solto voltaria a ser
// uma regiao que rola sem foco por teclado). Fontes de producao lidas em texto, como as guardas telaF13.
const fontes = import.meta.glob(['./*.tsx', '../Forecast.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('FZ2: nenhum .table-wrapper solto nos componentes do Forecast', () => {
  it('so ForecastTabelaRolavel.tsx escreve className="table-wrapper"; os 11 sitios usam <TabelaRolavel>', () => {
    const soltos = Object.entries(fontes)
      .filter(([arquivo, texto]) => !arquivo.endsWith('/ForecastTabelaRolavel.tsx') && /table-wrapper/.test(texto))
      .map(([arquivo]) => arquivo);
    expect(soltos).toEqual([]);
    const usos = Object.values(fontes).reduce((n, texto) => n + (texto.match(/<TabelaRolavel /g) ?? []).length, 0);
    expect(usos).toBe(11);
    expect(Object.keys(fontes).length).toBeGreaterThan(30);
  });
});

describe('TabelaRolavel (FZ2)', () => {
  it('tabela mais larga que a caixa: regiao focavel (tabIndex 0, role region) com nome da tabela e a classe .table-wrapper', () => {
    medidas(900, 300);
    render(
      <TabelaRolavel rotulo="Lead time por fonte">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </TabelaRolavel>,
    );
    const regiao = screen.getByRole('region', { name: 'Tabela: Lead time por fonte, role na horizontal' });
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(regiao.className).toBe('table-wrapper');
  });

  it('tabela que cabe: sem tabIndex, sem role e sem nome (nenhuma parada de Tab a toa)', () => {
    medidas(300, 300);
    const { container } = render(
      <TabelaRolavel rotulo="Lead time por fonte">
        <table />
      </TabelaRolavel>,
    );
    const caixa = container.querySelector('.table-wrapper') as HTMLElement;
    expect(caixa.hasAttribute('tabindex')).toBe(false);
    expect(caixa.hasAttribute('role')).toBe(false);
    expect(caixa.hasAttribute('aria-label')).toBe(false);
  });
});

describe('Fontes e lead time: painel de aba focavel (FZ2)', () => {
  function renderFontes(abaInicial: 'fontes' | 'ocasioes' = 'fontes') {
    get.mockImplementation(async (path: string) => {
      if (path.includes('prazo-real')) {
        return {
          data: {
            fontes: [{ fonte: 'FONTE 1', pais: 'CHINA', leadTime: 40, desembaraco: 5, prazoReal: 45, amostra: 6, etdEta: 30, etdMais: 35 }],
            semFonte: { chegadas: 0 },
          },
        };
      }
      return { data: [] };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <ForecastFontesModal podeEditar={false} abaInicial={abaInicial} onFechar={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('o painel ativo tem tabIndex 0 e SEM outline:none inline (o anel de foco vem do CSS); o oculto nao entra na ordem de Tab', () => {
    renderFontes();
    const ativo = screen.getByRole('tabpanel', { name: 'Lead time por fonte' });
    expect(ativo.getAttribute('tabindex')).toBe('0');
    expect(ativo.getAttribute('style') ?? '').not.toMatch(/outline/);
    const oculto = document.querySelector('[role="tabpanel"][hidden]') as HTMLElement;
    expect(oculto.hasAttribute('tabindex')).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Eventos estrangeiros' }));
    expect(screen.getByRole('tabpanel', { name: 'Eventos estrangeiros' }).getAttribute('tabindex')).toBe('0');
    expect(document.querySelector('[role="tabpanel"][hidden]')?.hasAttribute('tabindex')).toBe(false);
  });

  it('a tabela de lead time e uma regiao que rola (focavel) quando excede a caixa', async () => {
    medidas(900, 300);
    renderFontes();
    const regiao = await screen.findByRole('region', { name: 'Tabela: Lead time cadastrado e prazo real por fonte, role na horizontal' });
    expect(regiao.getAttribute('tabindex')).toBe('0');
    expect(regiao.classList.contains('table-wrapper')).toBe(true);
  });
});
