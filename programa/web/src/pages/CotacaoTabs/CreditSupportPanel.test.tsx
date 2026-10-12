import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import { CreditSupportPanel } from './CreditSupportPanel';

let mockRole = 'comprador';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'U', email: 'u@b.c', role: mockRole } }),
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

const responses = [
  {
    id: 42, quoteRequestId: 99, supplierId: 7,
    offeredPrice: 100, currency: 'USD', exchangeRate: 5,
    freightCost: 10, insuranceCost: 5, otherFees: 2,
    importDuty: 0, ipi: 0, pis: 0, cofins: 0,
    offeredIncoterm: 'FOB' as const, paymentTermsDays: 30, leadTimeDays: 20,
    notes: null, isWinner: false, totalLandedCost: 600,
    submittedAt: '2026-01-01T12:00:00.000Z', version: 1,
    createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
    supplier: { id: 7, name: 'ACME Ltda', country: 'BR', status: 'active' as const },
  },
];

const base = {
  quoteResponseId: 42,
  supplier: { id: 7, name: 'ACME Ltda', country: 'BR' },
  partner: { id: 1, name: 'Banco Alfa' },
  recipientEmails: ['bruno@alfa.com'],
  isStale: false,
  expiresAt: '2026-10-26T12:00:00.000Z',
  createdAt: '2026-10-12T15:30:00.000Z',
  createdBy: { id: 1, name: 'Lucas' },
  respondedAt: null,
  responseVersion: 1,
  currency: 'USD',
  offeredIncoterm: 'FOB',
  originPort: 'Shanghai',
  originalPaymentTermsDays: 30,
  partnerPaymentTermsDays: null,
  partnerValidityDays: null,
  partnerNotes: null,
  totals: { original: '1000.00', partner: null, markupPercent: null },
  items: [
    {
      quoteRequestItemId: 5, position: 1, productName: 'Resina Epóxi', itemCode: 'RE-01', unit: 'kg',
      quantity: 100, isUnavailable: false, originPort: null, isDangerousGood: true,
      originalUnitPrice: '10.00', originalTotalPrice: '1000.00',
      partnerUnitPrice: null, partnerTotalPrice: null, markupPercent: null,
    },
    {
      quoteRequestItemId: 6, position: 2, productName: 'Catalisador Y', itemCode: null, unit: 'L',
      quantity: 0, isUnavailable: true, originPort: null, isDangerousGood: false,
      originalUnitPrice: '0.00', originalTotalPrice: '0.00',
      partnerUnitPrice: null, partnerTotalPrice: null, markupPercent: null,
    },
  ],
};

const row = {
  ...base,
  id: 1,
  status: 'responded',
  respondedAt: '2026-10-13T10:00:00.000Z',
  partnerPaymentTermsDays: 90,
  partnerValidityDays: 15,
  partnerNotes: 'Sujeito a aprovação de crédito.',
  totals: { original: '1000.00', partner: '1100.00', markupPercent: '10.00' },
  items: [
    { ...base.items[0]!, partnerUnitPrice: '11.00', partnerTotalPrice: '1100.00', markupPercent: '10.00' },
    base.items[1]!,
  ],
};
const row2 = { ...base, id: 2, status: 'sent', isStale: true, partner: { id: 2, name: 'Banco Beta' } };
const row3 = { ...base, id: 3, status: 'revoked', partner: { id: 3, name: 'Banco Gama' } };

function mockList(rows: unknown[]) {
  vi.mocked(api.get).mockImplementation((async () => rows) as typeof api.get);
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <CreditSupportPanel quoteRequestId={99} responses={responses} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe('CreditSupportPanel', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    mockRole = 'comprador';
  });

  it('1. agrupa por resposta com cabecalho do fornecedor e badges de status', async () => {
    mockList([row, row2, row3]);
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    expect(api.get).toHaveBeenCalledWith('/v1/quote-requests/99/credit-support');
    const section = getByTestId('credit-support-42');
    expect(within(section).getByText('Respondido')).toBeTruthy();
    expect(within(section).getByText('Enviado')).toBeTruthy();
    expect(within(section).getByText('Revogado')).toBeTruthy();
    expect(within(section).getByText('Banco Alfa')).toBeTruthy();
    expect(within(section).getByText('Banco Beta')).toBeTruthy();
    expect(within(section).getByText('Banco Gama')).toBeTruthy();
    const sentLines = within(section).getAllByText(/por Lucas/);
    expect(sentLines.length).toBe(3);
    expect(sentLines[0]!.textContent).toContain('Enviado em');
    expect(within(section).getAllByText(/Destinatários: bruno@alfa.com/).length).toBe(3);
  });

  it('2. badge "Proposta do fornecedor mudou" so no stale', async () => {
    mockList([row, row2, row3]);
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    expect(within(getByTestId('credit-support-request-2')).getByText('Proposta do fornecedor mudou')).toBeTruthy();
    expect(within(getByTestId('credit-support-request-1')).queryByText('Proposta do fornecedor mudou')).toBeNull();
    expect(within(getByTestId('credit-support-request-3')).queryByText('Proposta do fornecedor mudou')).toBeNull();
  });

  it('3. lado a lado: "+10,00 %" literal do servidor, "Indisponível" no item 2 e totais', async () => {
    mockList([row]);
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    const card = getByTestId('credit-support-request-1');
    const bodyRows = within(card).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(3);
    const cells = (r: HTMLElement) => Array.from(r.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells(bodyRows[0]!)).toEqual([
      'Resina EpóxiRE-01DG', '100 kg', '10,00 USD', '1.000,00 USD', '11,00 USD', '1.100,00 USD', '+100,00 USD', '+10,00 %',
    ]);
    expect(within(bodyRows[1]!).getByText('Indisponível')).toBeTruthy();
    expect(cells(bodyRows[1]!).slice(1)).toEqual(['—', '—', '—', '—', '—', '—', '—']);
    const totals = getByTestId('credit-support-totals-1');
    expect(totals.textContent).toContain('Totais');
    expect(totals.textContent).toContain('1.000,00 USD');
    expect(totals.textContent).toContain('1.100,00 USD');
    expect(totals.textContent).toContain('+100,00 USD');
    expect(totals.textContent).toContain('+10,00 %');
  });

  it('3b. markupPercent negativo vem com sinal do servidor ("-5,00 %")', async () => {
    mockList([
      {
        ...row,
        totals: { original: '1000.00', partner: '950.00', markupPercent: '-5.00' },
        items: [{ ...row.items[0]!, partnerUnitPrice: '9.50', partnerTotalPrice: '950.00', markupPercent: '-5.00' }],
      },
    ]);
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    expect(within(getByTestId('credit-support-request-1')).getAllByText('-5,00 %').length).toBe(2);
    expect(within(getByTestId('credit-support-request-1')).getAllByText('-50,00 USD').length).toBe(2);
  });

  it('4. prazo de pagamento, validade, versao e observacoes do parceiro', async () => {
    mockList([row]);
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    const card = getByTestId('credit-support-request-1');
    expect(within(card).getByText(/Prazo de pagamento: fornecedor 30 dias × parceiro 90 dias/)).toBeTruthy();
    expect(within(card).getByText('Validade da proposta do parceiro: 15 dias')).toBeTruthy();
    expect(within(card).getByText(/Respondido em .*\(versão 1\)/)).toBeTruthy();
    expect(within(card).getByText('Observações do parceiro: Sujeito a aprovação de crédito.')).toBeTruthy();
    expect(within(card).getByText('Moeda/Incoterm: USD FOB')).toBeTruthy();
  });

  it('5. comprador: Revogar (com confirmacao) e Reenviar chamam a API e mostram o link novo', async () => {
    mockList([row, { ...row2, isStale: false }]);
    vi.mocked(api.post).mockImplementation((async (path: string) => {
      if (path.endsWith('/revoke')) return { id: 1, status: 'revoked' };
      return {
        id: 2,
        expiresAt: '2026-11-01T12:00:00.000Z',
        portalUrl: 'https://intelliquote.portal-comex.com/portal/credit?token=NEW',
        recipients: [{ email: 'bruno@alfa.com', status: 'sent' }],
      };
    }) as typeof api.post);
    const { findByRole, getByTestId, container } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });

    fireEvent.click(within(getByTestId('credit-support-request-1')).getByRole('button', { name: 'Revogar' }));
    const confirmDialog = Array.from(container.querySelectorAll('dialog')).find((d) => d.open) as HTMLDialogElement;
    expect(within(confirmDialog).getByText(/Revogar este encaminhamento\?/)).toBeTruthy();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/credit-support-requests/1/revoke'));

    const card2 = getByTestId('credit-support-request-2');
    fireEvent.click(within(card2).getByRole('button', { name: 'Reenviar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/credit-support-requests/2/resend', {}));
    const input = await within(card2).findByLabelText('Link do portal do parceiro') as HTMLInputElement;
    expect(input.value).toBe('https://intelliquote.portal-comex.com/portal/credit?token=NEW');
    expect(within(card2).getByText('Novo link gerado.')).toBeTruthy();
  });

  it('6. viewer: nenhum botao de acao; gestor: botoes presentes', async () => {
    mockRole = 'viewer';
    mockList([row, row2]);
    const first = renderPanel();
    await first.findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    expect(first.queryByRole('button', { name: 'Revogar' })).toBeNull();
    expect(first.queryByRole('button', { name: 'Reenviar' })).toBeNull();
    first.unmount();

    mockRole = 'gestor';
    const second = renderPanel();
    await second.findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    expect(second.getAllByRole('button', { name: 'Revogar' }).length).toBe(2);
    expect(second.getAllByRole('button', { name: 'Reenviar' }).length).toBe(1);
  });

  it('7. stale: "Reenviar" desabilitado com title; respondido: sem "Reenviar"; revogado: sem "Revogar"', async () => {
    mockList([row, row2, row3]);
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    const resend = within(getByTestId('credit-support-request-2')).getByRole('button', { name: 'Reenviar' }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    expect(resend.title).toBe('A proposta do fornecedor mudou: revogue e encaminhe de novo.');
    expect(within(getByTestId('credit-support-request-1')).queryByRole('button', { name: 'Reenviar' })).toBeNull();
    expect(within(getByTestId('credit-support-request-1')).getByRole('button', { name: 'Revogar' })).toBeTruthy();
    expect(within(getByTestId('credit-support-request-3')).queryByRole('button', { name: 'Revogar' })).toBeNull();
    expect(within(getByTestId('credit-support-request-3')).queryByRole('button', { name: 'Reenviar' })).toBeNull();
  });

  it('8. GET rejeita: alert--error com a mensagem do servidor', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, { message: 'Banco indisponivel' }));
    const { findByText } = renderPanel();
    const alert = await findByText(/Banco indisponivel/);
    expect(alert.className).toContain('alert--error');
  });

  it('9. lista vazia: nada renderizado', async () => {
    mockList([]);
    const { container } = renderPanel();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
    expect(container.querySelector('.alert')).toBeNull();
  });

  it('10. encaminhamento de resposta removida vai no bloco "Respostas removidas"', async () => {
    mockList([{ ...row3, quoteResponseId: 77, supplier: { id: 8, name: 'Zeta Corp', country: 'CN' } }]);
    const { findByTestId } = renderPanel();
    const removed = await findByTestId('credit-support-removed');
    expect(within(removed).getByRole('heading', { name: 'Credit Support — Respostas removidas' })).toBeTruthy();
    expect(within(removed).getByText(/Zeta Corp/)).toBeTruthy();
  });

  it('11. erro na acao fica no card (messageOf)', async () => {
    mockList([{ ...row2, isStale: false }]);
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Encaminhamento revogado' }));
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('heading', { name: 'Credit Support — ACME Ltda' });
    const card = getByTestId('credit-support-request-2');
    fireEvent.click(within(card).getByRole('button', { name: 'Reenviar' }));
    const alert = await within(card).findByText('Encaminhamento revogado');
    expect(alert.className).toContain('alert--error');
  });
});
