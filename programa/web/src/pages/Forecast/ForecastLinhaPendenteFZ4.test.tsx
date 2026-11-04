import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastLinha, ForecastMonths, ForecastSnapshotDetail } from '@/services/forecast';
import { parseColor, ratioOf, readSource, regioes, temasDeTokens, tokensDosTemas, opaque, parseRules } from '@/test/rfCss';
import ForecastGrid from './ForecastGrid';
import ForecastItemPagina from './ForecastItemPagina';
import { colunasDoPainel } from './forecastPainel';
import { TEXTO_CADASTRADO_DEPOIS } from './forecastPendentes';

// FZ4-F: linha de codigo do DBCorp que entrou na quinzena sem cadastro (sem produto, sem fonte, sem lead time, sem sugestao de compra).
// Estados: sem_cadastro, produto_inativo, cadastradoDepois e linha normal. Dados 100% sinteticos.

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
const post = vi.mocked(api.post);

const MONTHS: ForecastMonths = {
  consumo: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
  return {
    linha: 3,
    O: 100,
    P: 50,
    Q: 100,
    R: 90,
    S: 80,
    T: 10,
    U: 500,
    chegadas: [0, 0, 0, 0, 0],
    AA: 5,
    programacoes: [0, 0, 0, 0],
    AG: 100,
    projecao: [400, 300, 200, 100, 50, 20],
    AN: 200,
    AQ: 30,
    AP: '2026-11-20',
    AR: 0,
    AS: 0,
    item: 'PRODUTO SINTETICO A',
    codigos: ['TST0001', 'TST0002'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    sobDemanda: false,
    mesesForaDaMedia: [],
    ...over,
  } as ForecastLinha;
}

const pendente = (over: Partial<ForecastLinha> = {}) =>
  linha({
    linha: 8,
    n: null,
    item: 'TST0901',
    codigos: ['TST0901', '', '', '', '', '', ''],
    fonte: '',
    productId: null,
    AN: null,
    AQ: null,
    AP: null,
    T: null,
    pendenteCadastro: 'sem_cadastro',
    cadastradoDepois: false,
    produtoInativoAtual: null,
    sobDemanda: undefined,
    mesesForaDaMedia: undefined,
    ...over,
  });

function detalhe(linhas: ForecastLinha[]): ForecastSnapshotDetail {
  return {
    id: 7,
    label: '11-1',
    baseDate: '2026-10-15',
    half: 2,
    origin: 'dbcorp',
    hoje: '2026-10-20',
    months: { consumo: [], chegada: [], programacao: [] },
    files: [],
    createdAt: '2026-10-15T10:00:00.000Z',
    linhas,
    conferencia: null,
  };
}

function montar(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const pagina = (l: ForecastLinha, podeEditar = true) => montar(<ForecastItemPagina detail={detalhe([l])} linha={l.linha} podeEditar={podeEditar} />);

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/sources') return { data: [{ id: 3, name: 'FONTE 001', leadTimeDays: 45, clearanceDays: null, isActive: true }] };
    if (path === '/v1/item-families') return { data: [{ id: 7, name: 'FAMILIA A', isActive: true }] };
    if (path === '/v1/forecast/products') return { data: [] };
    throw new Error(`GET inesperado: ${path}`);
  });
});

describe('FZ4-F grade: selo "Sem cadastro" / "Produto inativo" e sem sugestao', () => {
  const grade = (linhas: ForecastLinha[]) =>
    montar(
      <ForecastGrid
        colunas={colunasDoPainel(MONTHS, { ocultas: false })}
        linhas={linhas}
        divergencias={new Map()}
        buscaDoItem=""
        legenda="Grade"
      />,
    );
  const celula = (tr: HTMLElement, id: string) => {
    const colunas = colunasDoPainel(MONTHS, { ocultas: false });
    const i = colunas.findIndex((c) => c.id === id);
    return within(tr).getAllByRole('cell')[i + 2] as HTMLElement;
  };
  const celulaAN = (tr: HTMLElement) => celula(tr, 'AN');

  it('sem cadastro: o selo tem TEXTO (nao so cor) dentro do link do item; a celula de demanda mostra "—" com o motivo acessivel', () => {
    grade([linha(), pendente()]);
    const tr = screen.getByText('TST0901').closest('tr') as HTMLElement;
    const selo = within(tr).getByText('Sem cadastro');
    expect(selo.className).toContain('fcpc-selo--sem_cadastro');
    expect(selo.closest('a')?.getAttribute('href')).toBe('/forecast/item/8');
    expect(selo.textContent?.trim()).toBe('Sem cadastro');
    expect(selo.getAttribute('title')).toBe('Código sem cadastro: sem fonte, sem lead time e sem sugestão de compra.');
    const an = celulaAN(tr);
    expect(an.textContent).toContain('—');
    expect(an.textContent).not.toContain('#N/D');
    expect(an.className).toContain('fc-cell--vazio');
    expect(an.querySelector('.sr-only')?.textContent).toBe('Código sem cadastro: sem fonte, sem lead time e sem sugestão de compra.');
    expect(an.getAttribute('title')).toBe('Código sem cadastro: sem fonte, sem lead time e sem sugestão de compra.');
    // SEGURANCA (T) e CHEG. (AP) tambem nao tem lead time: "—" (nunca #N/D), com o mesmo motivo no title e para leitor de tela
    const motivo = 'Código sem cadastro: sem fonte, sem lead time e sem sugestão de compra.';
    for (const id of ['T', 'AP']) {
      const c = celula(tr, id);
      expect(c.textContent, id).toContain('—');
      expect(c.textContent, id).not.toContain('#N/D');
      expect(c.className, id).toContain('fc-cell--vazio');
      expect(c.getAttribute('title'), id).toBe(motivo);
      expect(c.querySelector('.sr-only')?.textContent, id).toBe(motivo);
    }
    // sem produto/fonte, "Cotacao nao enviada" sugeriria uma acao impossivel: o status some (a linha normal o mantem)
    expect(within(tr).queryByText(/Cotação não enviada/)).toBeNull();
  });

  it('produto inativo: selo proprio e motivo proprio', () => {
    grade([pendente({ pendenteCadastro: 'produto_inativo', produtoInativoAtual: { id: 9, nome: 'PRODUTO 009' } })]);
    const tr = screen.getByText('TST0901').closest('tr') as HTMLElement;
    const selo = within(tr).getByText('Produto inativo');
    expect(selo.className).toContain('fcpc-selo--produto_inativo');
    expect(celulaAN(tr).querySelector('.sr-only')?.textContent).toBe(
      'Produto inativo no cadastro: sem fonte, sem lead time e sem sugestão de compra.',
    );
  });

  it('linha normal e a quinzena antiga (sem a marca): sem selo e a demanda continua numerica', () => {
    const { container } = grade([linha({ AN: -150 })]);
    expect(container.querySelector('.fcpc-selo')).toBeNull();
    const tr = screen.getByText('PRODUTO SINTETICO A').closest('tr') as HTMLElement;
    expect(celulaAN(tr).textContent).toBe('-150,0');
    expect(celulaAN(tr).querySelector('.sr-only')).toBeNull();
    // a linha normal mantem o status e a data de chegada
    expect(within(tr).getByText(/Cotação não enviada/)).toBeTruthy();
    expect(celula(tr, 'AP').textContent).toBe('20-nov');
  });

  it('linha cadastrada depois continua marcada na grade (a quinzena nao muda): o selo segue e a demanda segue sem sugestao', () => {
    grade([pendente({ cadastradoDepois: true })]);
    const tr = screen.getByText('TST0901').closest('tr') as HTMLElement;
    expect(within(tr).getByText('Sem cadastro')).toBeTruthy();
    expect(celulaAN(tr).textContent).toContain('—');
  });
});

describe('FZ4-F pagina do item: aviso por item', () => {
  it('sem cadastro (admin/comprador): aviso "Item nao cadastrado" com o botao que abre o MESMO dialogo Completar cadastro', async () => {
    pagina(pendente());
    const aviso = document.querySelector('.fcpc-aviso') as HTMLElement;
    expect(within(aviso).getByText('Item não cadastrado')).toBeTruthy();
    expect(aviso.textContent).toContain('sem fonte, sem lead time e sem sugestão de compra');
    expect(aviso.textContent).not.toMatch(/FORA do cálculo/i);
    const botao = within(aviso).getByRole('button', { name: 'Completar cadastro do código TST0901' });
    expect(botao.textContent).toBe('Completar cadastro');
    expect((botao.getAttribute('aria-label') ?? '').startsWith(botao.textContent ?? '')).toBe(true);
    expect(within(aviso).queryByRole('button', { name: /Reativar/ })).toBeNull();
    fireEvent.click(botao);
    expect(await screen.findByRole('heading', { name: 'Completar cadastro' })).toBeTruthy();
    expect(((await screen.findByLabelText('Código 1')) as HTMLInputElement).value).toBe('TST0901');
  });

  it('o botao e alcancavel por teclado (button nativo, sem tabIndex negativo) e Esc no dialogo devolve o foco a ele', async () => {
    pagina(pendente());
    const botao = screen.getByRole('button', { name: 'Completar cadastro do código TST0901' });
    expect(botao.tagName).toBe('BUTTON');
    expect(botao.getAttribute('tabindex')).toBeNull();
    botao.focus();
    fireEvent.click(botao);
    await screen.findByRole('heading', { name: 'Completar cadastro' });
    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Completar cadastro' })).toBeNull());
    expect(document.activeElement).toBe(botao);
  });

  it('produto inativo (com produtoInativoAtual): "Reativar produto" chama o POST com o id certo e mostra a mensagem com foco', async () => {
    post.mockResolvedValue({ data: { id: 9, nome: 'PRODUTO 009', ativo: true, origem: 'dbcorp', alterado: true } });
    pagina(pendente({ pendenteCadastro: 'produto_inativo', produtoInativoAtual: { id: 9, nome: 'PRODUTO 009' } }));
    const aviso = document.querySelector('.fcpc-aviso') as HTMLElement;
    expect(within(aviso).getByText('Produto inativo')).toBeTruthy();
    expect(aviso.textContent).toContain('O produto “PRODUTO 009” está inativo no cadastro');
    expect(within(aviso).queryByRole('button', { name: /Completar cadastro/ })).toBeNull();
    const botao = within(aviso).getByRole('button', { name: 'Reativar produto PRODUTO 009 (código TST0901)' });
    expect(botao.textContent).toBe('Reativar produto');
    fireEvent.click(botao);
    const status = await screen.findByText(
      'Produto PRODUTO 009 reativado. Os códigos dele entram no cálculo a partir da próxima quinzena importada.',
    );
    expect(post).toHaveBeenCalledWith('/v1/forecast/products/9/reativar', {});
    expect(status.getAttribute('role')).toBe('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it('cadastradoDepois: "Cadastrado — entra completo na proxima quinzena", SEM botao de completar nem de reativar', () => {
    pagina(pendente({ cadastradoDepois: true, produtoInativoAtual: null }));
    const aviso = document.querySelector('.fcpc-aviso') as HTMLElement;
    expect(within(aviso).getByText('Cadastrado')).toBeTruthy();
    expect(within(aviso).getByText(TEXTO_CADASTRADO_DEPOIS)).toBeTruthy();
    expect(TEXTO_CADASTRADO_DEPOIS.startsWith('Cadastrado — entra completo na próxima quinzena')).toBe(true);
    expect(within(aviso).queryByRole('button')).toBeNull();
    expect(aviso.textContent).not.toMatch(/Item não cadastrado/);
  });

  it('cadastradoDepois vence um produtoInativoAtual residual (nada de "Reativar produto" depois de cadastrado)', () => {
    pagina(pendente({ pendenteCadastro: 'produto_inativo', cadastradoDepois: true, produtoInativoAtual: { id: 9, nome: 'PRODUTO 009' } }));
    expect(screen.queryByRole('button', { name: /Reativar produto/ })).toBeNull();
    expect(screen.getByText(TEXTO_CADASTRADO_DEPOIS)).toBeTruthy();
  });

  it('produto inativo sem produto conhecido: aviso sem botao', () => {
    pagina(pendente({ pendenteCadastro: 'produto_inativo', produtoInativoAtual: null }));
    const aviso = document.querySelector('.fcpc-aviso') as HTMLElement;
    expect(within(aviso).getByText('Produto inativo')).toBeTruthy();
    expect(within(aviso).queryByRole('button')).toBeNull();
  });

  it('somente leitura (viewer/gestor): o aviso aparece, sem botoes', () => {
    pagina(pendente(), false);
    const aviso = document.querySelector('.fcpc-aviso') as HTMLElement;
    expect(within(aviso).getByText('Item não cadastrado')).toBeTruthy();
    expect(within(aviso).queryByRole('button')).toBeNull();
  });

  it('duplo clique em "Reativar produto" com o POST pendente = 1 chamada (guarda contra gravacao dupla; foco fica no botao)', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    post.mockReturnValue(new Promise((r) => (resolver = r)) as never);
    pagina(pendente({ pendenteCadastro: 'produto_inativo', produtoInativoAtual: { id: 9, nome: 'PRODUTO 009' } }));
    const botao = screen.getByRole('button', { name: 'Reativar produto PRODUTO 009 (código TST0901)' });
    botao.focus();
    fireEvent.click(botao);
    await waitFor(() => expect(botao.getAttribute('aria-busy')).toBe('true'));
    expect(botao.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(botao);
    fireEvent.click(botao);
    // o mutationFn roda depois de um tick: espera antes de contar
    await new Promise((r) => setTimeout(r, 30));
    expect(post).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(botao);
    resolver({ data: { id: 9, nome: 'PRODUTO 009', ativo: true, origem: 'dbcorp', alterado: true } });
    await screen.findByRole('status');
  });

  it('linha normal: nenhum aviso de cadastro', () => {
    const { container } = pagina(linha());
    expect(container.querySelector('.fcpc-aviso')).toBeNull();
    expect(screen.queryByText('Item não cadastrado')).toBeNull();
  });
});

// ---------- CSS: par F13-Z4 ----------
const css = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
const regiao = regioes(css).find((r) => r.nome === 'tela F13');
const bruto = regiao?.bruto ?? '';
const par = bruto.slice(bruto.indexOf('/* -- F13-Z4 >>> -- */'), bruto.indexOf('/* -- <<< F13-Z4 -- */'));

describe('FZ4-F CSS: par F13-Z4 da regiao tela F13', () => {
  it('existe 1 vez, depois do par E, com so regras de @media screen, sem !important, sem cor literal e so var(--rf-*)', () => {
    expect(bruto.split('/* -- F13-Z4 >>> -- */')).toHaveLength(2);
    expect(bruto.split('/* -- <<< F13-Z4 -- */')).toHaveLength(2);
    expect(bruto.indexOf('/* -- <<< F13-E -- */')).toBeLessThan(bruto.indexOf('/* -- F13-Z4 >>> -- */'));
    const corpo = par.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const r of parseRules(corpo)) expect(r.prelude).toBe('@media screen');
    expect(corpo).not.toContain('!important');
    expect(corpo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    for (const [, nome] of corpo.matchAll(/var\(\s*(--[\w-]+)/g)) expect(nome, nome).toMatch(/^--rf-/);
    expect(corpo).toContain('.fc-pagina .fcpc-selo--sem_cadastro');
    expect(corpo).toContain('.fc-pagina .fcpc-selo--produto_inativo');
    expect(corpo).toContain('.fc-pagina .fcpc-aviso');
  });

  it('impressao: `.fc-grid .sr-only` some no papel (o motivo absoluto vazava do scroller clipado e criava paginas em branco), em regra @media print FORA do par Z4 e das regioes', () => {
    const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const regras = [...limpo.matchAll(/@media print\s*\{\s*\.fc-grid \.sr-only\s*\{([^}]*)\}\s*\}/g)];
    expect(regras).toHaveLength(1);
    expect(regras[0]?.[1]).toMatch(/display\s*:\s*none/);
    // a regiao tela F13 (e o par Z4) e so de tela: a regra de papel mora fora dela
    expect(regiao?.limpo ?? '').not.toContain('.fc-grid .sr-only');
    expect(par).not.toMatch(/@media print/);
  });

  it('contraste AA (>= 4,5:1) dos 2 pares de tom do selo nos 2 temas (tokens existentes)', () => {
    const { claro, escuro } = tokensDosTemas(css);
    const temas = temasDeTokens(claro, escuro);
    for (const [tema, tokens] of Object.entries(temas)) {
      for (const tom of ['warning', 'neutral']) {
        const fg = parseColor(tokens[`--rf-tone-${tom}-fg`] ?? '');
        const bg = opaque(tokens, `--rf-tone-${tom}-bg`);
        expect(ratioOf([fg[0], fg[1], fg[2]], bg), `${tema} ${tom}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
