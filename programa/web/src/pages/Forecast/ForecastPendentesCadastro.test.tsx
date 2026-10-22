import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForecastPendentesCadastro from './ForecastPendentesCadastro';

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

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

// Dados 100% sinteticos.
const item = (over: Record<string, unknown>) => ({
  codigo: 'TST0901',
  situacao: 'sem_cadastro',
  produtoInativo: null,
  vendasMes: 0,
  vendasAtual: 0,
  vendasAnual: 0,
  vendas3Meses: 0,
  vendasAnteriores: 0,
  programacao: 0,
  chegadas: 0,
  comprasEmAberto: 0,
  saldo: 0,
  ...over,
});

const REGRA = { mesesVenda: ['2026-08', '2026-09', '2026-10'], historicoAusente: [] as string[], compras: 'fup_em_aberto' };

let pendentes: Record<string, unknown>;

function dados(over: Record<string, unknown> = {}) {
  return {
    aplicavel: true,
    snapshotId: 8,
    label: '11-1',
    itens: [
      item({ codigo: 'TST0901', vendasMes: 20, vendasAnteriores: 40, vendas3Meses: 60, vendasAnual: 1200, comprasEmAberto: 80 }),
      item({
        codigo: 'TST0902',
        situacao: 'produto_inativo',
        produtoInativo: { id: 9, nome: 'PRODUTO 009' },
        vendasMes: 5,
        vendas3Meses: 5,
        vendasAnual: 50,
      }),
    ],
    totalItens: 2,
    omitidos: 0,
    soSaldo: { codigos: 0, kg: 0 },
    semVendaRecente: { codigos: 0, vendasAnual: 0 },
    regra: REGRA,
    ...over,
  };
}

function renderPainel(podeEditar = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForecastPendentesCadastro snapshotId={8} label="11-1" podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pendentes = dados();
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/forecast/snapshots/8/pendentes') return { data: pendentes };
    if (path === '/v1/forecast/sources') return { data: [{ id: 3, name: 'FONTE 001', leadTimeDays: 45, clearanceDays: null, isActive: true }] };
    if (path === '/v1/item-families') return { data: [{ id: 7, name: 'FAMILIA A', isActive: true }] };
    if (path === '/v1/forecast/products') {
      return { data: [{ id: 1, name: 'PRODUTO 001', isActive: true, origin: 'planilha', codes: [{ id: 11, position: 1, code: 'TST0001' }] }] };
    }
    throw new Error(`GET inesperado: ${path}`);
  });
});

describe('ForecastPendentesCadastro - estados', () => {
  it('carregando e depois a lista; consulta so os pendentes da quinzena', async () => {
    renderPainel();
    expect(screen.getByText('Carregando pendentes de cadastro…')).toBeTruthy();
    expect(await screen.findByText(/Pendentes de cadastro \(2\)/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/v1/forecast/snapshots/8/pendentes');
  });

  it('erro: alerta em portugues com "Tentar de novo" que consulta de novo', async () => {
    get.mockRejectedValueOnce(new ApiError(500, null));
    renderPainel();
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Não foi possível carregar os pendentes de cadastro (HTTP 500).');
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/Pendentes de cadastro \(2\)/)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('vazio: uma linha discreta com o criterio, sem tabela; as contagens fora da lista continuam visiveis', async () => {
    pendentes = dados({ itens: [], totalItens: 0, semVendaRecente: { codigos: 4, vendasAnual: 2500 } });
    renderPainel();
    expect(
      await screen.findByText(
        'Pendentes de cadastro: nenhum código com venda nos últimos 3 meses, programação ou compra em aberto no FUP fora do cadastro nesta quinzena.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Sem venda nos últimos 3 meses (não listados): 4 códigos · 2.500 kg de venda anual')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('vazio com backend antigo (sem `regra`): o texto de antes', async () => {
    pendentes = dados({ itens: [], totalItens: 0, regra: undefined, semVendaRecente: undefined });
    renderPainel();
    expect(await screen.findByText('Pendentes de cadastro: nenhum código fora do cadastro nesta quinzena.')).toBeTruthy();
  });

  it('quinzena da planilha (aplicavel: false): nao renderiza nada', async () => {
    pendentes = dados({ aplicavel: false, itens: [], totalItens: 0 });
    const { container } = renderPainel();
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Carregando pendentes de cadastro…')).toBeNull());
    expect(container.textContent).toBe('');
  });
});

describe('ForecastPendentesCadastro - lista', () => {
  it('resumo, texto de quando entra no calculo e tabela com quantidades; zero vira traco; sem coluna Saldo zerada', async () => {
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    expect(screen.getByText(/ficam fora do cálculo/)).toBeTruthy();
    expect(
      screen.getByText(
        'Esses códigos ficaram FORA do cálculo da quinzena 11-1. Depois de completar o cadastro, eles entram a partir da próxima quinzena importada.',
      ),
    ).toBeTruthy();
    const tabela = screen.getByRole('table');
    expect(within(tabela).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Código',
      'Situação',
      'Vendas 3 meses',
      'Vendas mês atual',
      'Programação',
      'Compras em aberto (FUP)',
      'Ação',
    ]);
    const linhas = within(tabela).getAllByRole('row').slice(1);
    const celulas = (l: HTMLElement) => within(l).getAllByRole('cell').map((c) => c.textContent);
    // Vendas 3 meses = 60 (nao so o mes anterior); a venda anual (1.200) nao e coluna.
    expect(celulas(linhas[0] as HTMLElement)).toEqual(['Sem cadastro', '60', '—', '—', '80', 'Completar cadastro']);
    expect(within(linhas[0] as HTMLElement).getByRole('rowheader').textContent).toBe('TST0901');
  });

  it('criterio, sem-venda-recente e historico ausente viram notas sob a tabela', async () => {
    pendentes = dados({
      semVendaRecente: { codigos: 7, vendasAnual: 3400 },
      regra: { ...REGRA, historicoAusente: ['2026-08'] },
    });
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    expect(
      screen.getByText('Entram na lista: venda em ago/2026, set/2026 ou out/2026, programação pendente ou compra em aberto no FUP.'),
    ).toBeTruthy();
    expect(screen.getByText('Sem venda nos últimos 3 meses (não listados): 7 códigos · 3.400 kg de venda anual')).toBeTruthy();
    expect(screen.getByText('Sem histórico de vendas gravado em ago/2026: a lista pode estar incompleta.')).toBeTruthy();
  });

  it('backend antigo (sem vendas3Meses/comprasEmAberto/regra): mostra vendas do mes anterior e chegadas, sem criterio', async () => {
    pendentes = dados({
      itens: [
        {
          codigo: 'TST0901',
          situacao: 'sem_cadastro',
          produtoInativo: null,
          vendasMes: 20,
          vendasAtual: 0,
          vendasAnual: 1200,
          programacao: 0,
          chegadas: 80,
          saldo: 0,
        },
      ],
      totalItens: 1,
      regra: undefined,
      semVendaRecente: undefined,
    });
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(1\)/);
    const linha = within(screen.getByRole('table')).getAllByRole('row')[1] as HTMLElement;
    expect(within(linha).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'Sem cadastro',
      '20',
      '—',
      '—',
      '80',
      'Completar cadastro',
    ]);
    expect(screen.queryByText(/Entram na lista/)).toBeNull();
  });

  it('coluna Saldo aparece quando algum codigo tem saldo; so-saldo e omitidos viram notas', async () => {
    pendentes = dados({
      itens: [item({ codigo: 'TST0901', vendasMes: 20, vendas3Meses: 20, saldo: 300 })],
      totalItens: 3,
      omitidos: 2,
      soSaldo: { codigos: 5, kg: 1234 },
    });
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(3\)/);
    expect(screen.getByRole('columnheader', { name: 'Saldo' })).toBeTruthy();
    expect(screen.getByText('Só saldo (não listados): 5 códigos · 1.234 kg')).toBeTruthy();
    expect(screen.getByText(/… e mais 2 códigos/)).toBeTruthy();
  });

  it('codigo de produto INATIVO: mostra o nome, explica a reativacao e NAO tem botao', async () => {
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    const linha = screen.getByRole('rowheader', { name: 'TST0902' }).closest('tr') as HTMLElement;
    expect(within(linha).getByText('Produto inativo')).toBeTruthy();
    expect(within(linha).getByText('PRODUTO 009')).toBeTruthy();
    expect(within(linha).queryByRole('button')).toBeNull();
    expect(
      screen.getByText(/Reative o produto para o código voltar ao cálculo\. A reativação de produto ainda não está disponível nesta tela\./),
    ).toBeTruthy();
  });

  it('sem permissao de editar (gestor/viewer): lista sem coluna Acao nem botoes', async () => {
    renderPainel(false);
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    expect(screen.getByText('TST0901')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Ação' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Completar cadastro/ })).toBeNull();
  });
});

describe('ForecastPendentesCadastro - completar cadastro', () => {
  it('abre o dialogo com o codigo; Esc devolve o foco ao botao que abriu', async () => {
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    const botao = screen.getByRole('button', { name: 'Completar cadastro do código TST0901' });
    botao.focus();
    fireEvent.click(botao);
    expect(await screen.findByRole('heading', { name: 'Completar cadastro' })).toBeTruthy();
    expect((await screen.findByLabelText('Código 1') as HTMLInputElement).value).toBe('TST0901');
    const dialogo = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogo, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Completar cadastro' })).toBeNull());
    expect(document.activeElement).toBe(botao);
  });

  it('gravar um produto novo: mensagem de sucesso com foco, lista consultada de novo', async () => {
    post.mockResolvedValue({ data: { id: 55 } });
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Completar cadastro do código TST0901' }));
    fireEvent.change(await screen.findByLabelText('Nome do produto'), { target: { value: 'PRODUTO 901' } });
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Família'), { target: { value: '7' } });
    const antes = get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots/8/pendentes').length;
    // A lista nova ja vem sem o codigo completado.
    pendentes = dados({ itens: [dados().itens[1]], totalItens: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }));
    const status = await screen.findByText('Cadastro gravado.');
    expect(status.getAttribute('role')).toBe('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
    await waitFor(() => expect(screen.getByText(/Pendentes de cadastro \(1\)/)).toBeTruthy());
    expect(get.mock.calls.filter((c) => c[0] === '/v1/forecast/snapshots/8/pendentes').length).toBeGreaterThan(antes);
    expect(screen.queryByRole('button', { name: 'Completar cadastro do código TST0901' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Completar cadastro' })).toBeNull();
  });

  it('acrescentar a produto da PLANILHA: a mensagem pede para incluir o codigo na planilha', async () => {
    post.mockResolvedValue({ data: { produtoId: 1, produtoOrigem: 'planilha', codigo: { id: 9, posicao: 2, codigo: 'TST0901' } } });
    renderPainel();
    await screen.findByText(/Pendentes de cadastro \(2\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Completar cadastro do código TST0901' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Adicionar a produto existente' }));
    fireEvent.click(await screen.findByRole('radio', { name: /PRODUTO 001/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar código' }));
    expect(
      await screen.findByText(
        'Cadastro gravado. Inclua o código também na planilha PO.COMP.01: o próximo import da planilha remove os códigos que não estão nela.',
      ),
    ).toBeTruthy();
  });
});
