import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComparacaoTab } from './ComparacaoTab';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/services/quoteResponses', () => ({
  listComparisons: vi.fn(),
  executeComparison: vi.fn(),
  previewComparison: vi.fn(),
  approveAward: vi.fn(),
  closeQuoteRequest: vi.fn(),
  setManualWinner: vi.fn(),
  messageOf: (e: unknown) => String(e),
}));
vi.mock('@/services/dispatch', () => ({
  previewQuoteResponseReply: vi.fn(),
  replyToQuoteResponse: vi.fn(),
  sendPurchaseOrder: vi.fn(),
}));

import {
  listComparisons,
  executeComparison,
  previewComparison,
  setManualWinner,
  closeQuoteRequest,
} from '@/services/quoteResponses';
import { previewQuoteResponseReply, sendPurchaseOrder } from '@/services/dispatch';

const winner = {
  supplierId: 7,
  quoteResponseId: 42,
  supplier: { id: 7, name: 'ACME Ltda' },
  contact: { name: 'Contato', email: 'x@acme.com' },
  isWinner: true,
  offeredPrice: 100,
  offeredIncoterm: 'FOB' as const,
  paymentTermsDays: 30,
  exchangeRate: 5,
  freightCost: 10,
  insuranceCost: 5,
  otherFees: 2,
  importDutyRate: 0.1,
  ipiRate: 0.05,
  pisRate: 0.02,
  cofinsRate: 0.03,
  cifValue: 500,
  importDutyAmount: 50,
  ipiAmount: 25,
  pisCofinsAmount: 15,
  totalLandedCost: 600,
  priceScore: 50,
  paymentTermsScore: 30,
  incotermScore: 20,
  qualityScore: 0,
  totalScore: 100,
};

const loser = {
  ...winner,
  supplierId: 8,
  quoteResponseId: 43,
  supplier: { id: 8, name: 'Beta Corp' },
  isWinner: false,
};

const record = {
  id: 1,
  quoteRequestId: 99,
  executedById: 1,
  executedBy: { id: 1, name: 'Admin', email: 'a@b.c' },
  priceWeight: 1,
  paymentTermsWeight: 1,
  incotermWeight: 1,
  winnerQuoteResponseId: 42,
  createdAt: '2026-01-01T12:00:00.000Z',
  approvalStatus: 'approved',
  results: [winner],
};

const recordWithLoser = { ...record, results: [winner, loser] };

// Preview padrão dos testes 1-9 (que já existiam antes dos toggles): ranking
// com a mesma vencedora, responseCount 2 pra cair no ramo normal da tabela
// (o histórico legado só tinha 1 resultado, mas a contagem de respostas do
// preview é um dado independente do backend).
const defaultPreview = {
  results: [winner],
  winnerQuoteResponseId: 42,
  pendingApproval: false,
  thresholdValue: null,
  responseCount: 2,
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComparacaoTab
        quoteRequestId={99}
        quoteRequestStatus="closed"
        productName="Produto X"
        requestCode="RFQ-001"
      />
    </QueryClientProvider>
  );
}

// Mesmo setup, mas com a cotação "open" -- é o estado em que o botão
// "Concluir cotação" e o gatilho pós-PO do modal de avaliação existem.
function renderOpenTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComparacaoTab
        quoteRequestId={99}
        quoteRequestStatus="open"
        productName="Produto X"
        requestCode="RFQ-001"
      />
    </QueryClientProvider>
  );
}

function getDialog(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog');
  if (!dialog) throw new Error('dialog não encontrado no container');
  return dialog;
}

describe('ComparacaoTab', () => {
  beforeEach(() => {
    vi.mocked(listComparisons).mockReset();
    vi.mocked(previewComparison).mockReset();
    vi.mocked(executeComparison).mockReset();
    vi.mocked(previewQuoteResponseReply).mockReset();
    vi.mocked(setManualWinner).mockReset();
    vi.mocked(setManualWinner).mockResolvedValue(undefined);
    vi.mocked(listComparisons).mockResolvedValue({ quoteRequestId: 99, comparisons: [record] });
    vi.mocked(previewComparison).mockResolvedValue(defaultPreview);
    vi.mocked(executeComparison).mockResolvedValue({
      results: [],
      pendingApproval: false,
      winnerQuoteResponseId: null,
      thresholdValue: null,
      comparisonId: 1,
    });
    vi.mocked(previewQuoteResponseReply).mockResolvedValue({
      to: 'x@acme.com',
      cc: [],
      subject: 's',
      html: '<p>oi</p>',
      text: 'oi',
    });
    vi.mocked(sendPurchaseOrder).mockReset();
    vi.mocked(sendPurchaseOrder).mockResolvedValue({ status: 'sent', to: 'x@acme.com', cc: [] });
    vi.mocked(closeQuoteRequest).mockReset();
    vi.mocked(closeQuoteRequest).mockResolvedValue(undefined);
  });

  it('1. replyTarget === null não quebra: dialogs (resposta + avaliação) fechados, sem throw', async () => {
    const { container, findByText } = renderTab();
    await findByText('ACME Ltda');
    // reply + review (avaliação) ficam sempre montados (mesmo fechados); PO e
    // "definir vencedora" só montam quando acionados.
    const dialogs = container.querySelectorAll('dialog');
    expect(dialogs.length).toBe(2);
    dialogs.forEach((dialog) => expect((dialog as HTMLDialogElement).open).toBe(false));
  });

  it('2. abre com título dinâmico e wide ao clicar em "Responder"', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(getDialog(container).open).toBe(true));
    const dialog = getDialog(container);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Responder ACME Ltda');
    expect(dialog.className).toContain('modal-dialog--wide');
  });

  it('3. fallback do nome quando supplier é undefined', async () => {
    const previewNoSupplier = {
      ...defaultPreview,
      results: [{ ...winner, supplier: undefined }],
    };
    vi.mocked(previewComparison).mockResolvedValue(previewNoSupplier);
    vi.mocked(listComparisons).mockResolvedValue({
      quoteRequestId: 99,
      comparisons: [{ ...record, results: [{ ...winner, supplier: undefined }] }],
    });
    const { container, findByText, getByRole } = renderTab();
    await findByText('Fornecedor #7');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(getDialog(container).open).toBe(true));
    const dialog = getDialog(container);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Responder Fornecedor #7');
  });

  it('4. fecha pelo botão × do componente compartilhado', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(getDialog(container).open).toBe(true));
    const dialog = getDialog(container);
    fireEvent.click(within(dialog).getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
  });

  it('5. openReplyModal intacto: assunto default e disparo do preview ao abrir', async () => {
    const { findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(previewQuoteResponseReply).toHaveBeenCalledTimes(1));
    expect(previewQuoteResponseReply).toHaveBeenCalledWith(42, {
      subject: 'Produto X - SQ QUIMICA - ACME Ltda',
      message: '',
    });
  });

  it('6. vencedor manual: botão "Definir como vencedora" abre modal e chama setManualWinner com o motivo', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      ...defaultPreview,
      results: [winner, loser],
    });
    vi.mocked(listComparisons).mockResolvedValue({ quoteRequestId: 99, comparisons: [recordWithLoser] });
    const { container, findByText, getByRole, getByLabelText } = renderTab();
    await findByText('Beta Corp');

    fireEvent.click(getByRole('button', { name: 'Definir como vencedora' }));
    const dialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Definir Beta Corp como vencedora');

    const dialogScope = within(dialog);
    fireEvent.change(getByLabelText('Motivo'), { target: { value: 'Melhor prazo de entrega' } });
    fireEvent.click(dialogScope.getByRole('button', { name: 'Definir como vencedora' }));

    await waitFor(() => expect(setManualWinner).toHaveBeenCalledTimes(1));
    expect(setManualWinner).toHaveBeenCalledWith(99, {
      quoteResponseId: 43,
      reason: 'Melhor prazo de entrega',
    });
  });

  it('7. abre o modal "Enviar Ordem de Compra" com título dinâmico e assunto default', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Enviar Ordem de Compra' }));
    // reply(0) + PO(1) + avaliação(2, sempre montado mas fechado aqui)
    await waitFor(() => expect(container.querySelectorAll('dialog').length).toBe(3));
    const dialogs = container.querySelectorAll('dialog');
    const dialog = dialogs[1] as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const heading = dialog.querySelector('.modal-header h2');
    expect(heading?.textContent).toBe('Enviar Ordem de Compra — ACME Ltda');
    const subjectInput = within(dialog).getByLabelText('Assunto') as HTMLInputElement;
    expect(subjectInput.value).toBe('Purchase Order - Produto X');
  });

  it('8. envia a Ordem de Compra com o PDF selecionado e o forwarderInfo digitado', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Enviar Ordem de Compra' }));
    await waitFor(() => expect(container.querySelectorAll('dialog').length).toBe(3));
    const dialogs = container.querySelectorAll('dialog');
    const dialog = dialogs[1] as HTMLDialogElement;
    const dialogScope = within(dialog);

    const file = new File(['%PDF-1.4 fake'], 'po.pdf', { type: 'application/pdf' });
    const fileInput = dialogScope.getByLabelText('PDF da Ordem de Compra') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await dialogScope.findByText(/Selecionado: po\.pdf/);

    fireEvent.change(dialogScope.getByLabelText('Contato do despachante (forwarder)'), {
      target: { value: 'Global Forwarders Ltda.\nmaria@globalforwarders.com' },
    });

    fireEvent.click(dialogScope.getByRole('button', { name: 'Enviar Ordem de Compra' }));

    await waitFor(() => expect(sendPurchaseOrder).toHaveBeenCalledTimes(1));
    const call = vi.mocked(sendPurchaseOrder).mock.calls[0];
    if (!call) throw new Error('sendPurchaseOrder nao foi chamado.');
    const [quoteResponseId, payload] = call;
    expect(quoteResponseId).toBe(42);
    expect(payload.forwarderInfo).toBe('Global Forwarders Ltda.\nmaria@globalforwarders.com');
    expect(payload.fileName).toBe('po.pdf');
    expect(payload.fileType).toBe('application/pdf');
    expect(payload.fileSize).toBe(file.size);
    expect(payload.contentBase64).toContain('base64,');
  });

  it('9. botão de envio fica desabilitado sem PDF ou sem forwarderInfo', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Enviar Ordem de Compra' }));
    await waitFor(() => expect(container.querySelectorAll('dialog').length).toBe(3));
    const dialogs = container.querySelectorAll('dialog');
    const dialog = dialogs[1] as HTMLDialogElement;
    const dialogScope = within(dialog);

    const sendButton = dialogScope.getByRole('button', { name: 'Enviar Ordem de Compra' }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });

  describe('Toggles de critério (mín 1 / máx 2) e recálculo ao vivo', () => {
    it('10. padrão só "Preço" selecionado; bloqueia desmarcar o único critério ativo', async () => {
      const { findByText, getByRole } = renderTab();
      await findByText('ACME Ltda');
      const priceToggle = getByRole('switch', { name: 'Preço' });
      expect(priceToggle.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(priceToggle);
      await findByText('Selecione ao menos 1 critério.');
      expect(priceToggle.getAttribute('aria-checked')).toBe('true');
    });

    it('11. bloqueia selecionar um 3º critério (máx 2)', async () => {
      const { findByText, getByRole } = renderTab();
      await findByText('ACME Ltda');

      fireEvent.click(getByRole('switch', { name: 'Condição de pagamento' }));
      fireEvent.click(getByRole('switch', { name: 'Incoterm' }));

      await findByText('Selecione no máximo 2 critérios.');
      expect(getByRole('switch', { name: 'Preço' }).getAttribute('aria-checked')).toBe('true');
      expect(getByRole('switch', { name: 'Condição de pagamento' }).getAttribute('aria-checked')).toBe('true');
      expect(getByRole('switch', { name: 'Incoterm' }).getAttribute('aria-checked')).toBe('false');
    });

    it('12. mudar um toggle dispara previewComparison com os pesos atualizados', async () => {
      const { findByText, getByRole } = renderTab();
      await findByText('ACME Ltda');
      vi.mocked(previewComparison).mockClear();

      fireEvent.click(getByRole('switch', { name: 'Qualidade' }));

      await waitFor(
        () =>
          expect(previewComparison).toHaveBeenCalledWith(99, {
            priceWeight: 1,
            paymentTermsWeight: 0,
            incotermWeight: 0,
            qualityWeight: 1,
          }),
        { timeout: 2000 },
      );
    });
  });

  describe('By-pass de 1 fornecedor (sem comparação)', () => {
    it('13. responseCount === 1 mostra card by-pass e some com a tabela de ranking', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [winner],
        winnerQuoteResponseId: null,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 1,
      });
      const { findByText, queryByRole } = renderTab();
      await findByText('Apenas um fornecedor respondeu — sem comparação.');
      expect(queryByRole('button', { name: 'Responder' })).toBeNull();
    });

    it('14. botão do card by-pass chama setManualWinner (sem motivo) e abre a Ordem de Compra', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [winner],
        winnerQuoteResponseId: null,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 1,
      });
      const { container, findByText, getByRole } = renderTab();
      await findByText('Apenas um fornecedor respondeu — sem comparação.');

      fireEvent.click(getByRole('button', { name: 'Enviar Ordem de Compra' }));

      await waitFor(() => expect(setManualWinner).toHaveBeenCalledTimes(1));
      expect(setManualWinner).toHaveBeenCalledWith(99, { quoteResponseId: 42 });
      // executeComparison NAO é chamado no by-pass: não há comparação a persistir.
      expect(executeComparison).not.toHaveBeenCalled();

      await waitFor(() => expect(container.querySelectorAll('dialog').length).toBe(3));
      const dialogs = container.querySelectorAll('dialog');
      const dialog = dialogs[1] as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      const heading = dialog.querySelector('.modal-header h2');
      expect(heading?.textContent).toBe('Enviar Ordem de Compra — ACME Ltda');
    });
  });

  describe('Avaliação em modal pós-PO / botão "Concluir cotação" (item #2)', () => {
    it('15. após enviar a Ordem de Compra pelo card vencedor, o modal de avaliação abre automaticamente', async () => {
      const { container, findByText, getByRole } = renderOpenTab();
      await findByText('ACME Ltda');

      fireEvent.click(getByRole('button', { name: 'Enviar Ordem de Compra' }));
      await waitFor(() => expect(container.querySelectorAll('dialog').length).toBe(3));
      const poDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      const poScope = within(poDialog);

      const file = new File(['%PDF-1.4 fake'], 'po.pdf', { type: 'application/pdf' });
      fireEvent.change(poScope.getByLabelText('PDF da Ordem de Compra'), { target: { files: [file] } });
      await poScope.findByText(/Selecionado: po\.pdf/);
      fireEvent.change(poScope.getByLabelText('Contato do despachante (forwarder)'), {
        target: { value: 'Forwarder Ltda' },
      });
      fireEvent.click(poScope.getByRole('button', { name: 'Enviar Ordem de Compra' }));

      await waitFor(() => expect(sendPurchaseOrder).toHaveBeenCalledTimes(1));

      // PO fecha (poTarget volta a null, desmonta) e o modal de avaliação abre sozinho.
      await waitFor(() => expect(container.querySelectorAll('dialog').length).toBe(2));
      const reviewDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      await waitFor(() => expect(reviewDialog.open).toBe(true));
      const heading = reviewDialog.querySelector('.modal-header h2');
      expect(heading?.textContent).toBe('Avaliar ACME Ltda');
    });

    it('16. botão "Concluir cotação" (fora do modal) abre o mesmo modal de avaliação', async () => {
      const { container, findByText, getByRole } = renderOpenTab();
      await findByText('ACME Ltda');

      // Com o dialog de avaliação fechado, o botão dentro dele fica fora da
      // árvore de acessibilidade (dialog sem `open` = hidden) -- só o botão
      // avulso do cmp-body é alcançável aqui.
      fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));

      const reviewDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      await waitFor(() => expect(reviewDialog.open).toBe(true));
      const heading = reviewDialog.querySelector('.modal-header h2');
      expect(heading?.textContent).toBe('Avaliar ACME Ltda');
      // Com o dialog aberto, o botão de confirmação interno também some na árvore --
      // agora existem 2 elementos acessíveis com este nome (avulso + dentro do modal).
      expect(within(reviewDialog).getByRole('button', { name: 'Concluir cotação' })).toBeTruthy();
    });

    it('17. concluir no modal envia a avaliação completa + notifyLosers e fecha a cotação', async () => {
      const { container, findByText, getByRole } = renderOpenTab();
      await findByText('ACME Ltda');

      fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));
      const reviewDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      await waitFor(() => expect(reviewDialog.open).toBe(true));
      const scope = within(reviewDialog);

      fireEvent.click(within(scope.getByRole('radiogroup', { name: /^Preço/ })).getByRole('radio', { name: '4 de 5' }));
      fireEvent.click(within(scope.getByRole('radiogroup', { name: /^Prazo/ })).getByRole('radio', { name: '5 de 5' }));
      fireEvent.click(within(scope.getByRole('radiogroup', { name: /^Qualidade/ })).getByRole('radio', { name: '3 de 5' }));
      fireEvent.change(scope.getByPlaceholderText('Comentário (opcional)'), {
        target: { value: 'Bom fornecedor' },
      });
      fireEvent.click(scope.getByLabelText('Avisar não selecionados'));

      fireEvent.click(scope.getByRole('button', { name: 'Concluir cotação' }));

      await waitFor(() => expect(closeQuoteRequest).toHaveBeenCalledTimes(1));
      expect(closeQuoteRequest).toHaveBeenCalledWith(99, {
        notifyLosers: true,
        review: {
          supplierId: 7,
          priceRating: 4,
          leadTimeRating: 5,
          qualityRating: 3,
          comment: 'Bom fornecedor',
        },
      });
      await waitFor(() => expect(reviewDialog.open).toBe(false));
    });
  });
});
