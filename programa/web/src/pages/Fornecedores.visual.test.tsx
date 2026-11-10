import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Fornecedores from './Fornecedores';

// F10 (Suite COMEX): Fornecedores (lista, TAG, linha expandida, contatos, Documentos, modais e importacao) so com classes e Icon. Mocks no padrao do
// Fornecedores.test.tsx; aqui so a marcacao e as classes que o CSS da regiao `tela F10` consome (as regras ficam no telaF10.test.ts).

vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: 'comprador' } }),
}));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/services/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dispatch')>()),
  listSupplierContacts: vi.fn(),
  createSupplierContact: vi.fn(),
  updateSupplierContact: vi.fn(),
  deleteSupplierContact: vi.fn(),
}));

import { api } from '@/api/client';
import { listSupplierContacts } from '@/services/dispatch';

const families = [
  { id: 1, name: 'Silano', isActive: true },
  { id: 2, name: 'Resina', isActive: true },
];

const suppliers = [
  {
    id: 10,
    name: 'ACME Ltda',
    website: null,
    status: 'active',
    country: 'China',
    notes: null,
    acceptedIncoterms: ['FOB', 'CIF'],
    paymentTermsDays: 30,
    tags: ['confiável', 'DG ok'],
    reviewStats: { count: 5, avgPrice: 4, avgLeadTime: 4, avgQuality: 4, avgRating: 4.6 },
    families: [{ id: 1, name: 'Silano' }],
  },
  {
    id: 11,
    name: 'Beta Química',
    website: null,
    status: 'inactive',
    country: 'Brasil',
    notes: null,
    acceptedIncoterms: [],
    paymentTermsDays: 30,
    tags: [],
    reviewStats: null,
    families: [],
  },
];

const contacts = [
  {
    id: 5,
    supplierId: 10,
    name: 'Contato Um',
    email: 'c1@acme.com',
    phone: '+86 571 0000 0000',
    position: 'Vendas',
    isPrimary: true,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 6,
    supplierId: 10,
    name: 'Contato Dois',
    email: 'c2@acme.com',
    phone: null,
    position: null,
    isPrimary: false,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
  },
];

const doc = (id: number, name: string, status: 'ok' | 'expiring' | 'due_today' | 'expired', daysLeft: number, expiresOn: string) => ({
  id,
  supplierId: 10,
  name,
  expiresOn,
  notes: id === 1 ? 'Renovação em andamento' : null,
  fileName: `${name}.pdf`,
  mimeType: 'application/pdf',
  fileSize: 2048,
  daysLeft,
  status,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
});

const documents = [
  doc(1, 'Certificado ISO', 'expiring', 12, '2026-11-01'),
  doc(2, 'Licença', 'due_today', 0, '2026-10-20'),
  doc(3, 'Ficha SDS', 'ok', 200, '2027-03-15'),
  doc(4, 'Certificado Halal', 'expired', -3, '2026-09-30'),
];

function mockApi({ withSummary = true, docs = documents }: { withSummary?: boolean; docs?: unknown[] } = {}) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/api/v1/suppliers') return Promise.resolve(suppliers);
    if (url === '/api/v1/supplier-contacts') return Promise.resolve({ bySupplier: { 10: contacts } });
    if (url === '/api/v1/item-families') return Promise.resolve({ data: families });
    if (url === '/api/v1/supplier-documents/summary') {
      return Promise.resolve(withSummary ? { bySupplier: { 10: { expired: 1, expiring: 1, nextDaysLeft: 12 } } } : { bySupplier: {} });
    }
    if (url === '/api/v1/supplier-documents') return Promise.resolve(docs);
    return Promise.resolve([]);
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Fornecedores />
    </QueryClientProvider>,
  );
}

const iconePath = (el: Element | null) => el?.querySelector('svg path')?.getAttribute('d');
const ICONE_PLUS = 'M12 5v14M5 12h14';
const ICONE_MINUS = 'M5 12h14';

async function expandir(utils: ReturnType<typeof renderPage>) {
  await utils.findByText('ACME Ltda');
  await waitFor(() => expect((utils.getAllByLabelText('Mostrar contatos')[0] as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(utils.getAllByLabelText('Mostrar contatos')[0] as HTMLElement);
  await utils.findByText('Contato Um');
  await utils.findByText('Certificado ISO');
}

describe('Fornecedores (visual, F10)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(listSupplierContacts).mockReset();
    vi.mocked(listSupplierContacts).mockResolvedValue(contacts);
    window.history.pushState({}, '', '/');
    mockApi();
  });

  it('raiz .fornecedores-page com cabecalho da base; "Novo fornecedor" e "Importar planilha" com icone aria-hidden e sem "+" no nome', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.classList.contains('page')).toBe(true);
    expect(raiz.classList.contains('fornecedores-page')).toBe(true);
    expect(raiz.querySelector(':scope > header.page-header .eyebrow')?.textContent).toBe('Cadastros');
    expect(raiz.querySelector(':scope > header.page-header .page-subtitle')?.textContent).toBe('Gerencie a base de fornecedores, Incoterms aceitos e status.');

    const novo = getByRole('button', { name: 'Novo fornecedor' });
    expect(novo.className).toContain('primary-button');
    expect(novo.textContent).toBe('Novo fornecedor');
    expect(novo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const importar = getByRole('button', { name: 'Importar planilha' });
    expect(importar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    const busca = container.querySelector('.fornecedores-busca') as HTMLElement;
    expect(busca.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(busca.querySelector('input.fornecedores-busca__campo')?.getAttribute('placeholder')).toBe('Buscar por nome ou país');
    expect(container.querySelector('section.card.fornecedores-lista')?.getAttribute('aria-label')).toBe('Lista de fornecedores');
  });

  it('filtro por etiqueta: role=group, chips com aria-pressed e o filtro continua funcionando', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    const grupo = getByRole('group', { name: 'Filtrar por etiqueta' });
    const chips = within(grupo).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Todas', 'confiável', 'DG ok']);
    expect(chips.every((c) => c.classList.contains('chip'))).toBe(true);
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(chips[0]?.className).toContain('chip--active');
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(chips[2] as HTMLElement);
    expect((within(grupo).getByText('DG ok') as HTMLElement).getAttribute('aria-pressed')).toBe('true');
    expect(within(grupo).getByText('Todas').getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).not.toContain('Beta Química');
  });

  it('TAG da linha: span.fornecedores-tag SEM a classe chip, com o texto da etiqueta (D-F10-01)', async () => {
    const { container, findByText } = renderPage();
    await findByText('ACME Ltda');
    const tags = Array.from(container.querySelectorAll('.fornecedores-tabela .fornecedores-tags .fornecedores-tag'));
    expect(tags.map((t) => t.textContent)).toEqual(['confiável', 'DG ok']);
    for (const tag of tags) {
      expect(tag.tagName).toBe('SPAN');
      expect(tag.classList.contains('chip')).toBe(false);
    }
    expect(container.querySelector('.fornecedores-tabela .chip')).toBeNull();
  });

  it('expandir: aria-expanded e icone plus/minus; selo de documento com icone; avaliacao com estrelas e "(n)"; status com ponto', async () => {
    const utils = renderPage();
    const { container, findByText } = utils;
    await findByText('ACME Ltda');
    const botao = container.querySelector('#supplier-row-10 .fornecedores-expandir__botao') as HTMLButtonElement;
    await waitFor(() => expect(botao.disabled).toBe(false));
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(iconePath(botao)).toBe(ICONE_PLUS);

    const selo = container.querySelector('.fornecedores-doc') as HTMLElement;
    expect(selo.className).toContain('badge--danger');
    expect(selo.textContent).toBe('Doc. vencido');
    expect(selo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    const linha = container.querySelector('#supplier-row-10') as HTMLElement;
    expect(linha.querySelector('.fornecedores-avaliacao [role="img"]')).not.toBeNull();
    expect(linha.querySelector('.fornecedores-avaliacao__n')?.textContent).toBe('(5)');
    expect(linha.querySelector('.col-status .badge.badge--dot')?.textContent).toBe('Ativo');
    expect(container.querySelector('#supplier-row-11 .col-status .badge')?.className).toContain('badge--muted');
    expect(container.querySelector('#supplier-row-11 .fornecedores-sem-dado')?.textContent).toBe('—');

    fireEvent.click(botao);
    await waitFor(() => expect(botao.getAttribute('aria-expanded')).toBe('true'));
    expect(iconePath(botao)).toBe(ICONE_MINUS);
    expect(linha.classList.contains('fornecedores-linha--aberta')).toBe(true);
    await utils.findByText('Contato Um');
  });

  it('linha expandida: Contatos com "Adicionar contato" (icone), contact-row, "Principal" e acoes; sem contatos mostra o texto de hoje', async () => {
    const utils = renderPage();
    await expandir(utils);
    const { container, getByRole } = utils;

    const celula = container.querySelector('td.fornecedores-expandida') as HTMLElement;
    expect(celula.getAttribute('colspan')).toBe('8');
    expect(celula.querySelector('.fornecedores-expandida__grade')).not.toBeNull();
    const secao = celula.querySelector('.fornecedores-secao') as HTMLElement;
    expect(secao.querySelector('.fornecedores-secao__cabecalho > h3')?.textContent).toBe('Contatos');
    const adicionar = within(secao).getByRole('button', { name: 'Adicionar contato' });
    expect(adicionar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(adicionar.textContent).toBe('Adicionar contato');

    const linhas = Array.from(secao.querySelectorAll('.contact-list > .contact-row'));
    expect(linhas).toHaveLength(2);
    const principal = linhas[0] as HTMLElement;
    expect(principal.querySelector('.contact-row__name')?.textContent).toBe('Contato UmPrincipal');
    const selo = within(principal).getByText('Principal');
    expect(selo.className).toContain('badge--success');
    expect((principal.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(principal.querySelector('.contact-row__meta')?.textContent).toBe('c1@acme.com · +86 571 0000 0000 · Vendas');
    expect(principal.querySelector('.contact-row__data')?.textContent).toBe('02/10/2026');
    expect(Array.from(principal.querySelectorAll('.contact-row__actions button')).map((b) => b.textContent)).toEqual(['Editar', 'Remover']);
    expect(getByRole('button', { name: 'Ocultar contatos' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('linha expandida sem contatos: texto "Nenhum contato cadastrado…" e a secao Documentos no mesmo grid', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/v1/suppliers') return Promise.resolve(suppliers);
      if (url === '/api/v1/supplier-contacts') return Promise.resolve({ bySupplier: {} });
      if (url === '/api/v1/item-families') return Promise.resolve({ data: families });
      if (url === '/api/v1/supplier-documents') return Promise.resolve([]);
      return Promise.resolve({ bySupplier: {} });
    });
    vi.mocked(listSupplierContacts).mockResolvedValue([]);
    const { container, findByText, getAllByLabelText } = renderPage();
    await findByText('ACME Ltda');
    await waitFor(() => expect((getAllByLabelText('Mostrar contatos')[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getAllByLabelText('Mostrar contatos')[0] as HTMLElement);
    await findByText(/Nenhum contato cadastrado/);
    await findByText('Nenhum documento cadastrado.');
    const grade = container.querySelector('.fornecedores-expandida__grade') as HTMLElement;
    expect(grade.querySelector('.fornecedores-secao__vazio')).not.toBeNull();
    expect(grade.querySelector('.documentos-secao .documentos-vazio')).not.toBeNull();
    expect(grade.querySelector('.contact-list')).toBeNull();
  });

  it('Documentos: .page-header.documentos-cabecalho com "Novo documento" (icone), % dos th 23/11/15/14/14/23 e situacao com os 4 tons', async () => {
    const utils = renderPage();
    await expandir(utils);
    const { container, getByText } = utils;

    const cabecalho = getByText('Documentos').closest('.page-header') as HTMLElement;
    expect(cabecalho.classList.contains('documentos-cabecalho')).toBe(true);
    const novo = within(cabecalho).getByRole('button', { name: 'Novo documento' });
    expect(novo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(cabecalho.parentElement?.classList.contains('documentos-secao')).toBe(true);

    const tabela = container.querySelector('.documentos-tabela table') as HTMLTableElement;
    expect(tabela.style.tableLayout).toBe('fixed');
    expect(Array.from(tabela.querySelectorAll('th')).map((th) => th.style.width)).toEqual(['23%', '11%', '15%', '14%', '14%', '23%']);

    const situacoes = Array.from(container.querySelectorAll('.documentos-tabela .documentos-situacao'));
    expect(situacoes.map((s) => s.textContent)).toEqual(['Vence em 12 dias', 'Vence hoje', 'Em dia', 'Vencido']);
    expect(situacoes.map((s) => (s.className.match(/badge--(warning|danger)/) ?? ['ok'])[0])).toEqual([
      'badge--warning',
      'badge--danger',
      'ok',
      'badge--danger',
    ]);
    expect(situacoes[2]?.className).not.toContain('badge--');
    expect(container.querySelector('.documentos-tabela td.documentos-vencimento')?.textContent).toBe('01/11/2026');
    expect(container.querySelector('.documentos-tabela .documentos-tamanho')?.textContent).toBe('2,0 KB');
    expect(container.querySelector('.documentos-tabela td.documentos-arquivo-celula')?.textContent).toBe('Certificado ISO.pdf · 2,0 KB');
    const acoes = Array.from(container.querySelectorAll('.documentos-tabela tbody tr:first-child .documentos-acoes button')).map((b) => b.textContent);
    expect(acoes).toEqual(['Baixar', 'Editar', 'Substituir', 'Excluir']);
  });

  it('modal Novo documento: Fornecedor, Nome *, Vencimento nativo, Arquivo * com botao "Escolher arquivo" e icone, dicas e sem estilo inline', async () => {
    const utils = renderPage();
    await expandir(utils);
    const { container } = utils;
    fireEvent.click(within(container.querySelector('.documentos-cabecalho') as HTMLElement).getByRole('button', { name: 'Novo documento' }));
    const form = (await waitFor(() => {
      const f = container.querySelector('form.documentos-form');
      expect(f).not.toBeNull();
      return f;
    })) as HTMLFormElement;
    expect(form.querySelector('.documentos-form__fornecedor')?.textContent).toBe('Fornecedor: ACME Ltda');
    expect((form.querySelector('#sd-expires') as HTMLInputElement).type).toBe('date');
    expect(form.querySelector('label[for="sd-name"]')?.textContent).toBe('Nome do documento *');
    const rotulos = Array.from(form.querySelectorAll('label[for="sd-file"]'));
    expect(rotulos[0]?.textContent).toBe('Arquivo *');
    const botao = form.querySelector('label.documentos-arquivo__botao') as HTMLElement;
    expect(botao.textContent).toBe('Escolher arquivo');
    expect(botao.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(form.querySelector('.documentos-arquivo__nome')?.textContent).toBe('Nenhum arquivo escolhido');
    expect(form.querySelector('.documentos-arquivo__nome--vazio')).not.toBeNull();
    expect(Array.from(form.querySelectorAll('.documentos-dica')).map((p) => p.textContent)).toEqual(['Último dia de validade. Deixe em branco se não vence.', 'PDF, PNG ou JPEG, até 10 MB.']);
    expect(form.querySelectorAll('[style]')).toHaveLength(0);

    const arquivo = new File(['%PDF-1.7 conteudo'], 'Novo.pdf', { type: 'application/pdf' });
    fireEvent.change(form.querySelector('#sd-file') as HTMLInputElement, { target: { files: [arquivo] } });
    await waitFor(() => expect(form.querySelector('.documentos-arquivo__nome')?.textContent).toBe('Novo.pdf'));
    expect(form.querySelector('.documentos-arquivo__nome--vazio')).toBeNull();
  });

  it('modal Fornecedor: etiqueta sem " ✕" no nome e com icone x aria-hidden; chips de Incoterms e familias com aria-pressed e check', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(container.querySelector('#supplier-row-10 .row-actions .ghost-button') as HTMLElement);
    const form = container.querySelector('form.fornecedor-form #name')?.closest('form') as HTMLFormElement;
    expect(form).not.toBeNull();
    const etiquetas = Array.from(form.querySelectorAll('button.fornecedor-etiqueta'));
    expect(etiquetas.map((e) => e.textContent)).toEqual(['confiável', 'DG ok']);
    for (const e of etiquetas) {
      expect(e.className).toContain('chip chip--active');
      expect(e.getAttribute('title')).toBe('Remover etiqueta');
      expect(e.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(e.textContent).not.toContain('✕');
    }
    expect(within(form).getByRole('button', { name: 'confiável' })).toBe(etiquetas[0]);

    expect(within(form).getByRole('group', { name: 'Incoterms aceitos' }).querySelectorAll('button')).toHaveLength(11);
    expect(within(form).getByRole('group', { name: 'Famílias que este fornecedor cota' }).querySelectorAll('button')).toHaveLength(2);
    const fob = within(form).getByRole('button', { name: 'FOB' });
    expect(fob.getAttribute('aria-pressed')).toBe('true');
    expect(fob.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(form).getByRole('button', { name: 'EXW' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(form).getByText('Silano').getAttribute('aria-pressed')).toBe('true');
    expect(within(form).getByText('Resina').getAttribute('aria-pressed')).toBe('false');
    expect(form.querySelectorAll('[style]')).toHaveLength(0);
    expect(form.querySelector('#paymentTermsDays')?.className).toContain('fornecedor-form__numero');
    expect(getByRole('button', { name: 'Salvar alterações' })).toBeTruthy();
  });

  it('modal Contato: Fornecedor, Nome *, E-mail *, Telefone, Cargo, "Marcar como contato principal" e sem estilo inline', async () => {
    const utils = renderPage();
    await expandir(utils);
    const { container } = utils;
    fireEvent.click(within(container.querySelector('.fornecedores-secao__cabecalho') as HTMLElement).getByRole('button', { name: 'Adicionar contato' }));
    const form = (await waitFor(() => {
      const f = container.querySelector('#contactName')?.closest('form');
      expect(f).not.toBeNull();
      return f;
    })) as HTMLFormElement;
    expect(form.querySelector('.fornecedor-form__fornecedor')?.textContent).toBe('Fornecedor: ACME Ltda');
    expect(Array.from(form.querySelectorAll('.field-label')).map((l) => l.textContent)).toEqual(['Nome *', 'E-mail *', 'Telefone', 'Cargo']);
    expect(form.querySelector('.checkbox-field')?.textContent).toBe('Marcar como contato principal');
    expect(form.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('Importar fornecedores: .import-modal-content e os 3 passos (envio com colunas e campo de arquivo, validacao com alerta, resultado)', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/v1/suppliers/import') {
        return Promise.resolve({
          data: {
            validLines: [{ row: 2, name: 'Novo', familyNames: [], familyIds: [] }],
            errorLines: [{ row: 3, name: 'Ruim', reason: 'Nome é obrigatório' }],
          },
        });
      }
      if (url === '/v1/suppliers/import/confirm') {
        return Promise.resolve({ data: { successLines: [{ row: 2, supplierId: 9, name: 'Novo' }], errorLines: [{ row: 5, name: 'Outro', reason: 'duplicado' }] } });
      }
      return Promise.resolve({ data: {} });
    });
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Importar planilha' }));
    const conteudo = (await waitFor(() => {
      const c = container.querySelector('.import-modal-content');
      expect(c).not.toBeNull();
      return c;
    })) as HTMLElement;
    expect(conteudo.classList.contains('importacao-fornecedores')).toBe(true);
    expect(conteudo.querySelector('.importacao-passo > .importacao-texto')?.textContent).toBe('Selecione uma planilha (.xlsx) com as colunas, nesta ordem:');
    const colunas = Array.from(conteudo.querySelectorAll('ol.importacao-colunas--grade > li')).map((li) => li.textContent);
    expect(colunas).toHaveLength(12);
    expect(colunas[0]).toBe('Nome*');
    expect(colunas[11]).toBe('Contato cargo');
    const modelo = within(conteudo).getByRole('button', { name: 'Baixar modelo' });
    expect(modelo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(conteudo.querySelector('label.importacao-arquivo input[type="file"]')).not.toBeNull();
    expect(conteudo.querySelector('.importacao-arquivo__nome')?.textContent).toBe('Nenhum arquivo escolhido');
    expect(conteudo.querySelector('.importacao-arquivo__acao')?.textContent).toBe('Escolher arquivo');
    expect(conteudo.querySelector('.importacao-passo > .modal-actions')).not.toBeNull();

    const arquivo = new File(['conteudo'], 'fornecedores.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(conteudo.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [arquivo] } });
    await waitFor(() => expect(conteudo.querySelector('.importacao-arquivo__nome')?.textContent).toBe('fornecedores.xlsx'));
    expect(conteudo.querySelector('.importacao-arquivo__acao')?.textContent).toBe('Escolher outro arquivo');

    fireEvent.click(within(conteudo).getByRole('button', { name: 'Carregar e validar' }));
    await waitFor(() => expect(conteudo.querySelector('.importacao-resumo')).not.toBeNull());
    expect(conteudo.querySelector('.importacao-resumo')?.textContent).toBe('Encontramos 1 fornecedores válidos e 1 linhas com erro.');
    const alerta = conteudo.querySelector('.importacao-alerta.alert--error') as HTMLElement;
    expect(alerta.getAttribute('role')).toBe('alert');
    expect(alerta.querySelector(':scope > svg[aria-hidden="true"]')).not.toBeNull();
    expect(alerta.querySelector('.importacao-alerta__titulo')?.textContent).toBe('Linhas com erro (serão ignoradas):');
    expect(alerta.querySelector('li')?.textContent).toBe('Linha 3 (Ruim): Nome é obrigatório');

    fireEvent.click(within(conteudo).getByRole('button', { name: 'Confirmar importação' }));
    await waitFor(() => expect(conteudo.querySelector('.importacao-alerta--centro')).not.toBeNull());
    const sucesso = conteudo.querySelector('.importacao-alerta--centro') as HTMLElement;
    expect(sucesso.getAttribute('role')).toBe('status');
    expect(sucesso.className).toContain('alert--success');
    expect(sucesso.textContent).toBe('1 fornecedores importados com sucesso.');
    expect(conteudo.querySelector('.importacao-alerta.alert--error li')?.textContent).toBe('Linha 5 (Outro): duplicado');
    expect(within(conteudo).getByRole('button', { name: 'Concluir' })).toBeTruthy();
    expect(conteudo.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('nenhum [style] na pagina nem nos modais, exceto a raiz, a table e os 6 th dos Documentos', async () => {
    const utils = renderPage();
    await expandir(utils);
    fireEvent.click(within(utils.container.querySelector('.documentos-cabecalho') as HTMLElement).getByRole('button', { name: 'Novo documento' }));
    fireEvent.click(utils.getByRole('button', { name: 'Importar planilha' }));
    await waitFor(() => expect(utils.container.querySelector('form.documentos-form')).not.toBeNull());
    const comEstilo = Array.from(utils.container.querySelectorAll('[style]'));
    const raizDocs = utils.container.querySelector('.documentos-secao') as HTMLElement;
    const tabelaDocs = utils.container.querySelector('.documentos-tabela table') as HTMLElement;
    const permitidos = new Set<Element>([raizDocs, tabelaDocs, ...Array.from(tabelaDocs.querySelectorAll('th'))]);
    expect(permitidos.size).toBe(8);
    expect(comEstilo.filter((el) => !permitidos.has(el))).toEqual([]);
    expect(comEstilo).toHaveLength(8);
  });

  // F12-A (A2): nome com title (ate 2 linhas no CSS: o title guarda o nome inteiro). O title do Contato principal segue "nome <e-mail>" (travado no Fornecedores.test.tsx:227)
  it('A2: o nome do fornecedor tem title igual ao nome (celula do nome em ate 2 linhas)', async () => {
    const { container, findByText } = renderPage();
    await findByText('ACME Ltda');
    await findByText('Contato Um');
    const nomes = Array.from(container.querySelectorAll('.fornecedores-tabela tbody tr.fornecedores-linha .fornecedores-nome > strong'));
    expect(nomes.map((n) => n.textContent)).toEqual(['ACME Ltda', 'Beta Química']);
    for (const n of nomes) expect(n.getAttribute('title')).toBe(n.textContent);
  });

  // F12-A (A4): enquanto contatos e documentos carregam a grade ja tem conteudo (o :has() de 2 colunas nao casa); so depois de carregar vazios ela abre em 2 colunas
  it('A4: com as consultas pendentes a grade expandida tem o "Carregando" (nao casa o seletor de 2 colunas); vazia so depois de carregar', async () => {
    const conteudo = '.contact-list, .documentos-tabela, .documentos-cartoes, .fornecedores-secao__carregando, .documentos-estado';
    let resolveContatos: (v: never[]) => void = () => undefined;
    let resolveDocs: (v: never[]) => void = () => undefined;
    vi.mocked(listSupplierContacts).mockImplementation(() => new Promise((res) => { resolveContatos = res as (v: never[]) => void; }));
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/v1/suppliers') return Promise.resolve(suppliers);
      if (url === '/api/v1/supplier-contacts') return Promise.resolve({ bySupplier: {} });
      if (url === '/api/v1/item-families') return Promise.resolve({ data: families });
      if (url === '/api/v1/supplier-documents') return new Promise((res) => { resolveDocs = res as (v: never[]) => void; });
      return Promise.resolve({ bySupplier: {} });
    });
    const { container, findByText, getAllByLabelText } = renderPage();
    await findByText('ACME Ltda');
    await waitFor(() => expect((getAllByLabelText('Mostrar contatos')[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getAllByLabelText('Mostrar contatos')[0] as HTMLElement);
    const carregando = await findByText('Carregando contatos…');
    await findByText('Carregando documentos…');
    expect(carregando.className).toBe('fornecedores-secao__vazio fornecedores-secao__carregando');
    const grade = container.querySelector('.fornecedores-expandida__grade') as HTMLElement;
    expect(grade.querySelector('.documentos-estado')).not.toBeNull();
    expect(grade.querySelector(conteudo)).not.toBeNull();

    await act(async () => {
      resolveContatos([]);
      resolveDocs([]);
    });
    await findByText(/Nenhum contato cadastrado/);
    await findByText('Nenhum documento cadastrado.');
    expect(grade.querySelector('.fornecedores-secao__carregando')).toBeNull();
    expect(grade.querySelector(conteudo)).toBeNull();
  });

  // F12-A (A5): "nome . tamanho" em spans (so o nome leva a reticencia); title e textContent da celula continuam IGUAIS
  it('A5: a celula do arquivo separa nome, separador e tamanho, com title igual ao textContent', async () => {
    const utils = renderPage();
    await expandir(utils);
    const celulas = Array.from(utils.container.querySelectorAll('.documentos-tabela td.documentos-arquivo-celula')) as HTMLElement[];
    expect(celulas).toHaveLength(4);
    for (const td of celulas) {
      expect(td.getAttribute('title')).toBe(td.textContent);
      const linha = td.querySelector(':scope > .documentos-arquivo-celula__linha') as HTMLElement;
      expect(Array.from(linha.children).map((c) => c.className)).toEqual(['documentos-arquivo-celula__nome', 'documentos-arquivo-celula__sep', 'documentos-tamanho']);
      expect(linha.querySelector('.documentos-arquivo-celula__sep')?.textContent).toBe(' · ');
      expect(linha.querySelector('.documentos-tamanho')?.textContent).toBe('2,0 KB');
    }
    expect(celulas[0]?.querySelector('.documentos-arquivo-celula__nome')?.textContent).toBe('Certificado ISO.pdf');
    expect(celulas[0]?.getAttribute('title')).toBe('Certificado ISO.pdf · 2,0 KB');
  });
});
