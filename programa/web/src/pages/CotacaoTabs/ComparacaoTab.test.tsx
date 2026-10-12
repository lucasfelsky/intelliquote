import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComparacaoTab } from './ComparacaoTab';

const controls = vi.hoisted(() => ({ role: 'admin', confirm: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: controls.role } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => controls.confirm }));
vi.mock('@/services/quoteResponses', async (importOriginal) => ({
  // PR4a: chave composta real (resposta direta x alternativa via parceiro).
  candidateKey: (await importOriginal<typeof import('@/services/quoteResponses')>()).candidateKey,
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
vi.mock('@/services/forwarders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/forwarders')>()),
  listForwarders: vi.fn().mockResolvedValue([]),
}));

import {
  approveAward,
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
  currency: 'USD',
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
  leadTimeDays: 21,
};

const loser = {
  ...winner,
  supplierId: 8,
  quoteResponseId: 43,
  supplier: { id: 8, name: 'Beta Corp' },
  isWinner: false,
  leadTimeDays: 35,
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
  it('exibe total dos itens em USD em vez do landed cost em BRL', async () => {
    const { container } = renderTab();
    await waitFor(() => expect(container.textContent).toContain('Total dos itens (US$)'));
    expect(container.querySelector('.cmp-row__price')?.textContent).toBe('100,00');
    expect(container.textContent).not.toContain('Custo total (R$)');
  });
  beforeEach(() => {
    controls.role = 'admin';
    controls.confirm.mockReset().mockResolvedValue(true);
    vi.mocked(approveAward).mockReset().mockResolvedValue(undefined);
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

  it('gestor/admin aprova explicitamente antes de abrir a ordem de compra', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...defaultPreview, pendingApproval: true, thresholdValue: 50 });
    vi.mocked(executeComparison).mockResolvedValue({ results: [winner], pendingApproval: true,
      winnerQuoteResponseId: 42, thresholdValue: 50, comparisonId: 19 });
    const view = renderOpenTab();
    await view.findByText('Recomendada · requer aprovação');
    fireEvent.click(view.getByRole('button', { name: 'Enviar Ordem de Compra' }));
    await waitFor(() => expect(approveAward).toHaveBeenCalledWith(99, 19));
    expect(controls.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'Aprovar e continuar' }));
    await view.findByText('PDF da Ordem de Compra');
  });

  it.each(['cancelada', 'comprador', 'falha'])('nao abre a ordem de compra quando a aprovacao e %s', async (caseName) => {
    controls.role = caseName === 'comprador' ? 'comprador' : 'admin';
    controls.confirm.mockResolvedValue(caseName !== 'cancelada');
    if (caseName === 'falha') vi.mocked(approveAward).mockRejectedValue(new Error('Aprovação indisponível'));
    vi.mocked(previewComparison).mockResolvedValue({ ...defaultPreview, pendingApproval: true, thresholdValue: 50 });
    vi.mocked(executeComparison).mockResolvedValue({ results: [winner], pendingApproval: true,
      winnerQuoteResponseId: 42, thresholdValue: 50, comparisonId: 19 });
    const view = renderOpenTab();
    await view.findByText('ACME Ltda');
    fireEvent.click(view.getByRole('button', { name: 'Enviar Ordem de Compra' }));
    await waitFor(() => expect(executeComparison).toHaveBeenCalled());
    if (caseName === 'comprador') await view.findByText(/Comparação registrada — a alçada/);
    else if (caseName === 'falha') await view.findByText(/Aprovação indisponível/);
    else await waitFor(() => expect(controls.confirm).toHaveBeenCalled());
    if (caseName !== 'falha') expect(approveAward).not.toHaveBeenCalled();
    expect(view.queryByText('PDF da Ordem de Compra')).toBeNull();
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

  it('5. openReplyModal: preview dispara ao abrir com assunto vazio (o padrao vem do backend)', async () => {
    const { findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(previewQuoteResponseReply).toHaveBeenCalledTimes(1));
    expect(previewQuoteResponseReply).toHaveBeenCalledWith(42, {
      subject: '',
      message: '',
    });
  });

  it('5b. o assunto padrao devolvido pelo preview preenche o campo e aparece em "Assunto:"; o digitado nao e sobrescrito', async () => {
    vi.mocked(previewQuoteResponseReply).mockResolvedValue({
      to: 'x@acme.com',
      cc: [],
      subject: 'Sourcing request QR-1 - Produto X',
      html: '<p>oi</p>',
      text: 'oi',
    });
    const { container, findByText, getByRole } = renderTab();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(getDialog(container).open).toBe(true));
    const dialog = getDialog(container);
    const subjectInput = within(dialog).getByLabelText('Assunto') as HTMLInputElement;
    await waitFor(() => expect(subjectInput.value).toBe('Sourcing request QR-1 - Produto X'));
    expect(await within(dialog).findByText('Sourcing request QR-1 - Produto X', { selector: 'strong' })).toBeTruthy();

    fireEvent.change(subjectInput, { target: { value: 'Contraproposta' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar preview' }));
    await waitFor(() => expect(previewQuoteResponseReply).toHaveBeenCalledTimes(2));
    expect(previewQuoteResponseReply).toHaveBeenLastCalledWith(42, { subject: 'Contraproposta', message: '' });
    expect(subjectInput.value).toBe('Contraproposta');
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

    it('17b. concluir com uma só resposta fecha direto (sem exigir 2ª proposta) e não chama executeComparison', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [winner],
        winnerQuoteResponseId: null,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 1,
      });
      const { container, findByText, getByRole } = renderOpenTab();
      await findByText('Apenas um fornecedor respondeu — sem comparação.');

      fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));
      const reviewDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      await waitFor(() => expect(reviewDialog.open).toBe(true));
      const scope = within(reviewDialog);

      fireEvent.click(scope.getByRole('button', { name: 'Concluir cotação' }));

      await waitFor(() => expect(closeQuoteRequest).toHaveBeenCalledTimes(1));
      expect(closeQuoteRequest).toHaveBeenCalledWith(99, { notifyLosers: false, review: null });
      expect(executeComparison).not.toHaveBeenCalled();
      await waitFor(() => expect(reviewDialog.open).toBe(false));
    });
  });

  describe('Coluna Lead time (item 3 — substitui Landed (BRL))', () => {
    it('18. cabeçalho mostra "Lead time" e não mostra mais "Landed (BRL)"', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, loser],
      });
      const { findByText, queryByText } = renderTab();
      await findByText('Lead time');
      expect(queryByText('Landed (BRL)')).toBeNull();
    });

    it('19. exibe o maior lead time formatado ("X dias") por linha', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, loser],
      });
      const { findByText } = renderTab();
      await findByText('ACME Ltda');
      await findByText('21 dias');
      await findByText('35 dias');
    });

    it('20. sem lead time (null) exibe "—"', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [{ ...winner, leadTimeDays: null }, loser],
      });
      const { findByText, findAllByText } = renderTab();
      await findByText('ACME Ltda');
      const dashes = await findAllByText('—');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });
  describe('Origem por item (informativa)', () => {
    const withOrigins = {
      ...winner,
      originPort: 'Shanghai',
      itemOrigins: [
        { quoteRequestItemId: 1, productName: 'Produto A', originPort: 'Shanghai', overridden: false },
        { quoteRequestItemId: 2, productName: 'Produto B', originPort: 'Ningbo', overridden: true },
      ],
    };

    it('21. ranking mostra "Origem: Shanghai · Produto B: Ningbo"', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [withOrigins, loser],
      });
      const { findByText } = renderTab();
      await findByText('Origem: Shanghai · Produto B: Ningbo');
    });

    it('22. resposta sem origem (legado/historico sem itemOrigins) mostra "Origem: —" e nao quebra', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, loser],
      });
      const { findAllByText } = renderTab();
      const lines = await findAllByText('Origem: —');
      expect(lines.length).toBe(2);
    });

    it('23. mais de 3 overrides mostra os 3 primeiros e "+N"', async () => {
      const many = {
        ...winner,
        originPort: 'Shanghai',
        itemOrigins: ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({
          quoteRequestItemId: i + 1,
          productName: `Produto ${name}`,
          originPort: `Porto ${name}`,
          overridden: true,
        })),
      };
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [many, loser],
      });
      const { findByText } = renderTab();
      await findByText(
        'Origem: Shanghai · Produto A: Porto A · Produto B: Porto B · Produto C: Porto C · +2',
      );
    });

    it('24. card de uma unica resposta (bypass) tambem mostra a origem', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [withOrigins],
        responseCount: 1,
      });
      const { findByText } = renderTab();
      await findByText('Apenas um fornecedor respondeu — sem comparação.');
      await findByText('Origem: Shanghai · Produto B: Ningbo');
    });
  });

  describe('Selo DG (informativo)', () => {
    const withDg = {
      ...winner,
      dgItems: [
        { quoteRequestItemId: 1, productName: 'Produto A' },
        { quoteRequestItemId: 2, productName: 'Produto B' },
      ],
    };

    it('30. ranking mostra o selo "DG · 2" com os nomes no title, so na proposta que marcou DG', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [withDg, loser],
      });
      const { findByTestId, getAllByTestId } = renderTab();
      const seal = await findByTestId('dg-seal');
      expect(seal.textContent).toBe('DG · 2');
      expect(seal.getAttribute('title')).toBe('Informado como DG pelo fornecedor: Produto A, Produto B');
      expect(getAllByTestId('dg-seal')).toHaveLength(1);
    });

    it('31. sem dgItems (historico) ou vazio nao mostra selo', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, { ...loser, dgItems: [] }],
      });
      const { findAllByText, queryByTestId } = renderTab();
      await findAllByText('Origem: —');
      expect(queryByTestId('dg-seal')).toBeNull();
    });

    it('32. card de uma unica resposta (bypass) tambem mostra o selo', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [withDg],
        responseCount: 1,
      });
      const { findByText, findByTestId } = renderTab();
      await findByText('Apenas um fornecedor respondeu — sem comparação.');
      expect((await findByTestId('dg-seal')).textContent).toBe('DG · 2');
    });
  });
});

describe('ComparacaoTab - Fora do ranking (item temporariamente indisponivel)', () => {
  const excludedGamma = {
    quoteResponseId: 44,
    supplierId: 9,
    supplier: { id: 9, name: 'Gamma SA' },
    reason: 'unavailable' as const,
    unavailableItems: [
      { quoteRequestItemId: 5, productName: 'Resina Epóxi' },
      { quoteRequestItemId: 6, productName: 'Catalisador Y' },
    ],
  };

  it('25. ranking com 2 completas + 1 excluida: secao "Fora do ranking" com fornecedor e itens indisponiveis', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner, loser],
      winnerQuoteResponseId: 42,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 3,
      excluded: [excludedGamma],
    });
    const { findByText, getByRole, queryByText } = renderTab();
    const heading = await findByText('Fora do ranking');
    expect(heading.tagName).toBe('H3');
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByText('Gamma SA')).toBeTruthy();
    expect(section.textContent).toContain('Temporariamente indisponível: Resina Epóxi, Catalisador Y');
    // o ranking segue so com as completas
    expect(getByRole('button', { name: 'Definir como vencedora' })).toBeTruthy();
    expect(queryByText('Apenas um fornecedor respondeu — sem comparação.')).toBeNull();
    expect(queryByText('Apenas uma proposta completa — sem comparação.')).toBeNull();
  });

  it('26. nenhuma completa (results vazio): mostra o aviso e a secao "Fora do ranking" (sem by-pass)', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 2,
      excluded: [
        excludedGamma,
        { ...excludedGamma, quoteResponseId: 45, supplierId: 10, supplier: { id: 10, name: 'Delta Ltda' } },
      ],
    });
    const { findByText, queryByRole, queryByText } = renderTab();
    await findByText('Nenhuma proposta completa para comparar.');
    const heading = await findByText('Fora do ranking');
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByText('Gamma SA')).toBeTruthy();
    expect(within(section).getByText('Delta Ltda')).toBeTruthy();
    expect(queryByText(/Apenas um/)).toBeNull();
    expect(queryByRole('button', { name: 'Enviar Ordem de Compra' })).toBeNull();
  });

  it('27. so 1 completa + excluida: by-pass com texto proprio e a secao "Fora do ranking"', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 2,
      excluded: [excludedGamma],
    });
    const { findByText } = renderTab();
    await findByText('Apenas uma proposta completa — sem comparação.');
    await findByText('Fora do ranking');
  });

  it('28. sem propostas excluidas nao existe a secao "Fora do ranking"', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      ...defaultPreview,
      results: [winner, loser],
      excluded: [],
    });
    const { findByText, queryByText } = renderTab();
    await findByText('ACME Ltda');
    expect(queryByText('Fora do ranking')).toBeNull();
  });

  it('29. concluir com 1 completa + excluida fecha direto (sem executeComparison, que daria 400)', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 2,
      excluded: [excludedGamma],
    });
    const { container, findByText, getByRole } = renderOpenTab();
    await findByText('Apenas uma proposta completa — sem comparação.');

    fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));
    const reviewDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    await waitFor(() => expect(reviewDialog.open).toBe(true));
    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'Concluir cotação' }));

    await waitFor(() => expect(closeQuoteRequest).toHaveBeenCalledTimes(1));
    expect(executeComparison).not.toHaveBeenCalled();
  });

  const excludedPartial = {
    quoteResponseId: 46,
    supplierId: 11,
    supplier: { id: 11, name: 'Epsilon Ltda' },
    reason: 'partial' as const,
    unavailableItems: [],
    partial: {
      missingItems: [{ quoteRequestItemId: 5, productName: 'Resina Epóxi' }],
      quantityMismatches: [{ quoteRequestItemId: 6, productName: 'Catalisador Y', requested: 100, offered: 80 }],
      extraItems: [],
      duplicateItems: [],
    },
  };

  it('33. proposta parcial (item faltando) aparece em "Fora do ranking" com o motivo e pode ser escolhida', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner, loser],
      winnerQuoteResponseId: 42,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 3,
      excluded: [excludedPartial],
    });
    const { findByText, getAllByRole, getByRole, queryByText } = renderTab();
    const heading = await findByText('Fora do ranking');
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByText('Epsilon Ltda')).toBeTruthy();
    expect(section.textContent).toContain(
      'Proposta incompleta: faltam itens: Resina Epóxi; quantidade diferente em Catalisador Y (pedido 100, cotado 80)',
    );
    // o ranking segue com as completas e o header conta todas as respostas
    expect(getAllByRole('button', { name: 'Definir como vencedora' }).length).toBeGreaterThan(0);
    await findByText(/3 respostas/);
    expect(queryByText('Apenas uma proposta completa — sem comparação.')).toBeNull();

    // item faltando pode ser escolhida manualmente: abre o modal com o nome do fornecedor
    fireEvent.click(getByRole('button', { name: 'Definir como vencedora mesmo assim' }));
    await findByText('Definir Epsilon Ltda como vencedora');
  });

  it('34. proposta com item extra/duplicado fica fora do ranking SEM a opcao de vencer', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner, loser],
      winnerQuoteResponseId: 42,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 3,
      excluded: [
        {
          ...excludedPartial,
          partial: {
            missingItems: [],
            quantityMismatches: [],
            extraItems: [{ quoteRequestItemId: 99, productName: 'Item antigo' }],
            duplicateItems: [],
          },
        },
      ],
    });
    const { findByText, queryByRole } = renderTab();
    const heading = await findByText('Fora do ranking');
    const section = heading.closest('section') as HTMLElement;
    expect(section.textContent).toContain('Proposta incompleta: item não pertence mais à cotação: Item antigo');
    expect(queryByRole('button', { name: 'Definir como vencedora mesmo assim' })).toBeNull();
  });

  it('35. quantidade divergente entra no ranking com a linha de aviso', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      ...defaultPreview,
      results: [
        winner,
        {
          ...loser,
          quantityAdjusted: true,
          quantityMismatches: [{ quoteRequestItemId: 6, productName: 'Catalisador Y', requested: 100, offered: 80 }],
        },
      ],
      excluded: [],
    });
    const { findByTestId, queryByText } = renderTab();
    const line = await findByTestId('qty-adjusted');
    expect(line.textContent).toBe(
      'Quantidade divergente: Catalisador Y: pedido 100, cotado 80 — ranking usa o unitário × quantidade pedida',
    );
    expect(queryByText('Fora do ranking')).toBeNull();
  });
});

describe('ComparacaoTab - Fora do ranking (item temporariamente indisponivel)', () => {
  const excludedGamma = {
    quoteResponseId: 44,
    supplierId: 9,
    supplier: { id: 9, name: 'Gamma SA' },
    reason: 'unavailable' as const,
    unavailableItems: [
      { quoteRequestItemId: 5, productName: 'Resina Epóxi' },
      { quoteRequestItemId: 6, productName: 'Catalisador Y' },
    ],
  };

  it('25. ranking com 2 completas + 1 excluida: secao "Fora do ranking" com fornecedor e itens indisponiveis', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner, loser],
      winnerQuoteResponseId: 42,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 3,
      excluded: [excludedGamma],
    });
    const { findByText, getByRole, queryByText } = renderTab();
    const heading = await findByText('Fora do ranking');
    expect(heading.tagName).toBe('H3');
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByText('Gamma SA')).toBeTruthy();
    expect(section.textContent).toContain('Temporariamente indisponível: Resina Epóxi, Catalisador Y');
    // o ranking segue so com as completas
    expect(getByRole('button', { name: 'Definir como vencedora' })).toBeTruthy();
    expect(queryByText('Apenas um fornecedor respondeu — sem comparação.')).toBeNull();
    expect(queryByText('Apenas uma proposta completa — sem comparação.')).toBeNull();
  });

  it('26. nenhuma completa (results vazio): mostra o aviso e a secao "Fora do ranking" (sem by-pass)', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 2,
      excluded: [
        excludedGamma,
        { ...excludedGamma, quoteResponseId: 45, supplierId: 10, supplier: { id: 10, name: 'Delta Ltda' } },
      ],
    });
    const { findByText, queryByRole, queryByText } = renderTab();
    await findByText('Nenhuma proposta completa para comparar.');
    const heading = await findByText('Fora do ranking');
    const section = heading.closest('section') as HTMLElement;
    expect(within(section).getByText('Gamma SA')).toBeTruthy();
    expect(within(section).getByText('Delta Ltda')).toBeTruthy();
    expect(queryByText(/Apenas um/)).toBeNull();
    expect(queryByRole('button', { name: 'Enviar Ordem de Compra' })).toBeNull();
  });

  it('27. so 1 completa + excluida: by-pass com texto proprio e a secao "Fora do ranking"', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 2,
      excluded: [excludedGamma],
    });
    const { findByText } = renderTab();
    await findByText('Apenas uma proposta completa — sem comparação.');
    await findByText('Fora do ranking');
  });

  it('28. sem propostas excluidas nao existe a secao "Fora do ranking"', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      ...defaultPreview,
      results: [winner, loser],
      excluded: [],
    });
    const { findByText, queryByText } = renderTab();
    await findByText('ACME Ltda');
    expect(queryByText('Fora do ranking')).toBeNull();
  });

  it('29. concluir com 1 completa + excluida fecha direto (sem executeComparison, que daria 400)', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [winner],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 2,
      excluded: [excludedGamma],
    });
    const { container, findByText, getByRole } = renderOpenTab();
    await findByText('Apenas uma proposta completa — sem comparação.');

    fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));
    const reviewDialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    await waitFor(() => expect(reviewDialog.open).toBe(true));
    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'Concluir cotação' }));

    await waitFor(() => expect(closeQuoteRequest).toHaveBeenCalledTimes(1));
    expect(executeComparison).not.toHaveBeenCalled();
  });

  // PR4a (Credit Support): alternativa via parceiro como candidato proprio na Comparacao.
  describe('alternativa via parceiro (Credit Support, PR4a)', () => {
    beforeEach(() => {
      controls.role = 'admin';
      vi.mocked(setManualWinner).mockReset().mockResolvedValue(undefined);
      vi.mocked(executeComparison).mockReset();
      vi.mocked(listComparisons).mockResolvedValue({ quoteRequestId: 99, comparisons: [record] });
    });

    // Mesma resposta de origem (42) que `winner`, cotada pelo Banco Alfa: preco/prazo do parceiro.
    const viaPartner = {
      ...winner,
      isWinner: false,
      offeredPrice: 90,
      paymentTermsDays: 90,
      creditSupportRequestId: 7,
      creditPartner: { id: 5, name: 'Banco Alfa' },
      partnerContact: { id: 50, name: 'Ana Crédito', email: 'ana@alfa.example' },
      partnerValidityDays: 30,
      validityExpired: false,
    };

    it('40. duas linhas com o mesmo quoteResponseId: ambas renderizam, chip "via", e so a marcada pelo winnerCreditSupportRequestId tem o badge', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [{ ...winner, isWinner: false }, viaPartner, loser],
        winnerQuoteResponseId: 42,
        winnerCreditSupportRequestId: 7,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 2,
        candidateCount: 3,
      });
      const { container, findAllByText, getByTestId, getAllByText, queryByText } = renderTab();
      const names = await findAllByText('ACME Ltda');
      expect(names).toHaveLength(2);
      const chip = getByTestId('via-partner');
      expect(chip.textContent).toBe('via Banco Alfa · Credit Support');
      // Badge de vencedora UMA vez, na linha via parceiro (chave composta, nao quoteResponseId).
      const badges = container.querySelectorAll('.cmp-winner-badge');
      expect(badges).toHaveLength(1);
      const winnerRow = badges[0]!.closest('.cmp-row') as HTMLElement;
      expect(within(winnerRow).getByTestId('via-partner')).toBeTruthy();
      expect(within(winnerRow).getByText('ana@alfa.example', { exact: false })).toBeTruthy();
      expect(getAllByText('90 dias')).toHaveLength(1);
      // candidateCount (3) e usado como comparableCount: ranking normal, sem by-pass.
      expect(queryByText(/sem comparação/)).toBeNull();
      // Ranking tem 3 linhas, chaves distintas.
      expect(container.querySelectorAll('.cmp-rows .cmp-row')).toHaveLength(3);
    });

    it('41. "Definir como vencedora" na linha via parceiro chama setManualWinner com creditSupportRequestId e titulo "via"', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [winner, viaPartner],
        winnerQuoteResponseId: 42,
        winnerCreditSupportRequestId: null,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 1,
        candidateCount: 2,
      });
      const { container, findByTestId, getByLabelText } = renderTab();
      const chip = await findByTestId('via-partner');
      const row = chip.closest('.cmp-row') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'Definir como vencedora' }));
      const dialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Definir ACME Ltda via Banco Alfa como vencedora');
      fireEvent.change(getByLabelText('Motivo'), { target: { value: 'Prazo do parceiro' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Definir como vencedora' }));
      await waitFor(() => expect(setManualWinner).toHaveBeenCalledTimes(1));
      expect(setManualWinner).toHaveBeenCalledWith(99, {
        quoteResponseId: 42,
        creditSupportRequestId: 7,
        reason: 'Prazo do parceiro',
      });
    });

    it('42. vencedora via parceiro: botao de PO desabilitado ("PO ao parceiro: em breve") e sem "Responder"', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [{ ...winner, isWinner: false }, viaPartner, loser],
        winnerQuoteResponseId: 42,
        winnerCreditSupportRequestId: 7,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 2,
        candidateCount: 3,
      });
      const { findByTestId, getByTestId, queryByRole, queryAllByRole } = renderTab();
      const po = (await findByTestId('po-partner-soon')) as HTMLButtonElement;
      expect(po.disabled).toBe(true);
      expect(po.title).toBe('PO ao parceiro: em breve');
      expect(po.textContent).toContain('Enviar Ordem de Compra');
      // Texto visivel (nao so o title) explicando o botao desabilitado.
      expect(getByTestId('po-partner-soon-hint').textContent).toBe('PO ao parceiro: em breve');
      expect(queryByRole('button', { name: 'Responder' })).toBeNull();
      // A direta da mesma origem (nao vencedora) e a Beta oferecem "Definir como vencedora".
      expect(queryAllByRole('button', { name: 'Definir como vencedora' })).toHaveLength(2);
    });

    it('43. excluida `stale` via parceiro: texto proprio, prefixo "via" e SEM botao de escolha manual', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, loser],
        excluded: [
          {
            quoteResponseId: 43,
            supplierId: 8,
            supplier: { id: 8, name: 'Beta Corp' },
            creditSupportRequestId: 9,
            creditPartner: { id: 6, name: 'Banco Beta' },
            reason: 'stale',
            unavailableItems: [],
          },
        ],
      });
      const { findByText, queryByRole } = renderTab();
      const heading = await findByText('Fora do ranking');
      const section = heading.closest('section') as HTMLElement;
      expect(within(section).getByTestId('via-partner').textContent).toBe('via Banco Beta');
      expect(section.textContent).toContain(
        'a proposta do fornecedor mudou depois do encaminhamento (revogue e encaminhe de novo)',
      );
      expect(queryByRole('button', { name: 'Definir como vencedora mesmo assim' })).toBeNull();
    });

    it('44. excluida `partial` (item faltando) via parceiro pode ser escolhida e envia creditSupportRequestId', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, loser],
        excluded: [
          {
            quoteResponseId: 43,
            supplierId: 8,
            supplier: { id: 8, name: 'Beta Corp' },
            creditSupportRequestId: 9,
            creditPartner: { id: 6, name: 'Banco Beta' },
            reason: 'partial',
            unavailableItems: [],
            partial: {
              missingItems: [{ quoteRequestItemId: 6, productName: 'Catalisador Y' }],
              quantityMismatches: [],
              extraItems: [],
              duplicateItems: [],
            },
          },
        ],
      });
      const { container, findByText, getByRole, getByLabelText } = renderTab();
      await findByText('Fora do ranking');
      fireEvent.click(getByRole('button', { name: 'Definir como vencedora mesmo assim' }));
      const dialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
      expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Definir Beta Corp via Banco Beta como vencedora');
      fireEvent.change(getByLabelText('Motivo'), { target: { value: 'ok' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Definir como vencedora' }));
      await waitFor(() => expect(setManualWinner).toHaveBeenCalledTimes(1));
      expect(setManualWinner).toHaveBeenCalledWith(99, { quoteResponseId: 43, creditSupportRequestId: 9, reason: 'ok' });
    });

    it('45. by-pass com o unico candidato via parceiro: chip, PO desabilitada e nenhuma chamada de PO', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        results: [viaPartner],
        winnerQuoteResponseId: null,
        winnerCreditSupportRequestId: null,
        pendingApproval: false,
        thresholdValue: null,
        responseCount: 1,
        candidateCount: 1,
        excluded: [
          {
            quoteResponseId: 42,
            supplierId: 7,
            supplier: { id: 7, name: 'ACME Ltda' },
            creditSupportRequestId: null,
            creditPartner: null,
            reason: 'unavailable',
            unavailableItems: [{ quoteRequestItemId: 5, productName: 'Resina Epóxi' }],
          },
        ],
      });
      const { findByText, getByTestId, container } = renderTab();
      await findByText('Apenas uma proposta completa — sem comparação.');
      const bypass = container.querySelector('.cmp-bypass') as HTMLElement;
      expect(within(bypass).getByTestId('via-partner').textContent).toBe('via Banco Alfa · Credit Support');
      expect(bypass.textContent).toContain('ana@alfa.example');
      const po = getByTestId('po-partner-soon') as HTMLButtonElement;
      expect(po.disabled).toBe(true);
      expect(po.title).toBe('PO ao parceiro: em breve');
      expect(within(bypass).getByTestId('po-partner-soon-hint').textContent).toBe('PO ao parceiro: em breve');
      expect(setManualWinner).not.toHaveBeenCalled();
      expect(executeComparison).not.toHaveBeenCalled();
    });

    it('46. fixtures antigas (sem chaves PR4a): badge continua na vencedora por quoteResponseId e comparableCount cai no fallback', async () => {
      vi.mocked(previewComparison).mockResolvedValue({
        ...defaultPreview,
        results: [winner, loser],
        responseCount: 3,
        excluded: [excludedGamma],
      });
      const { container, findByText, queryByTestId } = renderTab();
      await findByText('Fora do ranking');
      const badges = container.querySelectorAll('.cmp-winner-badge');
      expect(badges).toHaveLength(1);
      expect(within(badges[0]!.closest('.cmp-row') as HTMLElement).getByText('ACME Ltda')).toBeTruthy();
      expect(queryByTestId('via-partner')).toBeNull();
      expect(queryByTestId('po-partner-soon')).toBeNull();
    });
  });
});
