import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import Itens from './Itens';
import Familias from './Familias';
import Forwarders from './Forwarders';

// F10 (Suite COMEX): Itens (+ importacao em 3 passos), Familias e Forwarders so com classes e Icon. Mocks no padrao do Itens.test.tsx e do Forwarders.test.tsx;
// aqui so a marcacao e as classes que o CSS da regiao `tela F10` consome (as regras ficam no telaF10.test.ts).

vi.mock('@/components/useConfirm', () => ({
  useConfirm: () => async () => true,
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => children,
}));
let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
}));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), patch: vi.fn() },
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

const ICONE_SHIP = 'M3 17h18l-2 3H5zM5 17V9h14v8M9 9V5h6v4';
const ICONE_EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z';
const iconePath = (el: Element | null) => el?.querySelector('svg path')?.getAttribute('d');
const comSvgOculto = (el: Element | null) => el?.querySelector('svg[aria-hidden="true"]') != null;

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>,
  );
};

// ---------------------------------------------------------------- Itens
function item(id: number, commercialName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    commercialName,
    marketName: `Mercado ${commercialName}`,
    ncm: '29181400',
    dbcorpCode: 'AC-CIT30',
    notes: 'Exigir laudo por lote.',
    isActive: true,
    familyId: 3,
    family: { id: 3, name: 'Acidulantes' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const ITENS = [item(1, 'Item A'), item(2, 'Item B', { notes: null, ncm: null, dbcorpCode: null, family: null, familyId: null }), item(3, 'Item C', { isActive: false })];

function mockItens() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('item-families')) return Promise.resolve({ data: [{ id: 3, name: 'Acidulantes' }] });
    if (url.includes('sem-forecast')) return Promise.resolve({ data: [] });
    if (url.includes('catalog-items')) {
      return Promise.resolve({ data: ITENS, pagination: { page: 1, pageSize: 50, totalItems: 75, totalPages: 2 } });
    }
    return Promise.resolve({ data: [] });
  });
}

describe('Itens (visual, F10)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    mockRole = 'comprador';
    mockItens();
  });

  it('raiz .itens-page, cabecalho com "Importar" e "Novo item" (icone, sem "+"), filtros em .itens-filters com icone de lupa e contagem em strong', async () => {
    const { container, findByText } = wrap(<Itens />);
    await findByText('Item A');
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toBe('page itens-page');
    expect(raiz.querySelector(':scope > header.page-header .eyebrow')?.textContent).toBe('Catálogo');
    const novo = screen.getByRole('button', { name: 'Novo item' });
    expect(novo.textContent).toBe('Novo item');
    expect(comSvgOculto(novo)).toBe(true);
    expect(comSvgOculto(screen.getByRole('button', { name: 'Importar' }))).toBe(true);

    const filtros = container.querySelector('section.itens-filters') as HTMLElement;
    expect(filtros.getAttribute('aria-label')).toBe('Filtros do catálogo');
    expect(comSvgOculto(filtros.querySelector('.itens-filters__search'))).toBe(true);
    expect(filtros.querySelector('.itens-filters__search-icon')).toBeNull();
    expect(filtros.textContent).not.toContain('🔎');
    expect(filtros.querySelector('.itens-filters__stats strong')?.textContent).toBe('75');
    expect(filtros.querySelector('.itens-filters__stats')?.textContent).toBe('75 itens no total');
    const mostrar = within(filtros).getByLabelText('Mostrar inativos') as HTMLInputElement;
    expect(mostrar.checked).toBe(false);
    fireEvent.click(mostrar);
    expect(mostrar.closest('label')?.className).toContain('itens-filters__toggle--active');
  });

  it('split com cartao "Catalogo", grade de cartoes (ativo, inativo, familia, notas, NCM/DBCorp mono, acoes) e formulario sticky em aside', async () => {
    const { container, findByText } = wrap(<Itens />);
    await findByText('Item A');
    const split = container.querySelector('.itens-page__split') as HTMLElement;
    expect(split.querySelector(':scope > section.card.itens-page__catalogo')?.getAttribute('aria-label')).toBe('Lista de itens do catálogo');
    expect(split.querySelector(':scope > aside.card.itens-form-card')?.getAttribute('aria-label')).toBe('Formulário de item');
    expect(split.querySelector('.itens-page__catalogo-cabecalho h2')?.textContent).toBe('Catálogo');

    const cartoes = Array.from(split.querySelectorAll('.itens-grid > button.itens-card'));
    expect(cartoes).toHaveLength(3);
    const a = cartoes[0] as HTMLElement;
    expect(a.getAttribute('aria-label')).toBe('Editar item Item A');
    expect(a.querySelector('.itens-card__name')?.textContent).toBe('Item A');
    expect(a.querySelector('.itens-card__market')?.textContent).toBe('Mercado Item A');
    const selos = Array.from(a.querySelectorAll('.itens-card__badges > .badge')).map((s) => s.textContent);
    expect(selos).toEqual(['Ativo', 'Acidulantes']);
    expect(a.querySelector('.itens-card__badges > .badge--muted')?.textContent).toBe('Acidulantes');
    expect(a.querySelector('.itens-card__notes')?.textContent).toBe('Exigir laudo por lote.');
    expect(a.querySelector('.itens-card__rodape .itens-card__meta')?.textContent).toBe('NCM 29181400DBCorp AC-CIT30');
    expect(Array.from(a.querySelectorAll('.itens-card__actions [role="button"]')).map((x) => x.textContent)).toEqual(['Editar', 'Inativar']);
    expect(a.querySelector('.itens-card__action--danger')?.textContent).toBe('Inativar');

    const b = cartoes[1] as HTMLElement;
    expect(b.querySelector('.itens-card__meta')?.textContent).toBe('Sem NCM nem DBCorp');
    expect(b.querySelector('.itens-card__notes')).toBeNull();
    const c = cartoes[2] as HTMLElement;
    expect(c.className).toContain('itens-card--inactive');
    expect(c.querySelector('.itens-card__badges > .badge--muted')?.textContent).toBe('Inativo');
    expect(c.querySelector('.itens-card__action--reativar')?.textContent).toBe('Reativar');
    expect(c.querySelector('.itens-card__rodape')).not.toBeNull();
  });

  it('formulario: eyebrow "Novo"/"Editando" antes do h2, dica, campos de hoje, NCM e Codigo DBCorp em .itens-form__row; cartao em edicao marcado', async () => {
    const { container, findByText } = wrap(<Itens />);
    await findByText('Item A');
    const form = container.querySelector('aside.itens-form-card') as HTMLElement;
    expect(form.querySelector('.itens-form__cabecalho > span.eyebrow')?.textContent).toBe('Novo');
    expect(form.querySelector('.itens-form__cabecalho > h2')?.textContent).toBe('Cadastrar item');
    expect(form.querySelector('.itens-form__cabecalho > .itens-form__hint')?.textContent).toContain('O NCM é validado com 8 dígitos');
    const row = form.querySelector('form.itens-form > .itens-form__row') as HTMLElement;
    expect(Array.from(row.querySelectorAll('.field > span')).map((s) => s.textContent)).toEqual(['NCM', 'Código DBCorp']);
    expect(form.querySelector('.itens-form__actions .primary-button')?.textContent).toBe('Cadastrar item');
    expect(container.querySelector('.itens-card--editando')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Editar item Item A' }));
    await waitFor(() => expect(form.querySelector('.itens-form__cabecalho > span')?.textContent).toBe('Editando'));
    expect(form.querySelector('.itens-form__cabecalho > h2')?.textContent).toBe('Item A');
    expect(screen.getByRole('button', { name: 'Editar item Item A' }).className).toContain('itens-card--editando');
    expect(screen.getByRole('button', { name: 'Editar item Item B' }).className).not.toContain('itens-card--editando');
    expect(within(form).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('feedback com role=status (alert--success e icone), erro de validacao em alert--error, paginacao e estados', async () => {
    vi.mocked(api.del).mockResolvedValue({});
    const { container, findByText } = wrap(<Itens />);
    await findByText('Item A');
    expect(container.querySelector('nav[aria-label="Paginação"]')).not.toBeNull();

    fireEvent.click(within(screen.getByRole('button', { name: 'Editar item Item A' })).getByText('Inativar'));
    const ok = await screen.findByText('Item inativado.');
    expect(ok.getAttribute('role')).toBe('status');
    expect(ok.className).toContain('itens-page__alerta');
    expect(ok.className).toContain('alert--success');
    expect(comSvgOculto(ok)).toBe(true);

    fireEvent.submit(container.querySelector('form.itens-form') as HTMLFormElement);
    const erro = await screen.findByText('Informe o nome comercial e o nome de mercado.');
    expect(erro.className).toContain('alert--error');
    expect(erro.getAttribute('role')).toBe('status');
    expect(comSvgOculto(erro)).toBe(true);
  });

  it('estados: carregando com spinner, erro com role=alert e vazio com titulo e texto', async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => undefined));
    const carregando = wrap(<Itens />);
    const spinner = carregando.container.querySelector('.itens-empty[role="status"]') as HTMLElement;
    expect(spinner.textContent).toBe('Carregando…');
    expect(spinner.querySelector('.btn-spinner')).not.toBeNull();
    carregando.unmount();

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('item-families')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } });
    });
    const vazio = wrap(<Itens />);
    await vazio.findByText('Nenhum item encontrado');
    expect(vazio.container.querySelector('.itens-empty > strong')?.textContent).toBe('Nenhum item encontrado');
    expect(vazio.container.querySelector('.itens-empty > p')?.textContent).toBe('Cadastre o primeiro item do catálogo para começar.');
    vazio.unmount();

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('item-families')) return Promise.resolve({ data: [] });
      return Promise.reject(new Error('Falha fictícia'));
    });
    const erro = wrap(<Itens />);
    const alerta = await waitFor(() => {
      const el = erro.container.querySelector('.itens-empty--erro');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(alerta.getAttribute('role')).toBe('alert');
  });

  it('Importar itens em 3 passos (envio com a lista numerada das 7 colunas, validacao com alertas, resultado) sem estilo inline', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/v1/catalog-items/import') {
        return Promise.resolve({
          data: {
            validLines: [{ commercialName: 'X', marketName: 'Mercado X' }],
            errorLines: [{ row: 14, reason: 'NCM deve ter 8 dígitos numéricos' }],
            warnings: ['1 linha(s) marcam DG na coluna 6, que foi ignorada.'],
          },
        });
      }
      return Promise.resolve({ data: { successLines: [{}], errorLines: [{ row: 23, reason: 'Já existe um item.' }] } });
    });
    const { container, findByText } = wrap(<Itens />);
    await findByText('Item A');
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    const conteudo = (await waitFor(() => {
      const c = container.querySelector('.import-modal-content');
      expect(c).not.toBeNull();
      return c;
    })) as HTMLElement;
    expect(conteudo.classList.contains('importacao-itens')).toBe(true);
    expect(conteudo.querySelector('.importacao-texto')?.textContent).toBe('Selecione uma planilha (xlsx) com as colunas na seguinte ordem:');
    const colunas = Array.from(conteudo.querySelectorAll('ol.importacao-colunas > li')).map((li) => li.textContent);
    expect(colunas).toEqual([
      'Nome Comercial',
      'Nome de Mercado',
      'NCM',
      'Código DB',
      'Família',
      '(coluna ignorada — DG agora é informado pelo fornecedor na resposta)',
      'Notas',
    ]);
    const arquivo = conteudo.querySelector('label.importacao-arquivo--itens') as HTMLElement;
    expect(arquivo.querySelector('input[type="file"]')).not.toBeNull();
    expect(arquivo.querySelector('.importacao-arquivo__botao')?.textContent).toBe('Escolher arquivo');
    expect(arquivo.querySelector('.importacao-arquivo__nome')?.textContent).toBe('Nenhum arquivo escolhido');
    expect(comSvgOculto(within(conteudo).getByRole('button', { name: 'Carregar e Validar' }))).toBe(true);

    fireEvent.change(arquivo.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'catalogo.xlsx')] } });
    await waitFor(() => expect(arquivo.querySelector('.importacao-arquivo__nome')?.textContent).toBe('catalogo.xlsx'));
    fireEvent.click(within(conteudo).getByRole('button', { name: 'Carregar e Validar' }));

    await waitFor(() => expect(conteudo.querySelector('.importacao-resumo')).not.toBeNull());
    expect(conteudo.querySelector('.importacao-resumo')?.textContent).toBe('Encontramos 1 itens válidos e 1 linhas com erro.');
    const erro = conteudo.querySelector('.importacao-alerta.alert--error') as HTMLElement;
    expect(erro.getAttribute('role')).toBe('alert');
    expect(erro.querySelector('li')?.textContent).toBe('Linha 14: NCM deve ter 8 dígitos numéricos');
    const aviso = conteudo.querySelector('.importacao-alerta.alert--warning') as HTMLElement;
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.querySelector('.importacao-alerta__titulo')?.textContent).toBe('Avisos:');
    expect(aviso.querySelector('li')?.textContent).toBe('1 linha(s) marcam DG na coluna 6, que foi ignorada.');

    fireEvent.click(within(conteudo).getByRole('button', { name: 'Confirmar Importação' }));
    await waitFor(() => expect(conteudo.querySelector('.importacao-alerta--centro')).not.toBeNull());
    expect(conteudo.querySelector('.importacao-alerta--centro')?.textContent).toBe('1 itens importados com sucesso!');
    expect(conteudo.querySelector('.importacao-alerta.alert--error li')?.textContent).toBe('Linha 23: Já existe um item.');
    expect(within(conteudo).getByRole('button', { name: 'Concluir' })).toBeTruthy();
    expect(conteudo.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('nenhum [style] na pagina de Itens (com o formulario e o modal de importacao)', async () => {
    const { container, findByText } = wrap(<Itens />);
    await findByText('Item A');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Familias
describe('Familias (visual, F10)', () => {
  const familiasLista = [
    { id: 1, name: 'Acidulantes', isActive: true },
    { id: 2, name: 'Conservantes', isActive: false },
  ];

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: familiasLista }));
  });

  it('raiz .familias-page (sem .itens-page), "Nova Familia" com icone, tabela com ID mono, status com ponto e acoes', async () => {
    const { container, findByText } = wrap(<Familias />);
    await findByText('Acidulantes');
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toBe('page familias-page');
    expect(raiz.classList.contains('itens-page')).toBe(false);
    expect(container.querySelector('.itens-page')).toBeNull();
    const novo = screen.getByRole('button', { name: 'Nova Família' });
    expect(novo.textContent).toBe('Nova Família');
    expect(comSvgOculto(novo)).toBe(true);

    expect(container.querySelector('section.card.familias-lista')?.getAttribute('aria-label')).toBe('Lista de famílias');
    const linhas = Array.from(container.querySelectorAll('table.familias-tabela tbody tr'));
    expect(linhas).toHaveLength(2);
    expect(linhas[0]?.querySelector('td.familias-id')?.textContent).toBe('1');
    expect(linhas[0]?.querySelector('.badge.badge--dot')?.textContent).toBe('Ativa');
    expect(linhas[1]?.querySelector('.badge.badge--muted.badge--dot')?.textContent).toBe('Inativa');
    const acoes = Array.from(linhas[0]?.querySelectorAll('.row-actions button') ?? []);
    expect(acoes.map((b) => b.textContent)).toEqual(['Editar', 'Inativar']);
    expect(comSvgOculto(acoes[0] ?? null)).toBe(true);
    expect(linhas[1]?.querySelectorAll('.row-actions button')[1]?.textContent).toBe('Reativar');
  });

  it('feedback com role=status e icone; modais Nova/Editar com .familias-form, erro em role=alert com icone e sem estilo inline', async () => {
    const { container, findByText } = wrap(<Familias />);
    await findByText('Acidulantes');
    fireEvent.click(screen.getByRole('button', { name: 'Nova Família' }));
    const dialogoNova = container.querySelectorAll('dialog')[0] as HTMLDialogElement;
    const formNova = dialogoNova.querySelector('form.familias-form') as HTMLFormElement;
    expect(formNova).not.toBeNull();
    fireEvent.submit(formNova);
    const erro = await within(dialogoNova).findByText('O nome é obrigatório');
    expect(erro.getAttribute('role')).toBe('alert');
    expect(erro.className).toContain('familias-alerta');
    expect(erro.className).toContain('alert--error');
    expect(comSvgOculto(erro)).toBe(true);
    expect(formNova.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    expect(formNova.querySelectorAll('[style]')).toHaveLength(0);
    expect(formNova.querySelector(':scope > .modal-actions')).not.toBeNull();

    const dialogoEditar = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0] as HTMLElement);
    const formEditar = dialogoEditar.querySelector('form.familias-form') as HTMLFormElement;
    expect(formEditar).not.toBeNull();
    expect(formEditar.querySelector('input')?.getAttribute('aria-invalid')).toBeNull();
    expect(formEditar.querySelectorAll('[style]')).toHaveLength(0);

    vi.mocked(api.put).mockResolvedValue({});
    fireEvent.click(within(container.querySelector('table.familias-tabela') as HTMLElement).getAllByRole('button', { name: 'Reativar' })[0] as HTMLElement);
    const ok = await screen.findByText('Família "Conservantes" reativada.');
    expect(ok.getAttribute('role')).toBe('status');
    expect(ok.className).toContain('alert--success');
    expect(comSvgOculto(ok)).toBe(true);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('estados: carregando com spinner e vazio com icone, titulo e texto no padrao da F5', async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => undefined));
    const carregando = wrap(<Familias />);
    const estado = carregando.container.querySelector('.familias-carregando') as HTMLElement;
    expect(estado.getAttribute('role')).toBe('status');
    expect(estado.textContent).toBe('Carregando famílias…');
    expect(estado.querySelector('.btn-spinner')).not.toBeNull();
    carregando.unmount();

    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: [] }));
    const vazio = wrap(<Familias />);
    await vazio.findByText('Nenhuma família encontrada');
    expect(vazio.container.querySelector('.familias-estado .empty-state .empty-state__icon svg')).not.toBeNull();
    expect(vazio.container.querySelector('.empty-state__text')?.textContent).toBe('Cadastre a primeira família para começar.');
  });
});

// ---------------------------------------------------------------- Forwarders
function forwarder(id: number, companyName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyName,
    address: `Rua ${companyName}, 1`,
    website: null,
    notes: null,
    isActive: true,
    isDefault: false,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    contacts: [
      { id: id * 10, name: `Contato ${companyName}`, email: `contato${id}@exemplo.invalid`, phone: null },
      { id: id * 10 + 1, name: `Segundo ${companyName}`, email: `segundo${id}@exemplo.invalid`, phone: null },
    ],
    ...extra,
  };
}

describe('Forwarders (visual, F10)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    mockRole = 'comprador';
    vi.mocked(api.get).mockImplementation((async () => [
      forwarder(1, 'Global Cargo', { isDefault: true }),
      forwarder(2, 'Sea Link'),
      forwarder(3, 'Velho Cargo', { isActive: false }),
    ]) as typeof api.get);
  });

  it('raiz .forwarders-page, "Novo forwarder" com icone, tabela com Padrao (icone), contatos "Nome +N", status com ponto e acoes', async () => {
    const { container } = wrap(<Forwarders />);
    await screen.findByText('Global Cargo');
    const raiz = container.firstElementChild as HTMLElement;
    expect(raiz.className).toBe('page forwarders-page');
    const novo = screen.getByRole('button', { name: 'Novo forwarder' });
    expect(novo.textContent).toBe('Novo forwarder');
    expect(comSvgOculto(novo)).toBe(true);
    expect(container.querySelector('section.card.forwarders-lista')?.getAttribute('aria-label')).toBe('Lista de forwarders');

    const linha = (await screen.findByText('Global Cargo')).closest('tr') as HTMLElement;
    const padrao = within(linha).getByText('Padrão');
    expect(padrao.className).toContain('forwarders-padrao');
    expect(comSvgOculto(padrao)).toBe(true);
    expect(within(linha).getByText('Contato Global Cargo +1')).toBeTruthy();
    expect(linha.querySelector('td.forwarders-contatos')?.textContent).toBe('Contato Global Cargo +1');
    expect(linha.querySelector('.col-status .badge.badge--dot')?.textContent).toBe('Ativo');
    const velho = screen.getByText('Velho Cargo').closest('tr') as HTMLElement;
    expect(velho.querySelector('.col-status .badge--muted.badge--dot')?.textContent).toBe('Inativo');
    expect(Array.from(linha.querySelectorAll('.row-actions button')).map((b) => b.textContent)).toEqual(['Editar', 'Excluir']);
    expect(Array.from(screen.getByText('Sea Link').closest('tr')?.querySelectorAll('.row-actions button') ?? []).map((b) => b.textContent)).toEqual([
      'Editar',
      'Definir como padrão',
      'Excluir',
    ]);
    expect(container.querySelector('.forwarders-aviso')).toBeNull();
  });

  it('perfil sem escrita: aviso "Apenas consulta" com icone, sem "Novo forwarder" e "Ver" com o icone eye', async () => {
    mockRole = 'viewer';
    const { container } = wrap(<Forwarders />);
    await screen.findByText('Global Cargo');
    expect(screen.queryByRole('button', { name: 'Novo forwarder' })).toBeNull();
    const aviso = container.querySelector('.forwarders-aviso') as HTMLElement;
    expect(aviso.textContent).toBe('Apenas consulta - seu perfil não pode alterar os forwarders.');
    expect(comSvgOculto(aviso)).toBe(true);
    const ver = screen.getAllByRole('button', { name: 'Ver' })[0] as HTMLElement;
    expect(iconePath(ver)).toBe(ICONE_EYE);
    expect(ver.textContent).toBe('Ver');
  });

  it('lista vazia com o icone ship (padrao de vazio da F5) e carregando com spinner', async () => {
    vi.mocked(api.get).mockImplementation((async () => []) as typeof api.get);
    const vazio = wrap(<Forwarders />);
    await screen.findByText('Nenhum forwarder cadastrado');
    const estado = vazio.container.querySelector('.forwarders-estado .empty-state') as HTMLElement;
    expect(iconePath(estado.querySelector('.empty-state__icon'))).toBe(ICONE_SHIP);
    expect(estado.querySelector('.empty-state__title')?.textContent).toBe('Nenhum forwarder cadastrado');
    vazio.unmount();

    vi.mocked(api.get).mockImplementation((() => new Promise(() => undefined)) as typeof api.get);
    const carregando = wrap(<Forwarders />);
    const spinner = carregando.container.querySelector('.forwarders-carregando') as HTMLElement;
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.textContent).toBe('Carregando forwarders…');
  });

  it('modal largo: grade Empresa/Endereco/Website/Observacoes, fieldset "Contato 1" com legenda, Remover contato com icone, Adicionar contato e erro com icone', async () => {
    const { container } = wrap(<Forwarders />);
    await screen.findByText('Global Cargo');
    fireEvent.click(screen.getByRole('button', { name: 'Novo forwarder' }));
    const form = container.querySelector('form.forwarder-form') as HTMLFormElement;
    expect(form).not.toBeNull();
    const grade = form.querySelector('.forwarder-form__grade') as HTMLElement;
    expect(Array.from(grade.querySelectorAll(':scope > .forwarder-campo > .field-label')).map((l) => l.textContent)).toEqual([
      'Empresa *',
      'Endereço',
      'Website',
      'Observações',
    ]);
    expect(form.querySelector('.forwarder-dica')?.textContent).toBe('Uso interno; não vai no e-mail.');
    expect(Array.from(form.querySelectorAll('.forwarder-form__opcoes .checkbox-field')).map((l) => l.textContent)).toEqual(['Forwarder ativo', 'Padrão no envio da PO']);
    expect(form.querySelector('h3.forwarder-form__titulo')?.textContent).toBe('Contatos');

    const contato = form.querySelector('fieldset.forwarder-contato') as HTMLElement;
    expect(contato.querySelector('legend.forwarder-contato__legenda')?.textContent).toBe('Contato 1');
    expect(within(form).getByRole('group', { name: 'Contato 1' })).toBe(contato);
    expect(contato.querySelectorAll('.forwarder-contato__grade > .forwarder-campo')).toHaveLength(3);
    expect(contato.querySelector('.forwarder-contato__acoes')).toBeNull();

    const adicionar = within(form).getByRole('button', { name: 'Adicionar contato' });
    expect(adicionar.textContent).toBe('Adicionar contato');
    expect(comSvgOculto(adicionar)).toBe(true);
    fireEvent.click(adicionar);
    const remover = (await within(form).findAllByRole('button', { name: 'Remover contato' }))[0] as HTMLElement;
    expect(comSvgOculto(remover)).toBe(true);
    expect(remover.className).toContain('danger-button');

    fireEvent.submit(form);
    const erro = await within(form).findByText('Informe o nome da empresa.');
    expect(erro.getAttribute('role')).toBe('alert');
    expect(erro.className).toContain('alert--error');
    expect(comSvgOculto(erro)).toBe(true);
    expect(form.querySelector('fieldset[disabled]')).toBeNull();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('modal "Forwarder" do viewer: fieldset[disabled], sem Remover/Adicionar contato e so o botao Fechar', async () => {
    mockRole = 'viewer';
    const { container } = wrap(<Forwarders />);
    await screen.findByText('Global Cargo');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver' })[0] as HTMLElement);
    const form = container.querySelector('form.forwarder-form') as HTMLFormElement;
    const campos = form.querySelector('fieldset.forwarder-form__campos') as HTMLFieldSetElement;
    expect(campos.disabled).toBe(true);
    expect(within(form).queryByRole('button', { name: 'Adicionar contato' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Remover contato' })).toBeNull();
    expect(within(form).getByRole('button', { name: 'Fechar' })).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Salvar forwarder' })).toBeNull();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
