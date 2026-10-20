import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComparisonResult } from '@/services/quoteResponses';
import type { Forwarder } from '@/services/forwarders';

const controls = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('@/components/useConfirm', () => ({ useConfirm: () => controls.confirm }));
vi.mock('@/services/dispatch', () => ({
  sendPurchaseOrder: vi.fn(),
  sendPurchaseOrderToPartner: vi.fn(),
  getPurchaseOrderRecipients: vi.fn(),
  getPartnerPurchaseOrderRecipients: vi.fn(),
}));
vi.mock('@/services/forwarders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/forwarders')>()),
  listForwarders: vi.fn(),
}));

import { sendPurchaseOrder } from '@/services/dispatch';
import { sendPurchaseOrderToPartner } from '@/services/dispatch';
import { getPartnerPurchaseOrderRecipients, getPurchaseOrderRecipients } from '@/services/dispatch';
import { listForwarders } from '@/services/forwarders';
import { PurchaseOrderModal } from './PurchaseOrderModal';

const target = {
  supplierId: 7,
  quoteResponseId: 42,
  supplier: { id: 7, name: 'ACME Ltda' },
  isWinner: true,
} as unknown as ComparisonResult;

function makeForwarder(overrides: Partial<Forwarder> & { id: number; companyName: string }): Forwarder {
  return {
    address: null,
    website: null,
    notes: 'nota interna',
    isActive: true,
    isDefault: false,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    contacts: [],
    ...overrides,
  };
}

const globalCargo = makeForwarder({
  id: 1,
  companyName: 'Global Cargo',
  address: 'Rua A, 10',
  isDefault: true,
  contacts: [{ id: 11, name: 'Maria', email: 'maria@global.com', phone: '+55 11 9999' }],
});
const seaLink = makeForwarder({
  id: 2,
  companyName: 'Sea Link',
  contacts: [{ id: 21, name: 'Beto', email: 'beto@sealink.com', phone: null }],
});

const GLOBAL_TEXT = 'Global Cargo\nRua A, 10\nMaria · maria@global.com · +55 11 9999';
const SEALINK_TEXT = 'Sea Link\nBeto · beto@sealink.com';

function renderModal() {
  const onSent = vi.fn();
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <PurchaseOrderModal
        target={target}
        requestCode="RFQ-001"
        productName="Produto X"
        onClose={onClose}
        onSent={onSent}
      />
    </QueryClientProvider>,
  );
  const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
  const scope = within(dialog);
  return { ...view, scope, onSent, onClose };
}

type Scope = ReturnType<typeof renderModal>['scope'];

const select = (scope: Scope) => scope.getByLabelText('Forwarder') as HTMLSelectElement;
const textarea = (scope: Scope) =>
  scope.getByLabelText('Contato do despachante (forwarder)') as HTMLTextAreaElement;

async function attachPdf(scope: Scope) {
  const file = new File(['%PDF-1.4 fake'], 'po.pdf', { type: 'application/pdf' });
  fireEvent.change(scope.getByLabelText('PDF da Ordem de Compra'), { target: { files: [file] } });
  await scope.findByText(/Selecionado: po\.pdf/);
}

// Lista de destinatarios padrao pros describes que nao testam a lista em si.
function mockDefaultRecipients() {
  vi.mocked(getPurchaseOrderRecipients).mockReset().mockResolvedValue({
    to: { name: 'John Supplier', email: 'john@acme.com' },
    contactCc: [],
    comexCc: [],
    cc: [],
  });
  vi.mocked(getPartnerPurchaseOrderRecipients).mockReset().mockResolvedValue({
    to: { name: 'Ana Crédito', email: 'ana@alfa.example' },
    contactCc: [],
    comexCc: [],
    cc: [],
  });
}

describe('PurchaseOrderModal - seletor de forwarder', () => {
  beforeEach(() => {
    controls.confirm.mockReset();
    mockDefaultRecipients();
    vi.mocked(listForwarders).mockReset().mockResolvedValue([globalCargo, seaLink]);
    vi.mocked(sendPurchaseOrder)
      .mockReset()
      .mockResolvedValue({ status: 'sent', to: 'x@acme.com', cc: [] });
  });

  it('forwarder padrao ativo: select ja no padrao e textarea com o texto formatado', async () => {
    const { scope } = renderModal();

    await waitFor(() => expect(select(scope).value).toBe('1'));
    expect(textarea(scope).value).toBe(GLOBAL_TEXT);
    expect(scope.getByRole('option', { name: 'Global Cargo (padrão)' })).toBeTruthy();
    expect(scope.getByRole('option', { name: 'Sea Link' })).toBeTruthy();
    expect(scope.getByRole('option', { name: 'Digitar manualmente' })).toBeTruthy();
    expect(listForwarders).toHaveBeenCalledWith({ active: true });
    // notes e uso interno: nao vai para o texto.
    expect(textarea(scope).value).not.toContain('nota interna');
  });

  it('sem padrao: "Digitar manualmente" e textarea vazio', async () => {
    vi.mocked(listForwarders).mockResolvedValue([seaLink]);
    const { scope } = renderModal();

    await scope.findByRole('option', { name: 'Sea Link' });
    expect(select(scope).value).toBe('');
    expect(textarea(scope).value).toBe('');
  });

  it('trocar de forwarder com o texto nao editado substitui sem confirmar', async () => {
    const { scope } = renderModal();
    await waitFor(() => expect(select(scope).value).toBe('1'));

    fireEvent.change(select(scope), { target: { value: '2' } });

    await waitFor(() => expect(textarea(scope).value).toBe(SEALINK_TEXT));
    expect(select(scope).value).toBe('2');
    expect(controls.confirm).not.toHaveBeenCalled();
  });

  it('texto editado + trocar: pede confirmacao; cancelar mantem texto e select', async () => {
    controls.confirm.mockResolvedValue(false);
    const { scope } = renderModal();
    await waitFor(() => expect(select(scope).value).toBe('1'));
    fireEvent.change(textarea(scope), { target: { value: `${GLOBAL_TEXT}\nPlantao 24h` } });

    fireEvent.change(select(scope), { target: { value: '2' } });

    await waitFor(() => expect(controls.confirm).toHaveBeenCalledTimes(1));
    expect(controls.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Substituir contato do forwarder?',
        confirmText: 'Substituir',
        message: 'O texto editado será substituído pelo cadastro de Sea Link.',
      }),
    );
    expect(textarea(scope).value).toBe(`${GLOBAL_TEXT}\nPlantao 24h`);
    expect(select(scope).value).toBe('1');
  });

  it('texto editado + trocar: confirmar substitui o texto e o select', async () => {
    controls.confirm.mockResolvedValue(true);
    const { scope } = renderModal();
    await waitFor(() => expect(select(scope).value).toBe('1'));
    fireEvent.change(textarea(scope), { target: { value: 'texto livre' } });

    fireEvent.change(select(scope), { target: { value: '2' } });

    await waitFor(() => expect(textarea(scope).value).toBe(SEALINK_TEXT));
    expect(select(scope).value).toBe('2');
  });

  it('"Digitar manualmente" mantem o texto e o envio vai SEM forwarderId', async () => {
    const { scope, onSent } = renderModal();
    await waitFor(() => expect(select(scope).value).toBe('1'));

    fireEvent.change(select(scope), { target: { value: '' } });

    await waitFor(() => expect(select(scope).value).toBe(''));
    expect(textarea(scope).value).toBe(GLOBAL_TEXT);

    await attachPdf(scope);
    fireEvent.click(scope.getByRole('button', { name: 'Enviar Ordem de Compra' }));

    await waitFor(() => expect(sendPurchaseOrder).toHaveBeenCalledTimes(1));
    const [quoteResponseId, payload] = vi.mocked(sendPurchaseOrder).mock.calls[0] ?? [];
    expect(quoteResponseId).toBe(42);
    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty('forwarderId');
    expect(payload?.forwarderInfo).toBe(GLOBAL_TEXT);
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(target));
  });

  it('envio com forwarder selecionado e texto editado leva forwarderId e o texto EDITADO', async () => {
    const { scope } = renderModal();
    await waitFor(() => expect(select(scope).value).toBe('1'));
    const edited = `${GLOBAL_TEXT}\nPlantao 24h`;
    fireEvent.change(textarea(scope), { target: { value: edited } });
    await attachPdf(scope);

    fireEvent.click(scope.getByRole('button', { name: 'Enviar Ordem de Compra' }));

    await waitFor(() => expect(sendPurchaseOrder).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(sendPurchaseOrder).mock.calls[0] ?? [];
    expect(payload?.forwarderId).toBe(1);
    expect(payload?.forwarderInfo).toBe(edited);
    expect(payload?.subject).toBe('Purchase Order - Produto X');
  });

  it('o que o usuario digitou antes da lista chegar nao e sobrescrito pela pre-selecao', async () => {
    let resolveList: (rows: Forwarder[]) => void = () => undefined;
    vi.mocked(listForwarders).mockReturnValue(
      new Promise<Forwarder[]>((resolve) => {
        resolveList = resolve;
      }),
    );
    const { scope } = renderModal();
    fireEvent.change(textarea(scope), { target: { value: 'Despachante digitado na mao' } });

    resolveList([globalCargo, seaLink]);

    await scope.findByRole('option', { name: 'Sea Link' });
    expect(textarea(scope).value).toBe('Despachante digitado na mao');
    expect(select(scope).value).toBe('');
  });

  it('listForwarders rejeitado: mostra o erro, desabilita o select e o textarea continua utilizavel', async () => {
    vi.mocked(listForwarders).mockRejectedValue(new Error('boom'));
    const { scope } = renderModal();

    await scope.findByText('Não foi possível carregar os forwarders; digite o contato abaixo.');
    expect(select(scope).disabled).toBe(true);
    fireEvent.change(textarea(scope), { target: { value: 'Digitado' } });
    expect(textarea(scope).value).toBe('Digitado');
  });

  it('lista vazia: avisa para cadastrar em Forwarders com link', async () => {
    vi.mocked(listForwarders).mockResolvedValue([]);
    const { scope } = renderModal();

    await scope.findByText(/Nenhum forwarder cadastrado/);
    const link = scope.getByRole('link', { name: 'Forwarders' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/forwarders');
    expect(link.target).toBe('_blank');
  });

  it('texto com 2001 caracteres desabilita o envio e mostra o contador', async () => {
    vi.mocked(listForwarders).mockResolvedValue([]);
    const { scope } = renderModal();
    await scope.findByText(/Nenhum forwarder cadastrado/);
    await attachPdf(scope);
    const sendButton = scope.getByRole('button', { name: 'Enviar Ordem de Compra' }) as HTMLButtonElement;

    fireEvent.change(textarea(scope), { target: { value: 'x'.repeat(2000) } });
    expect(scope.getByText('2000/2000')).toBeTruthy();
    expect(sendButton.disabled).toBe(false);

    fireEvent.change(textarea(scope), { target: { value: 'x'.repeat(2001) } });
    expect(scope.getByText('2001/2000')).toBeTruthy();
    expect(sendButton.disabled).toBe(true);
  });
});

// PR4b: alvo = alternativa via parceiro (Credit Support).
describe('PurchaseOrderModal - PO ao parceiro (PR4b)', () => {
  const partnerTarget = {
    supplierId: 7,
    quoteResponseId: 42,
    supplier: { id: 7, name: 'ACME Ltda' },
    isWinner: true,
    creditSupportRequestId: 7,
    creditPartner: { id: 5, name: 'Banco Alfa' },
    partnerContact: { id: 50, name: 'Ana Crédito', email: 'ana@alfa.example' },
  } as unknown as ComparisonResult;

  function renderPartnerModal(overrides: Partial<ComparisonResult> = {}) {
    const onSent = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <PurchaseOrderModal
          target={{ ...partnerTarget, ...overrides } as ComparisonResult}
          requestCode="RFQ-001"
          productName="Produto X"
          onClose={vi.fn()}
          onSent={onSent}
        />
      </QueryClientProvider>,
    );
    const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
    return { ...view, dialog, scope: within(dialog), onSent };
  }

  beforeEach(() => {
    controls.confirm.mockReset();
    mockDefaultRecipients();
    vi.mocked(listForwarders).mockReset().mockResolvedValue([globalCargo]);
    vi.mocked(sendPurchaseOrder).mockReset().mockResolvedValue({ status: 'sent', to: 'x@acme.com', cc: [] });
    vi.mocked(sendPurchaseOrderToPartner)
      .mockReset()
      .mockResolvedValue({ status: 'sent', to: 'ana@alfa.example', cc: [] });
  });

  it('titulo cita parceiro e fornecedor de origem; aviso so cita o fornecedor de origem', async () => {
    const { dialog, scope } = renderPartnerModal();
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe(
      'Enviar Ordem de Compra ao parceiro Banco Alfa — fornecedor ACME Ltda',
    );
    const notice = scope.getByTestId('po-partner-notice');
    expect(notice.textContent).toBe('O fornecedor de origem não é copiado.');
    await waitFor(() => expect(listForwarders).toHaveBeenCalled());
  });

  it('sem contato no encaminhamento: o Para vem da lista do backend (contato principal do parceiro)', async () => {
    vi.mocked(getPartnerPurchaseOrderRecipients).mockResolvedValue({
      to: { name: 'Principal Parceiro', email: 'principal@alfa.example' },
      contactCc: [],
      comexCc: [],
      cc: [],
    });
    const { scope } = renderPartnerModal({ partnerContact: null });
    const box = await scope.findByTestId('po-recipients');
    await waitFor(() =>
      expect(box.textContent).toContain('Para: Principal Parceiro <principal@alfa.example>'),
    );
    expect(scope.getByTestId('po-partner-notice').textContent).toBe(
      'O fornecedor de origem não é copiado.',
    );
    await waitFor(() => expect(listForwarders).toHaveBeenCalled());
  });

  it('envio chama sendPurchaseOrderToPartner(7, ...) e NAO sendPurchaseOrder', async () => {
    const { scope, onSent } = renderPartnerModal();
    await waitFor(() => expect(select(scope).value).toBe('1'));
    await attachPdf(scope);

    fireEvent.click(scope.getByRole('button', { name: 'Enviar Ordem de Compra' }));

    await waitFor(() => expect(sendPurchaseOrderToPartner).toHaveBeenCalledTimes(1));
    const [creditSupportRequestId, payload] = vi.mocked(sendPurchaseOrderToPartner).mock.calls[0] ?? [];
    expect(creditSupportRequestId).toBe(7);
    expect(payload?.forwarderId).toBe(1);
    expect(payload?.forwarderInfo).toBe(GLOBAL_TEXT);
    expect(payload?.fileType).toBe('application/pdf');
    expect(sendPurchaseOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it('alvo fornecedor (sem creditSupportRequestId) continua chamando sendPurchaseOrder, sem aviso de parceiro', async () => {
    const { scope, container } = renderModal();
    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    await waitFor(() => expect(select(scope).value).toBe('1'));
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Enviar Ordem de Compra — ACME Ltda');
    expect(scope.queryByTestId('po-partner-notice')).toBeNull();
    await attachPdf(scope);

    fireEvent.click(scope.getByRole('button', { name: 'Enviar Ordem de Compra' }));

    await waitFor(() => expect(sendPurchaseOrder).toHaveBeenCalledTimes(1));
    expect(sendPurchaseOrderToPartner).not.toHaveBeenCalled();
  });
});

// Lista informativa de destinatarios (Para/Cc): vem do backend (a MESMA lista que o envio usa).
describe('PurchaseOrderModal - destinatarios (Para/Cc)', () => {
  const partnerTarget = {
    supplierId: 7,
    quoteResponseId: 42,
    supplier: { id: 7, name: 'ACME Ltda' },
    isWinner: true,
    creditSupportRequestId: 7,
    creditPartner: { id: 5, name: 'Banco Alfa' },
    partnerContact: { id: 50, name: 'Ana Crédito', email: 'ana@alfa.example' },
  } as unknown as ComparisonResult;

  function renderWith(modalTarget: ComparisonResult) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <PurchaseOrderModal
          target={modalTarget}
          requestCode="RFQ-001"
          productName="Produto X"
          onClose={vi.fn()}
          onSent={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
    return { ...view, scope: within(dialog) };
  }

  beforeEach(() => {
    controls.confirm.mockReset();
    vi.mocked(listForwarders).mockReset().mockResolvedValue([globalCargo]);
    vi.mocked(sendPurchaseOrder).mockReset().mockResolvedValue({ status: 'sent', to: 'x@acme.com', cc: [] });
    vi.mocked(getPurchaseOrderRecipients).mockReset().mockResolvedValue({
      to: { name: 'John Supplier', email: 'john@acme.com' },
      contactCc: [
        { name: 'Jane Supplier', email: 'jane@acme.com' },
        { name: '', email: 'jack@acme.com' },
      ],
      comexCc: [],
      cc: ['jane@acme.com', 'jack@acme.com'],
    });
    vi.mocked(getPartnerPurchaseOrderRecipients).mockReset().mockResolvedValue({
      to: { name: 'Ana Crédito', email: 'ana@alfa.example' },
      contactCc: [{ name: 'Beto Crédito', email: 'beto@alfa.example' }],
      comexCc: ['cc1@sqquimica.com', 'cc2@sqquimica.com'],
      cc: ['beto@alfa.example', 'cc1@sqquimica.com', 'cc2@sqquimica.com'],
    });
  });

  it('fornecedor com 3 contatos: Para com o principal e Cc com os outros 2', async () => {
    const { scope } = renderWith(target);

    const box = await scope.findByTestId('po-recipients');
    await waitFor(() => expect(box.textContent).toContain('Para: John Supplier <john@acme.com>'));
    expect(box.textContent).toContain('Cc: Jane Supplier <jane@acme.com>, jack@acme.com');
    expect(getPurchaseOrderRecipients).toHaveBeenCalledWith(42);
    expect(getPartnerPurchaseOrderRecipients).not.toHaveBeenCalled();
  });

  it('1 contato: sem linha Cc', async () => {
    vi.mocked(getPurchaseOrderRecipients).mockResolvedValue({
      to: { name: 'John Supplier', email: 'john@acme.com' },
      contactCc: [],
      comexCc: [],
      cc: [],
    });
    const { scope } = renderWith(target);

    const box = await scope.findByTestId('po-recipients');
    await waitFor(() => expect(box.textContent).toContain('Para: John Supplier <john@acme.com>'));
    expect(box.textContent).not.toContain('Cc:');
    expect(box.textContent).not.toContain('Equipe COMEX');
  });

  it('comexCc nao vazio: mostra a contagem da Equipe COMEX em copia', async () => {
    vi.mocked(getPurchaseOrderRecipients).mockResolvedValue({
      to: { name: 'John Supplier', email: 'john@acme.com' },
      contactCc: [],
      comexCc: ['cc1@sqquimica.com', 'cc2@sqquimica.com'],
      cc: ['cc1@sqquimica.com', 'cc2@sqquimica.com'],
    });
    const { scope } = renderWith(target);

    await scope.findByText('Equipe COMEX em cópia (2).');
  });

  it('parceiro chama a lista do parceiro (7) e nao a do fornecedor; aviso so cita o fornecedor de origem', async () => {
    const { scope } = renderWith(partnerTarget);

    const box = await scope.findByTestId('po-recipients');
    await waitFor(() => expect(box.textContent).toContain('Para: Ana Crédito <ana@alfa.example>'));
    expect(box.textContent).toContain('Cc: Beto Crédito <beto@alfa.example>');
    expect(box.textContent).toContain('Equipe COMEX em cópia (2).');
    expect(getPartnerPurchaseOrderRecipients).toHaveBeenCalledWith(7);
    expect(getPurchaseOrderRecipients).not.toHaveBeenCalled();
    expect(scope.getByTestId('po-partner-notice').textContent).toBe(
      'O fornecedor de origem não é copiado.',
    );
  });

  it('carregando: mostra "Carregando destinatários…"', async () => {
    vi.mocked(getPurchaseOrderRecipients).mockReturnValue(new Promise(() => {}));
    const { scope } = renderWith(target);

    await scope.findByText('Carregando destinatários…');
  });

  it('erro na lista: avisa e o botao de envio continua habilitado', async () => {
    vi.mocked(getPurchaseOrderRecipients).mockRejectedValue(new Error('falha de rede'));
    const { scope } = renderWith(target);

    await scope.findByText(/Não foi possível carregar os destinatários/);
    await waitFor(() => expect(select(scope).value).toBe('1'));
    await attachPdf(scope);
    const sendButton = scope.getByRole('button', { name: 'Enviar Ordem de Compra' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);
  });
});
