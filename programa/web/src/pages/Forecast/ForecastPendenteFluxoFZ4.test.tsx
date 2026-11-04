import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Forecast from '../Forecast';
import { TEXTO_CADASTRADO_DEPOIS } from './forecastPendentes';

// FZ4-F: fluxo ao nivel da pagina (Forecast.tsx, rota do item). Depois de reativar ou de completar o cadastro a quinzena NAO muda, mas o backend passa a
// devolver `cadastradoDepois: true`: o front precisa BUSCAR o detalhe de novo (invalidateQueries ['forecast']) e o aviso da MESMA linha vira "Cadastrado".
// Dados 100% sinteticos.

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@exemplo.invalid', role: 'comprador' } }),
}));

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

const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function pendente(over: Record<string, unknown> = {}) {
  return {
    linha: 9, O: 100, P: 50, Q: 100, R: 90, S: 80, T: null, U: 500, chegadas: [0, 0, 0, 0, 0], AA: 5, programacoes: [0, 0, 0, 0], AG: 100,
    projecao: [400, 300, 200, 100, 50, 20], AN: null, AQ: null, AP: null, AR: 0, AS: 0, item: 'TST0901', codigos: ['TST0901', '', '', '', '', '', ''],
    fonte: '', status: 'nao', analiseForecast: null, productId: null, n: null, historico: [1, 2, 3, 4, 5], obs: '', precoFixo: false,
    pendenteCadastro: 'sem_cadastro', cadastradoDepois: false, produtoInativoAtual: null, ...over,
  };
}

let linhaAtual: Record<string, unknown>;

const detalheChamadas = () => get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots/8').length;

beforeEach(() => {
  vi.clearAllMocks();
  linhaAtual = pendente();
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') {
      return { data: [{ id: 8, label: '11-1', baseDate: '2026-11-05T00:00:00.000Z', half: 1, origin: 'dbcorp', months: MONTHS, files: [], createdById: 1, createdAt: '2026-11-05T12:00:00.000Z' }] };
    }
    if (path === '/v1/forecast/snapshots/8') {
      return { data: { id: 8, label: '11-1', baseDate: '2026-11-05', half: 1, origin: 'dbcorp', hoje: '2026-11-10', months: MONTHS, files: [], createdAt: '2026-11-05T12:00:00.000Z', linhas: [linhaAtual], conferencia: null } };
    }
    if (path === '/v1/forecast/snapshots/8/pendentes') {
      return { data: { aplicavel: true, snapshotId: 8, label: '11-1', itens: [], totalItens: 0, omitidos: 0, soSaldo: { codigos: 0, kg: 0 } } };
    }
    if (path === '/v1/forecast/sources') return { data: [{ id: 3, name: 'FONTE 001', leadTimeDays: 45, clearanceDays: null, isActive: true }] };
    if (path === '/v1/item-families') return { data: [{ id: 7, name: 'FAMILIA A', isActive: true }] };
    if (path === '/v1/forecast/products') {
      return { data: [{ id: 1, name: 'PRODUTO 001', isActive: true, origin: 'dbcorp', codes: [{ id: 11, position: 1, code: 'TST0001' }] }] };
    }
    if (path.endsWith('/decisoes')) return { data: { decisoes: [] } };
    throw new Error(`GET inesperado: ${path}`);
  });
});

function renderItem() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/forecast/item/9?quinzena=8']}>
        <Routes>
          <Route path="/forecast/item/:linha" element={<Forecast />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const aviso = () => document.querySelector('.fcpc-aviso') as HTMLElement;

describe('FZ4-F: depois de gravar, o detalhe e buscado de novo e o aviso da mesma linha vira "Cadastrado"', () => {
  it('reativar produto: POST, nova chamada do detalhe, aviso "Cadastrado", botao some, mesmo item', async () => {
    linhaAtual = pendente({ pendenteCadastro: 'produto_inativo', produtoInativoAtual: { id: 9, nome: 'PRODUTO 009' } });
    renderItem();
    const botao = await screen.findByRole('button', { name: 'Reativar produto PRODUTO 009 (código TST0901)' });
    const antes = detalheChamadas();
    post.mockImplementation(async () => {
      linhaAtual = pendente({ pendenteCadastro: 'produto_inativo', cadastradoDepois: true });
      return { data: { id: 9, nome: 'PRODUTO 009', ativo: true, origem: 'dbcorp', alterado: true } };
    });
    fireEvent.click(botao);
    await waitFor(() => expect(within(aviso()).getByText(TEXTO_CADASTRADO_DEPOIS)).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/v1/forecast/products/9/reativar', {});
    expect(detalheChamadas()).toBeGreaterThan(antes);
    expect(within(aviso()).queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { name: 'TST0901' })).toBeTruthy();
  });

  it('completar cadastro: POST, nova chamada do detalhe, aviso "Cadastrado", botao some, mesmo item', async () => {
    renderItem();
    const botao = await screen.findByRole('button', { name: 'Completar cadastro do código TST0901' });
    const antes = detalheChamadas();
    post.mockImplementation(async () => {
      linhaAtual = pendente({ cadastradoDepois: true });
      return { data: { id: 55 } };
    });
    fireEvent.click(botao);
    fireEvent.change(await screen.findByLabelText('Nome do produto'), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Família'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }));
    await waitFor(() => expect(within(aviso()).getByText(TEXTO_CADASTRADO_DEPOIS)).toBeTruthy());
    expect(detalheChamadas()).toBeGreaterThan(antes);
    expect(within(aviso()).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /Completar cadastro do código/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'TST0901' })).toBeTruthy();
  });

  it('adicionar a produto existente: POST, nova chamada do detalhe, aviso "Cadastrado", botao some, mesmo item', async () => {
    renderItem();
    const botao = await screen.findByRole('button', { name: 'Completar cadastro do código TST0901' });
    const antes = detalheChamadas();
    post.mockImplementation(async () => {
      linhaAtual = pendente({ cadastradoDepois: true });
      return { data: { produtoId: 1, produtoOrigem: 'dbcorp', codigo: { id: 9, posicao: 2, codigo: 'TST0901' } } };
    });
    fireEvent.click(botao);
    await screen.findByLabelText('Nome do produto');
    fireEvent.click(screen.getByRole('tab', { name: 'Adicionar a produto existente' }));
    fireEvent.click(await screen.findByRole('radio', { name: /PRODUTO 001/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    await waitFor(() => expect(within(aviso()).getByText(TEXTO_CADASTRADO_DEPOIS)).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/v1/forecast/products/1/codigos', { codigo: 'TST0901' });
    expect(detalheChamadas()).toBeGreaterThan(antes);
    expect(within(aviso()).queryByRole('button')).toBeNull();
  });
});
