import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import Forecast from '../Forecast';

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

// FZ2: foco e document.title na ida e volta grade <-> pagina do item (/forecast/item/:linha). Dados 100% sinteticos.
const TITULO_PAINEL = 'Forecast de compras · IntelliQuote';
const MONTHS = {
  consumo: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7 (ATUAL)'],
  chegada: ['B1', 'B2', 'B3', 'B4', 'B5'],
  programacao: ['C1', 'C2', 'C3', 'C4'],
};

function linha(over: Record<string, unknown> = {}) {
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
    item: 'PRODUTO A',
    codigos: ['C0001'],
    fonte: 'FONTE 1',
    status: 'nao',
    analiseForecast: null,
    productId: 42,
    n: 1,
    historico: [11, 22, 33, 44, 55],
    obs: '',
    precoFixo: false,
    sobDemanda: false,
    sobDemandaMotivo: null,
    ...over,
  };
}

const LINHAS = [
  linha(),
  linha({ linha: 4, n: 2, item: 'PRODUTO B', codigos: ['C0003'], fonte: 'FONTE 2', status: 'cotando', AN: -40, P: 130, projecao: [10, -5, -10, -15, -20, -25] }),
  linha({ linha: 5, n: 3, item: 'PRODUTO C', codigos: ['C0004'], fonte: 'FONTE 1', Q: 0, AN: null, AP: null }),
];

const detalhe = (id: number) => ({
  id,
  label: id === 8 ? '11-1' : '10-2',
  baseDate: id === 8 ? '2026-11-05' : '2026-10-15',
  half: id === 8 ? 1 : 2,
  origin: 'planilha',
  hoje: '2026-10-20',
  months: MONTHS,
  files: [],
  createdAt: '2026-10-20T12:00:00.000Z',
  linhas: LINHAS,
  conferencia: { celulas: 84, batem: 84, porColuna: {}, totalDivergencias: 0, divergencias: [] },
});

const RESUMOS = [
  { id: 8, label: '11-1', baseDate: '2026-11-05T00:00:00.000Z', half: 1, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-11-05T12:00:00.000Z' },
  { id: 7, label: '10-2', baseDate: '2026-10-15T00:00:00.000Z', half: 2, origin: 'planilha', months: MONTHS, files: [], createdById: 1, createdAt: '2026-10-20T12:00:00.000Z' },
];

function Voltar() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        Voltar do historico
      </button>
      <button type="button" onClick={() => navigate('/forecast/item/4?quinzena=7')}>
        Ir para o item 4
      </button>
    </>
  );
}

function renderRota(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Voltar />
        <Routes>
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/forecast/item/:linha" element={<Forecast />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tituloDoItem = (nome: string) => screen.findByRole('heading', { name: nome });
const linkDoItem = (nome: string) => screen.findByRole('link', { name: new RegExp(nome) });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.title = 'IntelliQuote';
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots') return { data: RESUMOS };
    if (path.endsWith('/pendentes')) return { data: { aplicavel: false } };
    if (path.endsWith('/decisoes')) return { data: [] };
    return { data: detalhe(Number(path.split('/').pop())) };
  });
});

afterEach(() => {
  cleanup();
});

describe('Forecast - foco ao entrar na pagina do item', () => {
  it('da grade para o item: o foco vai ao titulo do item (fora da ordem de Tab) e o title identifica o item', async () => {
    renderRota('/forecast?quinzena=7');
    expect(document.title).toBe(TITULO_PAINEL);
    fireEvent.click(await linkDoItem('PRODUTO B'));
    const titulo = await tituloDoItem('PRODUTO B');
    expect(document.activeElement).toBe(titulo);
    expect(titulo.getAttribute('tabindex')).toBe('-1');
    expect(document.title).toBe(`PRODUTO B · ${TITULO_PAINEL}`);
  });

  it('deep link: o foco vai ao titulo e o title traz o nome do item assim que a quinzena carrega', async () => {
    renderRota('/forecast/item/5?quinzena=7');
    const titulo = await tituloDoItem('PRODUTO C');
    expect(document.activeElement).toBe(titulo);
    expect(document.title).toBe(`PRODUTO C · ${TITULO_PAINEL}`);
  });

  it('item inexistente: o foco vai ao aviso e o title diz que nao encontrou', async () => {
    renderRota('/forecast/item/99?quinzena=7');
    const aviso = await screen.findByText('Item não encontrado nesta quinzena');
    expect(document.activeElement).toBe(aviso);
    expect(document.title).toBe(`Item não encontrado · ${TITULO_PAINEL}`);
  });
});

describe('Forecast - foco ao voltar para a grade', () => {
  it('aba Painel: o foco retorna ao link do item de origem, o title volta ao do painel e filtro/busca/ocultas ficam', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await screen.findByRole('button', { name: 'Demanda ≤ 0 1' }));
    fireEvent.change(screen.getByLabelText('Buscar produto, código ou fonte'), { target: { value: 'FONTE 2' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Colunas ocultas da planilha' }));
    fireEvent.click(await linkDoItem('PRODUTO B'));
    await tituloDoItem('PRODUTO B');

    fireEvent.click(screen.getByRole('button', { name: 'Painel' }));
    const link = await linkDoItem('PRODUTO B');
    expect(document.activeElement).toBe(link);
    expect(document.title).toBe(TITULO_PAINEL);
    expect(screen.getByRole('button', { name: 'Demanda ≤ 0 1' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Buscar produto, código ou fonte') as HTMLInputElement).value).toBe('FONTE 2');
    expect(screen.getByRole('switch', { name: 'Colunas ocultas da planilha' }).getAttribute('aria-checked')).toBe('true');
  });

  it('historico do navegador (Alt+seta esquerda): o foco retorna ao link do item de origem', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await linkDoItem('PRODUTO C'));
    await tituloDoItem('PRODUTO C');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar do historico' }));
    const link = await linkDoItem('PRODUTO C');
    expect(document.activeElement).toBe(link);
    expect(document.title).toBe(TITULO_PAINEL);
  });

  it('o link que recebe o foco e o do item aberto (nao o primeiro da grade)', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await linkDoItem('PRODUTO C'));
    await tituloDoItem('PRODUTO C');
    fireEvent.click(screen.getByRole('button', { name: 'Painel' }));
    const link = await linkDoItem('PRODUTO C');
    expect(document.activeElement).toBe(link);
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /PRODUTO A/ }));
  });

  it('item que o filtro esconde (deep link + filtro): o foco vai a regiao da grade', async () => {
    renderRota('/forecast/item/3?quinzena=7&filtro=andamento');
    await tituloDoItem('PRODUTO A');
    fireEvent.click(screen.getByRole('button', { name: 'Painel' }));
    const regiao = await screen.findByRole('region', { name: 'Grade do Forecast' });
    await waitFor(() => expect(document.activeElement).toBe(regiao));
    expect(within(regiao).queryByRole('link', { name: /PRODUTO A/ })).toBeNull();
  });

  it('sem origem (abre o painel direto) o foco nao e movido', async () => {
    renderRota('/forecast?quinzena=7');
    await linkDoItem('PRODUTO A');
    expect(document.activeElement).toBe(document.body);
  });

  it('trocar a quinzena na pagina do item NAO leva o foco a um link da quinzena nova', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await linkDoItem('PRODUTO B'));
    await tituloDoItem('PRODUTO B');
    fireEvent.change(screen.getByLabelText('Quinzena'), { target: { value: '8' } });
    await screen.findByRole('table', { name: /quinzena 11-1/ });
    expect(document.activeElement?.closest('.fc-grid')).toBeNull();
    expect(document.title).toBe(TITULO_PAINEL);
  });

  it('item -> Relatorio de compras -> Painel: a origem foi esquecida (foco nao volta ao link)', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await linkDoItem('PRODUTO B'));
    await tituloDoItem('PRODUTO B');
    fireEvent.click(screen.getByRole('button', { name: 'Relatório de compras' }));
    await waitFor(() => expect(document.title).toBe(`Relatório de compras · ${TITULO_PAINEL}`));
    fireEvent.click(screen.getByRole('button', { name: 'Painel' }));
    await linkDoItem('PRODUTO B');
    expect(document.activeElement?.closest('.fc-grid')).toBeNull();
  });
});

describe('Forecast - foco com a pagina do item ja montada e origem esquecida', () => {
  it('ir de /forecast/item/3 para /forecast/item/4 (mesma pagina montada): o foco vai ao titulo do item novo e o title o acompanha', async () => {
    renderRota('/forecast/item/3?quinzena=7');
    const primeiro = await tituloDoItem('PRODUTO A');
    expect(document.activeElement).toBe(primeiro);
    (screen.getByLabelText('Quinzena') as HTMLSelectElement).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Ir para o item 4' }));
    const novo = await tituloDoItem('PRODUTO B');
    expect(document.activeElement).toBe(novo);
    expect(document.title).toBe(`PRODUTO B · ${TITULO_PAINEL}`);
  });

  it('item -> quinzena 8 -> quinzena 7: o foco continua no seletor (a origem foi consumida na quinzena 8, nao rouba o foco depois)', async () => {
    renderRota('/forecast?quinzena=7');
    fireEvent.click(await linkDoItem('PRODUTO B'));
    await tituloDoItem('PRODUTO B');
    const seletor = screen.getByLabelText('Quinzena') as HTMLSelectElement;
    seletor.focus();
    fireEvent.change(seletor, { target: { value: '8' } });
    await screen.findByRole('table', { name: /quinzena 11-1/ });
    expect(document.activeElement).toBe(seletor);
    fireEvent.change(seletor, { target: { value: '7' } });
    await screen.findByRole('table', { name: /quinzena 10-2/ });
    expect(document.activeElement).toBe(seletor);
  });
});

describe('Forecast - document.title', () => {
  it('ao sair da tela o title anterior e restaurado', async () => {
    const { unmount } = renderRota('/forecast?quinzena=7');
    await linkDoItem('PRODUTO A');
    expect(document.title).toBe(TITULO_PAINEL);
    unmount();
    expect(document.title).toBe('IntelliQuote');
  });
});
