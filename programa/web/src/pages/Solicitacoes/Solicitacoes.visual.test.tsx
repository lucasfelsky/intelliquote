import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Solicitacoes from '../Solicitacoes';

// F9 (Suite COMEX): marcacao das duas visoes das Solicitacoes (COMEX e Comercial): raiz, tons dos status, mono, icones, estados e nenhum estilo inline.
// As classes citadas aqui sao as que o CSS da regiao `tela F9` estiliza (telaF9.test.ts); os textos e o textContent seguem os de antes da fase.

let mockRole = 'admin';
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

import { api, ApiError } from '@/api/client';

// Dados 100% sinteticos.
const ATTACHMENTS = [
  { id: 3, kind: 'TDS', fileName: 'tds.pdf', mimeType: 'application/pdf', fileSize: 2048, createdAt: '2026-10-18T12:00:00.000Z' },
];

function comexRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    status: 'pending',
    customerName: 'Beta SA',
    notes: 'Urgente',
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    statusChangedAt: null,
    isDevelopment: false,
    attachments: [],
    requestedBy: { id: 3, name: 'Ana Comercial', email: 'ana@x.com' },
    statusChangedBy: null,
    quoteRequest: null,
    items: [
      {
        id: 1,
        catalogItemId: 10,
        commercialName: 'Resina X',
        isNewItem: false,
        notes: null,
        proposedName: null,
        marketName: 'RX-100',
        dbcorpCode: 'DB-77',
        quantity: 5,
        unit: 'KG',
        targetPrice: '10.50',
        targetCurrency: 'USD',
        quoteRequestItemId: null,
      },
    ],
    ...overrides,
  };
}

function mineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    status: 'pending',
    customerName: 'ACME',
    notes: null,
    rejectionReason: null,
    fulfillmentNote: null,
    createdAt: '2026-10-19T12:00:00.000Z',
    statusChangedAt: null,
    isDevelopment: false,
    attachments: [],
    quote: null,
    items: [
      {
        id: 1,
        catalogItemId: 10,
        commercialName: 'Resina X',
        isNewItem: false,
        notes: null,
        quantity: 5,
        unit: 'KG',
        targetPrice: '1.85',
        targetCurrency: 'USD',
        finalPrice: null,
      },
    ],
    ...overrides,
  };
}

function page<T>(data: T[]) {
  return { data, pagination: { page: 1, pageSize: 20, totalItems: data.length, totalPages: 1 } };
}

function mockApi(comex: unknown[] = [], mine: unknown[] = []) {
  vi.mocked(api.get).mockImplementation((async (path: string) => {
    if (path === '/api/v1/commercial-requests/mine') return page(mine);
    if (path === '/api/v1/commercial-requests') return page(comex);
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
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

const semEstiloInline = (raiz: Element) => expect(Array.from(raiz.querySelectorAll('[style]')).map((el) => el.outerHTML.slice(0, 80))).toEqual([]);

describe('F9: lista do COMEX', () => {
  const LISTA = [
    comexRow({
      id: 11,
      status: 'pending',
      isDevelopment: true,
      attachments: ATTACHMENTS,
      items: [
        { ...comexRow().items[0], id: 8, catalogItemId: null, commercialName: 'Aditivo Novo', isNewItem: true, proposedName: 'Aditivo Novo', marketName: null, dbcorpCode: null },
      ],
    }),
    comexRow({ id: 12, status: 'quoting', quoteRequest: { id: 4, requestCode: 'QR-2026-001', status: 'open' } }),
    comexRow({ id: 13, status: 'fulfilled', fulfillmentNote: 'Fechou por fora', quoteRequest: { id: 5, requestCode: 'QR-2026-002', status: 'closed' } }),
    comexRow({ id: 14, status: 'rejected', rejectionReason: 'Fora do escopo' }),
  ];

  beforeEach(() => {
    mockRole = 'admin';
    mockApi(LISTA);
  });

  it('raiz .solicitacoes-page--comex e cartao da lista com o aria-label de hoje', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    expect(container.querySelector('div.page.solicitacoes-page.solicitacoes-page--comex')).not.toBeNull();
    expect(container.querySelector('.solicitacoes-page--comercial')).toBeNull();
    const cartao = screen.getByLabelText('Lista de solicitações');
    expect(cartao.tagName).toBe('SECTION');
    expect(cartao.classList.contains('card')).toBe(true);
    expect(cartao.classList.contains('solicitacoes-lista')).toBe(true);
    expect(container.querySelector('table.table.table--dense.sol-table.solicitacoes-tabela')).not.toBeNull();
  });

  it('tons dos 4 status (Atendida = badge--success, D-F9-04) e "Desenvolvimento" em badge--info', async () => {
    const { container } = renderPage();
    for (const [texto, tom] of [
      ['Pendente', 'badge--warning'],
      ['Em cotação', 'badge--info'],
      ['Atendida', 'badge--success'],
      ['Recusada', 'badge--danger'],
    ] as const) {
      const selo = (await screen.findAllByText(texto, { selector: 'span.badge' }))[0] as HTMLElement;
      expect(selo.classList.contains(tom), texto).toBe(true);
      expect(selo.classList.contains('badge--dot'), texto).toBe(true);
    }
    const desenvolvimento = container.querySelector('td[data-label="Itens"] .badge') as HTMLElement;
    expect(desenvolvimento.textContent).toBe('Desenvolvimento');
    expect(desenvolvimento.classList.contains('badge--info')).toBe(true);
  });

  it('#id, data e quantidade em mono; a quantidade da contagem de itens tambem', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    const linha = container.querySelector('tbody tr.solicitacoes-linha') as HTMLElement;
    const id = linha.querySelector('td[data-label="Solicitação"] span.solicitacoes-mono') as HTMLElement;
    expect(id.textContent).toBe('#11');
    const data = linha.querySelector('td[data-label="Criada em"] span.solicitacoes-mono') as HTMLElement;
    expect(data.textContent).toBe(new Date('2026-10-18T12:00:00.000Z').toLocaleDateString('pt-BR'));
    expect(linha.querySelector('td[data-label="Itens"] span.solicitacoes-mono')?.textContent).toBe('1');
  });

  it('"Ver itens" tem chevron aria-hidden e aria-expanded; abre a linha de detalhe (aberta + detalhe) e o nome acessivel e o de antes', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    const botao = screen.getAllByRole('button', { name: 'Ver itens' })[0] as HTMLElement;
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(botao.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(botao);
    const aberto = screen.getByRole('button', { name: 'Ocultar itens' });
    expect(aberto.getAttribute('aria-expanded')).toBe('true');
    expect(aberto.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelectorAll('tr.solicitacoes-linha--aberta')).toHaveLength(1);
    const detalhe = container.querySelector('tr.solicitacoes-linha-detalhe td.sol-cell-detail') as HTMLElement;
    expect(detalhe.querySelector('.solicitacoes-detalhe .solicitacoes-nota strong')?.textContent).toBe('Observações:');
    expect(detalhe.querySelector('.solicitacoes-itens-tabela table.table.sol-table.solicitacoes-itens')).not.toBeNull();
    expect(within(detalhe).getByText('Anexos técnicos')).toBeTruthy();
    expect(detalhe.querySelector('ul.anexos-lista')).not.toBeNull();
    expect(detalhe.querySelector('td.solicitacoes-valor')?.textContent).toBe('5 KG');
    expect(within(detalhe).getByRole('button', { name: 'Baixar tds.pdf' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('a nota "Atendida sem preço" e o motivo da recusa entram no detalhe com o strong de antes', async () => {
    renderPage();
    await screen.findAllByText('Atendida', { selector: 'span.badge' });
    const botoes = screen.getAllByRole('button', { name: 'Ver itens' });
    fireEvent.click(botoes[2] as HTMLElement);
    expect(screen.getByText('Atendida sem preço:', { selector: 'strong' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver itens' })[2] as HTMLElement);
    expect(screen.getByText('Motivo da recusa:', { selector: 'strong' })).toBeTruthy();
  });

  it('acoes da linha: ghost-button--sm, Recusar perigo e a dica dos itens novos com a classe da fase', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    const criar = screen.getAllByRole('button', { name: 'Criar cotação' })[0] as HTMLButtonElement;
    expect(criar.classList.contains('ghost-button--sm')).toBe(true);
    expect(criar.disabled).toBe(true); // a 1a linha tem item novo sem catalogo
    expect(screen.getAllByRole('button', { name: 'Recusar' })[0]?.classList.contains('danger-button')).toBe(true);
    const dica = container.querySelector('.solicitacoes-dica') as HTMLElement;
    expect(dica.textContent).toBe('Vincule os itens novos ao catálogo antes de cotar');
    expect(container.querySelector('button.solicitacoes-cotacao')?.textContent).toBe('QR-2026-001');
  });

  it('todas as celulas do corpo tem data-label (menos a do "Ver itens"); cabecalho de status com col-status', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    for (const td of Array.from(container.querySelectorAll('table.solicitacoes-tabela > tbody > tr.solicitacoes-linha > td'))) {
      if (td.classList.contains('solicitacoes-ver')) continue;
      expect(td.getAttribute('data-label'), td.outerHTML.slice(0, 60)).toBeTruthy();
    }
    expect(container.querySelector('th.col-status')?.textContent).toBe('Status');
  });

  it('nenhum [style] na visao do COMEX (nem com a linha expandida e o modal de vinculo aberto)', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    semEstiloInline(container);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver itens' })[0] as HTMLElement);
    semEstiloInline(container);
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular ao catálogo' })[0] as HTMLElement);
    await screen.findByRole('button', { name: 'Selecionar existente' });
    semEstiloInline(container);
  });

  it('carregando, erro e vazio no padrao da F5 (role=status e role=alert)', async () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => undefined)) as typeof api.get);
    const carregando = renderPage();
    const status = carregando.container.querySelector('.solicitacoes-carregando[role="status"]') as HTMLElement;
    expect(status.textContent).toBe('Carregando solicitações…');
    expect(status.querySelector('.btn-spinner[aria-hidden="true"]')).not.toBeNull();
    carregando.unmount();

    vi.mocked(api.get).mockImplementation((async (path: string) => {
      if (path === '/api/v1/commercial-requests') throw new ApiError(500, { message: 'falhou' });
      return [];
    }) as typeof api.get);
    const erro = renderPage();
    const alerta = await waitFor(() => {
      const el = erro.container.querySelector('.solicitacoes-estado .empty-state.empty-state--erro[role="alert"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(alerta.textContent).toBe('Não foi possível carregar as solicitações: falhou');
    expect(alerta.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    erro.unmount();

    mockApi([]);
    const vazio = renderPage();
    const estado = await waitFor(() => {
      const el = vazio.container.querySelector('.solicitacoes-estado .empty-state');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(estado.querySelector('.empty-state__title')?.textContent).toBe('Nenhuma solicitação encontrada');
    expect(estado.querySelector('.empty-state__text')?.textContent).toBe('Ajuste os filtros ou aguarde novos pedidos do comercial.');
    expect(estado.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    semEstiloInline(vazio.container);
  });
});

describe.each(['comprador', 'viewer'])('F9: lista do COMEX (%s)', (role) => {
  it('mesma raiz; so quem age ve a coluna Acoes e os botoes; sem [style]', async () => {
    mockRole = role;
    mockApi([comexRow({ id: 21, status: 'pending' })]);
    const { container } = renderPage();
    await screen.findByText('Pendente', { selector: 'span.badge' });
    expect(container.querySelector('.solicitacoes-page--comex')).not.toBeNull();
    expect(screen.queryByText('Ações', { selector: 'th' }) !== null).toBe(role === 'comprador');
    expect(screen.queryByRole('button', { name: 'Recusar' }) !== null).toBe(role === 'comprador');
    expect(screen.getByRole('button', { name: 'Ver itens' }).querySelector('svg')).not.toBeNull();
    semEstiloInline(container);
  });
});

describe('F9: lista do Comercial', () => {
  const LISTA = [
    mineRow({
      id: 31,
      isDevelopment: true,
      customerName: null,
      attachments: ATTACHMENTS,
      items: [
        { id: 1, catalogItemId: null, commercialName: 'Resina Nova', isNewItem: true, notes: null, quantity: 8000, unit: 'KG', targetPrice: '2.10', targetCurrency: 'USD', finalPrice: null },
      ],
    }),
    mineRow({
      id: 32,
      status: 'fulfilled',
      quote: { requestCode: 'QR-2026-009' },
      items: [
        { id: 2, catalogItemId: 10, commercialName: 'Resina X', isNewItem: false, notes: null, quantity: 5, unit: 'KG', targetPrice: '1.85', targetCurrency: 'USD', finalPrice: { unitPrice: '1.85', currency: 'EUR', incoterm: 'CIF', unit: 'KG' } },
        { id: 3, catalogItemId: 11, commercialName: 'Solvente Y', isNewItem: false, notes: null, quantity: 5, unit: 'KG', targetPrice: null, targetCurrency: null, finalPrice: null },
      ],
    }),
    mineRow({ id: 33, status: 'rejected', rejectionReason: 'Fora do escopo' }),
    mineRow({ id: 34, status: 'quoting', quote: { requestCode: 'QR-2026-010' } }),
  ];

  beforeEach(() => {
    mockRole = 'comercial';
    mockApi([], LISTA);
  });

  it('raiz .solicitacoes-page--comercial; "Solicitar uma cotacao" primario com icone plus; cartao da lista', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    expect(container.querySelector('div.page.solicitacoes-page.solicitacoes-page--comercial')).not.toBeNull();
    const botao = screen.getByRole('button', { name: 'Solicitar uma cotação' });
    expect(botao.classList.contains('primary-button')).toBe(true);
    expect(botao.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByLabelText('Minhas solicitações').classList.contains('solicitacoes-lista')).toBe(true);
  });

  it('tons dos status, "Desenvolvimento" ao lado do status e "Item novo" na linha do item', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    expect(screen.getByText('Atendida', { selector: 'span.badge' }).classList.contains('badge--success')).toBe(true);
    expect(screen.getByText('Recusada', { selector: 'span.badge' }).classList.contains('badge--danger')).toBe(true);
    expect(screen.getByText('Em cotação', { selector: 'span.badge' }).classList.contains('badge--info')).toBe(true);
    const linha = container.querySelector('tbody tr') as HTMLElement;
    expect(linha.querySelector('td[data-label="Status"] .badge--info')?.textContent).toBe('Desenvolvimento');
    expect(linha.querySelector('td[data-label="Itens"] li.sol-item-linha .badge--info')?.textContent).toBe('Item novo');
    expect(linha.querySelector('td[data-label="Cliente"]')?.classList.contains('solicitacoes-cliente--vazio')).toBe(true);
  });

  it('numeros das linhas de item em span mono com o textContent do li de hoje (D-F9-08)', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    const lis = Array.from(container.querySelectorAll('li.sol-item-linha')) as HTMLElement[];
    expect(lis.map((li) => li.textContent)).toEqual([
      'Item novo Resina Nova — 8.000 KG — alvo 2,10 USD',
      'Resina X — 5 KG — alvo 1,85 USD — preço final 1,85 EUR/KG CIF',
      'Solvente Y — 5 KG — sem preço final',
      'Resina X — 5 KG — alvo 1,85 USD',
      'Resina X — 5 KG — alvo 1,85 USD',
    ]);
    expect(Array.from((lis[0] as HTMLElement).querySelectorAll('span.solicitacoes-mono')).map((s) => s.textContent)).toEqual(['8.000', '2,10']);
    expect(Array.from((lis[1] as HTMLElement).querySelectorAll('span.solicitacoes-mono')).map((s) => s.textContent)).toEqual(['5', '1,85', '1,85']);
    expect((lis[1] as HTMLElement).querySelector('strong.sol-item-final')?.textContent).toBe(' — preço final 1,85 EUR/KG CIF');
    expect((container.querySelector('tbody tr td[data-label="Solicitação"] span.solicitacoes-mono') as HTMLElement).textContent).toBe('#31');
  });

  it('Anexos: AnexosLista + "Anexar" com icone plus e o aria-label de hoje; demais celulas com data-label', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    const anexar = screen.getByRole('button', { name: 'Anexar arquivo à solicitação #31' });
    expect(anexar.textContent).toBe('Anexar');
    expect(anexar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('td[data-label="Anexos"] ul.anexos-lista')).not.toBeNull();
    for (const td of Array.from(container.querySelectorAll('table.solicitacoes-tabela > tbody > tr > td'))) {
      expect(td.getAttribute('data-label'), td.outerHTML.slice(0, 60)).toBeTruthy();
    }
    expect(container.querySelector('td.solicitacoes-observacao')?.textContent).toBeTruthy();
  });

  it('nenhum [style] na visao do Comercial (lista e modal "Solicitar uma cotacao" aberto)', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Pendente', { selector: 'span.badge' });
    semEstiloInline(container);
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar uma cotação' }));
    await screen.findByLabelText('Buscar item');
    semEstiloInline(container);
  });

  it('carregando, erro e vazio no padrao da F5 (role=status e role=alert)', async () => {
    vi.mocked(api.get).mockImplementation((() => new Promise(() => undefined)) as typeof api.get);
    const carregando = renderPage();
    expect(carregando.container.querySelector('.solicitacoes-carregando[role="status"]')?.textContent).toBe('Carregando solicitações…');
    carregando.unmount();

    vi.mocked(api.get).mockImplementation((async () => {
      throw new ApiError(500, { message: 'falhou' });
    }) as typeof api.get);
    const erro = renderPage();
    const alerta = await waitFor(() => {
      const el = erro.container.querySelector('.empty-state--erro[role="alert"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(alerta.textContent).toBe('Não foi possível carregar as solicitações: falhou');
    erro.unmount();

    mockApi([], []);
    const vazio = renderPage();
    const estado = await waitFor(() => {
      const el = vazio.container.querySelector('.solicitacoes-estado .empty-state');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(estado.querySelector('.empty-state__title')?.textContent).toBe('Nenhuma solicitação ainda');
    semEstiloInline(vazio.container);
  });
});
