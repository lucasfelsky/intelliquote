import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComparacaoTab } from './ComparacaoTab';

// F8 (Suite COMEX): a aba Comparacoes e seus 3 modais usam so classes (nenhum estilo inline, fora a largura da barra de score); icones do
// board CotacaoComparacao no lugar dos 7 SVG locais; selos, chip "Qtd divergente", estados e feedback com papel. Mocks no padrao do
// ComparacaoTab.test.tsx; dados ficticios.

const controls = vi.hoisted(() => ({ role: 'admin', confirm: vi.fn() }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: controls.role } }),
}));
vi.mock('@/components/useConfirm', () => ({ useConfirm: () => controls.confirm }));
vi.mock('@/services/quoteResponses', async (importOriginal) => ({
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
  sendPurchaseOrderToPartner: vi.fn(),
  getPurchaseOrderRecipients: vi.fn().mockResolvedValue({
    to: { name: '[Contato Demo]', email: 'contato@exemplo.invalid' },
    contactCc: [],
    comexCc: [],
    cc: [],
  }),
  getPartnerPurchaseOrderRecipients: vi.fn().mockResolvedValue({
    to: { name: '[Parceiro Demo]', email: 'parceiro@exemplo.invalid' },
    contactCc: [],
    comexCc: [],
    cc: [],
  }),
}));
vi.mock('@/services/forwarders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/forwarders')>()),
  listForwarders: vi.fn().mockResolvedValue([]),
}));

import { executeComparison, previewComparison, setManualWinner } from '@/services/quoteResponses';
import { previewQuoteResponseReply } from '@/services/dispatch';

const winner = {
  supplierId: 7,
  quoteResponseId: 42,
  supplier: { id: 7, name: '[Fornecedor Demo 01]' },
  contact: { name: '[Contato Demo]', email: 'contato@exemplo.invalid' },
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
  supplier: { id: 8, name: '[Fornecedor Demo 02]' },
  isWinner: false,
  totalScore: 80,
  leadTimeDays: 35,
};
const divergente = {
  ...loser,
  supplierId: 9,
  quoteResponseId: 44,
  supplier: { id: 9, name: '[Fornecedor Demo 03]' },
  totalScore: 70,
  quantityAdjusted: true,
  quantityMismatches: [{ quoteRequestItemId: 6, productName: '[Item B]', requested: 5000, offered: 4800 }],
};
const comDg = {
  ...loser,
  supplierId: 10,
  quoteResponseId: 45,
  supplier: { id: 10, name: '[Fornecedor Demo 04]' },
  totalScore: 60,
  dgItems: [{ quoteRequestItemId: 5, productName: '[Item A]' }],
};

const preview = {
  results: [winner, loser],
  winnerQuoteResponseId: 42,
  pendingApproval: false,
  thresholdValue: null,
  responseCount: 2,
};

function renderTab(status: 'open' | 'closed' = 'open') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ComparacaoTab quoteRequestId={99} quoteRequestStatus={status} productName="[Produto Demo]" requestCode="QR-2026-0418" />
    </QueryClientProvider>,
  );
}

// Nenhum estilo inline na aba nem nos modais; a unica excecao e a largura da barra de score (valor dinamico).
const inlineFora = (root: ParentNode) =>
  Array.from(root.querySelectorAll('[style]')).filter((el) => !el.matches('.cmp-scorebar__fill'));

describe('ComparacaoTab: visual (Suite COMEX, F8)', () => {
  beforeEach(() => {
    controls.role = 'admin';
    controls.confirm.mockReset().mockResolvedValue(true);
    vi.mocked(previewComparison).mockReset().mockResolvedValue(preview);
    vi.mocked(setManualWinner).mockReset().mockResolvedValue(undefined);
    vi.mocked(executeComparison)
      .mockReset()
      .mockResolvedValue({ results: [], pendingApproval: false, winnerQuoteResponseId: null, thresholdValue: null, comparisonId: 1 });
    vi.mocked(previewQuoteResponseReply)
      .mockReset()
      .mockResolvedValue({ to: 'contato@exemplo.invalid', cc: [], subject: 's', html: '<p>oi</p>', text: 'oi' });
  });

  it('o cartao e uma section nomeada pelo titulo (h2#cmp-title) e nao tem estilo inline na aba inteira', async () => {
    const { container, findByText } = renderTab();
    await findByText('[Fornecedor Demo 01]');
    const card = container.querySelector('section.cmp-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('aria-labelledby')).toBe('cmp-title');
    const titulo = card?.querySelector('h2#cmp-title');
    expect(titulo?.textContent).toBe('Comparação de fornecedores');
    expect(container.querySelector('.cmp-tab')).not.toBeNull();
    expect(inlineFora(container)).toEqual([]);
    // a barra de score e o unico estilo inline (largura dinamica)
    expect(container.querySelectorAll('.cmp-scorebar__fill[style]')).toHaveLength(2);
  });

  it('selo "ao vivo": role=status, numero em .cmp-live__num e "resposta"/"respostas" conforme o numero (D-F8-02)', async () => {
    const { container, findByText } = renderTab();
    await findByText('[Fornecedor Demo 01]');
    const selo = container.querySelector('.cmp-live') as HTMLElement;
    expect(selo.getAttribute('role')).toBe('status');
    expect(selo.querySelector('.cmp-live__num')?.textContent).toBe('2');
    expect(selo.querySelector('.cmp-live__dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(selo.textContent).toContain('2 respostas · ao vivo');
    expect(within(selo).getByText('2 respostas · ao vivo').className).toContain('sr-only');
  });

  it('com 1 resposta o selo diz "1 resposta" (singular)', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...preview, results: [winner], responseCount: 1 });
    const { container, findByText } = renderTab();
    await findByText('Apenas um fornecedor respondeu — sem comparação.');
    const selo = container.querySelector('.cmp-live') as HTMLElement;
    expect(selo.querySelector('.cmp-live__num')?.textContent).toBe('1');
    expect(within(selo).getByText('1 resposta · ao vivo')).toBeTruthy();
    expect(selo.textContent).not.toContain('respostas');
  });

  it('chaves dos criterios: icone (svg aria-hidden) so quando ligadas; role=switch e aria-checked intactos', async () => {
    const { findByText, getByRole } = renderTab();
    await findByText('[Fornecedor Demo 01]');
    const preco = getByRole('switch', { name: 'Preço' });
    expect(preco.getAttribute('aria-checked')).toBe('true');
    expect(preco.className).toContain('cmp-toggle--active');
    expect(preco.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const pagamento = getByRole('switch', { name: 'Condição de pagamento' });
    expect(pagamento.getAttribute('aria-checked')).toBe('false');
    expect(pagamento.querySelector('svg')).toBeNull();
    fireEvent.click(pagamento);
    expect(getByRole('switch', { name: 'Condição de pagamento' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('"Vencedora": selo de sucesso com anel (cmp-winner-badge) e trofeu; a vencedora tem as acoes com icone e as demais, os botoes de texto', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('[Fornecedor Demo 01]');
    const selo = container.querySelector('.cmp-rows .cmp-winner-badge') as HTMLElement;
    expect(selo.textContent).toBe('Vencedora');
    expect(selo.className).toContain('badge');
    expect(selo.className).toContain('badge--success');
    expect(selo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const po = container.querySelector('.cmp-rows .cmp-btn--primary') as HTMLElement;
    expect(po.textContent).toBe('Enviar Ordem de Compra');
    expect(po.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const responder = getByRole('button', { name: 'Responder' });
    expect(responder.className).toContain('cmp-btn--ghost');
    expect(responder.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const definir = getByRole('button', { name: 'Definir como vencedora' });
    expect(definir.className).toContain('cmp-btn--link');
    expect(definir.querySelector('svg')).toBeNull();
    const rank = container.querySelectorAll('.cmp-rank');
    expect(rank[0]?.className).toContain('cmp-rank--winner');
    expect(rank[1]?.className).not.toContain('cmp-rank--winner');
  });

  it('"Qtd divergente": chip info-chip--warning com icone; o popover (portal) tem titulo com icone, lista com numeros em mono e a nota', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...preview, results: [winner, divergente], responseCount: 2 });
    const { findByTestId, getByRole } = renderTab();
    const chip = await findByTestId('qty-adjusted');
    expect(chip.className).toContain('info-chip--warning');
    expect(chip.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(chip);
    const tip = getByRole('tooltip');
    expect(tip.className).toContain('info-popover');
    expect(tip.querySelector('.cmp-popover__titulo svg[aria-hidden="true"]')).not.toBeNull();
    expect(tip.querySelector('.cmp-popover__titulo')?.textContent).toBe('Quantidade divergente');
    expect(Array.from(tip.querySelectorAll('.cmp-popover__lista .cmp-mono')).map((n) => n.textContent)).toEqual(['5.000', '4.800']);
    expect(tip.querySelector('li')?.textContent).toBe('[Item B]: pedido 5.000, cotado 4.800');
    expect(tip.querySelector('.cmp-popover__nota')?.textContent).toBe('O ranking usa o unitário × quantidade pedida.');
  });

  it('selo DG sem estilo inline: badge--danger com o title de hoje; "via parceiro" em badge--info', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      ...preview,
      results: [winner, comDg, { ...loser, quoteResponseId: 46, supplierId: 11, supplier: { id: 11, name: '[Fornecedor Demo 05]' }, creditSupportRequestId: 5, creditPartner: { id: 3, name: '[Banco Parceiro]' }, partnerContact: { id: 3, name: '[Parceiro]', email: 'p@exemplo.invalid' } }],
      responseCount: 3,
    });
    const { findByTestId, container } = renderTab();
    const dg = await findByTestId('dg-seal');
    expect(dg.className).toContain('badge--danger');
    expect(dg.getAttribute('title')).toBe('Informado como DG pelo fornecedor: [Item A]');
    expect(dg.getAttribute('style')).toBeNull();
    const via = await findByTestId('via-partner');
    expect(via.className).toContain('badge--info');
    expect(inlineFora(container)).toEqual([]);
  });

  it('alcada: aviso de atencao com role=status, icone e o valor em .cmp-mono (sem estilo inline)', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...preview, pendingApproval: true, thresholdValue: 250000 });
    const { container, findByText } = renderTab();
    await findByText('Recomendada · requer aprovação');
    const aviso = container.querySelector('.cmp-alcada') as HTMLElement;
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.className).not.toContain('alert');
    expect(aviso.querySelector(':scope > svg[aria-hidden="true"]')).not.toBeNull();
    expect(aviso.querySelector('.cmp-mono')?.textContent).toBe('250.000,00');
    expect(aviso.textContent).toContain('pela alçada de R$ 250.000,00 ou');
    expect(inlineFora(container)).toEqual([]);
  });

  it('escolha manual: "Usar vencedora pelo score" com icone e "Vencedora (escolha manual)"', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      ...preview,
      persistedWinner: { quoteResponseId: 43, creditSupportRequestId: null, manual: true },
    });
    const { findByTestId, container } = renderTab();
    const usar = await findByTestId('use-score-winner');
    expect(usar.className).toContain('cmp-btn--ghost');
    expect(usar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('.cmp-rows .cmp-winner-badge')?.textContent).toBe('Vencedora (escolha manual)');
    expect(inlineFora(container)).toEqual([]);
  });

  it('by-pass (1 proposta): alerta com role=status e alert-circle, cartao do fornecedor com avatar, estatisticas e o botao "Enviar Ordem de Compra" com icone dentro do cartao', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...preview, results: [winner], responseCount: 1 });
    const { container, findByText } = renderTab();
    await findByText('Apenas um fornecedor respondeu — sem comparação.');
    const alerta = container.querySelector('.cmp-bypass .cmp-bypass-alert') as HTMLElement;
    expect(alerta.getAttribute('role')).toBe('status');
    expect(alerta.querySelector('.cmp-bypass-alert__icon svg[aria-hidden="true"]')).not.toBeNull();
    const cartao = container.querySelector('.cmp-bypass-supplier') as HTMLElement;
    expect(cartao.querySelector('.cmp-bypass-supplier__avatar')?.textContent).toBe('[D');
    expect(cartao.querySelector('.cmp-bypass-supplier__valor')?.textContent).toBe('100,00');
    const botao = within(cartao).getByRole('button', { name: 'Enviar Ordem de Compra' });
    expect(botao.className).toContain('cmp-btn--primary');
    expect(botao.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(inlineFora(container)).toEqual([]);
  });

  it('nenhuma proposta completa: alerta de by-pass sem cartao e a lista de "Fora do ranking" com nome forte, motivo e acoes', async () => {
    vi.mocked(previewComparison).mockResolvedValue({
      results: [],
      winnerQuoteResponseId: null,
      pendingApproval: false,
      thresholdValue: null,
      responseCount: 1,
      excluded: [
        {
          quoteResponseId: 51,
          supplierId: 20,
          supplier: { id: 20, name: '[Fornecedor Demo 20]' },
          reason: 'unavailable',
          unavailableItems: [{ quoteRequestItemId: 5, productName: '[Item A]' }],
        },
      ],
    });
    const { container, findByText } = renderTab();
    await findByText('Nenhuma proposta completa para comparar.');
    expect(container.querySelector('.cmp-bypass-supplier')).toBeNull();
    const titulo = await findByText('Fora do ranking');
    expect(titulo.tagName).toBe('H3');
    const secao = titulo.closest('section.cmp-excluded') as HTMLElement;
    expect(secao.querySelector('ul.cmp-excluded__lista > li.cmp-excluded__item')).not.toBeNull();
    expect(secao.querySelector('.cmp-excluded__nome')?.textContent).toBe('[Fornecedor Demo 20]');
    expect(secao.textContent).toContain('Temporariamente indisponível: [Item A]');
    expect(within(secao).getByTestId('po-nonwinner').className).toContain('cmp-btn--subtle');
    expect(inlineFora(container)).toEqual([]);
  });

  it('sem respostas: vazio com icone aria-hidden; carregando e erro com os papeis do board', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...preview, results: [], responseCount: 0 });
    const vazio = renderTab();
    await vazio.findByText('Nenhuma resposta ainda');
    expect(vazio.container.querySelector('.cmp-empty__icon svg[aria-hidden="true"]')).not.toBeNull();
    expect(inlineFora(vazio.container)).toEqual([]);
    vazio.unmount();

    vi.mocked(previewComparison).mockReturnValue(new Promise(() => undefined));
    const carregando = renderTab();
    const estado = (await carregando.findByText('Calculando comparação…')).closest('.cmp-carregando') as HTMLElement;
    expect(estado.getAttribute('role')).toBe('status');
    expect(estado.querySelector('.cmp-carregando__spinner')?.getAttribute('aria-hidden')).toBe('true');
    carregando.unmount();
  });

  it('erro ao calcular: role=alert com icone, "Não foi possível calcular a comparação." em destaque, o detalhe e "Tentar novamente" (secundario com icone)', async () => {
    vi.mocked(previewComparison).mockRejectedValue(new Error('[Detalhe do erro]'));
    const { container, findByRole, getByRole } = renderTab();
    const erro = await findByRole('alert');
    expect(erro.className).toContain('cmp-erro');
    expect(erro.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(erro).getByText('Não foi possível calcular a comparação.').tagName).toBe('STRONG');
    expect(erro.textContent).toContain('[Detalhe do erro]');
    const tentar = getByRole('button', { name: 'Tentar novamente' });
    expect(tentar.className).toContain('ghost-button');
    expect(tentar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    vi.mocked(previewComparison).mockResolvedValue(preview);
    fireEvent.click(tentar);
    await waitFor(() => expect(container.querySelector('.cmp-erro')).toBeNull());
  });

  it('feedback com papel: sucesso = role=status, erro = role=alert (D-F8-11), fora do cartao e sem estilo inline', async () => {
    vi.mocked(previewComparison).mockResolvedValue({ ...preview, results: [winner, loser] });
    const { container, findByText, getByRole } = renderTab();
    await findByText('[Fornecedor Demo 02]');
    // abre o modal "Definir como vencedora" e confirma: o sucesso volta como feedback
    fireEvent.click(getByRole('button', { name: 'Definir como vencedora' }));
    const dialog = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Definir como vencedora' }));
    const ok = await findByText('Vencedora definida manualmente.');
    expect(ok.getAttribute('role')).toBe('status');
    expect(ok.className).toContain('alert--success');
    expect(ok.closest('.cmp-card')).toBeNull();
    expect(inlineFora(container)).toEqual([]);
  });

  it('modais: subtitulo "codigo · produto" (.modal-subtitle) em Responder, Definir vencedora e Avaliar e concluir; sem estilo inline', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('[Fornecedor Demo 01]');

    fireEvent.click(getByRole('button', { name: 'Responder' }));
    await waitFor(() => expect(container.querySelectorAll('dialog')).toHaveLength(2));
    const responder = container.querySelectorAll('dialog')[0] as HTMLDialogElement;
    await waitFor(() => expect(responder.querySelector('iframe')).not.toBeNull());
    expect(responder.querySelector('.modal-subtitle')?.textContent).toBe('QR-2026-0418 · [Produto Demo]');
    expect(responder.querySelector('.modal-subtitle .cmp-codigo')?.textContent).toBe('QR-2026-0418');
    expect(responder.className).toContain('modal-dialog--wide');
    const atualizar = within(responder).getByRole('button', { name: 'Atualizar preview' });
    expect(atualizar.className).toContain('cmp-btn--ghost');
    expect(atualizar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(responder).getByRole('heading', { name: 'Preview do e-mail', level: 3 })).toBeTruthy();
    expect(responder.querySelector('iframe')?.className).toContain('preview-frame');
    expect(responder.querySelector('iframe')?.getAttribute('title')).toBe('preview-reply-email');
    const enviar = within(responder).getByRole('button', { name: 'Enviar e-mail' });
    expect(enviar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(inlineFora(responder)).toEqual([]);

    fireEvent.click(within(responder).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(getByRole('button', { name: 'Definir como vencedora' }));
    await waitFor(() => expect(container.querySelectorAll('dialog')).toHaveLength(3));
    const vencedora = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    expect(vencedora.querySelector('.modal-subtitle')?.textContent).toBe('QR-2026-0418 · [Produto Demo]');
    expect(within(vencedora).getByRole('button', { name: 'Definir como vencedora' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(inlineFora(vencedora)).toEqual([]);
    fireEvent.click(within(vencedora).getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));
    const avaliar = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    expect(avaliar.querySelector('.modal-header h2')?.textContent).toBe('Avaliar [Fornecedor Demo 01]');
    expect(avaliar.querySelector('.modal-subtitle')?.textContent).toBe('QR-2026-0418 · [Produto Demo]');
    expect(inlineFora(avaliar)).toEqual([]);
  });

  it('Avaliar e concluir: avaliacao com estrelas, aviso de avaliacao incompleta com role=alert e icone, "Avisar não selecionados"', async () => {
    const { container, findByText, getByRole } = renderTab();
    await findByText('[Fornecedor Demo 01]');
    fireEvent.click(getByRole('button', { name: 'Concluir cotação' }));
    const avaliar = container.querySelectorAll('dialog')[1] as HTMLDialogElement;
    const escopo = within(avaliar);
    expect(escopo.getByText('Avaliação (opcional)').className).toContain('cmp-review__hint');
    fireEvent.click(within(escopo.getByRole('radiogroup', { name: /^Preço/ })).getByRole('radio', { name: '4 de 5' }));
    const aviso = await escopo.findByText('Dê nota nas três dimensões ou deixe todas em branco.');
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(escopo.getByText('Avisar não selecionados').closest('label')?.className).toContain('cmp-review__notify');
    expect(inlineFora(avaliar)).toEqual([]);
  });

  it('Responder: erro de envio ou de preview vira .alert--error com role=alert', async () => {
    vi.mocked(previewQuoteResponseReply).mockRejectedValue(new Error('[falha no preview]'));
    const { container, findByText, getByRole } = renderTab();
    await findByText('[Fornecedor Demo 01]');
    fireEvent.click(getByRole('button', { name: 'Responder' }));
    const erro = await findByText(/\[falha no preview\]/);
    expect(erro.className).toContain('alert--error');
    expect(erro.getAttribute('role')).toBe('alert');
    expect(inlineFora(container)).toEqual([]);
  });
});
