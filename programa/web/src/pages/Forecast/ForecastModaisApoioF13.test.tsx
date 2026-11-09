import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastFontesModal from './ForecastFontesModal';
import ForecastGruposModal from './ForecastGruposModal';
import ForecastImportModal from './ForecastImportModal';
import ForecastOcasioesLinhaDoTempo, { type LinhaDoTempo } from './ForecastOcasioesLinhaDoTempo';

// F13-E: markup dos modais de apoio no mock v68 (Fontes e lead time, Grupos, Importar e linha do tempo dos Eventos). So o que a frente acrescentou; o
// comportamento segue nos testes de cada modal. Dados 100% sinteticos.

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
import { readSource } from '../../test/rfCss';

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

// resumo DBCorp sintetico (copia do ForecastImportModal.test.tsx)
function rel(over: Record<string, unknown> = {}) {
  return {
    fileName: 'arquivo-teste.xlsx',
    lidas: 10,
    usadas: 8,
    ignoradas: { 'sem codigo': 2 },
    total: 1000,
    avisos: [],
    erros: [],
    totalCasado: 900,
    codigosSemProduto: 1,
    ...over,
  };
}

function resumoDbcorp(over: Record<string, unknown> = {}, relatorios: Record<string, unknown> = {}) {
  return {
    label: '12-2',
    baseDate: '2026-12-15',
    half: 2,
    meses: {
      consumo: ['06', '07', '08', '09', '10', '11', '12 (ATUAL)'],
      chegada: ['12', '01', '02', '03', '04'],
      programacao: ['12', '01', '02', '03'],
    },
    produtos: { total: 3 },
    historico: {
      meses: [
        { yearMonth: '2026-10', linhas: 4 },
        { yearMonth: '2026-11', linhas: 5 },
      ],
      ausentes: [],
      mesAnterior: { yearMonth: '2026-11', linhas: 5, novas: 1, alteradas: 2, removidas: 3 },
    },
    relatorios: {
      saldo: rel({
        porDeposito: [
          { deposito: 'DEPÓSITO A', incluido: true, linhas: 4, saldo: 1000 },
          { deposito: 'DEPÓSITO B', incluido: false, linhas: 2, saldo: 300 },
        ],
        outrasEmpresas: [{ empresa: 'EMPRESA Y', linhas: 1, saldo: 50 }],
      }),
      vendasMes: rel({ empresas: ['EMPRESA X'] }),
      vendasAtual: rel({ empresas: ['EMPRESA X'] }),
      vendasAnual: rel({ empresas: ['EMPRESA X', 'EMPRESA Y'] }),
      programacao: rel({
        porStatus: [{ status: 'Pendente', incluido: true, linhas: 3, qtd: 600 }],
        foraDaJanela: { antes: 1, depois: 2 },
      }),
      fup: rel({
        porStatus: [
          { status: 'STATUS A', incluido: true, linhas: 5, kg: 8000 },
          { status: 'STATUS B', incluido: true, linhas: 2, kg: 2000 },
          { status: 'CONCLUÍDO', incluido: false, linhas: 4, kg: 900 },
        ],
        estimadasPorEtd: { linhas: 1, kg: 500 },
        vencidasNoMesBase: { linhas: 2, kg: 700 },
        semData: {
          linhas: 3,
          kg: 2500,
          porStatus: [
            { status: 'STATUS A', linhas: 2, kg: 1500 },
            { status: 'STATUS B', linhas: 1, kg: 1000 },
          ],
        },
        depoisDaJanela: { linhas: 1, kg: 300 },
      }),
      ...relatorios,
    },
    avisos: ['Aviso de teste.'],
    erros: [],
    ...over,
  };
}


const est = (media: number, poucas = false) => ({ chegadas: poucas ? 2 : 12, media, mediana: media, min: media - 5, max: media + 5, poucasChegadas: poucas });
const DADOS_FONTES = {
  quinzena: { id: 9, label: '11-1', baseDate: '2033-11-05' },
  disponivel: true,
  motivo: null,
  janelaDias: 365,
  minChegadas: 3,
  padraoEtdDias: 35,
  fontes: [
    { sourceId: 1, nome: 'FONTE A', leadTimeDays: 60, clearanceDays: 7, etdDiasUsado: 35, real: { po: est(74), etd: est(50) } },
    { sourceId: 2, nome: 'FONTE B', leadTimeDays: 45, clearanceDays: 5, etdDiasUsado: 35, real: { po: est(41), etd: est(30) } },
    { sourceId: 3, nome: 'FONTE C', leadTimeDays: 30, clearanceDays: null, etdDiasUsado: 35, real: { po: est(30), etd: est(30) } },
    { sourceId: 4, nome: 'FONTE D', leadTimeDays: 30, clearanceDays: null, etdDiasUsado: 35, real: { po: est(70, true), etd: null } },
  ],
  semFonte: { chegadas: 0 },
};

function comClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: DADOS_FONTES });
});

describe('F13-E: Fontes e lead time', () => {
  it('a diferenca vira selo (aviso acima, ok abaixo, neutro igual) e sem dado segue como traco', async () => {
    comClient(<ForecastFontesModal podeEditar onFechar={vi.fn()} />);
    const linha = async (nome: string) => (await screen.findByRole('rowheader', { name: nome })).closest('tr') as HTMLElement;
    expect(within(await linha('FONTE A')).getByText('+14 dias').className).toBe('badge badge--warning');
    expect(within(await linha('FONTE B')).getByText('−4 dias').className).toBe('badge badge--success');
    expect(within(await linha('FONTE C')).getByText('igual').className).toBe('badge badge--muted');
    expect(within(await linha('FONTE D')).queryByText(/dias$/, { selector: '.badge' })).toBeNull();
  });

  it('o botao Editar fica na celula do lead time (como no board) e a coluna Acao (vazia no board) deixou de existir', async () => {
    comClient(<ForecastFontesModal podeEditar onFechar={vi.fn()} />);
    const linha = (await screen.findByRole('rowheader', { name: 'FONTE A' })).closest('tr') as HTMLElement;
    const celulas = within(linha).getAllByRole('cell');
    const leadTime = celulas[1] as HTMLElement;
    expect(within(leadTime).getByRole('button', { name: 'Editar lead time de FONTE A' })).toBeTruthy();
    expect(leadTime.textContent).toContain('60 dias');
    expect(screen.queryByRole('columnheader', { name: 'Ação' })).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(9); // + Prontidão → ETA FINAL (real)
    expect(screen.getByRole('table', { name: 'Lead time cadastrado e prazo real por fonte' }).className).toBe('table');
  });

  it('tem rodape com o botao Fechar (alem do X do cabecalho) que chama onFechar', async () => {
    const onFechar = vi.fn();
    comClient(<ForecastFontesModal podeEditar={false} onFechar={onFechar} />);
    await screen.findByRole('table', { name: /Lead time cadastrado/ });
    const botoes = screen.getAllByRole('button', { name: 'Fechar' });
    expect(botoes).toHaveLength(2);
    fireEvent.click(botoes[1] as HTMLElement);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});

describe('F13-E: Grupos de equivalencia', () => {
  const GRUPO = {
    id: 7,
    nome: 'GRUPO SINTETICO',
    observacao: null,
    principalProdutoId: 1,
    membros: [{ id: 1, nome: 'PRODUTO 001', fonte: 'FONTE 001', ativo: true, sobDemanda: false }],
  };
  const PRODUTOS = [
    { id: 3, name: 'PRODUTO 003', isActive: true, source: null, codes: [{ code: 'C3' }], equivalenceGroupId: null },
    { id: 4, name: 'PRODUTO 004', isActive: true, source: null, codes: [{ code: 'C4' }], equivalenceGroupId: null },
  ];

  beforeEach(() => {
    get.mockImplementation(async (path: string) => ({ data: path.includes('equivalence-groups') ? [GRUPO] : PRODUTOS }));
  });

  it('o dialogo tem a classe de 640 px e a lista mostra "Desfazer grupo" com o nome acessivel de sempre', async () => {
    comClient(<ForecastGruposModal podeEditar onFechar={vi.fn()} />);
    const botao = await screen.findByRole('button', { name: 'Desfazer o grupo GRUPO SINTETICO' });
    expect(botao.textContent).toBe('Desfazer grupo');
    expect(document.querySelector('dialog')?.className).toContain('fcg-dialogo');
    expect(screen.getByRole('button', { name: 'Novo grupo' }).querySelector('svg')).not.toBeNull();
  });

  it('o formulario novo tem a busca com lupa (mesmo campo, mesmo nome) e a confirmacao vira o cartao do board', async () => {
    comClient(<ForecastGruposModal podeEditar onFechar={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Novo grupo' }));
    const busca = await screen.findByRole('searchbox', { name: 'Buscar produto por nome ou código' });
    expect(busca.closest('.fcg-busca')?.querySelector('svg')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Nome do grupo'), { target: { value: 'NOVO' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /PRODUTO 003/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PRODUTO 004/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e salvar' }));
    const titulo = await screen.findByRole('heading', { name: 'Confirmar o grupo NOVO' });
    expect(titulo.closest('form')?.className).toContain('fcg-confirmar');
  });
});

describe('F13-E: Importar quinzena', () => {
  const renderImport = (somenteDbcorp = false) =>
    comClient(<ForecastImportModal aberto onFechar={vi.fn()} quinzenasExistentes={[]} onImportada={vi.fn()} somenteDbcorp={somenteDbcorp} />);

  it('o botao "Escolher .xlsx" e um rotulo do MESMO <input type=file> (que continua no DOM, so oculto); escolher troca por nome, tamanho e Remover', () => {
    renderImport();
    fireEvent.click(screen.getByRole('tab', { name: 'Relatórios DBCorp' }));
    const escolher = screen.getAllByText('Escolher .xlsx');
    expect(escolher).toHaveLength(8);
    const entrada = screen.getByLabelText('SALDO') as HTMLInputElement;
    expect(entrada.type).toBe('file');
    expect(entrada.closest('.fci-arquivo')).not.toBeNull();
    expect((escolher[0] as HTMLLabelElement).htmlFor).toBe(entrada.id);
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array(2048)], 'saldo-teste.xlsx')] } });
    expect(screen.getAllByText('Escolher .xlsx')).toHaveLength(7);
    expect(screen.getByText('saldo-teste.xlsx')).toBeTruthy();
    expect(screen.getByText('2,0 KB')).toBeTruthy();
    expect(document.querySelector('#fci-slot-saldo')).toBe(entrada);
    fireEvent.click(screen.getByRole('button', { name: 'Remover saldo-teste.xlsx' }));
    expect(screen.getAllByText('Escolher .xlsx')).toHaveLength(8);
  });

  it('data-base e quinzena vem DEPOIS das abas e da nota, no painel da origem (board), nos dois fluxos', () => {
    renderImport();
    const painel = screen.getByRole('tabpanel');
    const nota = painel.querySelector('.fci-nota-origem') as HTMLElement;
    const comuns = painel.querySelector('.fci-comuns') as HTMLElement;
    expect(nota.compareDocumentPosition(comuns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('Data-base')).toBeTruthy();
    expect(screen.getByLabelText('Arquivo da planilha')).toBeTruthy();
  });

  it('sem a planilha (comprador) a secao DBCorp traz nota, campos comuns e cartoes, nessa ordem', () => {
    renderImport(true);
    const secao = document.querySelector('.fci-origem') as HTMLElement;
    const filhos = [...secao.children].map((c) => c.className.split(' ')[0]);
    expect(filhos.indexOf('fit-nota-dbcorp')).toBeLessThan(filhos.indexOf('fci-comuns'));
    expect(filhos.indexOf('fci-comuns')).toBeLessThan(filhos.indexOf('fci-slots'));
  });
});

describe('F13-E: linha do tempo dos Eventos', () => {
  const linha = (chave: string, escopo: LinhaDoTempo['escopo'], ativa: boolean): LinhaDoTempo => ({
    chave,
    nome: `EVENTO ${chave}`,
    alcance: 'x',
    ativa,
    escopo,
    ocorrencias: [{ inicio: '2026-03-01', fim: '2026-03-05' }],
  });

  it('a barra leva a classe do alcance (global, pais, fonte) e a de inativo', () => {
    const { container } = render(
      <ForecastOcasioesLinhaDoTempo
        ano={2026}
        hoje="2026-11-03"
        linhas={[linha('g', 'global', true), linha('p', 'pais', true), linha('f', 'fonte', true), linha('i', 'pais', false), linha('s', undefined, true)]}
        carregando={false}
        erro={null}
        onTentar={vi.fn()}
      />,
    );
    const classes = [...container.querySelectorAll('.fco-linha__barra')].map((b) => b.className);
    expect(classes).toEqual([
      'fco-linha__barra fco-linha__barra--global',
      'fco-linha__barra fco-linha__barra--pais',
      'fco-linha__barra fco-linha__barra--fonte',
      'fco-linha__barra fco-linha__barra--pais fco-linha__barra--inativa',
      'fco-linha__barra fco-linha__barra--global',
    ]);
  });
});

describe('F13-E: Importar - entrada recolhida depois de pre-visualizar (D-E2)', () => {
  it('o CSS recolhe a entrada (display:none em .fci-fieldset--recolhido) e mantem o botao visivel', () => {
    const lf = readSource('../styles/globals.css').replace(/\r\n/g, '\n');
    expect(lf).toContain('.fc-pagina .fci-fieldset--recolhido { display: none; }');
    expect(lf).toContain('.fc-pagina .fci-alterar { display: flex; }');
  });

  it('Pre-visualizar recolhe a entrada; "Editar entrada" reabre, descarta a previa e preserva os arquivos', async () => {
    post.mockResolvedValueOnce({ data: resumoDbcorp() });
    comClient(<ForecastImportModal aberto onFechar={vi.fn()} quinzenasExistentes={[]} onImportada={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Relatórios DBCorp' }));
    fireEvent.change(screen.getByLabelText('Data-base'), { target: { value: '2026-12-15' } });
    fireEvent.click(screen.getByLabelText('2ª'));
    for (const s of ['saldo', 'vendasMes', 'vendasAtual', 'vendasAnual', 'programacao', 'fup']) {
      fireEvent.change(document.querySelector(`#fci-slot-${s}`) as HTMLInputElement, { target: { files: [new File([new Uint8Array([1])], `${s}-teste.xlsx`)] } });
    }
    expect(screen.queryByRole('button', { name: 'Editar entrada' })).toBeNull();
    expect(document.querySelector('.fci-fieldset')?.className).toBe('fci-fieldset');
    fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar' }));
    await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
    expect(document.querySelector('.fci-fieldset')?.className).toBe('fci-fieldset fci-fieldset--recolhido');
    fireEvent.click(screen.getByRole('button', { name: 'Editar entrada' }));
    expect(screen.queryByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' })).toBeNull();
    expect(document.querySelector('.fci-fieldset')?.className).toBe('fci-fieldset');
    expect(screen.queryByRole('button', { name: 'Editar entrada' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remover saldo-teste.xlsx' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remover fup-teste.xlsx' })).toBeTruthy();
    expect((screen.getByLabelText('Data-base') as HTMLInputElement).value).toBe('2026-12-15');
    expect(screen.getByRole('button', { name: 'Pré-visualizar' })).toBeTruthy();
  });
});
