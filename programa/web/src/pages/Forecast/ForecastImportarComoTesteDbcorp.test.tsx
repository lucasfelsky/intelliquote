import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastImportModal from './ForecastImportModal';
import { NOTA_DBCORP_CONFIRMACAO } from './forecastImport';
import {
  NOTA_COMPLETAR_MODO_TESTE,
  NOTA_DBCORP_SEM_TESTE,
  servidorAplicouModoTeste,
  textoCaixaModoTesteDbcorp,
  textoEcoAusente,
  textoHistoricoModoTeste,
  textoModoTesteNaoConfirmado,
  textoPadroesNaoGravados,
} from './forecastModoTeste';

// Modo teste dos relatorios DBCorp (PR2 do piloto): caixa na previa, corpo do confirm, eco do servidor e L62.
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
import { confirmForecastDbcorp, type ForecastDbcorpBody } from '@/services/forecast';

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);

const ROTA_PREVIEW = '/v1/forecast/import/dbcorp/preview';
const ROTA_CONFIRM = '/v1/forecast/import/dbcorp/confirm';
const ROTA_QUINZENAS = '/v1/forecast/snapshots';

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

const SEM_LINHAS = { linhas: 0, kg: 0 };

const pendente = {
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
};

function resumoDbcorp(over: Record<string, unknown> = {}) {
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
        porDeposito: [{ deposito: 'DEPÓSITO A', incluido: true, linhas: 4, saldo: 1000 }],
        outrasEmpresas: [],
      }),
      vendasMes: rel({ empresas: ['EMPRESA X'] }),
      vendasAtual: rel({ empresas: ['EMPRESA X'] }),
      vendasAnual: rel({ empresas: ['EMPRESA X'] }),
      programacao: rel({
        porStatus: [{ status: 'Pendente', incluido: true, linhas: 3, qtd: 600 }],
        foraDaJanela: { antes: 0, depois: 0 },
      }),
      fup: rel({
        porStatus: [{ status: 'STATUS A', incluido: true, linhas: 5, kg: 8000 }],
        estimadasPorEtd: { linhas: 1, kg: 500 },
        vencidasNoMesBase: SEM_LINHAS,
        semData: { linhas: 0, kg: 0, porStatus: [] },
        depoisDaJanela: SEM_LINHAS,
      }),
    },
    pendentes: {
      itens: [pendente],
      totalItens: 1,
      omitidos: 0,
      soSaldo: { codigos: 0, kg: 0 },
      semVendaRecente: { codigos: 0, vendasAnual: 0 },
      regra: { mesesVenda: ['2026-10', '2026-11', '2026-12'], historicoAusente: [], compras: 'fup_em_aberto' },
    },
    prazosEstimativa: {
      padrao: { prontidaoDias: 35, etdDias: 35 },
      fontes: [
        {
          sourceId: 1,
          nome: 'FONTE 001',
          salvo: { prontidaoDias: null, etdDias: null },
          usado: { prontidaoDias: 60, etdDias: 35 },
          prontidao: { linhas: 2, kg: 1800 },
          etd: { linhas: 1, kg: 500 },
        },
      ],
      semFonte: { prontidao: SEM_LINHAS, etd: SEM_LINHAS },
      padroesAlterados: 1,
    },
    avisos: [],
    erros: [],
    ...over,
  };
}

const arquivo = (nome: string) => new File([new Uint8Array([1, 2, 3])], nome);

function renderModal(somenteDbcorp = false) {
  const onFechar = vi.fn();
  const onImportada = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ForecastImportModal
        aberto
        onFechar={onFechar}
        quinzenasExistentes={['10-2', '11-1']}
        onImportada={onImportada}
        somenteDbcorp={somenteDbcorp}
      />
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
const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement;
const caixaTeste = () => screen.getByLabelText(/Importar como teste/) as HTMLInputElement;
const regiaoPrevia = () => within(screen.getByRole('region', { name: 'Pré-visualização dos relatórios DBCorp' }));

async function previsualizarDbcorp(somenteDbcorp = false, resumo: unknown = resumoDbcorp()) {
  post.mockResolvedValueOnce({ data: resumo });
  if (!somenteDbcorp) abrirDbcorp();
  preencherComuns();
  SLOTS_2A.forEach((s) => escolher(s));
  fireEvent.click(botao('Pré-visualizar'));
  await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
}

const chamadas = (rota: string) => post.mock.calls.filter(([path]) => path === rota);

const quinzenaGravada = {
  id: 77,
  label: '12-2',
  baseDate: '2026-12-15',
  half: 2,
  origin: 'dbcorp',
  months: {},
  files: [],
  createdById: 1,
  createdAt: '2026-12-15T12:00:00Z',
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  post.mockReset();
  get.mockReset();
  get.mockResolvedValue({ data: [] });
});

describe.each([
  ['admin (aba DBCorp)', false],
  ['comprador (somenteDbcorp)', true],
])('Importar como teste nos relatorios DBCorp - %s', (_nome, somenteDbcorp) => {
  it('antes da previa nao ha caixa; na previa ela aparece desmarcada com o texto do mes anterior', async () => {
    renderModal(somenteDbcorp);
    if (!somenteDbcorp) abrirDbcorp();
    expect(screen.queryByLabelText(/Importar como teste/)).toBeNull();
    if (somenteDbcorp) expect(screen.getByText(NOTA_DBCORP_CONFIRMACAO)).toBeTruthy();

    await previsualizarDbcorp(somenteDbcorp);
    expect(caixaTeste().checked).toBe(false);
    expect(screen.getByLabelText(/não altera o histórico de 11\/2026 nem os prazos das fontes/)).toBeTruthy();
    expect(botao('Confirmar importação')).toBeTruthy();
    expect(document.querySelector('.fit-status')?.textContent).toBe('');
  });

  it('ligar troca avisos, historico, prazos, pendentes e botao; desligar restaura os textos originais', async () => {
    renderModal(somenteDbcorp);
    await previsualizarDbcorp(somenteDbcorp);
    const original = /vira o padrão da fonte nas próximas importações/;
    expect(regiaoPrevia().getByText(/Ao confirmar, o histórico de 11\/2026 será substituído/)).toBeTruthy();
    expect(regiaoPrevia().getByText(original)).toBeTruthy();
    expect(regiaoPrevia().queryByText(NOTA_COMPLETAR_MODO_TESTE)).toBeNull();

    fireEvent.click(caixaTeste());
    const aviso = document.querySelector('.fit-status')?.textContent ?? '';
    expect(aviso).toContain('12-2');
    expect(aviso).toContain('Excluir quinzena');
    expect(aviso).toContain('Completar cadastro');
    expect(botao('Importar como teste')).toBeTruthy();
    expect(regiaoPrevia().getByText(textoHistoricoModoTeste('2026-11'))).toBeTruthy();
    expect(regiaoPrevia().queryByText(/Ao confirmar, o histórico de 11\/2026 será substituído/)).toBeNull();
    expect(regiaoPrevia().getByText(/não viram padrão no modo teste/)).toBeTruthy();
    expect(regiaoPrevia().queryByText(original)).toBeNull();
    expect(regiaoPrevia().getByText(textoPadroesNaoGravados(1) as string)).toBeTruthy();
    expect(regiaoPrevia().getByText(NOTA_COMPLETAR_MODO_TESTE)).toBeTruthy();

    fireEvent.click(caixaTeste());
    expect(botao('Confirmar importação')).toBeTruthy();
    expect(regiaoPrevia().getByText(/Ao confirmar, o histórico de 11\/2026 será substituído/)).toBeTruthy();
    expect(regiaoPrevia().getByText(original)).toBeTruthy();
    expect(regiaoPrevia().queryByText(NOTA_COMPLETAR_MODO_TESTE)).toBeNull();
    expect(document.querySelector('.fit-status')?.textContent).toBe('');
  });

  it('confirm ligado manda modoTeste no corpo (o preview nao) e, com o eco, importa direto', async () => {
    const { onImportada } = renderModal(somenteDbcorp);
    await previsualizarDbcorp(somenteDbcorp);
    fireEvent.click(caixaTeste());
    post.mockResolvedValueOnce({ data: { snapshotId: 9, modoTeste: true } });
    fireEvent.click(botao('Importar como teste'));

    await waitFor(() => expect(onImportada).toHaveBeenCalledWith(9, '12-2'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(chamadas(ROTA_PREVIEW)[0]![1]).not.toHaveProperty('modoTeste');
    expect(chamadas(ROTA_CONFIRM)).toHaveLength(1);
    expect(chamadas(ROTA_CONFIRM)[0]![1]).toMatchObject({ label: '12-2', modoTeste: true });
  });

  it.each([
    ['sem eco', { snapshotId: 9 }],
    ['eco nao booleano', { snapshotId: 9, modoTeste: 'true' }],
    ['eco false', { snapshotId: 9, modoTeste: false }],
  ])('%s: alerta de importacao normal, nada de onImportada ate o "Concluir"', async (_caso, dados) => {
    const { onImportada, invalidate } = renderModal(somenteDbcorp);
    await previsualizarDbcorp(somenteDbcorp);
    fireEvent.click(caixaTeste());
    post.mockResolvedValueOnce({ data: dados });
    fireEvent.click(botao('Importar como teste'));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(textoEcoAusente('12-2', '2026-11'));
    expect(onImportada).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['forecast'] });

    fireEvent.click(botao('Concluir'));
    expect(onImportada).toHaveBeenCalledWith(9, '12-2');
  });

  it('confirm desligado: corpo sem a chave modoTeste e resposta sem eco segue direto, sem alerta', async () => {
    const { onImportada } = renderModal(somenteDbcorp);
    await previsualizarDbcorp(somenteDbcorp);
    post.mockResolvedValueOnce({ data: { snapshotId: 9 } });
    fireEvent.click(botao('Confirmar importação'));

    await waitFor(() => expect(onImportada).toHaveBeenCalledWith(9, '12-2'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(chamadas(ROTA_CONFIRM)[0]![1]).not.toHaveProperty('modoTeste');
  });

  it('L62 em modo teste: 504 com a quinzena na lista vira alerta (nao sucesso silencioso)', async () => {
    const { onImportada } = renderModal(somenteDbcorp);
    await previsualizarDbcorp(somenteDbcorp);
    fireEvent.click(caixaTeste());
    post.mockRejectedValueOnce(new ApiError(504, null));
    get.mockResolvedValueOnce({ data: [quinzenaGravada] });
    fireEvent.click(botao('Importar como teste'));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(textoModoTesteNaoConfirmado('12-2', '2026-11'));
    expect(get).toHaveBeenCalledWith(ROTA_QUINZENAS);
    expect(onImportada).not.toHaveBeenCalled();

    fireEvent.click(botao('Concluir'));
    expect(onImportada).toHaveBeenCalledWith(77, '12-2');
  });
});

describe('Importar como teste nos relatorios DBCorp - admin e funcoes puras', () => {
  it('trocar de aba desliga o modo teste (opt-in por origem)', async () => {
    renderModal(false);
    await previsualizarDbcorp(false);
    fireEvent.click(caixaTeste());
    expect(caixaTeste().checked).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Planilha (.xlsx)' }));
    abrirDbcorp();
    post.mockResolvedValueOnce({ data: resumoDbcorp() });
    fireEvent.click(botao('Pré-visualizar'));
    await screen.findByRole('heading', { name: 'Pré-visualização dos relatórios DBCorp' });
    expect(caixaTeste().checked).toBe(false);
    expect(botao('Confirmar importação')).toBeTruthy();
  });

  it('servico: so manda modoTeste quando ligado', async () => {
    const corpo = { label: '12-2', baseDate: '2026-12-15', files: {} } as unknown as ForecastDbcorpBody;
    post.mockResolvedValue({ data: { snapshotId: 1 } });

    await confirmForecastDbcorp(corpo);
    expect(post).toHaveBeenLastCalledWith(ROTA_CONFIRM, corpo);
    expect(post.mock.calls[0]![1]).toBe(corpo);

    await confirmForecastDbcorp(corpo, true);
    expect(post).toHaveBeenLastCalledWith(ROTA_CONFIRM, { ...corpo, modoTeste: true });
  });

  it('funcoes puras: eco estrito, textos sem mes e notas', () => {
    expect(servidorAplicouModoTeste({ modoTeste: true })).toBe(true);
    for (const valor of [undefined, false, 'true', 1, null]) {
      expect(servidorAplicouModoTeste({ modoTeste: valor })).toBe(false);
    }
    expect(servidorAplicouModoTeste({})).toBe(false);

    for (const texto of [
      textoCaixaModoTesteDbcorp(null),
      textoHistoricoModoTeste(null),
      textoEcoAusente('12-2', null),
      textoModoTesteNaoConfirmado('12-2', null),
    ]) {
      expect(texto).toContain('do mês anterior');
      expect(texto).not.toContain('—');
    }
    expect(textoCaixaModoTesteDbcorp('2026-11')).toContain('não altera o histórico de 11/2026 nem os prazos das fontes');
    expect(textoPadroesNaoGravados(0)).toBeNull();
    expect(textoPadroesNaoGravados(1)).toBe('No modo teste, o prazo alterado de 1 fonte não vira padrão.');
    expect(textoPadroesNaoGravados(3)).toBe('No modo teste, os prazos alterados de 3 fontes não viram padrão.');
    expect(NOTA_DBCORP_SEM_TESTE).not.toBe(NOTA_DBCORP_CONFIRMACAO);
    expect(NOTA_DBCORP_CONFIRMACAO).not.toMatch(/Importar como teste/);
  });
});
