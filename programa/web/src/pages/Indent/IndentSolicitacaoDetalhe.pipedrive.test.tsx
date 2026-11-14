import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IndentSolicitacaoDetalhe from './IndentSolicitacaoDetalhe';
import { validarReferencia } from './IndentSolicitacaoDetalhePipedrive';

// IQ Indent (PR 5a.5): detalhe da solicitacao com os elementos do Pipedrive: aviso de cliente pendente com a organizacao e "Abrir fila de vinculo"
// (D13), h1 e painel Cliente da pendencia (D22), "Referencia pendente", `R<n>`, alertas, nota (texto), "Itens a digitar" e o modal de itens.
// Dados FICTICIOS (Cliente Exemplo, CNPJs de teste, ids 9xxxxx).

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Exemplo', email: 'ana@exemplo.com.br', role: mockRole } }),
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

const NOTA = 'CFR Santos - Fabricante Exemplo\nRESINA EXEMPLO 223 (RXE)  2.000';

function item(id: number, extra: Obj = {}) {
  return {
    id,
    position: id - 21,
    description: 'RESINA EXEMPLO 223 (RXE)',
    name: 'RESINA EXEMPLO 223 (RXE)',
    quantityKg: 2000,
    confirmed: false,
    source: 'NOTE',
    noteLine: 'RESINA EXEMPLO 223 (RXE)  2.000',
    productId: null,
    product: null,
    isFree: true,
    ...extra,
  };
}

const ORG_ALFA = { orgId: 900201, name: 'Cliente Exemplo Alfa Ltda', cnpj: '11222333000181', city: 'Itajaí, SC' };
const ORG_DELTA = { orgId: 900202, name: 'Cliente Exemplo Delta SA', cnpj: null, city: null };

function solicitacao(extra: Obj = {}) {
  return {
    id: 11,
    processNumber: '277/26',
    origin: 'PIPEDRIVE',
    pipedriveDealId: 900111,
    dealTitle: '277/26 INDENT - ALFA',
    dealType: 'Regular',
    rawNote: NOTA,
    ownerName: 'Vendedora Exemplo',
    createdByName: null,
    status: 'NOVA',
    clientPending: false,
    createdAt: '2026-11-12T15:05:00.000Z',
    stageEnteredAt: '2026-11-12T15:05:00.000Z',
    queueBusinessDays: 1,
    slaBusinessDays: 2,
    referenceAlert: null,
    currentRevision: null,
    revisionAlertAt: null,
    noteChangedAt: null,
    noteIncoterm: null,
    noteDestination: null,
    noteSupplierHint: null,
    pendingOrg: null,
    client: {
      id: 3,
      name: 'Cliente Exemplo Alfa Ltda',
      cnpj: '11222333000181',
      city: 'Itajaí',
      pipedriveOrgId: 900201,
      supplierRuleMode: 'LIVRE',
      ruleReason: null,
      supplierRules: [],
    },
    items: [item(21, { confirmed: true, productId: 9, product: { id: 9, name: 'RESINA EXEMPLO 223 (RXE)', cas: null, origin: 'LIVRE' } })],
    quotes: [],
    ...extra,
  };
}

const PENDENTE = { clientPending: true, client: null, pendingOrg: { id: 501, candidates: [ORG_ALFA] } };

let corpo: Obj = solicitacao();

function mockApi() {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url === '/api/v1/indent/requests/11') return corpo;
    if (url === '/api/v1/indent/requests/11/supplier-options') return { clientRuleMode: 'LIVRE', suppliers: [] };
    if (url === '/api/v1/indent/products/options') return [{ id: 9, name: 'RESINA EXEMPLO 223 (RXE)', cas: null, isActive: true }];
    return [];
  }) as typeof api.get);
}

const chamadas = (url: string) => vi.mocked(api.get).mock.calls.filter((c) => c[0] === url).length;

function Sonda() {
  const location = useLocation();
  return <p data-testid="rota">{location.pathname}</p>;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/indent/solicitacoes/11']}>
        <Routes>
          <Route path="/indent/solicitacoes/:id" element={<IndentSolicitacaoDetalhe />} />
          <Route path="/indent/integracao" element={<Sonda />} />
          <Route path="/indent/solicitacoes" element={<Sonda />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Ano de 2 digitos aceito pelo backend (atual, anterior ou proximo): o teste nao depende da data de hoje.
const AA = String(new Date().getFullYear() % 100).padStart(2, '0');
const AA_FORA = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.put).mockReset();
  mockRole = 'comprador';
  corpo = solicitacao();
  mockApi();
});

describe('cliente pendente com a organizacao da fila de vinculo (D13 e D22)', () => {
  it('h1 com o nome da organizacao, aviso com nome e Org #N, botao primario "Abrir fila de vinculo" e nenhum seletor', async () => {
    corpo = solicitacao(PENDENTE);
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('277/26 · Cliente Exemplo Alfa Ltda');
    const aviso = container.querySelector('.alert.alert--warning.indent-alerta') as HTMLElement;
    expect(aviso.textContent).toBe(
      'A organização Cliente Exemplo Alfa Ltda (Org #900201) não tem cliente cadastrado. Vincule antes de escolher fornecedores, para a restrição do cliente valer.',
    );
    expect(aviso.querySelector('b')?.textContent).toBe('Cliente Exemplo Alfa Ltda');
    expect(aviso.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    const botao = screen.getByRole('button', { name: 'Abrir fila de vínculo' });
    expect(botao.className).toBe('primary-button');
    expect(container.querySelector('.indent-sup')).toBeNull();
    expect(chamadas('/api/v1/indent/requests/11/supplier-options')).toBe(0);

    fireEvent.click(botao);
    expect((await screen.findByTestId('rota')).textContent).toBe('/indent/integracao');
  });

  it('painel Cliente da pendencia: CNPJ formatado, cidade, Org #N, tipo de negocio e a tag "Cliente pendente"', async () => {
    corpo = solicitacao(PENDENTE);
    renderPage();
    const painel = (await screen.findByRole('heading', { level: 2, name: 'Cliente' })).closest('section') as HTMLElement;
    expect(within(painel).getByText('Cliente pendente').className).toContain('indent-tag--manual');
    const dls = Array.from(painel.querySelectorAll('dl.indent-dl'));
    expect(Array.from(dls[0]?.querySelectorAll('dt') ?? []).map((dt) => dt.textContent)).toEqual(['CNPJ', 'Cidade', 'Pipedrive']);
    expect(Array.from(dls[0]?.querySelectorAll('dd') ?? []).map((dd) => dd.textContent)).toEqual(['11.222.333/0001-81', 'Itajaí, SC', 'Org #900201']);
    expect(dls[0]?.querySelector('dd.indent-dl__mono')?.textContent).toBe('11.222.333/0001-81');
    expect(dls[1]?.textContent).toBe('Tipo de negócioRegular');
  });

  it('organizacao sem CNPJ valido nem cidade: "—" nos dois e sem a classe monoespacada', async () => {
    corpo = solicitacao({ ...PENDENTE, pendingOrg: { id: 501, candidates: [ORG_DELTA] } });
    renderPage();
    const painel = (await screen.findByRole('heading', { level: 2, name: 'Cliente' })).closest('section') as HTMLElement;
    expect(Array.from(painel.querySelectorAll('dd')).map((dd) => dd.textContent)).toEqual(['—', '—', 'Org #900202', 'Regular']);
    expect(painel.querySelector('dd.indent-dl__mono')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('277/26 · Cliente Exemplo Delta SA');
  });

  it('organizacao sem nome usa "Organização #N" no titulo e no aviso', async () => {
    corpo = solicitacao({ ...PENDENTE, pendingOrg: { id: 501, candidates: [{ ...ORG_DELTA, name: '  ' }] } });
    renderPage();
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('277/26 · Organização #900202');
    expect(screen.getByText('Organização #900202', { selector: 'b' })).toBeTruthy();
  });

  it('negocio com varias organizacoes: h1 "Cliente pendente", aviso com a lista e um bloco por organizacao no painel', async () => {
    corpo = solicitacao({ ...PENDENTE, pendingOrg: { id: 501, candidates: [ORG_ALFA, ORG_DELTA] } });
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('277/26 · Cliente pendente');
    const aviso = container.querySelector('.alert.alert--warning.indent-alerta') as HTMLElement;
    expect(aviso.textContent).toBe(
      'O negócio tem 2 organizações sem cliente cadastrado: Cliente Exemplo Alfa Ltda (Org #900201), Cliente Exemplo Delta SA (Org #900202). Vincule antes de escolher fornecedores, para a restrição do cliente valer.',
    );
    const painel = screen.getByRole('heading', { level: 2, name: 'Cliente' }).closest('section') as HTMLElement;
    const dls = Array.from(painel.querySelectorAll('dl.indent-dl'));
    expect(dls.map((dl) => dl.querySelector('dt')?.textContent)).toEqual(['Organização', 'Organização', 'Tipo de negócio']);
    expect(Array.from(dls[0]?.querySelectorAll('dd') ?? []).map((dd) => dd.textContent)).toEqual(['Cliente Exemplo Alfa Ltda', '11.222.333/0001-81', 'Itajaí, SC', 'Org #900201']);
  });

  it('negocio sem organizacao: aviso generico, botao da fila e nenhum painel Cliente', async () => {
    corpo = solicitacao({ ...PENDENTE, pendingOrg: { id: 501, candidates: [] } });
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('277/26 · Cliente pendente');
    expect(screen.getByText(/A organização do negócio não tem cliente cadastrado\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir fila de vínculo' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Cliente' })).toBeNull();
  });

  it('viewer tambem ve o aviso e o botao (a fila e so leitura para ele)', async () => {
    mockRole = 'viewer';
    corpo = solicitacao(PENDENTE);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Abrir fila de vínculo' })).toBeTruthy();
  });
});

describe('"Referência pendente"', () => {
  it('h1 "Referência pendente", alerta literal, campo, botao e porque nao gera cotacoes; seletor e opcoes de fornecedor NAO sao pedidos', async () => {
    corpo = solicitacao({ processNumber: null, dealTitle: 'INDENT - ALFA' });
    const { container } = renderPage();
    await screen.findByLabelText('Referência (NNN/AA)');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Referência pendente · Cliente Exemplo Alfa Ltda');
    expect(screen.getByText('Título do negócio sem número NNN/AA. Digite a referência para seguir.').closest('.alert')?.className).toBe(
      'alert alert--warning indent-alerta',
    );
    expect(screen.getByText('Enquanto a referência estiver pendente, as cotações desta solicitação não podem ser geradas.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar referência' }).className).toBe('primary-button');
    expect(container.querySelector('form.indent-referencia')).not.toBeNull();
    expect(container.querySelector('.indent-sup')).toBeNull();
    expect(chamadas('/api/v1/indent/requests/11/supplier-options')).toBe(0);
  });

  it('viewer ve o alerta mas nao o campo nem o botao', async () => {
    mockRole = 'viewer';
    corpo = solicitacao({ processNumber: null });
    renderPage();
    await screen.findByText('Título do negócio sem número NNN/AA. Digite a referência para seguir.');
    expect(screen.queryByLabelText('Referência (NNN/AA)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar referência' })).toBeNull();
    expect(screen.getByText('Só quem edita as solicitações pode digitar a referência.')).toBeTruthy();
  });

  it('salva: PUT /requests/:id/reference com o numero normalizado, toast, detalhe relido e foco no titulo', async () => {
    corpo = solicitacao({ processNumber: null });
    vi.mocked(api.put).mockImplementation((async () => {
      corpo = solicitacao({ processNumber: `074/${AA}` });
      return corpo;
    }) as typeof api.put);
    renderPage();
    const campo = await screen.findByLabelText('Referência (NNN/AA)');
    const antes = chamadas('/api/v1/indent/requests/11');
    fireEvent.change(campo, { target: { value: ` 74/${AA} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar referência' }));

    expect(await screen.findByText(`Referência 074/${AA} salva`)).toBeTruthy();
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/requests/11/reference', { processNumber: `074/${AA}` });
    await waitFor(() => expect(chamadas('/api/v1/indent/requests/11')).toBeGreaterThan(antes));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`074/${AA} · Cliente Exemplo Alfa Ltda`));
    expect(screen.queryByLabelText('Referência (NNN/AA)')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it.each([
    ['', 'Informe a referência no formato NNN/AA (ex.: 274/26).'],
    ['abc', 'Informe a referência no formato NNN/AA (ex.: 274/26).'],
    [`274-${AA}`, 'Informe a referência no formato NNN/AA (ex.: 274/26).'],
    [`26/20${AA}`, 'Informe a referência no formato NNN/AA (ex.: 274/26).'],
    [`0/${AA}`, 'Informe a referência no formato NNN/AA (ex.: 274/26).'],
    [`274/${AA_FORA}`, 'O ano da referência deve ser o atual, o anterior ou o próximo.'],
  ])('valida antes de enviar: "%s" nao chama o backend', async (digitado, mensagem) => {
    corpo = solicitacao({ processNumber: null });
    renderPage();
    const campo = await screen.findByLabelText('Referência (NNN/AA)');
    fireEvent.change(campo, { target: { value: digitado } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar referência' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(mensagem);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(api.put).not.toHaveBeenCalled();
    // digitar de novo limpa o erro
    fireEvent.change(campo, { target: { value: `274/${AA}` } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('erro de digitacao de ano (2026/26): a sequencia incomum pede confirmacao; so o 2o "Salvar referência" com o MESMO numero envia', async () => {
    corpo = solicitacao({ processNumber: null });
    vi.mocked(api.put).mockResolvedValue(solicitacao({ processNumber: `2026/${AA}` }));
    renderPage();
    const campo = await screen.findByLabelText('Referência (NNN/AA)');
    const salvar = screen.getByRole('button', { name: 'Salvar referência' });

    fireEvent.change(campo, { target: { value: `2026/${AA}` } });
    fireEvent.click(salvar);
    const aviso = await screen.findByText(/A sequência 2\.026 é muito maior que o normal/);
    expect(aviso.textContent).toContain('parece o ano no lugar do número');
    expect(aviso.textContent).toContain(`Se 2026/${AA} estiver certo, clique em “Salvar referência” de novo para confirmar.`);
    expect(api.put).not.toHaveBeenCalled();

    // mudar o numero zera a confirmacao: de novo so o aviso
    fireEvent.change(campo, { target: { value: `1500/${AA}` } });
    expect(screen.queryByText(/muito maior que o normal/)).toBeNull();
    fireEvent.click(salvar);
    expect((await screen.findByText(/A sequência 1\.500 é muito maior que o normal/)).textContent).not.toContain('parece o ano');
    expect(api.put).not.toHaveBeenCalled();

    fireEvent.click(salvar);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/requests/11/reference', { processNumber: `1500/${AA}` });
  });

  it('sequencia normal (ate 999) vai direto, sem pedir confirmacao', async () => {
    corpo = solicitacao({ processNumber: null });
    vi.mocked(api.put).mockResolvedValue(solicitacao({ processNumber: `999/${AA}` }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Referência (NNN/AA)'), { target: { value: `999/${AA}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar referência' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/muito maior que o normal/)).toBeNull();
  });

  it('409 do servidor (numero usado) aparece inline e o detalhe e relido', async () => {
    corpo = solicitacao({ processNumber: null });
    vi.mocked(api.put).mockRejectedValue(new ApiError(409, { message: 'Já existe uma solicitação com este número.' }));
    renderPage();
    const campo = await screen.findByLabelText('Referência (NNN/AA)');
    const antes = chamadas('/api/v1/indent/requests/11');
    fireEvent.change(campo, { target: { value: `274/${AA}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar referência' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe uma solicitação com este número.');
    await waitFor(() => expect(chamadas('/api/v1/indent/requests/11')).toBeGreaterThan(antes));
    // o formulario continua (ainda sem referencia) e o foco fica no campo/botao
    expect(screen.getByLabelText('Referência (NNN/AA)')).toBeTruthy();
  });

  it('clique duplo durante a chamada envia uma vez (aria-disabled, sem perder o foco)', async () => {
    corpo = solicitacao({ processNumber: null });
    vi.mocked(api.put).mockImplementation((() => new Promise(() => undefined)) as typeof api.put);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Referência (NNN/AA)'), { target: { value: `274/${AA}` } });
    const salvar = screen.getByRole('button', { name: 'Salvar referência' });
    salvar.focus();
    fireEvent.click(salvar);
    await waitFor(() => expect(salvar.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(salvar);
    // o mutate do TanStack so chama o mutationFn depois de microtarefas: espera antes de contar as chamadas
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 60)));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(salvar);
  });
});

describe('validarReferencia (puro)', () => {
  const agora = new Date('2026-11-13T15:00:00.000Z');

  it('normaliza para 3 digitos e aceita o ano anterior, o atual e o proximo', () => {
    expect(validarReferencia('274/26', agora)).toEqual({ ok: true, numero: '274/26', sequencia: 274 });
    expect(validarReferencia(' 74 / 26 ', agora)).toEqual({ ok: true, numero: '074/26', sequencia: 74 });
    expect(validarReferencia('1/25', agora)).toEqual({ ok: true, numero: '001/25', sequencia: 1 });
    expect(validarReferencia('001/27', agora)).toEqual({ ok: true, numero: '001/27', sequencia: 1 });
    expect(validarReferencia('1000/26', agora)).toEqual({ ok: true, numero: '1000/26', sequencia: 1000 });
  });

  it('recusa formato errado, sequencia zero, 5 digitos e ano fora da faixa (ano de Sao Paulo, nao o do navegador)', () => {
    for (const texto of ['', 'x', '274', '274/2026', '12345/26', '0/26', '000/26', '26/']) {
      expect(validarReferencia(texto, agora), texto).toMatchObject({ ok: false });
    }
    expect(validarReferencia('274/24', agora)).toEqual({ ok: false, erro: 'O ano da referência deve ser o atual, o anterior ou o próximo.' });
    expect(validarReferencia('274/28', agora)).toEqual({ ok: false, erro: 'O ano da referência deve ser o atual, o anterior ou o próximo.' });
    // 01/01/2027 00:30 UTC ainda e 31/12/2026 em Sao Paulo: o ano de referencia continua 2026 (faixa 2025-2027)
    expect(validarReferencia('274/27', new Date('2027-01-01T00:30:00.000Z'))).toMatchObject({ ok: true });
    expect(validarReferencia('274/24', new Date('2027-01-01T00:30:00.000Z'))).toMatchObject({ ok: false });
  });
});

describe('alertas da sincronizacao, R<n> e nota', () => {
  it('referenceAlert aparece como alerta de aviso com icone, tambem com referencia ja preenchida', async () => {
    corpo = solicitacao({ referenceAlert: 'O título do negócio aponta para 278/26, diferente da solicitação 277/26.' });
    renderPage();
    const alerta = (await screen.findByText('O título do negócio aponta para 278/26, diferente da solicitação 277/26.')).closest('.alert') as HTMLElement;
    expect(alerta.className).toBe('alert alert--warning indent-alerta');
    expect(alerta.firstElementChild?.tagName.toLowerCase()).toBe('svg');
  });

  it('revisao R2: tag "R2" no cabecalho e alerta "Revisão R2 recebida do Pipedrive em dd/MM." (fuso de Sao Paulo)', async () => {
    corpo = solicitacao({ currentRevision: 2, revisionAlertAt: '2026-11-13T02:30:00.000Z' });
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });
    const tag = container.querySelector('.page-header__actions .indent-tag') as HTMLElement;
    expect(tag.textContent).toBe('R2');
    expect(tag.className).toBe('indent-tag indent-tag--pd');
    // 02:30 UTC = 23:30 do dia 12 em Sao Paulo
    expect(screen.getByText('Revisão R2 recebida do Pipedrive em 12/11.').closest('.alert')?.className).toBe('alert alert--info indent-alerta');
    // a revisao so alerta (P3): o status e o seletor seguem como estavam
    expect(container.querySelector('.page-header__actions .badge')?.textContent).toBe('Nova');
  });

  it('sem revisao nao ha tag R<n> nem alerta; revisao sem data de alerta mostra so a tag', async () => {
    const { container, unmount } = renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('.page-header__actions .indent-tag')).toBeNull();
    expect(screen.queryByText(/Revisão R/)).toBeNull();
    unmount();

    corpo = solicitacao({ currentRevision: 3, revisionAlertAt: null });
    const outra = renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(outra.container.querySelector('.page-header__actions .indent-tag')?.textContent).toBe('R3');
    expect(screen.queryByText(/Revisão R3 recebida/)).toBeNull();
  });

  it('nota alterada depois da confirmacao: alerta literal', async () => {
    corpo = solicitacao({ noteChangedAt: '2026-11-13T12:00:00.000Z' });
    renderPage();
    const alerta = (await screen.findByText('A nota do negócio mudou no Pipedrive depois da confirmação dos itens.')).closest('.alert') as HTMLElement;
    expect(alerta.className).toBe('alert alert--warning indent-alerta');
  });

  it('painel da nota: fornecedor citado, incoterm e destino; so as partes que existem', async () => {
    corpo = solicitacao({ noteSupplierHint: 'Fabricante Exemplo', noteIncoterm: 'CFR', noteDestination: 'Santos' });
    const { container, unmount } = renderPage();
    await screen.findByText('Nota do negócio no Pipedrive');
    expect(screen.getByText('Fornecedor citado na nota:', { exact: false }).textContent).toBe('Fornecedor citado na nota: Fabricante Exemplo');
    expect(screen.getByText('Incoterm CFR · destino Santos')).toBeTruthy();
    expect(container.querySelector('.indent-cell-main b')?.textContent).toBe('Fabricante Exemplo');
    unmount();

    corpo = solicitacao({ noteIncoterm: 'FOB' });
    renderPage();
    await screen.findByText('Nota do negócio no Pipedrive');
    expect(screen.getByText('Incoterm FOB')).toBeTruthy();
    expect(screen.queryByText(/Fornecedor citado na nota/)).toBeNull();
  });

  it('a nota original e sempre TEXTO: marcacao HTML nao vira elemento', async () => {
    const perigosa = '<img src="x" onerror="alert(1)"> <b>negrito</b>\n<script>alert(2)</script>';
    corpo = solicitacao({ rawNote: perigosa });
    const { container } = renderPage();
    await screen.findByText('Nota do negócio no Pipedrive');
    const nota = container.querySelector('pre.indent-nota') as HTMLElement;
    expect(nota.textContent).toBe(perigosa);
    expect(nota.children).toHaveLength(0);
    expect(container.querySelector('img, script')).toBeNull();
  });
});

describe('itens da nota: confirmar, digitar e quantidade', () => {
  it('itens lidos e nao confirmados: tag "Lidos da nota · confirmar", "— kg" sem quantidade, alerta e botao; seletor barrado ate confirmar', async () => {
    corpo = solicitacao({ items: [item(21), item(22, { name: 'SOLVENTE TESTE 99%', description: 'SOLVENTE TESTE 99%', quantityKg: 0, noteLine: 'SOLVENTE TESTE 99%' })] });
    const { container } = renderPage();
    const painel = (await screen.findByRole('heading', { level: 2, name: 'Itens pedidos' })).closest('section') as HTMLElement;

    expect(within(painel).getByText('Lidos da nota · confirmar').className).toContain('indent-tag--manual');
    const qtds = Array.from(painel.querySelectorAll('.indent-itemrow__qtd')).map((el) => el.textContent);
    expect(qtds).toEqual(['2.000 kg', '— kg']);
    expect(within(painel).getByRole('button', { name: 'Revisar e confirmar itens' }).className).toBe('ghost-button');
    expect(screen.getByText(/Os itens lidos da nota ainda não foram confirmados\. Use “Revisar e confirmar itens” antes de escolher fornecedores\./)).toBeTruthy();
    expect(container.querySelector('.indent-sup')).toBeNull();
    expect(chamadas('/api/v1/indent/requests/11/supplier-options')).toBe(0);
  });

  it('nota que nao deu itens: tag "Itens a digitar", botao "Digitar itens" e a nota original continua visivel', async () => {
    corpo = solicitacao({ items: [], rawNote: 'Cliente pediu cotacao urgente' });
    const { container } = renderPage();
    const painel = (await screen.findByRole('heading', { level: 2, name: 'Itens pedidos' })).closest('section') as HTMLElement;
    expect(within(painel).getByText('Itens a digitar').className).toContain('indent-tag--manual');
    expect(within(painel).getByRole('button', { name: 'Digitar itens' })).toBeTruthy();
    expect(container.querySelector('pre.indent-nota')?.textContent).toBe('Cliente pediu cotacao urgente');
    expect(screen.getByText(/Esta solicitação ainda não tem itens\. Use “Digitar itens” antes de escolher fornecedores\./)).toBeTruthy();
  });

  it('itens confirmados: tag "Itens confirmados", sem botao, seletor liberado', async () => {
    corpo = solicitacao();
    const { container } = renderPage();
    const painel = (await screen.findByRole('heading', { level: 2, name: 'Itens pedidos' })).closest('section') as HTMLElement;
    expect(within(painel).getByText('Itens confirmados').className).toContain('indent-tag--ok');
    expect(within(painel).queryByRole('button')).toBeNull();
    await waitFor(() => expect(chamadas('/api/v1/indent/requests/11/supplier-options')).toBe(1));
    await waitFor(() => expect(container.querySelector('.indent-gerar')).not.toBeNull());
  });

  it('alerta "a nota mudou": mesmo com itens confirmados o botao "Revisar e confirmar itens" aparece (so NOVA, so quem escreve, sem cotacao)', async () => {
    corpo = solicitacao({ noteChangedAt: '2026-11-13T12:00:00.000Z' });
    const { unmount } = renderPage();
    expect(await screen.findByRole('button', { name: 'Revisar e confirmar itens' })).toBeTruthy();
    unmount();

    corpo = solicitacao({ noteChangedAt: '2026-11-13T12:00:00.000Z', status: 'COTACAO', quotes: [{ id: 1, status: 'RASCUNHO', revision: 1, ref: '277/26', currency: 'USD', total: null, supplier: { id: 5, name: 'Fornecedor Exemplo' }, exception: null }] });
    const cotada = renderPage();
    await cotada.findByText('Fornecedor Exemplo');
    expect(screen.queryByRole('button', { name: 'Revisar e confirmar itens' })).toBeNull();
    cotada.unmount();

    mockRole = 'viewer';
    corpo = solicitacao({ noteChangedAt: '2026-11-13T12:00:00.000Z' });
    renderPage();
    await screen.findByText('A nota do negócio mudou no Pipedrive depois da confirmação dos itens.');
    expect(screen.queryByRole('button', { name: 'Revisar e confirmar itens' })).toBeNull();
  });

  it('viewer com itens pendentes: ve o aviso (sem o botao) e nao ve "Revisar e confirmar itens"', async () => {
    mockRole = 'viewer';
    corpo = solicitacao({ items: [item(21)] });
    renderPage();
    expect(await screen.findByText(/Quem cota precisa confirmá-los antes de escolher fornecedores\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisar e confirmar itens' })).toBeNull();
  });

  it('abre o modal "Revisar itens da nota", confirma (PUT note-items), mostra o toast e devolve o foco ao titulo dos itens', async () => {
    corpo = solicitacao({ items: [item(21)] });
    vi.mocked(api.put).mockImplementation((async () => {
      corpo = solicitacao();
      return corpo;
    }) as typeof api.put);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar e confirmar itens' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Revisar itens da nota' });
    expect(within(dialogo).getByText('Pipedrive · negócio #900111')).toBeTruthy();

    // o catalogo carrega antes de confirmar (senao o produto digitado nao e ligado ao catalogo)
    await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Confirmar itens' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar itens' }));
    // toast (role=status) "Itens confirmados"; a tag da tela com o mesmo texto aparece quando o detalhe e relido
    const avisos = await screen.findAllByText('Itens confirmados');
    expect(avisos.some((el) => el.closest('[role="status"]') !== null)).toBe(true);
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/requests/11/note-items', {
      items: [{ id: 21, productId: 9, description: 'RESINA EXEMPLO 223 (RXE)', quantityKg: 2000 }],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revisar e confirmar itens' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Itens pedidos' }));
  });

  it('Cancelar fecha sem enviar e devolve o foco ao botao que abriu', async () => {
    corpo = solicitacao({ items: [item(21)] });
    renderPage();
    const abrir = await screen.findByRole('button', { name: 'Revisar e confirmar itens' });
    abrir.focus();
    fireEvent.click(abrir);
    const dialogo = await screen.findByRole('dialog', { name: 'Revisar itens da nota' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.put).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(abrir);
  });

  it('os itens mudaram no servidor (400 "mudaram"): relê o detalhe, reabre o modal com a lista nova e avisa', async () => {
    corpo = solicitacao({ items: [item(21)] });
    vi.mocked(api.put).mockImplementation((async () => {
      // a sincronizacao trocou os itens da nota enquanto o modal estava aberto
      corpo = solicitacao({ items: [item(31, { name: 'SOLVENTE TESTE 99%', description: 'SOLVENTE TESTE 99%', quantityKg: 500, noteLine: 'SOLVENTE TESTE 99%  500' })] });
      throw new ApiError(400, { message: 'Os itens da solicitação mudaram. Recarregue e revise de novo.' });
    }) as typeof api.put);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar e confirmar itens' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Revisar itens da nota' });
    await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Confirmar itens' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar itens' }));

    await waitFor(() => expect(within(screen.getByRole('dialog')).getByDisplayValue('SOLVENTE TESTE 99%')).toBeTruthy());
    const novo = screen.getByRole('dialog', { name: 'Revisar itens da nota' });
    expect(within(novo).getByRole('alert').textContent).toBe('Os itens da solicitação mudaram. Recarregue e revise de novo.');
    expect(within(novo).queryByDisplayValue('RESINA EXEMPLO 223 (RXE)')).toBeNull();
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});
