import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastImportModal from './ForecastImportModal';

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

import { api, ApiError } from '@/api/client';

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);
const MB = 1024 * 1024;

// ---------- dados 100% sinteticos ----------
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

function resumoPlanilha(historico: Record<string, unknown> = {}) {
  return {
    label: '12-2',
    baseDate: '2026-12-15',
    half: 2,
    produtos: { total: 3, novos: 1, alterados: 1, inativados: 0 },
    codigos: { total: 4, vinculadosCatalogo: 2, movidos: 0 },
    fontes: { total: 2, novas: 0, alteradas: 1, comFornecedor: 1 },
    historico: { yearMonth: '2026-11', linhas: 5, novas: 1, alteradas: 2, removidas: 0, ...historico },
    conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
    avisos: [],
    erros: [],
  };
}

const arquivo = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome);

function renderModal(quinzenasExistentes: string[] = ['10-2', '11-1']) {
  const onFechar = vi.fn();
  const onImportada = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ForecastImportModal aberto onFechar={onFechar} quinzenasExistentes={quinzenasExistentes} onImportada={onImportada} />
    </QueryClientProvider>,
  );
  return { onFechar, onImportada, invalidate };
}

function preencherComuns(data = '2026-12-15', quinzena = '2ª') {
  fireEvent.change(screen.getByLabelText('Data-base'), { target: { value: data } });
  fireEvent.click(screen.getByLabelText(quinzena));
}

const abrirDbcorp = () => fireEvent.click(screen.getByRole('tab', { name: 'Relatórios DBCorp' }));

function escolher(slot: string, file: File = arquivo(`${slot}-teste.xlsx`)) {
  fireEvent.change(document.querySelector(`#fci-slot-${slot}`) as HTMLInputElement, { target: { files: [file] } });
}

const SLOTS_2A = ['saldo', 'vendasMes', 'vendasAtual', 'vendasAnual', 'programacao', 'fup'];
const escolherTodos = (slots = SLOTS_2A) => slots.forEach((s) => escolher(s));

const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement;
const queryBotao = (nome: string) => screen.queryByRole('button', { name: nome }) as HTMLButtonElement | null;

async function previsualizarDbcorp(resumo: unknown = resumoDbcorp()) {
  post.mockResolvedValueOnce({ data: resumo });
  abrirDbcorp();
  preencherComuns();
  escolherTodos();
  fireEvent.click(botao('Pré-visualizar'));
  await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
}

async function previsualizarPlanilha(resumo: unknown = resumoPlanilha()) {
  post.mockResolvedValueOnce({ data: resumo });
  preencherComuns();
  fireEvent.change(screen.getByLabelText('Arquivo da planilha'), { target: { files: [arquivo('planilha-teste.xlsx')] } });
  fireEvent.click(botao('Pré-visualizar'));
  await screen.findByRole('heading', { name: 'Pré-visualização da planilha' });
}

beforeEach(() => {
  vi.restoreAllMocks();
  post.mockReset();
});

describe('ForecastImportModal - campos e rotulo', () => {
  it('Pre-visualizar fica desabilitado e a lista "Faltam" acompanha o que falta', () => {
    renderModal();
    expect(botao('Pré-visualizar').disabled).toBe(true);
    expect(screen.getByText('Faltam: data-base, quinzena, arquivo da planilha')).toBeTruthy();

    abrirDbcorp();
    expect(screen.getByText(/^Faltam: data-base, quinzena, SALDO, VENDAS do mês anterior, VENDAS anual, PROGRAMAÇÃO, FUP$/)).toBeTruthy();

    preencherComuns();
    expect(screen.getByText('Faltam: SALDO, VENDAS do mês anterior, VENDAS do mês atual (até o dia 15), VENDAS anual, PROGRAMAÇÃO, FUP')).toBeTruthy();
    escolherTodos();
    expect(screen.queryByText(/^Faltam:/)).toBeNull();
    expect(botao('Pré-visualizar').disabled).toBe(false);
  });

  it('1a quinzena nao exige o relatorio de vendas do mes atual', () => {
    renderModal();
    abrirDbcorp();
    preencherComuns('2026-12-05', '1ª');
    escolherTodos(['saldo', 'vendasMes', 'vendasAnual', 'programacao', 'fup']);
    expect(botao('Pré-visualizar').disabled).toBe(false);
  });

  it('o rotulo e derivado da data-base e da quinzena', () => {
    renderModal();
    expect(screen.getByText('Rótulo: —')).toBeTruthy();
    preencherComuns('2026-10-15', '2ª');
    expect(screen.getByText('Rótulo: 10-2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('1ª'));
    expect(screen.getByText('Rótulo: 10-1')).toBeTruthy();
  });

  it('data inexistente nao gera rotulo e continua faltando', () => {
    renderModal();
    preencherComuns('2026-02-30', '2ª');
    expect(screen.getByText('Rótulo: —')).toBeTruthy();
    expect(screen.getByText(/^Faltam: data-base/)).toBeTruthy();
  });

  it('cada slot tem label ligada ao input de arquivo .xlsx', () => {
    renderModal();
    abrirDbcorp();
    for (const id of ['SALDO', 'VENDAS do mês anterior', 'VENDAS anual', 'PROGRAMAÇÃO', 'FUP', 'CLIENTES ATIVOS', 'MARGEM']) {
      const input = screen.getByLabelText(id) as HTMLInputElement;
      expect(input.type).toBe('file');
      expect(input.accept).toContain('.xlsx');
    }
    expect(screen.getAllByText('obrigatório')).toHaveLength(5);
    expect(screen.getAllByText('opcional')).toHaveLength(3);
  });

  it('as abas respondem as setas do teclado', () => {
    renderModal();
    const planilha = screen.getByRole('tab', { name: 'Planilha (.xlsx)' });
    expect(planilha.getAttribute('aria-selected')).toBe('true');
    planilha.focus();
    fireEvent.keyDown(planilha, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Relatórios DBCorp' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('SALDO')).toBeTruthy();
  });

  it('o rotulo ja existente avisa e bloqueia o Confirmar (DBCorp)', async () => {
    renderModal(['12-2']);
    await previsualizarDbcorp();
    expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Já existe a quinzena 12-2. A confirmação será recusada.')).toBe(true);
    expect(botao('Confirmar importação').disabled).toBe(true);
  });
});

describe('ForecastImportModal - preview DBCorp', () => {
  it('envia SO o contrato e mostra o resumo legivel', async () => {
    renderModal();
    await previsualizarDbcorp();

    const [path, corpo] = post.mock.calls[0] as [string, { label: string; baseDate: string; files: Record<string, unknown> }];
    expect(path).toBe('/v1/forecast/import/dbcorp/preview');
    expect(Object.keys(corpo)).toEqual(['label', 'baseDate', 'files']);
    expect(corpo.label).toBe('12-2');
    expect(corpo.baseDate).toBe('2026-12-15');
    expect(Object.keys(corpo.files)).toEqual(SLOTS_2A);
    for (const slot of SLOTS_2A) {
      expect(corpo.files[slot]).toEqual({ fileName: `${slot}-teste.xlsx`, contentBase64: 'AQID' });
    }

    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
    expect(resumo.getByText(/Quinzena 12-2 · base 15\/12\/2026 · 2ª quinzena · 3 produtos ativos/)).toBeTruthy();
    // SALDO: depositos incluido x excluido com totais
    expect(resumo.getByText('DEPÓSITO A')).toBeTruthy();
    expect(resumo.getByText('DEPÓSITO B')).toBeTruthy();
    expect(resumo.getByText('Incluído: 1.000 · Excluído: 300')).toBeTruthy();
    expect(resumo.getByText('EMPRESA Y')).toBeTruthy();
    // VENDAS: empresas
    expect(resumo.getByText(/VENDAS anual — Empresas encontradas: EMPRESA X, EMPRESA Y/)).toBeTruthy();
    // PROGRAMACAO
    expect(resumo.getByText('Fora da janela: 1 antes do mês base · 2 depois de 4 meses')).toBeTruthy();
    // FUP
    expect(resumo.getByText('Em aberto: 10.000 kg')).toBeTruthy();
    expect(
      resumo.getByText('Sem data: 3 linhas · 2.500 kg (25% do em aberto) ficaram FORA das chegadas'),
    ).toBeTruthy();
    expect(resumo.getByText('STATUS A: 2 linhas · 1.500 kg')).toBeTruthy();
    expect(resumo.getByText('STATUS B: 1 linhas · 1.000 kg')).toBeTruthy();
    expect(resumo.getByText(/Vencidas \(entraram no mês base\): 2 linhas · 700 kg/)).toBeTruthy();
    expect(resumo.getByText(/Estimadas por ETD \+ 35 dias: 1 linhas · 500 kg/)).toBeTruthy();
    expect(resumo.getByText(/Depois da janela de 5 meses \(ignoradas\): 1 linhas · 300 kg/)).toBeTruthy();
    // historico
    expect(
      resumo.getByText(/Ao confirmar, o histórico de 11\/2026 será substituído: 5 linhas \(1 novas, 2 alteradas, 3 removidas\)\./),
    ).toBeTruthy();
    // motivo traduzido e aviso
    expect(resumo.getAllByText('sem código: 2').length).toBeGreaterThan(0);
    expect(resumo.getByText('Aviso de teste.')).toBeTruthy();
    // nada travado: todos os relatorios tem linhas
    expect(botao('Confirmar importação').disabled).toBe(false);
    expect(screen.queryByLabelText(/Entendi/)).toBeNull();
  });

  it('o foco vai para o titulo do resumo', async () => {
    renderModal();
    await previsualizarDbcorp();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Pré-visualização dos relatórios DBCorp'));
  });

  it('erros do preview: role="alert" e Confirmar desabilitado', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ erros: ['Relatorio de vendas do mes anterior sem linhas validas.'] }));
    const alertas = screen.getAllByRole('alert');
    expect(alertas.some((a) => a.textContent?.includes('Relatorio de vendas do mes anterior sem linhas validas.'))).toBe(true);
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('um relatorio sem linhas uteis recebe selo', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({}, { saldo: rel({ usadas: 0, porDeposito: [] }) }));
    expect(screen.getAllByText('sem linhas úteis').some((e) => e.classList.contains('badge'))).toBe(true);
  });

  it('extras ausentes nao quebram a renderizacao', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp(
        { historico: { meses: [], ausentes: [], mesAnterior: null } },
        { saldo: rel(), fup: rel(), programacao: rel() },
      ),
    );
    expect(screen.queryByText(/Ao confirmar, o histórico/)).toBeNull();
    expect(botao('Confirmar importação').disabled).toBe(false);
  });
});

describe('ForecastImportModal - trava "Entendi"', () => {
  const semSaldo = () => resumoDbcorp({}, { saldo: rel({ usadas: 0, porDeposito: [] }) });

  it('saldo sem linhas uteis: Confirmar so habilita depois da caixa', async () => {
    renderModal();
    await previsualizarDbcorp(semSaldo());
    const caixa = screen.getByLabelText(/Entendi que SALDO veio sem linhas úteis e quero criar a quinzena assim mesmo\./) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    expect(botao('Confirmar importação').disabled).toBe(true);
    fireEvent.click(caixa);
    expect(botao('Confirmar importação').disabled).toBe(false);
    fireEvent.click(caixa);
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('varios relatorios vazios entram na mesma frase; vendas do mes anterior vazio nao', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp({}, { vendasMes: rel({ usadas: 0 }), vendasAnual: rel({ usadas: 0 }), fup: rel({ usadas: 0 }) }),
    );
    expect(screen.getByLabelText(/Entendi que VENDAS anual, FUP vieram sem linhas úteis/)).toBeTruthy();
  });

  it('trocar um arquivo depois do preview descarta o resumo e a caixa', async () => {
    renderModal();
    await previsualizarDbcorp(semSaldo());
    fireEvent.click(screen.getByLabelText(/Entendi/));
    escolher('fup', arquivo('outro-teste.xlsx'));
    expect(screen.queryByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' })).toBeNull();
    expect(screen.queryByLabelText(/Entendi/)).toBeNull();
    expect(queryBotao('Confirmar importação')).toBeNull();

    post.mockResolvedValueOnce({ data: semSaldo() });
    fireEvent.click(botao('Pré-visualizar'));
    const caixa = (await screen.findByLabelText(/Entendi/)) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
  });

  it('mudar data-base, quinzena ou aba tambem descarta o resumo', async () => {
    renderModal();
    await previsualizarDbcorp();
    fireEvent.change(screen.getByLabelText('Data-base'), { target: { value: '2026-12-14' } });
    expect(screen.queryByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' })).toBeNull();

    post.mockResolvedValueOnce({ data: resumoDbcorp() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
    fireEvent.click(screen.getByLabelText('1ª'));
    expect(screen.queryByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' })).toBeNull();

    post.mockResolvedValueOnce({ data: resumoDbcorp() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
    fireEvent.click(screen.getByRole('tab', { name: 'Planilha (.xlsx)' }));
    expect(screen.queryByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' })).toBeNull();
  });
});

describe('ForecastImportModal - regra F3 e DATA PRONTIDAO (PR 3A)', () => {
  const regra = {
    id: 'F3',
    etaPorEtdDias: 35,
    etaPorProntidaoDias: 35,
    excluiEtaFinal: true,
    statusExcluidos: ['ATRAC. AG. LIBERAÇÃO'],
  };
  const fupF3 = (over: Record<string, unknown> = {}) =>
    rel({
      porStatus: [
        { status: 'STATUS A', incluido: true, linhas: 5, kg: 8000 },
        { status: 'ATRAC. AG. LIBERACAO', incluido: false, linhas: 2, kg: 600 },
        { status: 'CONCLUÍDO', incluido: false, linhas: 4, kg: 900 },
      ],
      regra,
      estimadasPorEtd: { linhas: 1, kg: 500 },
      estimadasPorProntidao: { linhas: 4, kg: 1800 },
      vencidasNoMesBase: { linhas: 0, kg: 0 },
      semData: { linhas: 0, kg: 0, porStatus: [] },
      depoisDaJanela: { linhas: 0, kg: 0 },
      excluidas: {
        atracadas: { linhas: 2, kg: 600 },
        etaFinalPreenchida: {
          linhas: 3,
          kg: 1200,
          porStatus: [{ status: 'STATUS A', linhas: 3, kg: 1200 }],
          depoisDaDataBase: { linhas: 1, kg: 100 },
        },
      },
      prontidaoNaoReconhecida: { linhas: 0, kg: 0, detalhes: [], omitidos: 0 },
      ...over,
    });
  const naoReconhecida = (omitidos = 0) => ({
    linhas: 2 + omitidos,
    kg: 840,
    detalhes: [
      { linha: 12, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0007', kg: 800, texto: 'ASAP' },
      { linha: 15, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0008', kg: 40, texto: 'WITH PO 123-45' },
    ],
    omitidos,
  });

  it('mostra a regra, as excluidas e as estimadas, cada uma com o selo ESTIMADA', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({}, { fup: fupF3() }));
    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
    expect(
      resumo.getByText(
        'Regra F3: atracadas e linhas com ETA FINAL ficam fora; chegada = ETA, senão ETD + 35 dias, senão DATA PRONTIDÃO + 35 dias (estimada).',
      ),
    ).toBeTruthy();
    expect(
      resumo.getByText(
        /^Excluídas pela regra: ATRAC\. AG\. LIBERAÇÃO — 2 linhas · 600 kg · ETA FINAL preenchida — 3 linhas · 1\.200 kg \(1 com ETA FINAL depois da data base\)$/,
      ),
    ).toBeTruthy();
    const etd = resumo.getByText(/^Estimadas por ETD \+ 35 dias: 1 linhas · 500 kg/);
    const prontidao = resumo.getByText(/^Estimadas por DATA PRONTIDÃO \+ 35 dias: 4 linhas · 1\.800 kg/);
    for (const linha of [etd, prontidao]) {
      const selo = within(linha).getByText('ESTIMADA');
      expect(selo.className).toBe('badge badge--warning');
    }
    expect(resumo.getAllByText('ESTIMADA')).toHaveLength(2);
    // sem prontidao nao reconhecida: nada de destaque nem de trava
    expect(resumo.queryByText(/DATA PRONTIDÃO não reconhecida:/)).toBeNull();
    expect(screen.queryByLabelText(/Entendi/)).toBeNull();
    expect(botao('Confirmar importação').disabled).toBe(false);
  });

  it('os dias vem da regra do backend (nao do texto fixo)', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp({}, { fup: fupF3({ regra: { ...regra, etaPorEtdDias: 30, etaPorProntidaoDias: 45 } }) }),
    );
    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
    expect(resumo.getByText(/senão ETD \+ 30 dias, senão DATA PRONTIDÃO \+ 45 dias \(estimada\)/)).toBeTruthy();
    expect(resumo.getByText(/^Estimadas por ETD \+ 30 dias:/)).toBeTruthy();
    expect(resumo.getByText(/^Estimadas por DATA PRONTIDÃO \+ 45 dias:/)).toBeTruthy();
  });

  it('prontidao nao reconhecida: destaque com a tabela e Confirmar travado ate a caixa', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({}, { fup: fupF3({ prontidaoNaoReconhecida: naoReconhecida(3) }) }));
    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
    expect(
      resumo.getByText('DATA PRONTIDÃO não reconhecida: 5 linhas · 840 kg ficaram FORA das chegadas'),
    ).toBeTruthy();
    const tabela = resumo.getByRole('table', { name: 'Linhas do FUP com DATA PRONTIDÃO não reconhecida' });
    expect(within(tabela).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Linha do FUP',
      'Status',
      'Código',
      'kg',
      'Texto',
    ]);
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas.map((l) => Array.from(l.children).map((c) => c.textContent))).toEqual([
      ['12', 'AG. PAGAMENTO (ANT)', 'TST0007', '800', 'ASAP'],
      ['15', 'AG. PAGAMENTO (ANT)', 'TST0008', '40', 'WITH PO 123-45'],
    ]);
    expect(resumo.getByText('… e mais 3 linhas')).toBeTruthy();

    const caixa = screen.getByLabelText(
      'Entendi que 5 linhas (840 kg) do FUP com DATA PRONTIDÃO não reconhecida ficam fora das chegadas.',
    ) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    expect(botao('Confirmar importação').disabled).toBe(true);
    fireEvent.click(caixa);
    expect(botao('Confirmar importação').disabled).toBe(false);
    fireEvent.click(caixa);
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('sem "… e mais" quando nada foi omitido; trocar arquivo descarta a caixa da prontidao', async () => {
    renderModal();
    const comTrava = resumoDbcorp({}, { fup: fupF3({ prontidaoNaoReconhecida: naoReconhecida() }) });
    await previsualizarDbcorp(comTrava);
    expect(screen.queryByText(/^… e mais/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Entendi que 2 linhas/));
    expect(botao('Confirmar importação').disabled).toBe(false);

    escolher('fup', arquivo('outro-teste.xlsx'));
    expect(queryBotao('Confirmar importação')).toBeNull();
    post.mockResolvedValueOnce({ data: comTrava });
    fireEvent.click(botao('Pré-visualizar'));
    const caixa = (await screen.findByLabelText(/Entendi que 2 linhas/)) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('as duas travas (sem linhas uteis + prontidao) valem juntas', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp(
        {},
        {
          saldo: rel({ usadas: 0, porDeposito: [] }),
          fup: fupF3({ prontidaoNaoReconhecida: naoReconhecida() }),
        },
      ),
    );
    fireEvent.click(screen.getByLabelText(/Entendi que SALDO veio sem linhas úteis/));
    expect(botao('Confirmar importação').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Entendi que 2 linhas/));
    expect(botao('Confirmar importação').disabled).toBe(false);
  });

  it('confirmar com a caixa marcada reenvia o MESMO corpo (o backend nao bloqueia)', async () => {
    const { onImportada } = renderModal();
    await previsualizarDbcorp(resumoDbcorp({}, { fup: fupF3({ prontidaoNaoReconhecida: naoReconhecida() }) }));
    fireEvent.click(screen.getByLabelText(/Entendi que 2 linhas/));
    post.mockResolvedValueOnce({ data: { ...resumoDbcorp(), snapshotId: 7 } });
    fireEvent.click(botao('Confirmar importação'));
    await waitFor(() => expect(onImportada).toHaveBeenCalledWith(7, '12-2'));
    expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
  });

  it('backend antigo (sem os campos novos): renderiza como hoje, sem regra, sem trava, ETD + 35 dias', async () => {
    renderModal();
    await previsualizarDbcorp();
    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
    expect(resumo.queryByText(/^Regra /)).toBeNull();
    expect(resumo.queryByText(/^Excluídas pela regra/)).toBeNull();
    expect(resumo.queryByText(/^Estimadas por DATA PRONTIDÃO/)).toBeNull();
    expect(resumo.getByText(/^Estimadas por ETD \+ 35 dias: 1 linhas · 500 kg/)).toBeTruthy();
    expect(resumo.getAllByText('ESTIMADA')).toHaveLength(1);
    expect(screen.queryByLabelText(/Entendi/)).toBeNull();
    expect(botao('Confirmar importação').disabled).toBe(false);
  });

  it('motivos novos aparecem com acento na tabela de relatorios', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp(
        {},
        {
          fup: fupF3({
            ignoradas: {
              'atracada aguardando liberacao': 2,
              'eta final preenchida': 3,
              'prontidao nao reconhecida': 0,
            },
          }),
        },
      ),
    );
    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
    expect(
      resumo.getByText(
        'atracada aguardando liberação: 2 · ETA FINAL preenchida (já chegou): 3 · DATA PRONTIDÃO não reconhecida: 0',
      ),
    ).toBeTruthy();
  });
});

describe('ForecastImportModal - confirmar', () => {
  it('reenvia o MESMO corpo do preview e chama onImportada com o id novo', async () => {
    const { onImportada } = renderModal();
    await previsualizarDbcorp();
    post.mockResolvedValueOnce({ data: { ...resumoDbcorp(), snapshotId: 99 } });
    fireEvent.click(botao('Confirmar importação'));
    await waitFor(() => expect(onImportada).toHaveBeenCalledWith(99, '12-2'));
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[0]).toBe('/v1/forecast/import/dbcorp/confirm');
    expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
  });

  it('dois cliques em Confirmar geram um unico POST', async () => {
    renderModal();
    await previsualizarDbcorp();
    post.mockReturnValueOnce(new Promise(() => undefined) as never);
    const confirmar = botao('Confirmar importação');
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    const gravando = botao('Gravando…');
    expect(gravando.disabled).toBe(true);
    fireEvent.click(gravando);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2)); // 1 preview + 1 confirm
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(post).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.fci-modal')?.getAttribute('aria-busy')).toBe('true');
  });

  it('fechar com o confirm pendente nao chama onFechar', async () => {
    const { onFechar } = renderModal();
    await previsualizarDbcorp();
    post.mockReturnValueOnce(new Promise(() => undefined) as never);
    fireEvent.click(botao('Confirmar importação'));
    fireEvent.click(botao('Fechar'));
    expect(onFechar).not.toHaveBeenCalled();
    expect(botao('Cancelar').disabled).toBe(true);
  });

  it('fechar durante o preview e permitido', async () => {
    const { onFechar } = renderModal();
    post.mockReturnValueOnce(new Promise(() => undefined) as never);
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    fireEvent.click(botao('Pré-visualizar'));
    expect(((await screen.findByRole('button', { name: 'Pré-visualizando…' })) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(botao('Fechar'));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('409 mostra a mensagem com o rotulo e nao fecha', async () => {
    const { onImportada } = renderModal();
    await previsualizarDbcorp();
    post.mockRejectedValueOnce(new ApiError(409, { message: 'qualquer' }));
    fireEvent.click(botao('Confirmar importação'));
    expect(await screen.findByText('Já existe a quinzena 12-2. Nada foi gravado.')).toBeTruthy();
    expect(onImportada).not.toHaveBeenCalled();
    expect(botao('Confirmar importação').disabled).toBe(false);
  });

  it('413 mostra o texto do limite', async () => {
    renderModal();
    await previsualizarDbcorp();
    post.mockRejectedValueOnce(new ApiError(413, null));
    fireEvent.click(botao('Confirmar importação'));
    expect(
      await screen.findByText('O envio passa do limite de 10 MB (somando todos os arquivos). Nada foi gravado.'),
    ).toBeTruthy();
  });

  it('404 no preview da aba DBCorp avisa que o servidor ainda nao tem a importacao', async () => {
    renderModal();
    post.mockRejectedValueOnce(new ApiError(404, null));
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    fireEvent.click(botao('Pré-visualizar'));
    expect(
      await screen.findByText('O servidor ainda não tem esta importação. Aguarde a atualização do sistema.'),
    ).toBeTruthy();
  });

  it('504 avisa que a importacao pode ter sido concluida e invalida a lista', async () => {
    const { invalidate } = renderModal();
    await previsualizarDbcorp();
    post.mockRejectedValueOnce(new ApiError(504, null));
    fireEvent.click(botao('Confirmar importação'));
    expect(await screen.findByText(/a importação pode ter sido concluída\./)).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['forecast'] });
  });

  it('erro de rede no preview mostra a mensagem e libera os botoes', async () => {
    renderModal();
    post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    fireEvent.click(botao('Pré-visualizar'));
    expect(await screen.findByText('Sem conexão com o servidor. Tente de novo.')).toBeTruthy();
    expect(botao('Pré-visualizar').disabled).toBe(false);
  });
});

describe('ForecastImportModal - limite de 10 MB e arquivos', () => {
  it('um arquivo grande demais: mensagem e nenhum POST', async () => {
    renderModal();
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    const grande = arquivo('saldo-grande.xlsx');
    Object.defineProperty(grande, 'size', { value: 8 * MB });
    escolher('saldo', grande);
    fireEvent.click(botao('Pré-visualizar'));
    expect(
      await screen.findByText('O arquivo SALDO (saldo-grande.xlsx) passa do limite de 10 MB depois da codificação.'),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('dois arquivos que somados passam do total: mensagem e nenhum POST', async () => {
    renderModal();
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    for (const slot of ['saldo', 'fup']) {
      const grande = arquivo(`${slot}-grande.xlsx`);
      Object.defineProperty(grande, 'size', { value: 4 * MB });
      escolher(slot, grande);
    }
    fireEvent.click(botao('Pré-visualizar'));
    expect(
      await screen.findByText(
        'Os arquivos somam 10,7 MB depois da codificação; o limite é 10 MB no total. Envie relatórios menores.',
      ),
    ).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('extensao diferente de .xlsx e arquivo vazio nao chegam ao servidor', async () => {
    renderModal();
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    escolher('fup', arquivo('fup-teste.xls'));
    fireEvent.click(botao('Pré-visualizar'));
    expect(await screen.findByText('Envie o relatório FUP em .xlsx.')).toBeTruthy();
    escolher('fup', new File([], 'fup-vazio.xlsx'));
    fireEvent.click(botao('Pré-visualizar'));
    expect(await screen.findByText('O arquivo fup-vazio.xlsx está vazio.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('remover um arquivo opcional tira o slot do corpo', async () => {
    renderModal();
    abrirDbcorp();
    preencherComuns();
    escolherTodos([...SLOTS_2A, 'margem']);
    fireEvent.click(screen.getByRole('button', { name: 'Remover margem-teste.xlsx' }));
    post.mockResolvedValueOnce({ data: resumoDbcorp() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
    const corpo = post.mock.calls[0]?.[1] as { files: Record<string, unknown> };
    expect('margem' in corpo.files).toBe(false);
  });

  it('remover limpa o campo de arquivo e reescolher o MESMO arquivo volta a valer (slot DBCorp)', async () => {
    renderModal();
    abrirDbcorp();
    preencherComuns();
    escolherTodos([...SLOTS_2A, 'margem']);
    const mesmo = arquivo('margem-teste.xlsx');
    escolher('margem', mesmo);
    const antes = document.querySelector('#fci-slot-margem') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Remover margem-teste.xlsx' }));
    const depois = document.querySelector('#fci-slot-margem') as HTMLInputElement;
    // input novo e vazio: o nome antigo nao fica no campo e o navegador dispara `change` de novo
    expect(depois).not.toBe(antes);
    expect(depois.files?.length ?? 0).toBe(0);
    expect(screen.queryByRole('button', { name: 'Remover margem-teste.xlsx' })).toBeNull();
    escolher('margem', mesmo);
    expect(screen.getByRole('button', { name: 'Remover margem-teste.xlsx' })).toBeTruthy();
    post.mockResolvedValueOnce({ data: resumoDbcorp() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
    const corpo = post.mock.calls[0]?.[1] as { files: Record<string, unknown> };
    expect('margem' in corpo.files).toBe(true);
  });

  it('remover limpa o campo de arquivo e reescolher o MESMO arquivo volta a valer (planilha)', async () => {
    renderModal();
    preencherComuns();
    const mesmo = arquivo('planilha-teste.xlsx');
    const escolherPlanilha = () => fireEvent.change(screen.getByLabelText('Arquivo da planilha'), { target: { files: [mesmo] } });
    escolherPlanilha();
    const antes = screen.getByLabelText('Arquivo da planilha');
    fireEvent.click(screen.getByRole('button', { name: 'Remover planilha-teste.xlsx' }));
    const depois = screen.getByLabelText('Arquivo da planilha') as HTMLInputElement;
    expect(depois).not.toBe(antes);
    expect(depois.files?.length ?? 0).toBe(0);
    expect(screen.getByText(/Faltam:.*arquivo da planilha/)).toBeTruthy();
    escolherPlanilha();
    expect(screen.getByRole('button', { name: 'Remover planilha-teste.xlsx' })).toBeTruthy();
    expect(botao('Pré-visualizar').disabled).toBe(false);
  });
});

describe('ForecastImportModal - corpo nao fica retido', () => {
  it('fechar o modal nao deixa preview nem confirm no cache de mutations', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { quinzenasExistentes: [], onFechar: vi.fn(), onImportada: vi.fn() };
    const arvore = (aberto: boolean) => (
      <QueryClientProvider client={client}>
        <ForecastImportModal aberto={aberto} {...props} />
      </QueryClientProvider>
    );
    const { rerender } = render(arvore(true));
    await previsualizarDbcorp();
    post.mockResolvedValueOnce({ data: { ...resumoDbcorp(), snapshotId: null } });
    fireEvent.click(botao('Confirmar importação'));
    await screen.findByText('Importação concluída. Nenhuma quinzena nova foi criada.');
    // aberto: as duas mutations (com o corpo em base64) existem
    expect(client.getMutationCache().getAll().length).toBe(2);

    rerender(arvore(false));
    await waitFor(() => expect(client.getMutationCache().getAll().length).toBe(0));
  });
});

describe('ForecastImportModal - aba Planilha', () => {
  it('preview e confirm com as tres opcoes marcadas', async () => {
    const { onImportada } = renderModal();
    await previsualizarPlanilha();
    expect(post.mock.calls[0]?.[0]).toBe('/v1/forecast/import/workbook/preview');
    expect(post.mock.calls[0]?.[1]).toEqual({
      contentBase64: 'AQID',
      fileName: 'planilha-teste.xlsx',
      label: '12-2',
      baseDate: '2026-12-15',
    });
    const resumo = within(screen.getByRole('region', { name: 'Pré-visualização da planilha' }));
    expect(resumo.getByText('Histórico de 11/2026')).toBeTruthy();
    expect(resumo.getByText(/o mês é substituído por inteiro/)).toBeTruthy();
    expect(resumo.getByText('Cálculo idêntico ao da planilha')).toBeTruthy();
    expect(resumo.getByText('84 de 84 células batem')).toBeTruthy();

    for (const nome of [
      'Atualizar cadastro (produtos, códigos e fontes)',
      'Gravar histórico de 11/2026',
      'Criar a quinzena 12-2',
    ]) {
      expect((screen.getByLabelText(nome) as HTMLInputElement).checked).toBe(true);
    }
    post.mockResolvedValueOnce({ data: { ...resumoPlanilha(), snapshotId: 9, options: {} } });
    fireEvent.click(botao('Confirmar importação'));
    await waitFor(() => expect(onImportada).toHaveBeenCalledWith(9, '12-2'));
    expect(post.mock.calls[1]?.[0]).toBe('/v1/forecast/import/workbook/confirm');
    expect(post.mock.calls[1]?.[1]).toEqual({
      ...(post.mock.calls[0]?.[1] as object),
      options: { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true },
    });
  });

  it('historico sem linhas: opcao desabilitada e desmarcada, e vai false no confirm', async () => {
    renderModal();
    await previsualizarPlanilha(resumoPlanilha({ linhas: 0, novas: 0, alteradas: 0, removidas: 0 }));
    const historico = screen.getByLabelText('Gravar histórico de 11/2026') as HTMLInputElement;
    expect(historico.disabled).toBe(true);
    expect(historico.checked).toBe(false);
    post.mockResolvedValueOnce({ data: { ...resumoPlanilha(), snapshotId: 9, options: {} } });
    fireEvent.click(botao('Confirmar importação'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect((post.mock.calls[1]?.[1] as { options: unknown }).options).toEqual({
      atualizarCadastro: true,
      gravarHistorico: false,
      criarQuinzena: true,
    });
  });

  it('rotulo existente: "Criar a quinzena" desabilitada e desmarcada, o resto segue', async () => {
    renderModal(['12-2']);
    await previsualizarPlanilha();
    const criar = screen.getByLabelText('Criar a quinzena 12-2') as HTMLInputElement;
    expect(criar.disabled).toBe(true);
    expect(criar.checked).toBe(false);
    expect(botao('Confirmar importação').disabled).toBe(false);
  });

  it('nenhuma opcao marcada: Confirmar desabilitado com a explicacao', async () => {
    renderModal();
    await previsualizarPlanilha();
    fireEvent.click(screen.getByLabelText('Atualizar cadastro (produtos, códigos e fontes)'));
    fireEvent.click(screen.getByLabelText('Gravar histórico de 11/2026'));
    fireEvent.click(screen.getByLabelText('Criar a quinzena 12-2'));
    expect(screen.getByText('Marque ao menos uma opção.')).toBeTruthy();
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('erros do preview da planilha: alerta e sem conferencia', async () => {
    renderModal();
    await previsualizarPlanilha({ ...resumoPlanilha(), erros: ['Aba ausente.'] });
    expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes('Aba ausente.'))).toBe(true);
    expect(screen.queryByText('Cálculo idêntico ao da planilha')).toBeNull();
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('snapshotId nulo: mostra o resultado, invalida a lista e nao navega', async () => {
    const { onImportada, onFechar, invalidate } = renderModal();
    await previsualizarPlanilha();
    fireEvent.click(screen.getByLabelText('Criar a quinzena 12-2'));
    post.mockResolvedValueOnce({ data: { ...resumoPlanilha(), snapshotId: null, options: {} } });
    fireEvent.click(botao('Confirmar importação'));
    expect(await screen.findByText('Importação concluída. Nenhuma quinzena nova foi criada.')).toBeTruthy();
    expect(onImportada).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['forecast'] });
    fireEvent.click(botao('Concluir'));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});

describe('ForecastImportModal - privacidade', () => {
  it('nada vai para storage nem para o console durante o fluxo', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    renderModal();
    await previsualizarDbcorp();
    post.mockResolvedValueOnce({ data: { ...resumoDbcorp(), snapshotId: 99 } });
    fireEvent.click(botao('Confirmar importação'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(setItem).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('ForecastImportModal - pendentes de cadastro (PR 3B-2)', () => {
  const pend = (over: Record<string, unknown>) => ({
    codigo: 'TST0901',
    situacao: 'sem_cadastro',
    produtoInativo: null,
    vendasMes: 20,
    vendasAtual: 0,
    vendasAnual: 1200,
    vendas3Meses: 50,
    vendasAnteriores: 30,
    programacao: 0,
    chegadas: 80,
    comprasEmAberto: 80,
    saldo: 0,
    ...over,
  });
  const inativo = () =>
    pend({ codigo: 'TST0902', situacao: 'produto_inativo', produtoInativo: { id: 9, nome: 'PRODUTO 009' } });
  const pendentes = (itens: unknown[] = [pend({}), inativo()]) => ({
    itens,
    totalItens: itens.length,
    omitidos: 0,
    soSaldo: { codigos: 0, kg: 0 },
    semVendaRecente: { codigos: 3, vendasAnual: 900 },
    regra: { mesesVenda: ['2026-10', '2026-11', '2026-12'], historicoAusente: [], compras: 'fup_em_aberto' },
  });
  const regiao = () => within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));

  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/forecast/sources') {
        return { data: [{ id: 3, name: 'FONTE 001', leadTimeDays: 45, clearanceDays: null, isActive: true }] };
      }
      if (path === '/v1/item-families') return { data: [{ id: 7, name: 'FAMILIA A', isActive: true }] };
      if (path === '/v1/forecast/products') {
        return {
          data: [
            { id: 1, name: 'PRODUTO 001', isActive: true, origin: 'planilha', codes: [{ id: 11, position: 1, code: 'TST0001' }] },
          ],
        };
      }
      throw new Error(`GET inesperado: ${path}`);
    });
  });

  it('mostra o bloco com a tabela, o texto "FORA do calculo" e um botao por codigo SEM cadastro', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes() }));
    expect(regiao().getByRole('heading', { name: 'Pendentes de cadastro (2)' })).toBeTruthy();
    expect(
      regiao().getByText('Ficam FORA do cálculo. Complete o cadastro e pré-visualize de novo para que entrem nesta quinzena.'),
    ).toBeTruthy();
    const tabela = regiao().getByRole('table', { name: /Códigos do DBCorp pendentes de cadastro/ });
    expect(within(tabela).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Código',
      'Situação',
      'Vendas 3 meses',
      'Vendas mês atual',
      'Programação',
      'Compras em aberto (FUP)',
      'Ação',
    ]);
    // O criterio da regra e a contagem do que ficou fora da lista aparecem sob a tabela.
    expect(
      regiao().getByText('Entram na lista: venda em out/2026, nov/2026 ou dez/2026, programação pendente ou compra em aberto no FUP.'),
    ).toBeTruthy();
    expect(regiao().getByText('Sem venda nos últimos 3 meses (não listados): 3 códigos · 900 kg de venda anual')).toBeTruthy();
    expect(regiao().getAllByRole('button', { name: /Completar cadastro do código/ })).toHaveLength(1);
    expect(regiao().getByRole('button', { name: 'Completar cadastro do código TST0901' })).toBeTruthy();
  });

  it('codigo de produto INATIVO: nome do produto e explicacao, sem botao', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes() }));
    const linha = regiao().getByRole('rowheader', { name: 'TST0902' }).closest('tr') as HTMLElement;
    expect(within(linha).getByText('Produto inativo')).toBeTruthy();
    expect(within(linha).getByText('PRODUTO 009')).toBeTruthy();
    expect(within(linha).queryByRole('button')).toBeNull();
    expect(
      regiao().getByText(
        /Reative o produto para o código voltar ao cálculo\. A reativação de produto ainda não está disponível nesta tela\./,
      ),
    ).toBeTruthy();
  });

  it('sem pendentes (null ou lista vazia): nenhum bloco', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: null }));
    expect(screen.queryByRole('heading', { name: /Pendentes de cadastro/ })).toBeNull();
    cleanup();
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes([]) }));
    expect(screen.queryByRole('heading', { name: /Pendentes de cadastro/ })).toBeNull();
  });

  it('completar: grava, pre-visualiza de novo com os MESMOS arquivos e mostra a mensagem (foco nela)', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes() }));
    const corpoInicial = post.mock.calls[0]?.[1];

    fireEvent.click(regiao().getByRole('button', { name: 'Completar cadastro do código TST0901' }));
    fireEvent.change(await screen.findByLabelText('Nome do produto'), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Família'), { target: { value: '7' } });
    // 1o POST depois do preview = o cadastro; 2o = a nova pre-visualizacao (sem o pendente).
    post.mockResolvedValueOnce({ data: { id: 55 } });
    post.mockResolvedValueOnce({ data: resumoDbcorp({ pendentes: pendentes([inativo()]) }) });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }));

    const status = await screen.findByText('Cadastro gravado. Pré-visualização atualizada.');
    expect(status.getAttribute('role')).toBe('status');
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      '/v1/forecast/import/dbcorp/preview',
      '/v1/forecast/products',
      '/v1/forecast/import/dbcorp/preview',
    ]);
    expect(post.mock.calls[2]?.[1]).toEqual(corpoInicial);
    await waitFor(() => expect(regiao().getByRole('heading', { name: 'Pendentes de cadastro (1)' })).toBeTruthy());
    expect(regiao().queryByRole('button', { name: /Completar cadastro do código/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Completar cadastro' })).toBeNull();
    expect(document.activeElement).toBe(status);
  });

  const semSaldoComPendentes = () =>
    resumoDbcorp({ pendentes: pendentes() }, { saldo: rel({ usadas: 0, porDeposito: [] }) });
  const caixaSaldo = () =>
    screen.getByLabelText(/Entendi que SALDO veio sem linhas úteis/) as HTMLInputElement;

  async function cadastrarCodigoExistente() {
    fireEvent.click(regiao().getByRole('button', { name: 'Completar cadastro do código TST0901' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Adicionar a produto existente' }));
    fireEvent.click(await screen.findByRole('radio', { name: /PRODUTO 001/ }));
    post.mockResolvedValueOnce({
      data: { produtoId: 1, produtoOrigem: 'dbcorp', codigo: { id: 9, posicao: 2, codigo: 'TST0901' } },
    });
  }

  it('re-previa com sucesso ZERA a caixa "Entendi": o usuario precisa marcar de novo', async () => {
    renderModal();
    await previsualizarDbcorp(semSaldoComPendentes());
    fireEvent.click(caixaSaldo());
    expect(caixaSaldo().checked).toBe(true);
    expect(botao('Confirmar importação').disabled).toBe(false);

    await cadastrarCodigoExistente();
    post.mockResolvedValueOnce({
      data: resumoDbcorp({ pendentes: pendentes([inativo()]) }, { saldo: rel({ usadas: 0, porDeposito: [] }) }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    await screen.findByText('Cadastro gravado. Pré-visualização atualizada.');
    await waitFor(() => expect(regiao().getByRole('heading', { name: 'Pendentes de cadastro (1)' })).toBeTruthy());
    expect(caixaSaldo().checked).toBe(false);
    expect(botao('Confirmar importação').disabled).toBe(true);
    fireEvent.click(caixaSaldo());
    expect(botao('Confirmar importação').disabled).toBe(false);
  });

  it('a nova pre-visualizacao falhou: descarta a previa antiga e as caixas, sem Confirmar, e diz isso', async () => {
    renderModal();
    await previsualizarDbcorp(semSaldoComPendentes());
    fireEvent.click(caixaSaldo());
    expect(botao('Confirmar importação').disabled).toBe(false);

    await cadastrarCodigoExistente();
    post.mockRejectedValueOnce(new ApiError(500, null));
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    await screen.findByText(/Cadastro gravado\. A pré-visualização anterior foi descartada: pré-visualize de novo para poder confirmar\./);
    // A previa antiga listava TST0901 como FORA: nao pode sobrar nem o resumo, nem o bloco, nem o Confirmar.
    await waitFor(() => expect(queryBotao('Confirmar importação')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Pendentes de cadastro/ })).toBeNull();
    expect(screen.queryByLabelText(/Entendi/)).toBeNull();
    expect(post.mock.calls.map((c) => c[0])).not.toContain('/v1/forecast/import/dbcorp/confirm');

    // Pre-visualizar de novo: a caixa volta desmarcada.
    post.mockResolvedValueOnce({ data: semSaldoComPendentes() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByLabelText(/Entendi que SALDO/);
    expect(caixaSaldo().checked).toBe(false);
    expect(botao('Confirmar importação').disabled).toBe(true);
  });

  it('a nova pre-visualizacao falhou: o cadastro continua gravado e a mensagem diz isso', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes() }));
    fireEvent.click(regiao().getByRole('button', { name: 'Completar cadastro do código TST0901' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Adicionar a produto existente' }));
    fireEvent.click(await screen.findByRole('radio', { name: /PRODUTO 001/ }));
    post.mockResolvedValueOnce({
      data: { produtoId: 1, produtoOrigem: 'planilha', codigo: { id: 9, posicao: 2, codigo: 'TST0901' } },
    });
    post.mockRejectedValueOnce(new ApiError(500, null));
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    expect(
      await screen.findByText(
        /Cadastro gravado\. A pré-visualização anterior foi descartada: pré-visualize de novo para poder confirmar\. Inclua o código também na planilha PO\.COMP\.01/,
      ),
    ).toBeTruthy();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('Esc no dialogo de cadastro devolve o foco ao botao "Completar cadastro" e nao fecha a importacao', async () => {
    const { onFechar } = renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes() }));
    const gatilho = regiao().getByRole('button', { name: 'Completar cadastro do código TST0901' });
    gatilho.focus();
    fireEvent.click(gatilho);
    await screen.findByRole('heading', { name: 'Completar cadastro' });
    const dialogos = document.querySelectorAll('dialog');
    fireEvent(dialogos[dialogos.length - 1] as HTMLDialogElement, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Completar cadastro' })).toBeNull());
    expect(document.activeElement).toBe(gatilho);
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Importar quinzena' })).toBeTruthy();
    // Nada foi gravado nem pre-visualizado de novo.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('trocar um arquivo depois do preview descarta o bloco de pendentes', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({ pendentes: pendentes() }));
    escolher('fup', arquivo('outro-teste.xlsx'));
    expect(screen.queryByRole('heading', { name: /Pendentes de cadastro/ })).toBeNull();
  });
});

describe('ForecastImportModal - ajustes do 3A (PR 3B-2)', () => {
  const regiao = () => within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));
  const confirmar = () => screen.getByRole('button', { name: 'Confirmar importação' }) as HTMLButtonElement;
  const fupComEtaFinal = (over: Record<string, unknown> = {}) =>
    rel({
      porStatus: [
        { status: 'STATUS A', incluido: true, linhas: 5, kg: 8000 },
        { status: 'CONCLUÍDO', incluido: false, linhas: 4, kg: 900 },
      ],
      regra: {
        id: 'F3',
        etaPorEtdDias: 35,
        etaPorProntidaoDias: 35,
        excluiEtaFinal: true,
        statusExcluidos: ['ATRAC. AG. LIBERAÇÃO'],
      },
      semData: { linhas: 2, kg: 1700, porStatus: [{ status: 'STATUS A', linhas: 2, kg: 1700 }] },
      excluidas: {
        atracadas: { linhas: 0, kg: 0 },
        etaFinalPreenchida: {
          linhas: 3,
          kg: 3000,
          porStatus: [{ status: 'STATUS A', linhas: 3, kg: 3000 }],
          depoisDaDataBase: { linhas: 0, kg: 0 },
        },
      },
      prontidaoNaoReconhecida: { linhas: 0, kg: 0, detalhes: [], omitidos: 0 },
      ...over,
    });

  it('"Em aberto" e "% do em aberto" nao contam as linhas com ETA FINAL excluidas pela F3', async () => {
    renderModal();
    await previsualizarDbcorp(resumoDbcorp({}, { fup: fupComEtaFinal() }));
    // 8000 do status que entra - 3000 de ETA FINAL = 5000; 1700 sem data = 34% de 5000 (era 21% de 8000).
    expect(regiao().getByText('Em aberto: 5.000 kg')).toBeTruthy();
    expect(regiao().getByText('Sem data: 2 linhas · 1.700 kg (34% do em aberto) ficaram FORA das chegadas')).toBeTruthy();
  });

  it('backend antigo (sem `excluidas`): "Em aberto" como antes', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp({}, { fup: rel({ porStatus: [{ status: 'STATUS A', incluido: true, linhas: 5, kg: 8000 }] }) }),
    );
    expect(regiao().getByText('Em aberto: 8.000 kg')).toBeTruthy();
  });

  it('1 linha com DATA PRONTIDAO nao reconhecida: checkbox no singular', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp(
        {},
        {
          fup: fupComEtaFinal({
            prontidaoNaoReconhecida: {
              linhas: 1,
              kg: 40,
              detalhes: [{ linha: 15, status: 'AG. PAGAMENTO (ANT)', codigo: 'TST0008', kg: 40, texto: 'ASAP' }],
              omitidos: 0,
            },
          }),
        },
      ),
    );
    const caixa = screen.getByLabelText(
      'Entendi que 1 linha (40 kg) do FUP com DATA PRONTIDÃO não reconhecida fica fora das chegadas.',
    ) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    expect(confirmar().disabled).toBe(true);
    fireEvent.click(caixa);
    expect(confirmar().disabled).toBe(false);
  });

  it('sem a coluna DATA PRONTIDAO o aviso de DATA PO ausente nao aparece junto (uma vez so)', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp({
        avisos: [
          'FUP: coluna "DATA PRONTIDÃO" não encontrada - linhas sem ETA nem ETD ficam de fora.',
          'FUP: coluna "DATA PO" não encontrada - o ano da DATA PRONTIDÃO usa a data base.',
        ],
      }),
    );
    expect(regiao().getByText(/coluna "DATA PRONTIDÃO" não encontrada/)).toBeTruthy();
    expect(regiao().queryByText(/coluna "DATA PO" não encontrada/)).toBeNull();
  });

  it('so a DATA PO ausente: o aviso continua', async () => {
    renderModal();
    await previsualizarDbcorp(
      resumoDbcorp({ avisos: ['FUP: coluna "DATA PO" não encontrada - o ano da DATA PRONTIDÃO usa a data base.'] }),
    );
    expect(regiao().getByText(/coluna "DATA PO" não encontrada/)).toBeTruthy();
  });
});
