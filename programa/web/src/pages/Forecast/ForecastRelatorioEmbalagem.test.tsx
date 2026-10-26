import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastRelatorioCompras from './ForecastRelatorioCompras';

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

// Dados 100% sinteticos.
function item(over: Record<string, unknown> = {}) {
  return {
    linha: 3,
    n: 1,
    productId: 42,
    item: 'PRODUTO 001',
    codigos: ['C0001', 'C0002'],
    status: 'nao',
    demanda: -40,
    quantidadeSugerida: 40,
    embalagem: { usada: null, cadastradas: [], multiplas: false },
    quantidadeEmbalagens: null,
    quantidadeFinal: 40,
    naoFraciona: false,
    ruptura: { indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false },
    dataLimite: '2026-10-22',
    vencida: false,
    leadTimeDias: 30,
    emAndamento: { chegadas: [], programacoes: [] },
    ...over,
  };
}

function relatorio(itens: unknown[]) {
  return {
    quinzena: { id: 7, label: '10-2', baseDate: '2026-10-15', half: 2, origin: 'planilha', hoje: '2026-10-20' },
    totais: { itens: itens.length, fontes: 1, vencidas: 0, semEmbalagem: 1, multiplasEmbalagens: 0 },
    fora: { semLeadTime: 0, semConsumoSemFalta: 0 },
    grupos: [{ fonte: 'FONTE 001', leadTimeDias: 30, dataLimiteMaisUrgente: '2026-10-22', vencidas: 0, itens }],
  };
}

const embalagens = {
  produto: { id: 42, nome: 'PRODUTO 001', ativo: true, embalagemPlanilha: null, naoFraciona: false },
  codigos: [
    { id: 1, posicao: 1, codigo: 'C0001', quantidadeKg: null, rotulo: null, principal: false, origem: null, atualizadoEm: null },
  ],
  usadaCodigoId: null,
};

function mockApi(itens: unknown[]) {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/embalagens')) return { data: embalagens };
    return { data: relatorio(itens) };
  });
}

function renderRelatorio(podeEditar?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastRelatorioCompras snapshotId={7} podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForecastRelatorioCompras - botao de embalagens', () => {
  it('editor + item sem embalagem com productId: "Cadastrar embalagem" abre o dialogo do produto', async () => {
    mockApi([item()]);
    renderRelatorio(true);
    const botao = await screen.findByRole('button', { name: 'Cadastrar embalagem de PRODUTO 001' });
    expect(botao.textContent).toBe('Cadastrar embalagem');
    expect(botao.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.getByText('Embalagem não cadastrada')).toBeTruthy();
    fireEvent.click(botao);
    expect(await screen.findByRole('heading', { name: 'Embalagens do item' })).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/products/42/embalagens');
    // O dialogo nao fica dentro da tabela do relatorio (o CSS da tabela nao pode vazar para ele).
    expect(screen.getByRole('heading', { name: 'Embalagens do item' }).closest('table')).toBeNull();
  });

  it('fechar o dialogo devolve o foco ao botao', async () => {
    mockApi([item()]);
    renderRelatorio(true);
    const botao = await screen.findByRole('button', { name: 'Cadastrar embalagem de PRODUTO 001' });
    fireEvent.click(botao);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Embalagens do item' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cadastrar embalagem de PRODUTO 001' }));
  });

  it('sem permissao de edicao: nenhum botao (o selo continua)', async () => {
    mockApi([item()]);
    renderRelatorio(false);
    expect(await screen.findByText('Embalagem não cadastrada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /embalagem/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar embalagens/ })).toBeNull();
  });

  it('productId nulo (produto fora do cadastro): sem botao e o selo "Embalagem não cadastrada" continua', async () => {
    mockApi([item({ productId: null })]);
    renderRelatorio(true);
    expect(await screen.findByText('Embalagem não cadastrada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cadastrar embalagem|Editar embalagens/ })).toBeNull();
  });

  it('com embalagem usada: mostra os kg com ate 3 casas e "Editar embalagens"', async () => {
    mockApi([
      item({
        embalagem: {
          usada: { codigo: 'C0001', quantidade: 22.68, rotulo: null },
          cadastradas: [{ codigo: 'C0001', quantidade: 22.68, rotulo: null }],
          multiplas: false,
        },
        quantidadeEmbalagens: 2,
        quantidadeFinal: 45.36,
      }),
    ]);
    renderRelatorio(true);
    expect(await screen.findByText(/× 22,68 kg \(código C0001\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar embalagens de PRODUTO 001' }).textContent).toBe(
      'Editar embalagens',
    );
    expect(screen.queryByText('Embalagem não cadastrada')).toBeNull();
  });

  it('uma so embalagem: sem linhas extras de "outras" e sem selo de arredondamento', async () => {
    mockApi([
      item({
        embalagem: {
          usada: { codigo: 'C0001', quantidade: 200, rotulo: null },
          cadastradas: [{ codigo: 'C0001', quantidade: 200, rotulo: null }],
          multiplas: false,
        },
        porEmbalagem: [{ codigo: 'C0001', quantidade: 200, rotulo: null, embalagens: 1, quantidadeFinal: 200, destaque: true }],
        quantidadeEmbalagens: 1,
        quantidadeFinal: 200,
      }),
    ]);
    const { container } = renderRelatorio();
    expect(await screen.findByText('1 × 200 kg (código C0001)')).toBeTruthy();
    expect(container.querySelector('.fcr-embalagem__outras')).toBeNull();
    expect(screen.queryByText(/Arredondado pela embalagem/)).toBeNull();
  });

  it('duas embalagens: a quantidade de cada uma, com o rotulo quando existe', async () => {
    mockApi([
      item({
        embalagem: {
          usada: { codigo: 'C0001', quantidade: 25, rotulo: null },
          cadastradas: [
            { codigo: 'C0001', quantidade: 25, rotulo: null },
            { codigo: 'C0002', quantidade: 200, rotulo: 'Tambor 200 kg' },
          ],
          multiplas: true,
        },
        porEmbalagem: [
          { codigo: 'C0001', quantidade: 25, rotulo: null, embalagens: 2, quantidadeFinal: 50, destaque: true },
          { codigo: 'C0002', quantidade: 200, rotulo: 'Tambor 200 kg', embalagens: 1, quantidadeFinal: 200, destaque: false },
        ],
        quantidadeEmbalagens: 2,
        quantidadeFinal: 50,
      }),
    ]);
    const { container } = renderRelatorio();
    expect(await screen.findByText('2 × 25 kg (código C0001)')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('.fcr-embalagem__outras')).map((e) => e.textContent)).toEqual([
      '1 × Tambor 200 kg (código C0002) = 200 kg',
    ]);
  });

  it('sem a prop podeEditar o padrao e somente leitura', async () => {
    mockApi([item()]);
    renderRelatorio();
    expect(await screen.findByText('Embalagem não cadastrada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cadastrar embalagem/ })).toBeNull();
  });
});

describe('ForecastRelatorioCompras - pallet fechado (PR 6e)', () => {
  const palletDe = (kg: number, abaixo: number, acima: number) => ({
    kgPorPallet: kg,
    abaixo: { pallets: abaixo, kg: abaixo * kg },
    acima: { pallets: acima, kg: acima * kg },
  });
  const comPallet = (over: Record<string, unknown> = {}) =>
    item({
      quantidadeSugerida: 1400,
      demanda: -1400,
      embalagem: {
        usada: { codigo: 'C0001', quantidade: 25, rotulo: null },
        cadastradas: [{ codigo: 'C0001', quantidade: 25, rotulo: null }],
        multiplas: false,
      },
      porEmbalagem: [
        {
          codigo: 'C0001',
          quantidade: 25,
          rotulo: null,
          embalagens: 56,
          quantidadeFinal: 1400,
          destaque: true,
          pallet: palletDe(600, 2, 3),
        },
      ],
      quantidadeEmbalagens: 56,
      quantidadeFinal: 1400,
      ...over,
    });

  it('mostra os pallets abaixo e acima sob a embalagem; a Qtd. final continua a da embalagem', async () => {
    mockApi([comPallet()]);
    const { container } = renderRelatorio();
    expect(await screen.findByText('56 × 25 kg (código C0001)')).toBeTruthy();
    const linhas = Array.from(container.querySelectorAll('.fcr-embalagem__pallet')).map((e) => e.textContent);
    expect(linhas).toEqual(['Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)']);
  });

  it('duas embalagens: o pallet de cada opcao vem logo abaixo dela (destaque e outras)', async () => {
    mockApi([
      comPallet({
        embalagem: {
          usada: { codigo: 'C0001', quantidade: 25, rotulo: null },
          cadastradas: [
            { codigo: 'C0001', quantidade: 25, rotulo: null },
            { codigo: 'C0002', quantidade: 1000, rotulo: 'Bag' },
          ],
          multiplas: true,
        },
        porEmbalagem: [
          {
            codigo: 'C0001',
            quantidade: 25,
            rotulo: null,
            embalagens: 56,
            quantidadeFinal: 1400,
            destaque: true,
            pallet: palletDe(600, 2, 3),
          },
          {
            codigo: 'C0002',
            quantidade: 1000,
            rotulo: 'Bag',
            embalagens: 2,
            quantidadeFinal: 2000,
            destaque: false,
            pallet: palletDe(2000, 0, 1),
          },
        ],
      }),
    ]);
    const { container } = renderRelatorio();
    await screen.findByText('56 × 25 kg (código C0001)');
    const celula = container.querySelector('.fcr-embalagem') as HTMLElement;
    const textos = Array.from(celula.children).map((e) => e.textContent);
    expect(textos).toEqual([
      '56 × 25 kg (código C0001)',
      'Arredondado pela embalagem do código C0001',
      'Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)',
      '2 × Bag (código C0002) = 2.000 kg',
      'Pallet de 2.000 kg: 1 pallet = 2.000 kg (acima)',
    ]);
  });

  it('sem pallet (nulo, ausente ou backend antigo) nada aparece, nem a linha do resumo', async () => {
    mockApi([comPallet({ porEmbalagem: [{ codigo: 'C0001', quantidade: 25, rotulo: null, embalagens: 56, quantidadeFinal: 1400, destaque: true }] })]);
    const { container } = renderRelatorio();
    await screen.findByText('56 × 25 kg (código C0001)');
    expect(container.querySelector('.fcr-embalagem__pallet')).toBeNull();
    expect(screen.queryByText(/^\d+ com pallet cadastrado$/)).toBeNull();
  });

  it('resumo: "N com pallet cadastrado" so com totais.comPallet > 0', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/embalagens')) return { data: embalagens };
      const base = relatorio([comPallet()]);
      return { data: { ...base, totais: { ...base.totais, comPallet: 1 } } };
    });
    renderRelatorio();
    expect(await screen.findByText('1 com pallet cadastrado')).toBeTruthy();
  });

  it('o paragrafo das regras fala do pallet', async () => {
    mockApi([comPallet()]);
    renderRelatorio();
    await screen.findByText('56 × 25 kg (código C0001)');
    expect(screen.getByText(/O pallet é uma opção de compra informada pelo cadastro, não uma regra, e pode não ser múltiplo da embalagem/)).toBeTruthy();
  });
});

describe('ForecastRelatorioCompras - varios tamanhos de pallet (Etapa B)', () => {
  const palletDe = (kg: number, abaixo: number, acima: number) => ({
    kgPorPallet: kg,
    abaixo: { pallets: abaixo, kg: abaixo * kg },
    acima: { pallets: acima, kg: acima * kg },
  });
  const comDoisTamanhos = (over: Record<string, unknown> = {}) =>
    item({
      quantidadeSugerida: 1400,
      demanda: -1400,
      embalagem: {
        usada: { codigo: 'C0001', quantidade: 25, rotulo: null, palletKg: 1000, outrosPalletsKg: [1200] },
        cadastradas: [{ codigo: 'C0001', quantidade: 25, rotulo: null, palletKg: 1000, outrosPalletsKg: [1200] }],
        multiplas: false,
      },
      porEmbalagem: [
        {
          codigo: 'C0001',
          quantidade: 25,
          rotulo: null,
          embalagens: 56,
          quantidadeFinal: 1400,
          destaque: true,
          pallet: palletDe(1000, 1, 2),
          outrosPallets: [palletDe(1200, 1, 2)],
        },
      ],
      quantidadeEmbalagens: 56,
      quantidadeFinal: 1400,
      ...over,
    });

  it('item com 2 tamanhos mostra as 2 linhas de pallet sob a embalagem, na ordem do cadastro', async () => {
    mockApi([comDoisTamanhos()]);
    const { container } = renderRelatorio();
    expect(await screen.findByText('56 × 25 kg (código C0001)')).toBeTruthy();
    const linhas = Array.from(container.querySelectorAll('.fcr-embalagem__pallet')).map((e) => e.textContent);
    expect(linhas).toEqual([
      'Pallet de 1.000 kg: 1 pallet = 1.000 kg (abaixo) · 2 pallets = 2.000 kg (acima)',
      'Pallet de 1.200 kg: 1 pallet = 1.200 kg (abaixo) · 2 pallets = 2.400 kg (acima)',
    ]);
  });

  it('duas embalagens: os tamanhos de cada opcao vem logo abaixo dela (destaque e outras)', async () => {
    mockApi([
      comDoisTamanhos({
        embalagem: {
          usada: { codigo: 'C0001', quantidade: 25, rotulo: null },
          cadastradas: [
            { codigo: 'C0001', quantidade: 25, rotulo: null },
            { codigo: 'C0002', quantidade: 1000, rotulo: 'Bag' },
          ],
          multiplas: true,
        },
        porEmbalagem: [
          {
            codigo: 'C0001',
            quantidade: 25,
            rotulo: null,
            embalagens: 56,
            quantidadeFinal: 1400,
            destaque: true,
            pallet: palletDe(1000, 1, 2),
            outrosPallets: [palletDe(1200, 1, 2)],
          },
          {
            codigo: 'C0002',
            quantidade: 1000,
            rotulo: 'Bag',
            embalagens: 2,
            quantidadeFinal: 2000,
            destaque: false,
            pallet: palletDe(2000, 0, 1),
            outrosPallets: [palletDe(4000, 0, 1)],
          },
        ],
      }),
    ]);
    const { container } = renderRelatorio();
    await screen.findByText('56 × 25 kg (código C0001)');
    const celula = container.querySelector('.fcr-embalagem') as HTMLElement;
    const textos = Array.from(celula.children).map((e) => e.textContent);
    expect(textos).toEqual([
      '56 × 25 kg (código C0001)',
      'Arredondado pela embalagem do código C0001',
      'Pallet de 1.000 kg: 1 pallet = 1.000 kg (abaixo) · 2 pallets = 2.000 kg (acima)',
      'Pallet de 1.200 kg: 1 pallet = 1.200 kg (abaixo) · 2 pallets = 2.400 kg (acima)',
      '2 × Bag (código C0002) = 2.000 kg',
      'Pallet de 2.000 kg: 1 pallet = 2.000 kg (acima)',
      'Pallet de 4.000 kg: 1 pallet = 4.000 kg (acima)',
    ]);
  });

  it('com 1 tamanho (sem outrosPallets) a celula e a de hoje: uma so linha de pallet', async () => {
    mockApi([
      comDoisTamanhos({
        porEmbalagem: [
          { codigo: 'C0001', quantidade: 25, rotulo: null, embalagens: 56, quantidadeFinal: 1400, destaque: true, pallet: palletDe(600, 2, 3) },
        ],
      }),
    ]);
    const { container } = renderRelatorio();
    await screen.findByText('56 × 25 kg (código C0001)');
    const linhas = Array.from(container.querySelectorAll('.fcr-embalagem__pallet')).map((e) => e.textContent);
    expect(linhas).toEqual(['Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)']);
  });
});
