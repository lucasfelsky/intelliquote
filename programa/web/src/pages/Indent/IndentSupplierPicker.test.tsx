import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ICONS } from '@/components/icons';
import IndentSupplierPicker from './IndentSupplierPicker';
import type { IndentRequestDetail } from '@/services/indentRequests';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Ana Souza', email: 'u@b.c', role: 'comprador' } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
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

const MOTIVO_TRAVA = 'Fora da lista de fornecedores aprovados do cliente';

function opcao(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    country: 'China',
    type: 'FABRICANTE',
    hasPartnership: false,
    defaultCurrency: 'USD',
    defaultIncoterm: 'CFR',
    allowed: true,
    blockedReason: null,
    approvedByClient: true,
    coverage: { covered: 2, total: 2 },
    ...extra,
  };
}

const OPCOES = {
  clientRuleMode: 'APROVADOS',
  suppliers: [
    opcao(1, 'Shandong Haohua Chemical Co.'),
    opcao(2, 'Gujarat Alkalies Trading', { country: 'Índia', type: 'TRADING', coverage: { covered: 1, total: 2 } }),
    opcao(4, 'Zeta Produtos Ltda', { coverage: { covered: 0, total: 2 } }),
    opcao(3, 'Nordic Solvents AB', {
      country: null,
      type: 'IMPORTADO',
      allowed: false,
      blockedReason: MOTIVO_TRAVA,
      approvedByClient: false,
      coverage: { covered: 0, total: 2 },
    }),
  ],
};

const SOLICITACAO = {
  id: 11,
  processNumber: '275/26',
  client: { id: 3, name: 'Cliente Alfa Ltda', supplierRuleMode: 'APROVADOS' },
} as unknown as IndentRequestDetail;

const onGenerated = vi.fn();

function mockApi(opcoes: unknown = OPCOES) {
  vi.mocked(api.get).mockImplementation((async () => opcoes) as typeof api.get);
  vi.mocked(api.post).mockResolvedValue({
    processNumber: '275/26',
    quotes: [
      { id: 1, supplierId: 1, supplierName: 'Shandong Haohua Chemical Co.', exception: null },
      { id: 2, supplierId: 2, supplierName: 'Gujarat Alkalies Trading', exception: null },
    ],
  });
}

function renderPicker(canWrite = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IndentSupplierPicker request={SOLICITACAO} canWrite={canWrite} onGenerated={onGenerated} />
    </QueryClientProvider>,
  );
}

const caixa = (nome: RegExp | string) => screen.getByRole('checkbox', { name: nome }) as HTMLInputElement;
const cartao = (nome: RegExp | string) => caixa(nome).closest('.indent-sup') as HTMLElement;

async function pronto(canWrite = true) {
  const view = renderPicker(canWrite);
  await screen.findByText('Shandong Haohua Chemical Co.');
  return view;
}

describe('IndentSupplierPicker', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    onGenerated.mockReset();
    mockApi();
  });

  it('pre-marca so permitido que cobre ao menos 1 item; travado fica desabilitado e sem marca', async () => {
    await pronto();

    expect(caixa(/Shandong/).checked).toBe(true);
    expect(caixa(/Gujarat/).checked).toBe(true);
    expect(caixa(/Zeta/).checked).toBe(false);
    expect(caixa(/Zeta/).disabled).toBe(false);
    expect(caixa(/Nordic/).checked).toBe(false);
    expect(caixa(/Nordic/).disabled).toBe(true);

    expect(cartao(/Shandong/).className).toBe('indent-sup is-on');
    expect(cartao(/Zeta/).className).toBe('indent-sup');
    expect(cartao(/Nordic/).className).toBe('indent-sup is-blocked');
  });

  it('cartao: "Pais · Tipo", "Cobre N de M itens" (verde so quando cobre tudo) e tags de aprovado/trava', async () => {
    await pronto();

    expect(within(cartao(/Shandong/)).getByText('China · Fabricante')).toBeTruthy();
    expect(within(cartao(/Gujarat/)).getByText('Índia · Trading')).toBeTruthy();
    expect(within(cartao(/Nordic/)).getByText('— · Importado')).toBeTruthy();

    expect(within(cartao(/Shandong/)).getByText('Cobre 2 de 2 itens').className).toBe('indent-tag indent-tag--ok');
    expect(within(cartao(/Gujarat/)).getByText('Cobre 1 de 2 itens').className).toBe('indent-tag');
    expect(within(cartao(/Zeta/)).getByText('Cobre 0 de 2 itens')).toBeTruthy();

    expect(within(cartao(/Shandong/)).getByText('Aprovado pelo cliente').className).toContain('indent-tag--ok');
    const trava = within(cartao(/Nordic/)).getByText(MOTIVO_TRAVA);
    expect(trava.closest('.indent-tag')?.className).toContain('indent-tag--lock');
    expect(within(cartao(/Nordic/)).getByRole('button', { name: 'Liberar exceção' })).toBeTruthy();
    expect(within(cartao(/Shandong/)).queryByRole('button', { name: 'Liberar exceção' })).toBeNull();
  });

  it('"Cobre N de 1 item" no singular', async () => {
    mockApi({ clientRuleMode: 'LIVRE', suppliers: [opcao(1, 'Shandong Haohua Chemical Co.', { coverage: { covered: 1, total: 1 }, approvedByClient: false })] });
    await pronto();
    expect(screen.getByText('Cobre 1 de 1 item').className).toContain('indent-tag--ok');
    // LIVRE: sem tag "Aprovado pelo cliente"
    expect(screen.queryByText('Aprovado pelo cliente')).toBeNull();
  });

  it('caixa "gerar": "Uma cotacao por fornecedor..." com a contagem e o numero da solicitacao', async () => {
    await pronto();

    expect(screen.getByText('Uma cotação por fornecedor, todas com o mesmo número de processo')).toBeTruthy();
    expect(screen.getByText('275/26').className).toContain('indent-ref--indent');
    expect(screen.getByText('em todas as 2 cotações')).toBeTruthy();
    expect(screen.getByText('Todas as cotações usam o número da solicitação; o fornecedor diferencia uma da outra.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gerar 2 cotações' }).className).toContain('primary-button');
    // Icone do mock: aviao de papel (send), nao a seta.
    expect(screen.getByRole('button', { name: 'Gerar 2 cotações' }).querySelector('svg path')?.getAttribute('d')).toBe(ICONS.send);

    fireEvent.click(caixa(/Gujarat/));
    expect(screen.getByText('em 1 cotação')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gerar 1 cotação' })).toBeTruthy();

    fireEvent.click(caixa(/Shandong/));
    expect(screen.getByText('Escolha ao menos um fornecedor')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Gerar 0 cotações' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Liberar exceção" abre o campo de motivo com foco; motivo vazio mostra "Escreva o motivo da exceção" e mantem o foco', async () => {
    await pronto();
    fireEvent.click(screen.getByRole('button', { name: 'Liberar exceção' }));

    const motivo = (await screen.findByLabelText('Motivo da exceção')) as HTMLInputElement;
    expect(motivo.placeholder).toBe('Motivo (fica no histórico)');
    await waitFor(() => expect(document.activeElement).toBe(motivo));
    expect(screen.queryByRole('button', { name: 'Liberar exceção' })).toBeNull();

    fireEvent.change(motivo, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exceção' }));
    const erro = screen.getByText('Escreva o motivo da exceção');
    expect(erro.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(motivo);
    expect(motivo.getAttribute('aria-invalid')).toBe('true');
    expect(motivo.getAttribute('aria-describedby')).toBe(erro.id);
    // continua travado
    expect(caixa(/Nordic/).disabled).toBe(true);
    expect(screen.queryByText(/fora da regra deste cliente/)).toBeNull();
  });

  it('excecao confirmada: cartao vermelho marcado, motivo + quem + quando, faixa de atencao e contagem de cotacoes', async () => {
    await pronto();
    fireEvent.click(screen.getByRole('button', { name: 'Liberar exceção' }));
    fireEvent.change(await screen.findByLabelText('Motivo da exceção'), { target: { value: 'Cliente autorizou por e-mail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exceção' }));

    const nordic = cartao(/Nordic/);
    expect(nordic.className).toBe('indent-sup is-on is-exc');
    expect(caixa(/Nordic/).checked).toBe(true);
    expect(caixa(/Nordic/).disabled).toBe(false);
    expect(within(nordic).getByText('Exceção à restrição do cliente').closest('.indent-tag')?.className).toContain('indent-tag--exc');
    expect(nordic.textContent).toMatch(/Motivo: Cliente autorizou por e-mail · liberada por Ana Souza em \d{2}\/\d{2} \d{2}:\d{2}/);
    expect(within(nordic).queryByText(MOTIVO_TRAVA)).toBeNull();

    const faixa = screen.getByText('Atenção: 1 fornecedor fora da regra deste cliente').closest('.indent-excbanner') as HTMLElement;
    expect(faixa.getAttribute('role')).toBe('alert');
    expect(within(faixa).getByText('Estas cotações serão marcadas com EXCEÇÃO em toda a tela e no histórico.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gerar 3 cotações' })).toBeTruthy();
    expect(screen.getByText('em todas as 3 cotações')).toBeTruthy();

    // desmarcar tira a excecao da faixa
    fireEvent.click(caixa(/Nordic/));
    expect(screen.queryByText(/fora da regra deste cliente/)).toBeNull();
  });

  it('gerar: manda exceptionReason so nos travados e avisa a tela com o texto do mock', async () => {
    await pronto();
    fireEvent.click(screen.getByRole('button', { name: 'Liberar exceção' }));
    fireEvent.change(await screen.findByLabelText('Motivo da exceção'), { target: { value: ' Autorizado ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar exceção' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar 3 cotações' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/requests/11/quotes', {
      suppliers: [{ supplierId: 1 }, { supplierId: 2 }, { supplierId: 3, exceptionReason: 'Autorizado' }],
    });
    await waitFor(() =>
      expect(onGenerated).toHaveBeenCalledWith('2 cotações criadas com o número 275/26: Shandong, Gujarat'),
    );
  });

  it('uma cotacao criada usa o singular no aviso', async () => {
    vi.mocked(api.post).mockResolvedValue({
      processNumber: '275/26',
      quotes: [{ id: 1, supplierId: 1, supplierName: 'Shandong Haohua Chemical Co.', exception: null }],
    });
    await pronto();
    fireEvent.click(caixa(/Gujarat/));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar 1 cotação' }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith('1 cotação criada com o número 275/26: Shandong'));
  });

  it('erro 400/409 do gerar vira alerta inline e recarrega as opcoes (a regra pode ter mudado)', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'As cotações desta solicitação já foram geradas.' }));
    await pronto();
    const antes = vi.mocked(api.get).mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Gerar 2 cotações' }));

    expect(await screen.findByText('As cotações desta solicitação já foram geradas.')).toBeTruthy();
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(antes));
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('viewer: so leitura (checkbox desabilitado, sem "Liberar exceção" e sem a caixa "Gerar")', async () => {
    await pronto(false);

    expect(caixa(/Shandong/).disabled).toBe(true);
    expect(caixa(/Shandong/).checked).toBe(true);
    expect(screen.queryByRole('button', { name: 'Liberar exceção' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Gerar/ })).toBeNull();
    expect(screen.queryByText('Escolha ao menos um fornecedor')).toBeNull();
    // a trava continua visivel
    expect(screen.getByText(MOTIVO_TRAVA)).toBeTruthy();
  });

  it('estado de erro e vazio das opcoes', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('indisponivel'));
    renderPicker();
    expect(await screen.findByText(/Não foi possível carregar os fornecedores: indisponivel/)).toBeTruthy();
  });

  it('sem fornecedor ativo: "Nenhum fornecedor ativo cadastrado."', async () => {
    mockApi({ clientRuleMode: 'LIVRE', suppliers: [] });
    renderPicker();
    expect(await screen.findByText('Nenhum fornecedor ativo cadastrado.')).toBeTruthy();
  });
});
