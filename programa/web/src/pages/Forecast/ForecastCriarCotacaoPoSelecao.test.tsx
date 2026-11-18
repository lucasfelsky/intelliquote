import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { ForecastPoDiretaEnviada } from '@/services/forecastPoDireta';

// PO direta de VARIOS itens de preco fechado a partir da selecao do Relatorio de compras: botao "Enviar PO (k)" na barra, uma PO por
// fonte (fila "PO 1 de 2"), itens enviados saem da selecao. O modal e a lista de decisoes sao simulados. Dados 100% sinteticos.

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('./ForecastGerarCotacao', () => ({ useVinculosDeCotacao: () => ({}) }));
vi.mock('./ForecastDecisaoCompra', () => ({ useDecisoesDaQuinzena: () => ({ mapa: new Map() }) }));
vi.mock('./ForecastCriarCotacaoPopup', () => ({ default: () => null }));
vi.mock('./ForecastPrecoFechadoModal', () => ({ default: () => null }));

const modal = vi.hoisted(() => ({ props: [] as Array<{ itens: ForecastItemRelatorio[]; posicao?: { atual: number; total: number } }> }));
vi.mock('./ForecastPoDiretaModal', () => ({
  default: (p: { itens: ForecastItemRelatorio[]; posicao?: { atual: number; total: number }; onClose: () => void; onEnviada: (r: ForecastPoDiretaEnviada) => void }) => {
    modal.props.push({ itens: p.itens, posicao: p.posicao });
    return (
      <div role="dialog" aria-label="Modal PO">
        <span data-testid="itens-po">{p.itens.map((i) => i.item).join('|')}</span>
        <span data-testid="posicao-po">{p.posicao ? `${p.posicao.atual}/${p.posicao.total}` : ''}</span>
        <button type="button" onClick={p.onClose}>
          fechar-modal
        </button>
        <button
          type="button"
          onClick={() =>
            p.onEnviada({
              purchaseOrderId: 1,
              purchaseOrderIds: p.itens.map((_, k) => k + 1),
              itens: p.itens.map((i, k) => ({ productId: i.productId as number, purchaseOrderId: k + 1, qtdFinalKg: i.quantidadeFinal, statusDaDecisao: 'po' })),
              jaEnviada: false,
              registro: 'ok',
              qtdFinalKg: 1,
              statusDaDecisao: 'po',
              fornecedor: `FORN ${p.itens[0]?.item}`,
              para: 'a@x.example',
              copia: [],
            })
          }
        >
          enviar-modal
        </button>
      </div>
    );
  },
}));

import { api } from '@/api/client';
import { ProvedorCriarCotacao, useCriarCotacao } from './ForecastCriarCotacao';

const get = vi.mocked(api.get);

function it_(productId: number, nome: string, over: Record<string, unknown> = {}) {
  return { linha: productId, n: 1, productId, item: nome, codigos: [`C${productId}`], status: 'nao', quantidadeFinal: 1000, precoFixo: true, ...over } as unknown as ForecastItemRelatorio;
}

const A1 = it_(1, 'ITEM A1');
const A2 = it_(2, 'ITEM A2');
const B1 = it_(3, 'ITEM B1');
const SEM_PRECO = it_(4, 'ITEM SEM PRECO');
const VENCIDO = it_(5, 'ITEM VENCIDO');
const COMUM = it_(6, 'ITEM COMUM', { precoFixo: false });

const SELECAO = [
  { item: A1, fonte: 'Fonte A' },
  { item: A2, fonte: 'FONTE A ' },
  { item: B1, fonte: 'Fonte B' },
  { item: SEM_PRECO, fonte: 'Fonte A' },
  { item: VENCIDO, fonte: 'Fonte A' },
  { item: COMUM, fonte: 'Fonte A' },
];

function preco(productId: number, estado: string) {
  return { productId, estado, valorPorKg: estado === 'ok' ? 2 : null, moeda: 'USD', incoterm: 'CFR', validoAte: '2026-12-31' };
}

function Marcador() {
  const ctx = useCriarCotacao();
  return (
    <div>
      {SELECAO.map((s) => (
        <button key={s.item.productId} type="button" onClick={() => ctx?.alternar(s)}>
          marcar {s.item.item}
        </button>
      ))}
      <span data-testid="n-sel">{ctx?.selecionados.size}</span>
    </div>
  );
}

function renderizar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProvedorCriarCotacao snapshotId={7} quinzena="11-1" diasCritico={30} itensDaLista={SELECAO}>
          <Marcador />
        </ProvedorCriarCotacao>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function marcar(...nomes: string[]) {
  for (const n of nomes) fireEvent.click(await screen.findByRole('button', { name: `marcar ${n}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  modal.props.length = 0;
  get.mockImplementation((async (path: string) => {
    if (path.endsWith('/precos-fechados')) {
      return {
        data: {
          hoje: '2026-11-17',
          itens: [preco(1, 'ok'), preco(2, 'ok'), preco(3, 'ok'), preco(4, 'sem_valor'), preco(5, 'vencido')],
        },
      };
    }
    return { data: null };
  }) as never);
});

describe('Enviar PO de varios itens selecionados', () => {
  it('a barra mostra "Enviar PO (k)" so com os selecionados de preco fechado com preco valido', async () => {
    renderizar();
    await marcar('ITEM A1', 'ITEM SEM PRECO', 'ITEM VENCIDO', 'ITEM COMUM');
    // sem_valor, vencido e item comum nao entram na conta
    expect(await screen.findByRole('button', { name: /Enviar PO \(1\)/ })).toBeTruthy();
    await marcar('ITEM A2');
    expect(await screen.findByRole('button', { name: /Enviar PO \(2\)/ })).toBeTruthy();
  });

  it('sem nenhum item elegivel o botao nao aparece (so "Criar cotacao")', async () => {
    renderizar();
    await marcar('ITEM COMUM', 'ITEM SEM PRECO');
    await screen.findByRole('region', { name: 'Itens selecionados' });
    expect(screen.queryByRole('button', { name: /Enviar PO/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Criar cotação/ })).toBeTruthy();
  });

  it('uma fonte so: UM modal com todos os itens, sem "PO x de y"', async () => {
    renderizar();
    await marcar('ITEM A1', 'ITEM A2');
    fireEvent.click(await screen.findByRole('button', { name: /Enviar PO \(2\)/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Modal PO' });
    expect(within(dialogo).getByTestId('itens-po').textContent).toBe('ITEM A1|ITEM A2');
    expect(within(dialogo).getByTestId('posicao-po').textContent).toBe('');
  });

  it('varias fontes: uma PO por fonte, na ordem; ao enviar a primeira abre a segunda e os enviados saem da selecao', async () => {
    renderizar();
    await marcar('ITEM A1', 'ITEM B1', 'ITEM A2');
    expect(screen.getByTestId('n-sel').textContent).toBe('3');
    fireEvent.click(await screen.findByRole('button', { name: /Enviar PO \(3\)/ }));

    let dialogo = await screen.findByRole('dialog', { name: 'Modal PO' });
    // "Fonte A" e "FONTE A " sao a mesma fonte (sem diferenciar caixa nem espacos)
    expect(within(dialogo).getByTestId('itens-po').textContent).toBe('ITEM A1|ITEM A2');
    expect(within(dialogo).getByTestId('posicao-po').textContent).toBe('1/2');

    fireEvent.click(within(dialogo).getByRole('button', { name: 'enviar-modal' }));
    await waitFor(() => expect(screen.getByTestId('itens-po').textContent).toBe('ITEM B1'));
    dialogo = screen.getByRole('dialog', { name: 'Modal PO' });
    expect(within(dialogo).getByTestId('posicao-po').textContent).toBe('2/2');
    expect(screen.getByTestId('n-sel').textContent).toBe('1');
    // aviso da primeira PO, com os dois itens
    expect(screen.getByText('PO de 2 itens enviada a FORN ITEM A1.')).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole('button', { name: 'enviar-modal' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modal PO' })).toBeNull());
    expect(screen.getByText('PO de ITEM B1 enviada a FORN ITEM B1.')).toBeTruthy();
    expect(screen.getByTestId('n-sel').textContent).toBe('0');
    expect(screen.queryByRole('button', { name: /Enviar PO/ })).toBeNull();
  });

  it('cancelar no meio da fila descarta so o que falta: o item da fonte pendente continua selecionado', async () => {
    renderizar();
    await marcar('ITEM A1', 'ITEM B1');
    fireEvent.click(await screen.findByRole('button', { name: /Enviar PO \(2\)/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Modal PO' });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'enviar-modal' }));
    await waitFor(() => expect(screen.getByTestId('itens-po').textContent).toBe('ITEM B1'));
    fireEvent.click(screen.getByRole('button', { name: 'fechar-modal' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modal PO' })).toBeNull());
    expect(screen.getByTestId('n-sel').textContent).toBe('1');
    expect(screen.getByRole('button', { name: /Enviar PO \(1\)/ })).toBeTruthy();
  });

  it('mais de 50 itens: o botao fica desabilitado e explica quantos tirar', async () => {
    // 51 itens elegiveis: a selecao e montada direto pelo contexto
    const muitos = Array.from({ length: 51 }, (_, k) => ({ item: it_(100 + k, `MUITO ${k}`), fonte: 'Fonte A' }));
    get.mockImplementation((async (path: string) =>
      path.endsWith('/precos-fechados')
        ? { data: { hoje: '2026-11-17', itens: muitos.map((m) => preco(m.item.productId as number, 'ok')) } }
        : { data: null }) as never);
    function Todos() {
      const ctx = useCriarCotacao();
      return (
        <button type="button" onClick={() => ctx?.marcar(muitos, true)}>
          marcar todos
        </button>
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ProvedorCriarCotacao snapshotId={7} quinzena="11-1" diasCritico={30} itensDaLista={muitos}>
            <Todos />
          </ProvedorCriarCotacao>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'marcar todos' }));
    const botao = (await screen.findByRole('button', { name: /Enviar PO \(51\)/ })) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.title).toContain('tire 1 da seleção');
  });
});
