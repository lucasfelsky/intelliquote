import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IndentSolicitacaoDetalhe from './IndentSolicitacaoDetalhe';

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

import { api, ApiError } from '@/api/client';

type Obj = Record<string, unknown>;

function cliente(extra: Obj = {}) {
  return {
    id: 3,
    name: 'Cliente Alfa Ltda',
    cnpj: '11222333000181',
    city: 'Itajaí',
    pipedriveOrgId: 5521,
    supplierRuleMode: 'LIVRE',
    ruleReason: null,
    supplierRules: [],
    ...extra,
  };
}

const ITENS = [
  {
    id: 21,
    position: 0,
    description: 'Ácido cítrico anidro',
    name: 'Ácido cítrico anidro',
    quantityKg: 25000,
    confirmed: true,
    productId: 1,
    product: { id: 1, name: 'Ácido cítrico anidro', cas: '77-92-9', origin: 'CADASTRADO' },
    isFree: false,
  },
  {
    id: 22,
    position: 1,
    description: 'Ureia técnica',
    name: 'Ureia técnica',
    quantityKg: 1500.5,
    confirmed: true,
    productId: 2,
    product: { id: 2, name: 'Ureia técnica', cas: null, origin: 'CADASTRADO' },
    isFree: false,
  },
  {
    id: 23,
    position: 2,
    description: 'Produto livre X',
    name: 'Produto livre X',
    quantityKg: 100,
    confirmed: true,
    productId: 3,
    product: { id: 3, name: 'Produto livre X', cas: null, origin: 'LIVRE' },
    isFree: true,
  },
];

function solicitacao(extra: Obj = {}) {
  return {
    id: 11,
    processNumber: '275/26',
    origin: 'IQ_INDENT',
    pipedriveDealId: null,
    dealTitle: null,
    dealType: null,
    rawNote: null,
    ownerName: 'Ana Souza',
    createdByName: 'Ana Souza',
    status: 'NOVA',
    clientPending: false,
    createdAt: '2026-11-12T15:05:00.000Z',
    stageEnteredAt: '2026-11-12T15:05:00.000Z',
    queueBusinessDays: 0,
    client: cliente(),
    items: ITENS,
    quotes: [],
    ...extra,
  };
}

const OPCOES = {
  clientRuleMode: 'LIVRE',
  suppliers: [
    {
      id: 1,
      name: 'Shandong Haohua Chemical Co.',
      country: 'China',
      type: 'FABRICANTE',
      hasPartnership: true,
      defaultCurrency: 'USD',
      defaultIncoterm: 'CFR',
      allowed: true,
      blockedReason: null,
      approvedByClient: false,
      coverage: { covered: 2, total: 3 },
    },
  ],
};

function mockApi(detalhe: unknown) {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/requests/11') {
      if (detalhe instanceof Error) throw detalhe;
      return detalhe;
    }
    if (url === '/api/v1/indent/requests/11/supplier-options') return OPCOES;
    return [];
  }) as typeof api.get);
}

function Sonda() {
  const location = useLocation();
  return <p data-testid="lista">{location.pathname}</p>;
}

function renderPage(caminho = '/indent/solicitacoes/11', state: unknown = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: caminho, state }]}>
        <Routes>
          <Route path="/indent/solicitacoes" element={<Sonda />} />
          <Route path="/indent/solicitacoes/:id" element={<IndentSolicitacaoDetalhe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IndentSolicitacaoDetalhe', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    mockRole = 'comprador';
  });

  it('cabecalho de solicitacao lancada no IQ: eyebrow, h1 "NNN/AA · cliente", subtitulo com fila e badge de status', async () => {
    mockApi(solicitacao());
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });

    expect(container.querySelector('.page-header .eyebrow')?.textContent).toBe('Lançada no IQ Indent');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('275/26 · Cliente Alfa Ltda');
    expect(h1.querySelector('.indent-ref')?.textContent).toBe('275/26');
    expect(screen.getByText('Criada em 12/11 12:05 · responsável Ana Souza · chegou hoje à fila')).toBeTruthy();
    expect(container.querySelector('.page-header__actions .badge')?.textContent).toBe('Nova');
    expect(container.querySelector('.page-header__actions .badge')?.className).toContain('badge--info');
  });

  it('solicitacao do Pipedrive: eyebrow com negocio e titulo; "na fila ha N dias"', async () => {
    mockApi(solicitacao({ origin: 'PIPEDRIVE', pipedriveDealId: 4412, dealTitle: '275/26 INDENT - ALFA', queueBusinessDays: 2 }));
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('.page-header .eyebrow')?.textContent).toBe('Pipedrive · negócio #4412 · título “275/26 INDENT - ALFA”');
    expect(screen.getByText('Criada em 12/11 12:05 · responsável Ana Souza · na fila há 2 dias')).toBeTruthy();
  });

  it('NOVA com cliente: painel "Fornecedores para cotar" com o seletor; tag de restricao so quando o cliente restringe', async () => {
    mockApi(solicitacao());
    const { container } = renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    const painel = screen.getByRole('heading', { level: 2, name: 'Fornecedores para cotar' }).closest('section') as HTMLElement;
    expect(painel.className).toBe('indent-painel');
    expect(within(painel).queryByText('Restrição do cliente aplicada')).toBeNull();
    expect(container.querySelector('.indent-cols > .indent-coluna .indent-sup')).not.toBeNull();
  });

  it('NOVA com cliente restrito mostra a tag "Restricao do cliente aplicada"', async () => {
    mockApi(solicitacao({ client: cliente({ supplierRuleMode: 'APROVADOS', ruleReason: 'Auditoria', supplierRules: [{ supplierId: 1, name: 'Shandong Haohua Chemical Co.' }] }) }));
    renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    expect(screen.getByText('Restrição do cliente aplicada').closest('.indent-tag')?.className).toContain('indent-tag--lock');
  });

  it('cliente pendente: aviso sem botao, sem seletor e "Cliente pendente" no titulo e no status', async () => {
    mockApi(solicitacao({ clientPending: true, client: null }));
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('275/26 · Cliente pendente');
    expect(screen.getByText(/não tem cliente cadastrado\. Vincule antes de escolher fornecedores, para a restrição do cliente valer\./)).toBeTruthy();
    expect(container.querySelector('.page-header__actions .badge')?.textContent).toBe('Cliente pendente');
    // Alerta como o do mock: cadeado (svg filho direto) antes do texto, sem o icone por mascara.
    const aviso = container.querySelector('.alert.alert--warning.indent-alerta');
    expect(aviso?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(aviso?.firstElementChild?.getAttribute('width')).toBe('18');
    expect(screen.queryByRole('button', { name: 'Abrir fila de vínculo' })).toBeNull();
    expect(container.querySelector('.indent-sup')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Cliente' })).toBeNull();
    expect(vi.mocked(api.get).mock.calls.some((c) => String(c[0]).endsWith('/supplier-options'))).toBe(false);
  });

  it('em cotacao: tabela "Cotacoes desta solicitacao" com excecao em destaque, status Rascunho e Total "—"', async () => {
    mockApi(
      solicitacao({
        status: 'COTACAO',
        queueBusinessDays: 1,
        quotes: [
          { id: 100, status: 'RASCUNHO', revision: 1, supplier: { id: 1, name: 'Shandong Haohua Chemical Co.' }, exception: null },
          {
            id: 101,
            status: 'RASCUNHO',
            revision: 1,
            supplier: { id: 3, name: 'Nordic Solvents AB' },
            exception: { reason: 'Cliente autorizou', byName: 'Ana Souza', at: '2026-11-12T15:10:00.000Z' },
          },
        ],
      }),
    );
    const { container } = renderPage();
    await screen.findByText('Nordic Solvents AB');

    expect(screen.getByRole('heading', { level: 2, name: 'Cotações desta solicitação' })).toBeTruthy();
    expect(screen.getByText('2 fornecedores')).toBeTruthy();
    expect(screen.queryByText('Fornecedores para cotar')).toBeNull();
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Referência', 'Fornecedor', 'Status', 'Total']);

    const linhas = Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.className).toBe('');
    expect(linhas[1]?.className).toBe('indent-linha-exc');
    expect(within(linhas[1] as HTMLElement).getByText('Exceção').closest('.indent-tag')?.className).toContain('indent-tag--exc');
    expect(within(linhas[0] as HTMLElement).queryByText('Exceção')).toBeNull();
    expect(within(linhas[0] as HTMLElement).getByText('275/26').className).toContain('indent-ref--indent');
    expect(within(linhas[0] as HTMLElement).getByText('Rascunho').className).toContain('badge--muted');
    expect(linhas[0]?.querySelectorAll('td')[3]?.textContent).toBe('—');
    // a gaveta de cotacao e do PR 3: linha nao clicavel
    expect((linhas[0] as HTMLElement).tabIndex).toBe(-1);
    expect(container.querySelector('tbody .indent-linha-clicavel')).toBeNull();
    expect(screen.getByText('na fila há 1 dia', { exact: false })).toBeTruthy();
  });

  it('cotacao unica usa "1 fornecedor"', async () => {
    mockApi(solicitacao({ status: 'COTACAO', quotes: [{ id: 100, status: 'RASCUNHO', revision: 1, supplier: { id: 1, name: 'Acme' }, exception: null }] }));
    renderPage();
    expect(await screen.findByText('1 fornecedor')).toBeTruthy();
  });

  it('itens pedidos: "CAS x", "sem CAS", "Item livre" e quantidade em kg; sem a tag "Lidos da nota" quando nao ha nota', async () => {
    mockApi(solicitacao());
    const { container } = renderPage();
    await screen.findByText('Ureia técnica');

    const painel = screen.getByRole('heading', { level: 2, name: 'Itens pedidos' }).closest('section') as HTMLElement;
    const linhas = Array.from(painel.querySelectorAll('.indent-itemrow')) as HTMLElement[];
    expect(linhas).toHaveLength(3);
    expect(within(linhas[0] as HTMLElement).getByText('Ácido cítrico anidro').tagName).toBe('STRONG');
    expect(within(linhas[0] as HTMLElement).getByText('CAS 77-92-9')).toBeTruthy();
    expect(within(linhas[0] as HTMLElement).getByText('25.000 kg').className).toContain('indent-ref');
    expect(within(linhas[1] as HTMLElement).getByText('sem CAS')).toBeTruthy();
    expect(within(linhas[1] as HTMLElement).getByText('1.500,5 kg')).toBeTruthy();
    expect(within(linhas[2] as HTMLElement).getByText('Item livre').className).toContain('indent-tag--manual');
    expect(within(painel).queryByText('Lidos da nota · confirmar')).toBeNull();
    expect(screen.queryByText('Nota do negócio no Pipedrive')).toBeNull();
    expect(container.querySelector('.indent-nota')).toBeNull();
  });

  it('com rawNote: painel da nota (texto original) e a tag "Lidos da nota · confirmar" nos itens', async () => {
    mockApi(solicitacao({ rawNote: 'CFR Itajaí - Shandong\n25 t ácido cítrico' }));
    const { container } = renderPage();
    await screen.findByText('Nota do negócio no Pipedrive');

    expect(screen.getByText('Texto original').className).toContain('indent-tag--pd');
    const nota = container.querySelector('pre.indent-nota') as HTMLElement;
    expect(nota.textContent).toBe('CFR Itajaí - Shandong\n25 t ácido cítrico');
    expect(screen.getByText('O pedido chega como texto livre. O IQ Indent propõe os itens ao lado e você confirma antes de cotar.')).toBeTruthy();
    expect(screen.getByText('Lidos da nota · confirmar').className).toContain('indent-tag--manual');
  });

  it('painel Cliente: CNPJ formatado, cidade, Pipedrive "Org #N" e "Tipo de negocio" so quando existe', async () => {
    mockApi(solicitacao({ dealType: 'Regular' }));
    const { container } = renderPage();
    await screen.findByText('Ureia técnica');

    const dl = container.querySelector('dl.indent-dl') as HTMLElement;
    expect(Array.from(dl.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['CNPJ', 'Cidade', 'Pipedrive', 'Tipo de negócio']);
    expect(Array.from(dl.querySelectorAll('dd')).map((dd) => dd.textContent)).toEqual(['11.222.333/0001-81', 'Itajaí', 'Org #5521', 'Regular']);
    expect(dl.querySelector('dd.indent-dl__mono')?.textContent).toBe('11.222.333/0001-81');
    expect(screen.getByText('Sem restrição de fornecedor').className).toBe('indent-tag');
  });

  it('painel Cliente sem organizacao do Pipedrive mostra "—" e sem tipo de negocio', async () => {
    mockApi(solicitacao({ client: cliente({ pipedriveOrgId: null, city: null }) }));
    const { container } = renderPage();
    await screen.findByText('Ureia técnica');
    const dl = container.querySelector('dl.indent-dl') as HTMLElement;
    expect(Array.from(dl.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['CNPJ', 'Cidade', 'Pipedrive']);
    expect(Array.from(dl.querySelectorAll('dd')).map((dd) => dd.textContent).slice(1)).toEqual(['—', '—']);
  });

  it('restricao do cliente: tag, motivo e lista com a 1a palavra de cada fornecedor (aprovados x bloqueados)', async () => {
    const regras = [
      { supplierId: 1, name: 'Shandong Haohua Chemical Co.' },
      { supplierId: 2, name: 'Gujarat Alkalies Trading' },
    ];
    mockApi(solicitacao({ client: cliente({ supplierRuleMode: 'APROVADOS', ruleReason: 'Auditoria do cliente', supplierRules: regras }) }));
    const aprovados = renderPage();
    await screen.findByText('Auditoria do cliente');
    expect(screen.getAllByText('Só aprovados').some((el) => el.closest('.indent-tag')?.className.includes('indent-tag--lock'))).toBe(true);
    expect(screen.getByText('Aprovados: Shandong, Gujarat')).toBeTruthy();
    aprovados.unmount();

    vi.mocked(api.get).mockReset();
    mockApi(solicitacao({ status: 'COTACAO', client: cliente({ supplierRuleMode: 'BLOQUEIO', ruleReason: 'Risco', supplierRules: regras }) }));
    renderPage();
    await screen.findByText('Bloqueados: Shandong, Gujarat');
    expect(screen.getByText('Bloqueios').closest('.indent-tag')?.className).toContain('indent-tag--lock');
  });

  it('viewer ve o seletor so para leitura', async () => {
    mockRole = 'viewer';
    mockApi(solicitacao());
    renderPage();
    await screen.findByText('Shandong Haohua Chemical Co.');
    expect(screen.queryByRole('button', { name: /^Gerar/ })).toBeNull();
    expect((screen.getByRole('checkbox', { name: /Shandong/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('id invalido ou 404: "Solicitação não encontrada." com o botao de voltar', async () => {
    mockApi(solicitacao());
    const invalido = renderPage('/indent/solicitacoes/abc');
    expect(await screen.findByText('Solicitação não encontrada.')).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
    invalido.unmount();

    mockApi(new ApiError(404, { message: 'Solicitação não encontrada.' }));
    renderPage();
    expect(await screen.findByText('Solicitação não encontrada.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Solicitações' })).toBeTruthy();
  });

  it('erro diferente de 404 vira alerta', async () => {
    mockApi(new Error('rede caiu'));
    renderPage();
    expect(await screen.findByText(/Não foi possível carregar a solicitação: rede caiu/)).toBeTruthy();
  });

  it('botao "Solicitações" volta para a lista', async () => {
    mockApi(solicitacao());
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    const voltar = screen.getByRole('button', { name: 'Solicitações' });
    expect(voltar.className).toBe('ghost-button ghost-button--sm');
    fireEvent.click(voltar);
    expect((await screen.findByTestId('lista')).textContent).toBe('/indent/solicitacoes');
  });

  it('toast da criacao chega pelo state da navegacao e e mostrado uma vez', async () => {
    mockApi(solicitacao());
    renderPage('/indent/solicitacoes/11', { toast: 'Solicitação 275/26 criada. Escolha os fornecedores' });
    expect(await screen.findByText('Solicitação 275/26 criada. Escolha os fornecedores')).toBeTruthy();
    expect(screen.getByTestId('fc-toast').getAttribute('role')).toBe('status');
    await waitFor(() => expect(screen.getAllByText('Solicitação 275/26 criada. Escolha os fornecedores')).toHaveLength(1));
  });
});
