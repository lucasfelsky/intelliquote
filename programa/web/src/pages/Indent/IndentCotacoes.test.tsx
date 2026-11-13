import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IndentCotacoes from './IndentCotacoes';

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

// Tela Cotacoes (PR 3): agrupar por fornecedor/cliente/status, selos, linha vermelha de excecao, gaveta pela URL (?cotacao=) e estados vazios.

type Obj = Record<string, unknown>;

function linha(id: number, extra: Obj = {}) {
  return {
    id,
    ref: '268/26',
    revision: 1,
    status: 'RESPONDIDA',
    requestId: 11,
    processNumber: '268/26',
    requestStatus: 'COTACAO',
    client: { id: 3, name: 'Cliente Alfa Indústria Ltda', city: 'Itajaí' },
    supplier: { id: 5, name: 'Shandong Haohua Chemical Co.', country: 'China', contactName: 'Li Wei', hasPartnership: true },
    itemsSummary: { firstName: 'Ureia técnica', count: 1 },
    currency: 'USD',
    total: '206000.00',
    validUntil: '2026-11-18',
    exception: null,
    createdAt: `2026-11-${String(10 + id).padStart(2, '0')}T12:00:00.000Z`,
    ...extra,
  };
}

const LINHAS = [
  linha(1),
  linha(2, {
    ref: '270/26',
    processNumber: '270/26',
    status: 'ENVIADA',
    client: { id: 4, name: 'Beta Tintas S.A.', city: null },
    supplier: { id: 6, name: 'Nordic Solvents AB', country: 'Suécia', contactName: null, hasPartnership: false },
    itemsSummary: { firstName: 'Dióxido de titânio rutilo', count: 2 },
    currency: 'EUR',
    total: null,
    validUntil: null,
    exception: { reason: 'Cliente autorizou' },
  }),
  linha(3, { ref: '270/26', processNumber: '270/26', status: 'RASCUNHO', total: '1100.00', validUntil: '2026-11-26' }),
  linha(4, { ref: '262/26', processNumber: '262/26', status: 'ACEITA', currency: 'EUR', total: '1100.00', validUntil: null }),
];

function detalhe() {
  return {
    ...linha(1),
    destination: 'Santos',
    incoterm: 'CFR',
    sentAt: null,
    respondedAt: null,
    decidedAt: null,
    productionLeadTimeDays: null,
    paymentTerms: null,
    manufacturer: null,
    notes: null,
    base: null,
    acceptedQuote: null,
    client: { id: 3, name: 'Cliente Alfa Indústria Ltda', city: 'Itajaí', supplierRuleMode: 'LIVRE' },
    supplier: { id: 5, name: 'Shandong Haohua Chemical Co.', country: 'China', contactName: 'Li Wei', hasPartnership: true, type: 'FABRICANTE' },
    exception: null,
    items: [],
    allowedActions: [],
  };
}

function mockApi(lista: unknown = { data: LINHAS, truncated: false }) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/quotes') {
      if (lista instanceof Error) throw lista;
      return lista;
    }
    if (url === '/api/v1/indent/quotes/1') return detalhe();
    if (/\/api\/v1\/indent\/quotes\/\d+$/.test(url)) throw new ApiError(404, { message: 'Cotação não encontrada.' });
    return {};
  }) as typeof api.get);
}

function Sonda() {
  const location = useLocation();
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(caminho = '/indent/cotacoes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route
            path="/indent/cotacoes"
            element={
              <>
                <IndentCotacoes />
                <Sonda />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const grupos = (container: HTMLElement) => Array.from(container.querySelectorAll('details.indent-grupo')) as HTMLDetailsElement[];
const tituloDe = (grupo: HTMLElement) => grupo.querySelector('.indent-grupo__titulo strong')?.textContent;
const colunas = (grupo: HTMLElement) => Array.from(grupo.querySelectorAll('thead th')).map((th) => th.textContent);

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  mockApi();
});

describe('IndentCotacoes - cabecalho e agrupamento', () => {
  it('raiz, eyebrow, h1, subtitulo e o seletor "Agrupar por" (Fornecedor ativo por padrao)', async () => {
    const { container } = renderPage();
    await screen.findByText('Nordic Solvents AB', { selector: 'strong' });

    expect(container.querySelector('.page.indent-page.indent-cotacoes-page')).not.toBeNull();
    expect(container.querySelector('.page-header .eyebrow')?.textContent).toBe('Indent');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cotações');
    expect(screen.getByText('Cada fornecedor tem a sua cotação e cada cotação tem a sua referência de processo indent.')).toBeTruthy();
    expect(container.querySelector('.page-header__actions .indent-seg-rotulo')?.textContent).toBe('Agrupar por');
    const seletor = screen.getByRole('group', { name: 'Agrupar por' });
    expect(seletor.className).toBe('indent-seg');
    expect(within(seletor).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Fornecedor', 'true'],
      ['Cliente', 'false'],
      ['Status', 'false'],
    ]);
  });

  it('por fornecedor: grupos por nome, avatar, "Pais · Contato", contagem, selos e colunas (sem a de fornecedor)', async () => {
    const { container } = renderPage();
    await screen.findByText('Nordic Solvents AB', { selector: 'strong' });

    const todos = grupos(container);
    expect(todos.map(tituloDe)).toEqual(['Nordic Solvents AB', 'Shandong Haohua Chemical Co.']);
    expect(todos.every((g) => g.open)).toBe(true);

    const [nordic, shandong] = todos as unknown as [HTMLElement, HTMLElement];
    expect(nordic.querySelector('.indent-grupo__avatar')?.textContent).toBe('NS');
    expect(nordic.querySelector('.indent-grupo__avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(nordic.querySelector('.indent-grupo__titulo .indent-cell-sub')?.textContent).toBe('Suécia');
    expect(shandong.querySelector('.indent-grupo__titulo .indent-cell-sub')?.textContent).toBe('China · Li Wei');

    const meta = (g: HTMLElement) => Array.from(g.querySelectorAll('.indent-grupo__meta > *')).map((el) => el.textContent);
    expect(meta(nordic)).toEqual(['1 cotação', 'Sem parceria', '1 com exceção', '1 em aberto']);
    expect(meta(shandong)).toEqual(['3 cotações', '1 em aberto']);
    expect(nordic.querySelector('.indent-grupo__meta .indent-tag--exc')).not.toBeNull();
    expect(nordic.querySelector('.indent-grupo__meta .indent-tag--manual')?.textContent).toBe('1 em aberto');
    expect(shandong.querySelector('.indent-tag--exc')).toBeNull();
    expect(shandong.querySelector('.indent-grupo__seta svg')).not.toBeNull();
    expect(colunas(nordic)).toEqual(['Referência', 'Cliente', 'Itens', 'Status', 'Total', 'Validade']);
  });

  it('linhas: referencia, tag e linha de excecao, itens com "+ N · NNN/AA", status, total na moeda, validade dd/mm ou "—"', async () => {
    const { container } = renderPage();
    await screen.findByText('Nordic Solvents AB', { selector: 'strong' });

    const nordic = grupos(container)[0] as HTMLElement;
    const exc = nordic.querySelector('tbody tr') as HTMLElement;
    expect(exc.className).toBe('indent-linha-clicavel indent-linha-exc');
    expect(exc.tabIndex).toBe(0);
    const celulas = Array.from(exc.querySelectorAll('td'));
    expect(celulas[0]?.querySelector('.indent-ref.indent-ref--indent')?.textContent).toBe('270/26');
    expect(celulas[0]?.querySelector('.indent-tag.indent-tag--exc')?.textContent).toBe('Exceção');
    expect(celulas[1]?.textContent).toBe('Beta Tintas S.A.');
    expect(celulas[2]?.textContent).toBe('Dióxido de titânio rutilo+ 1 · 270/26');
    expect(celulas[3]?.querySelector('.badge')?.className).toContain('badge--info');
    expect(celulas[3]?.textContent).toBe('Enviada');
    expect(celulas[4]?.textContent).toBe('—');
    expect(celulas[5]?.textContent).toBe('—');

    const shandong = grupos(container)[1] as HTMLElement;
    const linhasShandong = Array.from(shandong.querySelectorAll('tbody tr')) as HTMLElement[];
    // da mais recente para a mais antiga (ids 4, 3, 1)
    expect(linhasShandong.map((tr) => tr.querySelector('.indent-ref')?.textContent)).toEqual(['262/26', '270/26', '268/26']);
    expect(linhasShandong[0]?.className).toBe('indent-linha-clicavel');
    expect(Array.from(linhasShandong[0]!.querySelectorAll('td')).slice(3).map((td) => td.textContent)).toEqual(['Aceita', '€ 1.100,00', '—']);
    expect(Array.from(linhasShandong[1]!.querySelectorAll('td')).slice(3).map((td) => td.textContent)).toEqual(['Rascunho', 'US$ 1.100,00', '26/11']);
    expect(Array.from(linhasShandong[2]!.querySelectorAll('td')).slice(3).map((td) => td.textContent)).toEqual(['Respondida', 'US$ 206.000,00', '18/11']);
    expect(within(linhasShandong[0] as HTMLElement).getByText('Aceita').className).toContain('badge--success');
  });

  it('por cliente: cidade como apoio, sem selo de parceria e colunas com Fornecedor no lugar de Cliente', async () => {
    const { container } = renderPage();
    await screen.findByText('Nordic Solvents AB', { selector: 'strong' });

    fireEvent.click(screen.getByRole('button', { name: 'Cliente' }));

    await waitFor(() => expect(grupos(container).map(tituloDe)).toEqual(['Beta Tintas S.A.', 'Cliente Alfa Indústria Ltda']));
    const [beta, alfa] = grupos(container) as unknown as [HTMLElement, HTMLElement];
    expect(beta.querySelector('.indent-grupo__titulo .indent-cell-sub')).toBeNull();
    expect(alfa.querySelector('.indent-grupo__titulo .indent-cell-sub')?.textContent).toBe('Itajaí');
    expect(alfa.querySelector('.indent-grupo__meta')?.textContent).not.toContain('Sem parceria');
    expect(colunas(alfa)).toEqual(['Referência', 'Fornecedor', 'Itens', 'Status', 'Total', 'Validade']);
    expect(screen.getByRole('button', { name: 'Cliente' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('url').textContent).toContain('agrupar=cliente');
  });

  it('por status: ordem Rascunho, Enviada, Respondida, Aceita; sem avatar; colunas Cliente e Fornecedor', async () => {
    const { container } = renderPage('/indent/cotacoes?agrupar=status');
    await screen.findByText('Rascunho', { selector: 'strong' });

    expect(grupos(container).map(tituloDe)).toEqual(['Rascunho', 'Enviada', 'Respondida', 'Aceita']);
    expect(container.querySelector('.indent-grupo__avatar')).toBeNull();
    expect(colunas(grupos(container)[0] as HTMLElement)).toEqual(['Referência', 'Cliente', 'Fornecedor', 'Itens', 'Status', 'Total', 'Validade']);
    expect(screen.getByRole('button', { name: 'Status' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('agrupamento invalido na URL cai em Fornecedor', async () => {
    renderPage('/indent/cotacoes?agrupar=foo');
    await screen.findByText('Nordic Solvents AB', { selector: 'strong' });
    expect(screen.getByRole('button', { name: 'Fornecedor' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('IndentCotacoes - estados', () => {
  it('sem cotacoes: texto de vazio', async () => {
    mockApi({ data: [], truncated: false });
    const { container } = renderPage();
    expect(await screen.findByText('Nenhuma cotação ainda. As cotações nascem na solicitação, ao escolher os fornecedores.')).toBeTruthy();
    expect(container.querySelector('.indent-grupo')).toBeNull();
  });

  it('lista cortada em 500: aviso "Mostrando as 500 cotações mais recentes."', async () => {
    mockApi({ data: LINHAS, truncated: true });
    renderPage();
    expect(await screen.findByText('Mostrando as 500 cotações mais recentes.')).toBeTruthy();
  });

  it('erro de carga: alert--warning com a mensagem', async () => {
    mockApi(new ApiError(500, { message: 'Falha no servidor' }));
    renderPage();
    const alerta = await screen.findByRole('alert');
    expect(alerta.className).toContain('alert--warning');
    expect(alerta.textContent).toContain('Não foi possível carregar as cotações: Falha no servidor');
  });
});

describe('IndentCotacoes - gaveta pela URL', () => {
  it('clicar na linha abre a gaveta e grava ?cotacao=; fechar remove o parametro', async () => {
    renderPage();
    const alvo = (await screen.findAllByText('268/26', { selector: '.indent-ref' }))[0] as HTMLElement;

    fireEvent.click(alvo.closest('tr') as HTMLElement);

    await screen.findByText('Referência de processo indent');
    expect(screen.getByTestId('url').textContent).toBe('/indent/cotacoes?cotacao=1');
    expect(document.querySelector('dialog.indent-gaveta')).not.toBeNull();

    fireEvent.click(within(document.querySelector('.modal-actions') as HTMLElement).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/indent/cotacoes'));
    expect(document.querySelector('dialog.indent-gaveta')).toBeNull();
  });

  it('Enter na linha tambem abre a gaveta', async () => {
    renderPage();
    const linhaAlvo = ((await screen.findAllByText('268/26', { selector: '.indent-ref' }))[0] as HTMLElement).closest('tr') as HTMLElement;

    fireEvent.keyDown(linhaAlvo, { key: 'Enter' });
    await screen.findByText('Referência de processo indent');
    expect(screen.getByTestId('url').textContent).toContain('cotacao=1');
  });

  it('o agrupamento escolhido e mantido ao abrir a gaveta', async () => {
    renderPage('/indent/cotacoes?agrupar=status');
    const linhaAlvo = ((await screen.findAllByText('268/26', { selector: '.indent-ref' }))[0] as HTMLElement).closest('tr') as HTMLElement;

    fireEvent.click(linhaAlvo);

    await screen.findByText('Referência de processo indent');
    expect(screen.getByTestId('url').textContent).toBe('/indent/cotacoes?agrupar=status&cotacao=1');
  });

  it('link direto ?cotacao=<id inexistente ou invalido>: "Cotação não encontrada."', async () => {
    const { unmount } = renderPage('/indent/cotacoes?cotacao=999');
    expect(await screen.findByText('Cotação não encontrada.', { selector: '.indent-vazio' })).toBeTruthy();
    unmount();

    renderPage('/indent/cotacoes?cotacao=abc');
    expect(await screen.findByText('Cotação não encontrada.', { selector: '.indent-vazio' })).toBeTruthy();
  });

  it('link direto ?cotacao=1 abre a gaveta ja carregada', async () => {
    renderPage('/indent/cotacoes?cotacao=1');
    expect(await screen.findByText('Referência de processo indent')).toBeTruthy();
    expect(document.querySelector('header.modal-header h2')?.textContent).toBe('268/26');
  });
});
