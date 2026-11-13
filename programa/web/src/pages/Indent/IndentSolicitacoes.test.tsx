import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import IndentSolicitacoes from './IndentSolicitacoes';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Souza', email: 'u@b.c', role: mockRole } }),
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

type Linha = Record<string, unknown>;

function linha(id: number, extra: Linha = {}): Linha {
  return {
    id,
    processNumber: `${id}/26`,
    createdAt: '2026-11-12T15:05:00.000Z',
    origin: 'IQ_INDENT',
    pipedriveDealId: null,
    ownerName: 'Ana Souza',
    status: 'NOVA',
    clientPending: false,
    client: { id: 3, name: 'Cliente Alfa Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
    itemsSummary: { firstName: 'Ácido cítrico anidro', count: 1, totalKg: 25000 },
    quotes: { total: 0, answered: 0 },
    queueBusinessDays: 0,
    ...extra,
  };
}

const NOVA = linha(275, {
  client: { id: 3, name: 'Cliente Alfa Ltda', city: 'Itajaí', supplierRuleMode: 'APROVADOS' },
  itemsSummary: { firstName: 'Ácido cítrico anidro', count: 2, totalKg: 40500 },
});
const COTACAO = linha(270, {
  origin: 'PIPEDRIVE',
  pipedriveDealId: 4412,
  status: 'COTACAO',
  ownerName: 'Bruno Lima',
  client: { id: 4, name: 'Beta Química SA', city: 'Paranaguá', supplierRuleMode: 'BLOQUEIO' },
  itemsSummary: { firstName: 'Tripolifosfato de sódio', count: 3, totalKg: 1500.5 },
  quotes: { total: 2, answered: 1 },
  queueBusinessDays: 2,
});
const PENDENTE = linha(277, {
  origin: 'PIPEDRIVE',
  pipedriveDealId: 4500,
  clientPending: true,
  client: null,
  queueBusinessDays: 3,
});
const CONVERTIDA = linha(262, { status: 'CONVERTIDA', queueBusinessDays: null, quotes: { total: 1, answered: 1 } });

const TODAS = [NOVA, COTACAO, PENDENTE, CONVERTIDA];
const COUNTS = { todas: 4, pipedrive: 2, iq: 2, nova: 1, pendente: 1 };
const KPIS = { novas: 1, emCotacao: 1, respondidas: 0, convertidasNoMes: 1 };

function mockApi(overrides: { rows?: Linha[]; totalPages?: number } = {}) {
  vi.mocked(api.get).mockImplementation((async (url: string, query?: { filter?: string; q?: string }) => {
    if (url === '/api/v1/indent/requests') {
      let rows = overrides.rows ?? TODAS;
      if (!overrides.rows) {
        if (query?.filter === 'nova') rows = TODAS.filter((r) => r.status === 'NOVA' && !r.clientPending);
        if (query?.filter === 'pendente') rows = TODAS.filter((r) => r.clientPending);
        if (query?.filter === 'iq') rows = TODAS.filter((r) => r.origin === 'IQ_INDENT');
        if (query?.filter === 'pipedrive') rows = TODAS.filter((r) => r.origin === 'PIPEDRIVE');
        if (query?.q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(query.q!.toLowerCase()));
      }
      return {
        data: rows,
        pagination: { page: 1, pageSize: 20, totalItems: rows.length, totalPages: overrides.totalPages ?? 1 },
        counts: COUNTS,
        kpis: KPIS,
      };
    }
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/indent/solicitacoes']}>
        <Routes>
          <Route path="/indent/solicitacoes" element={<IndentSolicitacoes />} />
          <Route path="/indent/solicitacoes/:id" element={<p data-testid="detalhe">detalhe aberto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IndentSolicitacoes', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    mockRole = 'comprador';
  });

  it('textos do mock: eyebrow, titulo, subtitulo, acao, alerta de pendentes e os 4 KPIs (sem Pipedrive nem fila de vinculo)', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');

    expect(container.querySelector('.page-header .eyebrow')?.textContent).toBe('Indent');
    expect(screen.getByRole('heading', { level: 1, name: 'Solicitações' })).toBeTruthy();
    expect(screen.getByText('Negócios do Funil de Vendas Indent (Pipedrive) e solicitações lançadas aqui, no mesmo lugar.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nova solicitação' })).toBeTruthy();
    expect(screen.getByText('1 solicitação aguarda vínculo de cliente antes de cotar.')).toBeTruthy();
    // Alerta como o do mock: cadeado (svg filho direto) antes do texto, sem o icone por mascara.
    const aviso = screen.getByText('1 solicitação aguarda vínculo de cliente antes de cotar.').closest('.alert');
    expect(aviso?.className).toBe('alert alert--warning indent-alerta');
    expect(aviso?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(aviso?.firstElementChild?.getAttribute('width')).toBe('18');

    expect(screen.queryByText(/Funil de Vendas Indent · há/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Funil de Vendas Indent/ })).toBeNull();
    expect(screen.queryByText('Abrir fila de vínculo')).toBeNull();

    const kpis = Array.from(container.querySelectorAll('.indent-kpis > .indent-kpi')).map((el) => [
      el.querySelector('.eyebrow')?.textContent,
      el.querySelector('.indent-kpi__valor')?.textContent,
      el.querySelector('.indent-kpi__sub')?.textContent,
    ]);
    expect(kpis).toEqual([
      ['Novas', '1', 'Aguardando escolha de fornecedores'],
      ['Em cotação', '1', 'Com cotações abertas'],
      ['Respondidas', '0', 'Aguardando retorno ao cliente'],
      ['Convertidas no mês', '1', 'Viraram processo indent'],
    ]);
  });

  it('o alerta de pendentes concorda no plural', async () => {
    mockApi();
    vi.mocked(api.get).mockImplementation((async () => ({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
      counts: { ...COUNTS, pendente: 2 },
      kpis: KPIS,
    })) as typeof api.get);
    renderPage();
    expect(await screen.findByText('2 solicitações aguardam vínculo de cliente antes de cotar.')).toBeTruthy();
  });

  it('cabecalhos e busca com os textos do mock', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');

    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Solicitação',
      'Cliente',
      'Itens',
      'Origem',
      'Responsável',
      'Na fila há',
      'Respostas',
      'Status',
    ]);
    // Respostas como no mock: th simples e celula com `.indent-ref` alinhados a esquerda (sem `.indent-num`, que alinha a direita).
    expect(container.querySelector('th.indent-num')).toBeNull();
    const busca = screen.getByPlaceholderText('Buscar por cliente, item ou número');
    expect(busca.getAttribute('type')).toBe('search');
    expect(screen.getByText('Buscar solicitação').className).toContain('sr-only');
  });

  it('linhas: referencia + data BRT, cliente com regra ou cidade, itens, origem, responsavel, fila, respostas e status', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');
    const linhas = Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(linhas).toHaveLength(4);
    const [a, b, c, d] = linhas as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    // 275: IQ Indent, APROVADOS, 2 itens, hoje, sem respostas, Nova
    expect(within(a).getByText('275/26').className).toContain('indent-ref');
    expect(within(a).getByText('12/11 12:05')).toBeTruthy();
    expect(within(a).getByText('Cliente Alfa Ltda')).toBeTruthy();
    expect(within(a).getByText('Só aprovados').closest('.indent-tag')?.className).toContain('indent-tag--lock');
    expect(within(a).getByText('Ácido cítrico anidro')).toBeTruthy();
    expect(within(a).getByText('+ 1 item · 40.500 kg no total')).toBeTruthy();
    expect(within(a).getByText('IQ Indent').className).toBe('indent-tag');
    expect(within(a).getByText('Ana Souza')).toBeTruthy();
    expect(within(a).getByText('hoje').className).toBe('badge badge--muted');
    expect(a.querySelectorAll('td')[6]?.textContent).toBe('—');
    expect(within(a).getByText('Nova').className).toBe('badge badge--dot badge--info');

    // 270: Pipedrive #4412, BLOQUEIO, 3 itens, no limite, 1/2, Em cotacao
    expect(within(b).getByText('Pipedrive #4412').className).toContain('indent-tag--pd');
    expect(within(b).getByText('Bloqueios')).toBeTruthy();
    expect(within(b).getByText('+ 2 itens · 1.500,5 kg no total')).toBeTruthy();
    expect(within(b).getByText('2 dias · no limite').className).toBe('badge badge--warning');
    expect(b.querySelectorAll('td')[6]?.textContent).toBe('1/2');
    expect(b.querySelectorAll('td')[6]?.className).toBe('');
    expect(b.querySelector('td:nth-child(7) > span')?.className).toBe('indent-ref');
    expect(within(b).getByText('Em cotação').className).toContain('badge--warning');

    // 277: cliente pendente, 3 dias atrasada
    expect(within(c).getAllByText('Cliente pendente')).toHaveLength(2);
    expect(within(c).getByText('3 dias · atrasada').className).toBe('badge badge--danger');

    // 262: convertida fora da fila ("—"), cidade em vez da regra
    expect(d.querySelectorAll('td')[5]?.textContent).toBe('—');
    expect(within(d).getByText('Convertida').className).toContain('badge--success');
    expect(within(d).getByText('Itajaí')).toBeTruthy();
  });

  it('chips com contagem e filtro: 5 chips, o ativo marca aria-pressed e o filtro vai ao servidor', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');

    const chips = Array.from(container.querySelectorAll('.indent-chips .chip')) as HTMLElement[];
    expect(chips.map((chip) => chip.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Todas 4',
      'Pipedrive 2',
      'IQ Indent 2',
      'Novas 1',
      'Cliente pendente 1',
    ]);
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(chips[0]?.querySelector('.indent-chip-conta')?.textContent).toBe('4');

    fireEvent.click(screen.getByRole('button', { name: /^Novas/ }));
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(1));
    expect(screen.getByRole('button', { name: /^Novas/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Todas/ }).getAttribute('aria-pressed')).toBe('false');
    expect(vi.mocked(api.get).mock.calls.some((c) => (c[1] as { filter?: string } | undefined)?.filter === 'nova')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Cliente pendente/ }));
    await waitFor(() => expect(within(container.querySelector('tbody') as HTMLElement).getByText('277/26')).toBeTruthy());
  });

  it('busca com atraso: manda q ao servidor e filtra a lista', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');

    fireEvent.change(screen.getByPlaceholderText('Buscar por cliente, item ou número'), { target: { value: 'beta' } });
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(1), { timeout: 2000 });
    expect(screen.getByText('270/26')).toBeTruthy();
    expect(vi.mocked(api.get).mock.calls.some((c) => (c[1] as { q?: string } | undefined)?.q === 'beta')).toBe(true);
  });

  it('sem resultado: "Nenhuma solicitação com esse filtro."', async () => {
    mockApi({ rows: [] });
    renderPage();
    expect(await screen.findByText('Nenhuma solicitação com esse filtro.')).toBeTruthy();
  });

  it('linha clicavel (clique, Enter e Espaco) navega para o detalhe', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');
    const primeira = container.querySelector('tbody tr') as HTMLElement;
    expect(primeira.tabIndex).toBe(0);
    expect(primeira.className).toContain('indent-linha-clicavel');

    fireEvent.click(primeira);
    expect(await screen.findByTestId('detalhe')).toBeTruthy();
  });

  it.each(['Enter', ' '])('tecla %j na linha abre o detalhe', async (tecla) => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('275/26');
    fireEvent.keyDown(container.querySelector('tbody tr') as HTMLElement, { key: tecla });
    expect(await screen.findByTestId('detalhe')).toBeTruthy();
  });

  it('paginacao so aparece com mais de uma pagina e usa a classe do Indent', async () => {
    mockApi({ totalPages: 3 });
    const { container } = renderPage();
    await screen.findByText('275/26');
    const nav = container.querySelector('nav.indent-paginacao');
    expect(nav?.getAttribute('aria-label')).toBe('Paginação');
    expect(within(nav as HTMLElement).getByText('Página 1 de 3')).toBeTruthy();
    expect((within(nav as HTMLElement).getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(nav as HTMLElement).getByRole('button', { name: 'Próxima' }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => (c[1] as { page?: number } | undefined)?.page === 2)).toBe(true),
    );
  });

  it('"Nova solicitacao" abre o modal de criacao', async () => {
    mockApi();
    renderPage();
    await screen.findByText('275/26');
    fireEvent.click(screen.getByRole('button', { name: 'Nova solicitação' }));
    expect(await screen.findByRole('dialog', { name: 'Nova solicitação' })).toBeTruthy();
  });

  it('viewer le a lista mas nao ve "Nova solicitacao"', async () => {
    mockRole = 'viewer';
    mockApi();
    renderPage();
    await screen.findByText('275/26');
    expect(screen.queryByRole('button', { name: 'Nova solicitação' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Solicitações' })).toBeTruthy();
  });

  it('erro de carga aparece como alerta', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('falhou'));
    renderPage();
    expect(await screen.findByText(/Não foi possível carregar as solicitações: falhou/)).toBeTruthy();
  });

  it('restoreFocus: fechar por Cancelar devolve o foco ao botao que abriu o modal', async () => {
    mockApi();
    renderPage();
    for (const nome of ["Nova solicitação"]) {
      const botao = await screen.findByRole('button', { name: nome });
      botao.focus();
      fireEvent.click(botao);
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement, nome).toBe(botao);
    }
  });

});
