import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastImportModal from './ForecastImportModal';

// L62 (confirm que estoura o tempo com a quinzena ja gravada) e L86 (403 da planilha) no modal de importacao.
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
import { FORECAST_IMPORT_403_PLANILHA } from '@/services/forecast';

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);

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

const ROTA_QUINZENAS = '/v1/forecast/snapshots';
const quinzenaGravada = (over: Record<string, unknown> = {}) => ({
  id: 77,
  label: '12-2',
  baseDate: '2026-12-15',
  half: 2,
  origin: 'dbcorp',
  months: {},
  files: [],
  createdById: 1,
  createdAt: '2026-12-15T12:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  post.mockReset();
  get.mockReset();
});

describe('ForecastImportModal - confirm que demora (L62)', () => {
  it('DBCorp: 504 no confirm e a quinzena ja esta na lista -> segue como sucesso, sem alerta', async () => {
    const { onImportada } = renderModal();
    await previsualizarDbcorp();
    post.mockRejectedValueOnce(new ApiError(504, null));
    get.mockResolvedValueOnce({ data: [quinzenaGravada()] });
    fireEvent.click(botao('Confirmar importação'));
    await waitFor(() => expect(onImportada).toHaveBeenCalledWith(77, '12-2'));
    expect(get).toHaveBeenCalledWith(ROTA_QUINZENAS);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('DBCorp: 502 e a lista sem o rotulo -> mantem a mensagem de "pode ter sido concluida"', async () => {
    const { onImportada } = renderModal();
    await previsualizarDbcorp();
    post.mockRejectedValueOnce(new ApiError(502, null));
    get.mockResolvedValueOnce({ data: [quinzenaGravada({ id: 5, label: '11-2' })] });
    fireEvent.click(botao('Confirmar importação'));
    expect(await screen.findByText(/a importação pode ter sido concluída\./)).toBeTruthy();
    expect(get).toHaveBeenCalledWith(ROTA_QUINZENAS);
    expect(onImportada).not.toHaveBeenCalled();
  });

  it('DBCorp: 400 no confirm nao confere a lista', async () => {
    const { onImportada } = renderModal();
    await previsualizarDbcorp();
    post.mockRejectedValueOnce(new ApiError(400, { message: 'Relatorios com erros: x' }));
    fireEvent.click(botao('Confirmar importação'));
    expect(await screen.findByText('Relatorios com erros: x')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(onImportada).not.toHaveBeenCalled();
  });

  it('planilha com o rotulo ja existente (nao cria quinzena): 504 nao confere a lista', async () => {
    const { onImportada } = renderModal(['12-2']);
    await previsualizarPlanilha();
    post.mockRejectedValueOnce(new ApiError(504, null));
    fireEvent.click(botao('Confirmar importação'));
    expect(await screen.findByText(/a importação pode ter sido concluída\./)).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(onImportada).not.toHaveBeenCalled();
  });
});

describe('ForecastImportModal - 403 da pre-visualizacao (L86)', () => {
  it('planilha: explica que e exclusiva do administrador; DBCorp mantem o texto de admin e comprador', async () => {
    renderModal();
    post.mockRejectedValueOnce(new ApiError(403, null));
    preencherComuns();
    fireEvent.change(screen.getByLabelText('Arquivo da planilha'), { target: { files: [arquivo('planilha-teste.xlsx')] } });
    fireEvent.click(botao('Pré-visualizar'));
    expect(await screen.findByText(FORECAST_IMPORT_403_PLANILHA)).toBeTruthy();

    post.mockRejectedValueOnce(new ApiError(403, null));
    abrirDbcorp();
    preencherComuns();
    escolherTodos();
    fireEvent.click(botao('Pré-visualizar'));
    expect(await screen.findByText('Só administradores e compradores podem importar quinzenas.')).toBeTruthy();
  });
});
