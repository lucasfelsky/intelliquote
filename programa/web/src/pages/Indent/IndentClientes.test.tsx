import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IndentClientes from './IndentClientes';

let mockRole = 'comprador';
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

function cliente(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    cnpj: '11222333000181',
    city: 'Itajaí, SC',
    ownerName: 'Mariana Souza',
    pipedriveOrgId: 5521,
    supplierRuleMode: 'LIVRE',
    ruleReason: null,
    isActive: true,
    createdAt: '2026-11-12T12:00:00.000Z',
    updatedAt: '2026-11-12T12:00:00.000Z',
    supplierRules: [],
    ...extra,
  };
}

const CLIENTES = [
  cliente(1, 'Indústria Química Vale do Itajaí Ltda', {
    supplierRuleMode: 'APROVADOS',
    ruleReason: 'Auditoria de qualidade do cliente.',
    supplierRules: [
      { supplierId: 1, supplier: { name: 'Shandong Haohua Chemical Co.' } },
      { supplierId: 3, supplier: { name: 'Gujarat Alkalies Trading' } },
    ],
  }),
  cliente(2, 'Tintas Serra Gaúcha S.A.', { cnpj: '45997418000153', city: 'Caxias do Sul, RS', ownerName: null, pipedriveOrgId: null }),
  cliente(3, 'Detergentes Paraná Indústria Ltda', {
    supplierRuleMode: 'BLOQUEIO',
    ruleReason: 'Não aceita o fornecedor após reprovação de lote em 2025.',
    supplierRules: [{ supplierId: 2, supplier: { name: 'Zhejiang Tianyu Chemicals' } }],
  }),
];

const OPCOES = [
  { id: 1, name: 'Shandong Haohua Chemical Co.', country: 'China' },
  { id: 2, name: 'Zhejiang Tianyu Chemicals', country: 'China' },
  { id: 3, name: 'Gujarat Alkalies Trading', country: 'Índia' },
];

function mockApi(rows: unknown[] = CLIENTES) {
  vi.mocked(api.get).mockImplementation((async (url: string, params?: { semCnpj?: number }) => {
    if (url === '/api/v1/indent/clients') {
      const pendentes = rows.filter((row) => (row as { cnpj: string | null }).cnpj === null);
      const lista = params?.semCnpj ? pendentes : rows;
      return {
        data: lista,
        pagination: { page: 1, pageSize: 100, totalItems: lista.length, totalPages: 1 },
        counts: { todos: rows.length, semCnpj: pendentes.length },
      };
    }
    if (url === '/api/v1/indent/suppliers/options') return OPCOES;
    return [];
  }) as typeof api.get);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IndentClientes />
    </QueryClientProvider>,
  );
}

async function abrirRestricao(nome: string) {
  const celula = await screen.findByText(nome);
  fireEvent.click(celula.closest('tr') as HTMLElement);
  return screen.findByRole('dialog', { name: nome });
}

describe('IndentClientes', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset().mockResolvedValue({});
    vi.mocked(api.put).mockReset().mockResolvedValue({});
    mockRole = 'comprador';
  });

  it('textos do mock: titulo, subtitulo, acao, dica e cabecalhos', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Tintas Serra Gaúcha S.A.');

    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeTruthy();
    expect(container.querySelector('.eyebrow')?.textContent).toBe('Indent');
    expect(screen.getByText('Cadastro próprio. Cada cliente define de quais fornecedores aceita receber cotação.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo cliente' })).toBeTruthy();
    expect(screen.getByText('Clique em um cliente para editar a restrição.')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Cliente',
      'Restrição',
      'Fornecedores',
      'Responsável',
      'Pipedrive',
    ]);
  });

  it('linhas: CNPJ mascarado · cidade, badge de restricao, tags (1a palavra; verde em aprovados, vermelha em bloqueio), responsavel e Org #N', async () => {
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Tintas Serra Gaúcha S.A.');
    const [a, b, c] = Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];

    expect(within(a as HTMLElement).getByText('11.222.333/0001-81 · Itajaí, SC')).toBeTruthy();
    expect(within(a as HTMLElement).getByText('Só aprovados').className).toContain('badge--warning');
    expect(within(a as HTMLElement).getByText('Só aprovados').querySelector('svg')).not.toBeNull();
    const tagsA = Array.from((a as HTMLElement).querySelectorAll('.indent-tag-row .indent-tag'));
    expect(tagsA.map((t) => t.textContent)).toEqual(['Shandong', 'Gujarat']);
    for (const tag of tagsA) expect(tag.className).toContain('indent-tag--ok');
    expect(within(a as HTMLElement).getByText('Mariana Souza')).toBeTruthy();
    expect(within(a as HTMLElement).getByText('Org #5521').className).toContain('indent-tag--pd');

    expect(within(b as HTMLElement).getByText('Sem restrição').className).toContain('badge--muted');
    expect(within(b as HTMLElement).getByText('Sem restrição').querySelector('svg')).toBeNull();
    expect(within(b as HTMLElement).getByText('Qualquer fornecedor')).toBeTruthy();
    expect((b as HTMLElement).querySelectorAll('td')[3]?.textContent).toBe('—');
    expect((b as HTMLElement).querySelectorAll('td')[4]?.textContent).toBe('—');

    expect(within(c as HTMLElement).getByText('Bloqueios').className).toContain('badge--danger');
    const tagC = (c as HTMLElement).querySelector('.indent-tag-row .indent-tag');
    expect(tagC?.textContent).toBe('Zhejiang');
    expect(tagC?.className).toContain('indent-tag--lock');
  });

  it('modal de restricao: eyebrow, titulo, 3 cartoes com os textos do mock, lista, motivo e alerta', async () => {
    mockApi();
    const { container } = renderPage();
    const dialog = await abrirRestricao('Indústria Química Vale do Itajaí Ltda');

    expect(container.querySelector('.modal-eyebrow')?.textContent).toBe('Restrição de fornecedores');
    const grupo = within(dialog).getByRole('radiogroup', { name: 'Modo de restrição' });
    const radios = within(grupo).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(within(grupo).getByText('Sem restrição')).toBeTruthy();
    expect(within(grupo).getByText('Pode receber cotação de qualquer fornecedor.')).toBeTruthy();
    expect(within(grupo).getByText('Somente fornecedores aprovados')).toBeTruthy();
    expect(within(grupo).getByText('Só os fornecedores da lista abaixo aparecem para este cliente.')).toBeTruthy();
    expect(within(grupo).getByText('Todos, exceto bloqueados')).toBeTruthy();
    expect(within(grupo).getByText('Qualquer fornecedor, menos os da lista abaixo.')).toBeTruthy();
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(radios[1]); // foco inicial no modo marcado (mock)
    expect(radios[1]?.closest('label')?.classList.contains('is-selected')).toBe(true);
    expect(radios[0]?.closest('label')?.classList.contains('is-selected')).toBe(false);
    expect(radios[1]?.closest('label')?.hasAttribute('aria-checked')).toBe(false);

    expect(within(dialog).getByText('Fornecedores aprovados')).toBeTruthy();
    await within(dialog).findByText('Zhejiang Tianyu Chemicals');
    expect((within(dialog).getByRole('checkbox', { name: /Shandong Haohua/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole('checkbox', { name: /Zhejiang Tianyu/ }) as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByText('Índia')).toBeTruthy();
    const motivo = within(dialog).getByLabelText('Motivo da restrição') as HTMLTextAreaElement;
    expect(motivo.placeholder).toBe('Por que este cliente restringe fornecedores?');
    expect(motivo.value).toBe('Auditoria de qualidade do cliente.');
    expect(within(dialog).getByText('Aparece para quem montar a cotação.')).toBeTruthy();
    expect(within(dialog).getByText('A regra vale para solicitações do Pipedrive e do IQ Indent.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Salvar restrição' })).toBeTruthy();
  });

  it('trocar de modo PRESERVA o motivo digitado; no modo LIVRE some a lista e o motivo', async () => {
    mockApi();
    renderPage();
    const dialog = await abrirRestricao('Tintas Serra Gaúcha S.A.');
    expect(within(dialog).queryByLabelText('Motivo da restrição')).toBeNull();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Somente fornecedores aprovados/ }));
    const motivo = within(dialog).getByLabelText('Motivo da restrição') as HTMLTextAreaElement;
    fireEvent.change(motivo, { target: { value: 'Contrato-quadro com fornecedor único.' } });

    fireEvent.click(within(dialog).getByRole('radio', { name: /Todos, exceto bloqueados/ }));
    expect(within(dialog).getByText('Fornecedores bloqueados')).toBeTruthy();
    expect((within(dialog).getByLabelText('Motivo da restrição') as HTMLTextAreaElement).value).toBe('Contrato-quadro com fornecedor único.');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Sem restrição/ }));
    expect(within(dialog).queryByLabelText('Motivo da restrição')).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Somente fornecedores aprovados/ }));
    expect((within(dialog).getByLabelText('Motivo da restrição') as HTMLTextAreaElement).value).toBe('Contrato-quadro com fornecedor único.');
  });

  it('lista vazia e motivo vazio bloqueiam com erro inline (nada e enviado)', async () => {
    mockApi();
    renderPage();
    const dialog = await abrirRestricao('Tintas Serra Gaúcha S.A.');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Somente fornecedores aprovados/ }));
    await within(dialog).findByText('Gujarat Alkalies Trading');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar restrição' }));

    const alertas = within(dialog).getAllByRole('alert').map((a) => a.textContent);
    expect(alertas).toEqual(['Escolha ao menos um fornecedor na lista', 'Informe o motivo da restrição.']);
    expect(api.put).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Gujarat Alkalies/ }));
    fireEvent.change(within(dialog).getByLabelText('Motivo da restrição'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar restrição' }));
    expect(within(dialog).getAllByRole('alert').map((a) => a.textContent)).toEqual(['Informe o motivo da restrição.']);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('salvar envia modo, fornecedores e motivo e confirma com "Restrição de <3 primeiras palavras> atualizada"', async () => {
    mockApi();
    renderPage();
    const dialog = await abrirRestricao('Indústria Química Vale do Itajaí Ltda');
    await within(dialog).findByText('Zhejiang Tianyu Chemicals');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Todos, exceto bloqueados/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Zhejiang Tianyu/ }));
    fireEvent.change(within(dialog).getByLabelText('Motivo da restrição'), { target: { value: ' Reprovação de lote ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar restrição' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/v1/indent/clients/1/supplier-rule', {
      mode: 'BLOQUEIO',
      supplierIds: [1, 3, 2],
      reason: 'Reprovação de lote',
    });
    expect((await screen.findByTestId('fc-toast')).textContent).toContain('Restrição de Indústria Química Vale atualizada');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('salvar em "Sem restrição" envia LIVRE com lista vazia (sem motivo)', async () => {
    mockApi();
    renderPage();
    const dialog = await abrirRestricao('Detergentes Paraná Indústria Ltda');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Sem restrição/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar restrição' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/v1/indent/clients/3/supplier-rule', { mode: 'LIVRE', supplierIds: [] }));
  });

  it('fornecedor INATIVO ja marcado na regra continua na lista (marcado) mesmo fora dos options', async () => {
    mockApi([
      cliente(4, 'Cliente Teste', {
        supplierRuleMode: 'BLOQUEIO',
        ruleReason: 'x',
        supplierRules: [{ supplierId: 99, supplier: { name: 'Fornecedor Inativo SA' } }],
      }),
    ]);
    renderPage();
    const dialog = await abrirRestricao('Cliente Teste');
    const caixa = await within(dialog).findByRole('checkbox', { name: /Fornecedor Inativo SA/ });
    expect((caixa as HTMLInputElement).checked).toBe(true);
  });

  it('erro do servidor na restricao aparece no modal', async () => {
    mockApi();
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, { message: 'Fornecedor inexistente na lista.' }));
    renderPage();
    const dialog = await abrirRestricao('Detergentes Paraná Indústria Ltda');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar restrição' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Fornecedor inexistente na lista.');
  });

  it('Novo cliente: Razao social, CNPJ (mascara ao digitar) e Cidade; CNPJ invalido bloqueia; valido envia so digitos e confirma por toast', async () => {
    mockApi();
    vi.mocked(api.post).mockResolvedValue(cliente(9, 'Resinas Boreal Ltda'));
    renderPage();
    await screen.findByText('Tintas Serra Gaúcha S.A.');
    fireEvent.click(screen.getByRole('button', { name: 'Novo cliente' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo cliente' });
    for (const rotulo of ['Razão social', 'CNPJ', 'Cidade']) expect(within(dialog).getByLabelText(rotulo), rotulo).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Razão social'));

    const cnpj = within(dialog).getByLabelText('CNPJ') as HTMLInputElement;
    fireEvent.change(cnpj, { target: { value: '11222333000182' } });
    expect(cnpj.value).toBe('11.222.333/0001-82');
    fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: 'Resinas Boreal Ltda' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('CNPJ inválido.');
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(cnpj, { target: { value: '11.222.333/0001-81' } });
    fireEvent.change(within(dialog).getByLabelText('Cidade'), { target: { value: 'Joinville, SC' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/indent/clients', {
        name: 'Resinas Boreal Ltda',
        cnpj: '11222333000181',
        city: 'Joinville, SC',
      }),
    );
    expect((await screen.findByTestId('fc-toast')).textContent).toContain('Cliente Resinas Boreal Ltda cadastrado');
  });

  it('Novo cliente: razao social vazia -> "Informe a razão social."; CNPJ repetido (409) aparece no modal', async () => {
    mockApi();
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Já existe um cliente com este CNPJ.' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo cliente' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo cliente' });
    fireEvent.change(within(dialog).getByLabelText('CNPJ'), { target: { value: '11222333000181' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Informe a razão social.');

    fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: 'Duplicado' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    expect((await within(dialog).findByText('Já existe um cliente com este CNPJ.')).getAttribute('role')).toBe('alert');
  });

  it('viewer: sem Novo cliente, sem a dica e linhas nao clicaveis', async () => {
    mockRole = 'viewer';
    mockApi();
    const { container } = renderPage();
    await screen.findByText('Tintas Serra Gaúcha S.A.');
    expect(screen.queryByRole('button', { name: 'Novo cliente' })).toBeNull();
    expect(screen.queryByText('Clique em um cliente para editar a restrição.')).toBeNull();
    const linha = container.querySelector('tbody tr') as HTMLElement;
    expect(linha.hasAttribute('tabindex')).toBe(false);
    fireEvent.click(linha);
    fireEvent.keyDown(linha, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('linha abre o modal tambem com Enter', async () => {
    mockApi();
    renderPage();
    const celula = await screen.findByText('Tintas Serra Gaúcha S.A.');
    fireEvent.keyDown(celula.closest('tr') as HTMLElement, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Tintas Serra Gaúcha S.A.' })).toBeTruthy();
  });

  it('restoreFocus: fechar o modal de restricao (aberto pela linha) e o de Novo cliente devolve o foco a quem abriu', async () => {
    mockApi();
    renderPage();
    const celula = await screen.findByText('Indústria Química Vale do Itajaí Ltda');
    const linha = celula.closest('tr') as HTMLElement;
    linha.focus();
    fireEvent.click(linha);
    const restricao = await screen.findByRole('dialog', { name: 'Indústria Química Vale do Itajaí Ltda' });
    fireEvent.click(within(restricao).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(linha);

    const novo = screen.getByRole('button', { name: 'Novo cliente' });
    novo.focus();
    fireEvent.click(novo);
    const dialog = await screen.findByRole('dialog', { name: 'Novo cliente' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(novo);
  });

  describe('CNPJ pendente (H0)', () => {
    const PENDENTE = cliente(7, 'Cliente Sem Cnpj Ltda', { cnpj: null, city: 'Joinville, SC', pipedriveOrgId: null });
    const COM_PENDENTE = [...CLIENTES, PENDENTE];

    it('linha sem CNPJ mostra a etiqueta "CNPJ pendente" (indent-tag--manual) e a cidade; com CNPJ continua mascarado', async () => {
      mockApi(COM_PENDENTE);
      const { container } = renderPage();
      await screen.findByText('Cliente Sem Cnpj Ltda');
      const linhas = Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];
      const pendente = linhas[3] as HTMLElement;

      const etiqueta = within(pendente).getByText('CNPJ pendente');
      expect(etiqueta.className).toContain('indent-tag--manual');
      expect(etiqueta.parentElement?.className).toContain('indent-cell-sub');
      expect(etiqueta.parentElement?.textContent).toContain('· Joinville, SC');
      expect(within(linhas[0] as HTMLElement).queryByText('CNPJ pendente')).toBeNull();
      expect(within(linhas[0] as HTMLElement).getByText('11.222.333/0001-81 · Itajaí, SC')).toBeTruthy();
    });

    it('chips "Todos" / "Sem CNPJ" com contagem e aria-pressed; "Sem CNPJ" filtra no servidor e mostra o aviso do Pipedrive', async () => {
      mockApi(COM_PENDENTE);
      const { container } = renderPage();
      await screen.findByText('Cliente Sem Cnpj Ltda');

      const grupo = screen.getByRole('group', { name: 'Filtrar por CNPJ' });
      const todos = within(grupo).getByRole('button', { name: /^Todos/ });
      const sem = within(grupo).getByRole('button', { name: /^Sem CNPJ/ });
      expect(todos.textContent).toBe('Todos 4');
      expect(sem.textContent).toBe('Sem CNPJ 1');
      expect(todos.getAttribute('aria-pressed')).toBe('true');
      expect(sem.getAttribute('aria-pressed')).toBe('false');
      expect(container.querySelector('.indent-chip-conta')).not.toBeNull();
      expect(screen.queryByText(/não casam automaticamente com o Pipedrive/)).toBeNull();

      fireEvent.click(sem);
      await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(1));
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/indent/clients', expect.objectContaining({ semCnpj: 1 }));
      expect(sem.getAttribute('aria-pressed')).toBe('true');
      expect(todos.getAttribute('aria-pressed')).toBe('false');
      const aviso = screen.getByText(
        'Clientes sem CNPJ não casam automaticamente com o Pipedrive. Preencha o CNPJ ou informe a organização do Pipedrive (Org #).',
      );
      expect(aviso.className).toContain('alert--info');

      fireEvent.click(todos);
      await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
      expect(screen.queryByText(/não casam automaticamente com o Pipedrive/)).toBeNull();
    });

    it('Novo cliente sem CNPJ: dica "Opcional...", nao bloqueia e envia cnpj null', async () => {
      mockApi();
      vi.mocked(api.post).mockResolvedValue(cliente(9, 'Resinas Boreal Ltda', { cnpj: null }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Novo cliente' }));
      const dialog = await screen.findByRole('dialog', { name: 'Novo cliente' });
      expect(within(dialog).getByText('Opcional. Sem CNPJ o cliente fica como CNPJ pendente.')).toBeTruthy();
      expect(within(dialog).queryByLabelText('Org # do Pipedrive')).toBeNull();

      fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: 'Resinas Boreal Ltda' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith('/api/v1/indent/clients', { name: 'Resinas Boreal Ltda', cnpj: null, city: null }),
      );
      expect((await screen.findByTestId('fc-toast')).textContent).toContain('Cliente Resinas Boreal Ltda cadastrado');
    });

    it('Novo cliente: CNPJ preenchido e invalido continua bloqueando; nome repetido sem CNPJ (409) aparece no modal', async () => {
      mockApi();
      vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Já existe um cliente sem CNPJ com este nome.' }));
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Novo cliente' }));
      const dialog = await screen.findByRole('dialog', { name: 'Novo cliente' });
      fireEvent.change(within(dialog).getByLabelText('Razão social'), { target: { value: 'Repetido' } });
      fireEvent.change(within(dialog).getByLabelText('CNPJ'), { target: { value: '123' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect(within(dialog).getByRole('alert').textContent).toBe('CNPJ inválido.');
      expect(api.post).not.toHaveBeenCalled();

      fireEvent.change(within(dialog).getByLabelText('CNPJ'), { target: { value: '' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect((await within(dialog).findByText('Já existe um cliente sem CNPJ com este nome.')).getAttribute('role')).toBe('alert');
    });

    it('"Completar CNPJ" abre o modal em edicao (nao a restricao), com os dados atuais, e faz PUT com so digitos, cidade e Org #', async () => {
      mockApi(COM_PENDENTE);
      vi.mocked(api.put).mockResolvedValue({ ...PENDENTE, cnpj: '11222333000181' });
      renderPage();
      const celula = await screen.findByText('Cliente Sem Cnpj Ltda');
      fireEvent.click(within(celula.closest('tr') as HTMLElement).getByRole('button', { name: 'Completar CNPJ' }));

      const dialog = await screen.findByRole('dialog', { name: 'Editar cliente' });
      expect(screen.queryByText('Restrição de fornecedores')).toBeNull();
      expect((within(dialog).getByLabelText('Razão social') as HTMLInputElement).value).toBe('Cliente Sem Cnpj Ltda');
      expect((within(dialog).getByLabelText('CNPJ') as HTMLInputElement).value).toBe('');
      expect((within(dialog).getByLabelText('Cidade') as HTMLInputElement).value).toBe('Joinville, SC');
      expect((within(dialog).getByLabelText('Org # do Pipedrive') as HTMLInputElement).value).toBe('');
      expect(document.activeElement).toBe(within(dialog).getByLabelText('Razão social'));

      fireEvent.change(within(dialog).getByLabelText('CNPJ'), { target: { value: '11222333000182' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect(within(dialog).getByRole('alert').textContent).toBe('CNPJ inválido.');

      fireEvent.change(within(dialog).getByLabelText('CNPJ'), { target: { value: '11.222.333/0001-81' } });
      fireEvent.change(within(dialog).getByLabelText('Org # do Pipedrive'), { target: { value: '12x' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect(within(dialog).getByRole('alert').textContent).toBe('Informe um número inteiro positivo.');
      expect(api.put).not.toHaveBeenCalled();

      fireEvent.change(within(dialog).getByLabelText('Org # do Pipedrive'), { target: { value: '5521' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
      expect(api.put).toHaveBeenCalledWith('/api/v1/indent/clients/7', {
        name: 'Cliente Sem Cnpj Ltda',
        cnpj: '11222333000181',
        city: 'Joinville, SC',
        pipedriveOrgId: 5521,
      });
      expect((await screen.findByTestId('fc-toast')).textContent).toContain('Cliente Cliente Sem Cnpj Ltda atualizado');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('edicao so com Org #: CNPJ em branco nao envia a chave cnpj (continua pendente); 409 do servidor aparece no modal', async () => {
      mockApi(COM_PENDENTE);
      vi.mocked(api.put).mockRejectedValueOnce(new ApiError(409, { message: 'Organização do Pipedrive já vinculada a outro cliente.' }));
      renderPage();
      const celula = await screen.findByText('Cliente Sem Cnpj Ltda');
      fireEvent.click(within(celula.closest('tr') as HTMLElement).getByRole('button', { name: 'Completar CNPJ' }));
      const dialog = await screen.findByRole('dialog', { name: 'Editar cliente' });

      fireEvent.change(within(dialog).getByLabelText('Org # do Pipedrive'), { target: { value: '77' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
      expect((await within(dialog).findByText('Organização do Pipedrive já vinculada a outro cliente.')).getAttribute('role')).toBe('alert');
      expect(api.put).toHaveBeenCalledWith('/api/v1/indent/clients/7', {
        name: 'Cliente Sem Cnpj Ltda',
        city: 'Joinville, SC',
        pipedriveOrgId: 77,
      });
    });

    it('Completar CNPJ nao abre a restricao (clique e Enter no botao ficam no botao); a linha continua abrindo a restricao', async () => {
      mockApi(COM_PENDENTE);
      renderPage();
      const celula = await screen.findByText('Cliente Sem Cnpj Ltda');
      const linha = celula.closest('tr') as HTMLElement;

      fireEvent.keyDown(within(linha).getByRole('button', { name: 'Completar CNPJ' }), { key: 'Enter' });
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(linha);
      expect(await screen.findByRole('dialog', { name: 'Cliente Sem Cnpj Ltda' })).toBeTruthy();
    });

    it('viewer ve a etiqueta mas nao o botao "Completar CNPJ"', async () => {
      mockRole = 'viewer';
      mockApi(COM_PENDENTE);
      renderPage();
      await screen.findByText('Cliente Sem Cnpj Ltda');
      expect(screen.getByText('CNPJ pendente')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Completar CNPJ' })).toBeNull();
    });

    it('lista vazia com o chip "Sem CNPJ" diz "Nenhum cliente sem CNPJ."', async () => {
      mockApi();
      renderPage();
      await screen.findByText('Tintas Serra Gaúcha S.A.');
      fireEvent.click(screen.getByRole('button', { name: /^Sem CNPJ/ }));
      expect(await screen.findByText('Nenhum cliente sem CNPJ.')).toBeTruthy();
    });
  });
});
