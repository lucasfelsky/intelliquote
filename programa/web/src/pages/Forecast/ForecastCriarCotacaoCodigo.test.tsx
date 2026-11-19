import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';
import { ProvedorGerarCotacao } from './ForecastGerarCotacao';

// Codigo da cotacao informado por fonte no pop-up "Criar cotacao" (PR1 do Cotar). Dados 100% sinteticos.

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
import { abrirCotar } from '@/test/forecastDetalhes';

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);
const post = vi.mocked(api.post);
const del = vi.mocked(api.del);

function item(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    productId: 41,
    item: 'PRODUTO 001',
    codigos: ['C0041'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 125,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  };
}

const grupos = [
  { fonte: 'FONTE 001', itens: [item({ linha: 3, productId: 41, item: 'PRODUTO 001', codigos: ['C0041'], quantidadeFinal: 125 })] },
  { fonte: 'FONTE 002', itens: [item({ linha: 4, productId: 43, item: 'PRODUTO 003', codigos: ['C0043'], quantidadeFinal: 300 })] },
];

function instalarApi() {
  get.mockImplementation((async (path: string) => {
    if (path === '/v1/forecast/products') {
      return {
        data: [41, 43].map((id) => ({
          id,
          name: `PRODUTO ${id}`,
          isActive: true,
          source: { id: 1, name: 'FONTE 001' },
          codes: [
            {
              id: id * 10,
              position: 1,
              code: `C${String(id).padStart(4, '0')}`,
              catalogItemId: id + 100,
              catalogItem: { id: id + 100, commercialName: `ITEM ${id}`, marketName: `M${id}` },
            },
          ],
        })),
      };
    }
    if (path.endsWith('/decisoes')) return { data: { snapshotId: 7, label: '10-2', decisoes: [] } };
    if (path.endsWith('/rascunho-cotacao')) return { data: null };
    if (path.endsWith('/candidatos-cotacao')) return { data: { snapshotId: 7, label: '10-2', fonte: null, fontes: [], excluidos: [] } };
    if (path.endsWith('/relatorio-compras')) {
      return {
        data: {
          quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
          totais: { itens: 2, fontes: 2, vencidas: 0, semEmbalagem: 2, multiplasEmbalagens: 0 },
          fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
          grupos: grupos.map((g) => ({ fonte: g.fonte, leadTimeDias: 30, dataLimiteMaisUrgente: '2026-10-22', vencidas: 0, itens: g.itens })),
        },
      };
    }
    return { data: {} };
  }) as never);
  put.mockResolvedValue({ data: { acao: 'create', rascunho: null } } as never);
  del.mockResolvedValue({ data: { acao: 'delete', rascunho: null } } as never);
  post.mockImplementation((async (_path: string, body: { itens: Array<{ productId: number; quantidadeKg: number }> }) => ({
    data: {
      snapshotId: 7,
      label: '10-2',
      cotacoes: body.itens.map((i, n) => ({
        id: 501 + n,
        requestCode: `COT-000${n + 1}`,
        fonte: i.productId === 41 ? 'FONTE 001' : 'FONTE 002',
        itens: [{ productId: i.productId, item: `PRODUTO ${i.productId}`, quantidadeKg: i.quantidadeKg }],
      })),
    },
  })) as never);
}

function renderRelatorio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast']}>
        <Routes>
          <Route
            path="/forecast"
            element={
              <ProvedorGerarCotacao snapshotId={7} podeCriar>
                <ForecastRelatorioCompras snapshotId={7} podeEditar />
              </ProvedorGerarCotacao>
            }
          />
          <Route path="/cotacoes/:id" element={<div>detalhe</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const botaoGerar = (d: HTMLElement) => within(d).getByRole('button', { name: /^Gerar( \d+)? cotaç(ão|ões)$|^Gerando…$/ }) as HTMLButtonElement;
const campoCodigo = (d: HTMLElement, fonte: string) => within(d).getByLabelText(`Código da cotação da fonte ${fonte}`) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  instalarApi();
});

describe('pop-up Criar cotacao: codigo da cotacao por fonte', () => {
  it('mostra o campo opcional com a dica por fonte do lote', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    const campo = campoCodigo(d, 'FONTE 001');
    expect(campo.value).toBe('');
    expect(campo.placeholder).toBe('Será gerado automaticamente');
    expect(within(d).getByText('Código da cotação (opcional)')).toBeTruthy();
    expect(within(d).getByText('Será gerado automaticamente se ficar em branco.')).toBeTruthy();
  });

  it('codigo digitado vai em codigosCotacao com a fonte do grupo (sem espacos nas pontas)', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.change(campoCodigo(d, 'FONTE 001'), { target: { value: '  cmx-001  ' } });
    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![0]).toBe('/v1/forecast/snapshots/7/cotacoes');
    expect(post.mock.calls[0]![1]).toMatchObject({
      itens: [{ productId: 41, quantidadeKg: 125 }],
      codigosCotacao: [{ fonte: 'FONTE 001', requestCode: 'cmx-001' }],
    });
  });

  it('campo vazio (ou so espacos): o corpo sai SEM codigosCotacao', async () => {
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.change(campoCodigo(d, 'FONTE 001'), { target: { value: '   ' } });
    fireEvent.click(botaoGerar(d));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const corpo = post.mock.calls[0]![1] as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('codigosCotacao');
    expect(Object.keys(corpo)).toEqual(['itens']);
  });

  it('409 do backend: a mensagem aparece em alerta, o pop-up segue aberto e o codigo digitado fica', async () => {
    const mensagem = 'Já existe uma cotação com o código CMX-001 (inclusive excluída). Informe outro código ou deixe em branco.';
    post.mockRejectedValueOnce(new ApiError(409, { message: mensagem }));
    renderRelatorio();
    const d = await abrirCotar('PRODUTO 001');
    fireEvent.change(campoCodigo(d, 'FONTE 001'), { target: { value: 'cmx-001' } });
    fireEvent.click(botaoGerar(d));
    const alerta = await within(d).findByRole('alert');
    expect(alerta.textContent).toContain(mensagem);
    expect(screen.getByRole('heading', { name: 'Criar cotação' })).toBeTruthy();
    expect(campoCodigo(d, 'FONTE 001').value).toBe('cmx-001');
    expect(campoCodigo(d, 'FONTE 001').disabled).toBe(false);
    expect(botaoGerar(d).disabled).toBe(false);
  });
});
