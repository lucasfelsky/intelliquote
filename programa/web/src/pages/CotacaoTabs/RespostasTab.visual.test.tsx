import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RespostasTab } from './RespostasTab';

// F7 (Suite COMEX): a aba Respostas e seus 3 modais usam so classes (nenhum estilo inline); selos, tags e icones do board CotacaoRespostas.
// Mocks no padrao do RespostasTab.test.tsx; dados fictiais.

let mockRole = 'admin';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: mockRole } }),
}));
vi.mock('@/services/creditSupport', () => ({
  listCreditSupport: vi.fn(async () => []),
  previewCreditSupport: vi.fn(),
  forwardCreditSupport: vi.fn(),
  revokeCreditSupport: vi.fn(),
  resendCreditSupport: vi.fn(),
  creditSupportQueryKey: (id: number) => ['credit-support', id],
  STATUS_LABELS: { sent: 'Enviado', responded: 'Respondido', expired: 'Expirado', revoked: 'Revogado' },
}));
vi.mock('@/services/creditPartners', () => ({
  listCreditPartners: vi.fn(async () => []),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/services/quoteResponses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/quoteResponses')>();
  return {
    effectiveOriginPort: actual.effectiveOriginPort,
    isOriginOverride: actual.isOriginOverride,
    listQuoteResponses: vi.fn(),
    createQuoteResponse: vi.fn(),
    deleteQuoteResponse: vi.fn(),
    INCOTERMS: ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
    messageOf: (e: unknown) => String(e),
  };
});
vi.mock('@/services/dispatch', () => ({
  previewQuoteResponseReply: vi.fn(),
  replyToQuoteResponse: vi.fn(),
  getTargetPriceHistory: vi.fn(),
}));

import { api } from '@/api/client';
import { deleteQuoteResponse, listQuoteResponses } from '@/services/quoteResponses';
import { previewQuoteResponseReply, getTargetPriceHistory } from '@/services/dispatch';

const base = {
  id: 42, quoteRequestId: 99, supplierId: 7,
  offeredPrice: 100, currency: 'USD', exchangeRate: 5,
  freightCost: 10, insuranceCost: 5, otherFees: 2,
  importDuty: 0, ipi: 0, pis: 0, cofins: 0,
  offeredIncoterm: 'FOB' as const, paymentTermsDays: 30, leadTimeDays: 20,
  notes: null, isWinner: false, totalLandedCost: 600,
  submittedAt: '2026-01-01T12:00:00.000Z', version: 1,
  createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
  targetPrice: 90, source: 'manual' as const,
  originPort: 'Shanghai',
  supplier: { id: 7, name: '[Fornecedor Demo 01]', country: 'China', status: 'active' as const },
};

// Itens: 1 de outra origem (Ningbo), 1 indisponivel, 1 DG, 1 normal.
const items = [
  { id: 801, quoteResponseId: 42, quoteRequestItemId: 5, unitPrice: 10, quantity: 4, totalPrice: 40, leadTimeDays: 15, notes: 'Entrega parcelada', productName: '[Item A]', originPort: null, isDangerousGood: true },
  { id: 802, quoteResponseId: 42, quoteRequestItemId: 6, unitPrice: 20, quantity: 2, totalPrice: 40, leadTimeDays: 10, notes: null, productName: '[Item B]', originPort: 'Ningbo' },
  { id: 803, quoteResponseId: 42, quoteRequestItemId: 7, unitPrice: 0, quantity: 0, totalPrice: 0, leadTimeDays: null, notes: null, productName: '[Item C]', originPort: null, isUnavailable: true },
];

const completa = { ...base, isWinner: true, source: 'portal' as const, notes: 'Preço válido por 15 dias.', items };

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <RespostasTab quoteRequestId={99} quoteRequestStatus="open" quoteRequestCurrency="USD" productName="[Produto Demo]" requestCode="QR-2026-0418" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('RespostasTab: visual (Suite COMEX, F7)', () => {
  beforeEach(() => {
    vi.mocked(listQuoteResponses).mockReset();
    vi.mocked(previewQuoteResponseReply).mockReset();
    vi.mocked(getTargetPriceHistory).mockReset();
    vi.mocked(api.get).mockReset();
    mockRole = 'admin';
    vi.mocked(listQuoteResponses).mockResolvedValue([completa]);
    vi.mocked(api.get).mockResolvedValue([{ id: 7, name: '[Fornecedor Demo 01]', status: 'active', country: 'China' }]);
    vi.mocked(getTargetPriceHistory).mockResolvedValue([
      { id: 1, sentAt: '2026-10-12T14:30:00.000Z', targetPrice: '1.80', sentBy: { name: '[Nome Sobrenome]' } },
    ] as never);
    vi.mocked(previewQuoteResponseReply).mockResolvedValue({
      to: 'x@exemplo.invalid', cc: ['y@exemplo.invalid'], subject: 'Assunto fictício', html: '<p>oi</p>', text: 'oi',
    });
  });

  it('"Vencedora" e selo success com o troféu (svg aria-hidden); "via portal" e selo info', async () => {
    const { findByText } = renderTab();
    const vencedora = await findByText('Vencedora');
    expect(vencedora.classList.contains('badge--success')).toBe(true);
    expect(vencedora.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const portal = await findByText('via portal');
    expect(portal.classList.contains('badge--info')).toBe(true);
  });

  it('as tags ficam numa linha so (response-alert-tags), na ordem outra origem, indisponivel, DG', async () => {
    const { findByTestId } = renderTab();
    const tags = await findByTestId('response-alert-tags');
    const selos = Array.from(tags.children) as HTMLElement[];
    expect(selos.map((s) => s.textContent)).toEqual(['1 item de outra origem', '1 item indisponível', '1 item DG']);
    expect(selos.map((s) => s.className)).toEqual(['badge badge--muted', 'badge badge--warning', 'badge badge--danger']);
    expect(selos[2]!.classList.contains('badge--danger')).toBe(true);
    expect(selos[2]!.getAttribute('data-testid')).toBe('dg-count-badge');
  });

  it('"Origem: Shanghai" fica num no so; as observacoes (#153) ficam entre a origem e as tags', async () => {
    const { findByText, findByTestId } = renderTab();
    const origem = await findByText('Origem: Shanghai');
    const notas = await findByTestId('supplier-notes');
    const tags = await findByTestId('response-alert-tags');
    expect(origem.parentElement?.classList.contains('resposta-meta')).toBe(true);
    expect(origem.parentElement?.nextElementSibling).toBe(notas);
    expect(notas.nextElementSibling).toBe(tags);
  });

  it('"Nova resposta" tem icone; o incoterm usa o chip estatico; a tabela fica no .table-wrapper com as acoes em row-actions--nowrap', async () => {
    const { findByRole, container } = renderTab();
    const novo = await findByRole('button', { name: 'Nova resposta' });
    await findByRole('button', { name: 'Apagar' });
    expect(novo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const wrapper = container.querySelector('.table-wrapper.respostas-tab__tabela');
    expect(wrapper?.querySelector('table.table')).not.toBeNull();
    expect(wrapper?.querySelector('.row-actions.row-actions--nowrap')).not.toBeNull();
    expect(wrapper?.querySelector('.chip.chip--static')?.textContent).toBe('FOB');
    expect(container.querySelector('.respostas-tab')).not.toBeNull();
  });

  it('o h2 "Respostas da Cotação" e as acoes de linha (Apagar em danger-button) nao tem estilo inline', async () => {
    const { findByRole } = renderTab();
    const h2 = await findByRole('heading', { name: 'Respostas da Cotação' });
    expect(h2.hasAttribute('style')).toBe(false);
    const apagar = await findByRole('button', { name: 'Apagar' });
    expect(apagar.classList.contains('danger-button')).toBe(true);
    expect(apagar.hasAttribute('style')).toBe(false);
  });

  it('feedback com papel: sucesso em role=status e erro em role=alert', async () => {
    const { findByRole } = renderTab();
    vi.mocked(deleteQuoteResponse).mockResolvedValueOnce(undefined as never);
    fireEvent.click(await findByRole('button', { name: 'Apagar' }));
    const status = await findByRole('status');
    expect(status.textContent).toBe('Proposta apagada.');
    expect(status.classList.contains('alert--success')).toBe(true);

    vi.mocked(deleteQuoteResponse).mockRejectedValueOnce(new Error('falha'));
    fireEvent.click(await findByRole('button', { name: 'Apagar' }));
    const alerta = await findByRole('alert');
    expect(alerta.textContent).toBe('Erro ao apagar.');
    expect(alerta.classList.contains('alert--error')).toBe(true);
  });

  it('nenhum [style] na aba nem nos 3 modais abertos (Nova resposta, Responder, Itens)', async () => {
    const { findByRole, container, findByText } = renderTab();
    await findByRole('button', { name: 'Nova resposta' });
    expect(container.querySelectorAll('[style]')).toHaveLength(0);

    fireEvent.click(await findByRole('button', { name: 'Nova resposta' }));
    expect(container.querySelectorAll('dialog')).toHaveLength(3);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    // grupos Custos e Impostos do board (fieldset + legenda), ids e rotulos preservados
    expect(Array.from(container.querySelectorAll('.resposta-form__grupo > legend')).map((l) => l.textContent)).toEqual(['Custos', 'Impostos']);
    expect(container.querySelector('#rf-freight')?.closest('.resposta-form__grupo')).not.toBeNull();

    fireEvent.click(await findByRole('button', { name: 'Responder' }));
    await findByText('Preview do e-mail');
    await waitFor(() => expect(container.querySelector('iframe[title="preview-reply-email"]')).not.toBeNull());
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    expect(container.querySelector('.modal-subtitle .resposta-codigo')?.textContent).toBe('QR-2026-0418');
    expect(container.querySelector('iframe[title="preview-reply-email"]')?.classList.contains('preview-frame')).toBe(true);

    fireEvent.click(await findByRole('button', { name: '[Fornecedor Demo 01]' }));
    const dialogs = Array.from(container.querySelectorAll('dialog')) as HTMLDialogElement[];
    const itens = dialogs[2]!;
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
    // coluna Obs. e bloco de notas gerais (#153), numeros em mono, selo DG em tom danger
    expect(within(itens).getByRole('columnheader', { name: 'Obs.' })).toBeTruthy();
    expect(within(itens).getByTestId('items-modal-notes').textContent).toContain('Preço válido por 15 dias.');
    expect(within(itens).getByTestId('dg-item-badge').classList.contains('badge--danger')).toBe(true);
    expect(itens.querySelector('.resposta-itens__valor')).not.toBeNull();
  });
});
