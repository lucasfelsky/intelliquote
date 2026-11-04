import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ForecastLinha } from '@/services/forecast';
import ForecastDemandaComercialModal from './ForecastDemandaComercialModal';
import ForecastEmbalagensModal from './ForecastEmbalagensModal';
import ForecastMesesAtipicosModal from './ForecastMesesAtipicosModal';

// F13-D: modais de operacao no mock v68 (Embalagens, Meses fora da media, Demanda do comercial). Markup minimo: lupa na busca de produto, aviso de mes atual com icone e
// "mes atual, ate o dia 15" como linha propria sob o mes. A raiz `fc-portal` (modais em portal) segue como a F13-0c deixou.

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

const LINHA = { item: 'PRODUTO 001', historico: [10, 20, 30, 40, 50], O: 60, P: 70, mesesForaDaMedia: [] } as unknown as ForecastLinha;

const comCliente = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('F13-D: Demanda do comercial (busca com lupa)', () => {
  it('a busca de produto fica num envoltorio com a lupa (svg escondido do leitor de tela) e o campo segue acessivel pelo mesmo nome', async () => {
    get.mockResolvedValue({ data: [{ id: 5, name: 'PRODUTO 001', isActive: true, source: { name: 'FONTE 001' }, codes: [{ code: 'C0001' }] }] });
    comCliente(<ForecastDemandaComercialModal hoje="2026-10-20" onFechar={() => undefined} onSalvo={() => undefined} />);
    const campo = (await screen.findByPlaceholderText('Buscar produto por nome ou código')) as HTMLInputElement;
    expect(campo.type).toBe('search');
    const envoltorio = campo.closest('.fcd-busca');
    expect(envoltorio).not.toBeNull();
    const lupa = envoltorio?.querySelector('svg');
    expect(lupa?.getAttribute('aria-hidden')).toBe('true');
    // o rotulo acessivel continua sendo o do label sr-only
    expect(screen.getByLabelText('Buscar produto por nome ou código')).toBe(campo);
    await waitFor(() => expect(screen.getByText('1 produto')).toBeTruthy());
  });

  it('o dialogo carrega a raiz fc-portal (regras do mock para modal em portal) e e o tamanho largo (700 pelo CSS do par D)', () => {
    get.mockResolvedValue({ data: [] });
    comCliente(<ForecastDemandaComercialModal hoje="2026-10-20" onFechar={() => undefined} onSalvo={() => undefined} />);
    const dialogo = document.querySelector('dialog');
    expect(dialogo?.classList.contains('fc-portal')).toBe(true);
    expect(dialogo?.classList.contains('modal-dialog--wide')).toBe(true);
  });
});

describe('F13-D: Embalagens do item', () => {
  it('o dialogo carrega fc-portal e o tamanho largo; o rodape (Cancelar/Salvar) e a ultima coisa do corpo, dentro de .fce-modal (onde o CSS do par D poe a faixa)', async () => {
    get.mockResolvedValue({
      data: {
        produto: { id: 5, nome: 'PRODUTO 001', ativo: true, embalagemPlanilha: null, naoFraciona: false },
        codigos: [{ id: 11, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: 'Saco', principal: true, origem: 'manual', atualizadoEm: '2026-10-22' }],
        usadaCodigoId: 11,
      },
    });
    comCliente(<ForecastEmbalagensModal productId={5} podeEditar onFechar={() => undefined} />);
    expect(await screen.findByRole('button', { name: 'Salvar embalagens' })).toBeTruthy();
    const dialogo = document.querySelector('dialog');
    expect(dialogo?.classList.contains('fc-portal')).toBe(true);
    expect(dialogo?.classList.contains('modal-dialog--wide')).toBe(true);
    const acoes = dialogo?.querySelector('.fce-modal .modal-actions:last-child');
    expect(acoes).not.toBeNull();
    expect(acoes?.querySelectorAll('button')).toHaveLength(2);
    // o codigo da embalagem e o primeiro filho da celula (recebe a fonte mono pelo CSS)
    expect(dialogo?.querySelector('.fce-codigo > span:first-child')?.textContent).toBe('C0001');
  });

  it('cada celula da tabela leva data-rotulo (a 390 px o CSS empilha o codigo em bloco com o rotulo de cada coluna), na edicao e na leitura', async () => {
    const dadosEmb = {
      produto: { id: 5, nome: 'PRODUTO 001', ativo: true, embalagemPlanilha: null, naoFraciona: false },
      codigos: [{ id: 11, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: 'Saco', principal: true, origem: 'manual', atualizadoEm: '2026-10-22' }],
      usadaCodigoId: 11,
    };
    const esperado = ['Código', 'Quantidade (kg)', 'Pallet (kg)', 'Rótulo', 'Principal', 'Origem'];
    for (const podeEditar of [true, false]) {
      get.mockResolvedValue({ data: dadosEmb });
      const { unmount } = comCliente(<ForecastEmbalagensModal productId={5} podeEditar={podeEditar} onFechar={() => undefined} />);
      await screen.findByRole('region', { name: 'Embalagens por código' });
      const celulas = [...document.querySelectorAll('.fce-tabela tbody td')];
      expect(celulas.map((td) => td.getAttribute('data-rotulo')), podeEditar ? 'edicao' : 'leitura').toEqual(esperado);
      unmount();
    }
  });
});

describe('F13-D: Meses fora da media', () => {
  const abrir = () =>
    comCliente(<ForecastMesesAtipicosModal productId={1} baseDate="2026-10-15" linha={LINHA} onFechar={() => undefined} />);

  it('"mes atual, ate o dia 15" fica numa linha propria sob o mes (sem o ponto medio do texto antigo)', () => {
    abrir();
    const atual = document.querySelector('.fca-atual');
    expect(atual).not.toBeNull();
    expect(atual?.textContent?.trim()).toBe('mês atual, até o dia 15');
    expect(atual?.textContent).not.toContain('·');
    expect(atual?.closest('th')?.textContent).toContain('/2026');
  });

  it('marcar o mes atual mostra o aviso com icone (alert-triangle escondido do leitor de tela) e o texto de sempre; a classe fce-dica fica', () => {
    abrir();
    expect(document.querySelector('.fca-aviso')).toBeNull();
    const caixas = screen.getAllByRole('checkbox');
    fireEvent.click(caixas[caixas.length - 1] as HTMLElement);
    const aviso = document.querySelector('.fca-aviso');
    expect(aviso).not.toBeNull();
    expect(aviso?.className).toContain('fce-dica');
    expect(aviso?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText(/Mês atual marcado: o consumo do mês \(AG\) fica igual à média trimestral, sem a venda parcial\./)).toBeTruthy();
  });

  it('o campo de motivo continua desabilitado (o CSS o esconde, como no board) ate o mes ser marcado e habilita ao marcar', () => {
    abrir();
    const motivos = screen.getAllByLabelText(/^Motivo da venda atípica em /) as HTMLInputElement[];
    expect(motivos.length).toBeGreaterThan(0);
    for (const m of motivos) expect(m.disabled).toBe(true);
    const caixas = screen.getAllByRole('checkbox');
    fireEvent.click(caixas[0] as HTMLElement);
    expect((screen.getAllByLabelText(/^Motivo da venda atípica em /) as HTMLInputElement[])[0]?.disabled).toBe(false);
  });
});
