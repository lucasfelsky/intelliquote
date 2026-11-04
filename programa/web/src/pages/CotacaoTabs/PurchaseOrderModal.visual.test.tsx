import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComparisonResult } from '@/services/quoteResponses';
import type { Forwarder } from '@/services/forwarders';

// F8 (Suite COMEX): o modal Enviar Ordem de Compra usa so classes (nenhum estilo inline), subtitulo "codigo · produto", aviso de proposta nao
// vencedora, bloco de destinatarios (Para/Cc/Equipe COMEX), botao de arquivo do board, tamanho do PDF com virgula e erro com icone.
// Mocks no padrao do PurchaseOrderModal.test.tsx; dados ficticios.

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

import { getPartnerPurchaseOrderRecipients, getPurchaseOrderRecipients } from '@/services/dispatch';
import { listForwarders } from '@/services/forwarders';
import { PurchaseOrderModal } from './PurchaseOrderModal';

const target = {
  supplierId: 7,
  quoteResponseId: 42,
  supplier: { id: 7, name: '[Fornecedor Demo 01]' },
  isWinner: true,
} as unknown as ComparisonResult;

const partnerTarget = {
  ...target,
  creditSupportRequestId: 7,
  creditPartner: { id: 5, name: '[Banco Parceiro]' },
  partnerContact: { id: 50, name: '[Contato Parceiro]', email: 'parceiro@exemplo.invalid' },
} as unknown as ComparisonResult;

const forwarder: Forwarder = {
  id: 1,
  companyName: '[Forwarder Demo A]',
  address: '[Endereço Demo]',
  website: null,
  notes: null,
  isActive: true,
  isDefault: true,
  createdAt: '2026-10-08T12:00:00.000Z',
  updatedAt: '2026-10-08T12:00:00.000Z',
  contacts: [{ id: 11, name: '[Contato Forwarder]', email: 'forwarder@exemplo.invalid', phone: '+55 13 0000-0000' }],
};

function renderModal(props: { target?: ComparisonResult; nonWinner?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <PurchaseOrderModal
        target={props.target ?? target}
        requestCode="QR-2026-0418"
        productName="[Produto Demo]"
        onClose={vi.fn()}
        onSent={vi.fn()}
        nonWinner={props.nonWinner}
      />
    </QueryClientProvider>,
  );
  const dialog = view.container.querySelector('dialog') as HTMLDialogElement;
  return { ...view, dialog, scope: within(dialog) };
}

// Nenhum estilo inline no modal inteiro (o InfoPopover nao entra aqui).
const inline = (root: ParentNode) => Array.from(root.querySelectorAll('[style]'));

describe('PurchaseOrderModal: visual (Suite COMEX, F8)', () => {
  beforeEach(() => {
    controls.confirm.mockReset();
    vi.mocked(listForwarders).mockReset().mockResolvedValue([forwarder]);
    vi.mocked(getPurchaseOrderRecipients).mockReset().mockResolvedValue({
      to: { name: '[Contato Demo]', email: 'contato@exemplo.invalid' },
      contactCc: [{ name: '[Copia Demo]', email: 'copia@exemplo.invalid' }],
      comexCc: ['comex1@exemplo.invalid', 'comex2@exemplo.invalid'],
      cc: [],
    });
    vi.mocked(getPartnerPurchaseOrderRecipients).mockReset().mockResolvedValue({
      to: { name: '[Contato Parceiro]', email: 'parceiro@exemplo.invalid' },
      contactCc: [],
      comexCc: [],
      cc: [],
    });
  });

  it('subtitulo "codigo · produto" em .modal-subtitle (o codigo em .cmp-codigo), modal largo e titulo de hoje', async () => {
    const { dialog } = renderModal();
    expect(dialog.className).toContain('modal-dialog--wide');
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Enviar Ordem de Compra — [Fornecedor Demo 01]');
    expect(dialog.querySelector('.modal-subtitle')?.textContent).toBe('QR-2026-0418 · [Produto Demo]');
    expect(dialog.querySelector('.modal-subtitle .cmp-codigo')?.textContent).toBe('QR-2026-0418');
    await waitFor(() => expect(listForwarders).toHaveBeenCalled());
  });

  it('proposta nao vencedora: aviso de atencao, icone e o data-testid de hoje', async () => {
    const { scope } = renderModal({ nonWinner: true });
    const aviso = scope.getByTestId('po-nonwinner-notice');
    expect(aviso.className).toContain('cmp-po-aviso--atencao');
    expect(aviso.className).toContain('cmp-po-nonwinner-notice');
    expect(aviso.querySelector(':scope > svg[aria-hidden="true"]')).not.toBeNull();
    expect(aviso.textContent).toBe('Esta proposta não é a vencedora da cotação. A vencedora continua a mesma.');
    await waitFor(() => expect(listForwarders).toHaveBeenCalled());
  });

  it('sem nonWinner nao ha o aviso; via parceiro o aviso e de informacao com icone e role=status e o texto exato de hoje', async () => {
    const semAviso = renderModal();
    expect(semAviso.scope.queryByTestId('po-nonwinner-notice')).toBeNull();
    expect(semAviso.scope.queryByTestId('po-partner-notice')).toBeNull();
    semAviso.unmount();
    const { scope, dialog } = renderModal({ target: partnerTarget });
    const aviso = scope.getByTestId('po-partner-notice');
    expect(aviso.className).toContain('cmp-po-aviso--info');
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.querySelector(':scope > svg[aria-hidden="true"]')).not.toBeNull();
    expect(aviso.textContent).toBe('O fornecedor de origem não é copiado.');
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe(
      'Enviar Ordem de Compra ao parceiro [Banco Parceiro] — fornecedor [Fornecedor Demo 01]',
    );
    await waitFor(() => expect(listForwarders).toHaveBeenCalled());
  });

  it('destinatarios: Para/Cc em strong, "Equipe COMEX em copia (N)." em tom de apoio, sem estilo inline e com o textContent de hoje', async () => {
    const { scope } = renderModal();
    const caixa = await scope.findByTestId('po-recipients');
    await waitFor(() => expect(caixa.textContent).toContain('Para: [Contato Demo] <contato@exemplo.invalid>'));
    expect(caixa.textContent).toContain('Cc: [Copia Demo] <copia@exemplo.invalid>');
    expect(caixa.textContent).toContain('Equipe COMEX em cópia (2).');
    expect(Array.from(caixa.querySelectorAll('strong')).map((n) => n.textContent)).toEqual(['Para:', 'Cc:']);
    expect(caixa.querySelector('.cmp-po__destinatarios-caixa')).not.toBeNull();
    expect(caixa.querySelector('.cmp-po__linha--suave')?.textContent).toBe('Equipe COMEX em cópia (2).');
    expect(caixa.textContent).not.toContain('Contato sem nome');
    expect(inline(caixa)).toEqual([]);
  });

  it('contato sem nome: aparece so o e-mail e a nota "Contato sem nome: aparece só o e-mail."', async () => {
    vi.mocked(getPurchaseOrderRecipients).mockResolvedValue({
      to: { name: '', email: 'sem.nome@exemplo.invalid' },
      contactCc: [],
      comexCc: [],
      cc: [],
    });
    const { scope } = renderModal();
    const caixa = await scope.findByTestId('po-recipients');
    await waitFor(() => expect(caixa.textContent).toContain('Para: sem.nome@exemplo.invalid'));
    expect(caixa.textContent).toContain('Contato sem nome: aparece só o e-mail.');
    expect(caixa.textContent).not.toContain('<');
  });

  it('destinatarios carregando e com erro: o erro tem role=alert e icone (sem .alert: o guard do F3b so admite o aviso da aba Itens e da Nova cotacao); o botao de envio nao depende dele', async () => {
    vi.mocked(getPurchaseOrderRecipients).mockReturnValue(new Promise(() => undefined));
    const carregando = renderModal();
    expect((await carregando.scope.findByText('Carregando destinatários…')).className).toContain('cmp-po__destinatarios-estado');
    carregando.unmount();

    vi.mocked(getPurchaseOrderRecipients).mockRejectedValue(new Error('[tempo esgotado]'));
    const { scope } = renderModal();
    const erro = await scope.findByRole('alert');
    expect(erro.className).toContain('cmp-po__destinatarios-erro');
    expect(erro.querySelector(':scope > svg[aria-hidden="true"]')).not.toBeNull();
    expect(erro.textContent).toContain('Não foi possível carregar os destinatários: ');
    expect(erro.textContent).toContain('[tempo esgotado]');
    expect(inline(erro)).toEqual([]);
  });

  it('arquivo: botao "Escolher arquivo" + upload ligado ao #poFile (focavel e rotulado); "Selecionado: nome" num no e "(0,42 MB)" com virgula ao lado', async () => {
    const { scope, dialog } = renderModal();
    const input = scope.getByLabelText('PDF da Ordem de Compra') as HTMLInputElement;
    expect(input.id).toBe('poFile');
    expect(input.type).toBe('file');
    expect(input.accept).toBe('application/pdf');
    // sem arquivo: bloco tracejado com o icone de upload e a dica, sem o botao
    const bloco = dialog.querySelector('label.cmp-po__arquivo') as HTMLLabelElement;
    expect(bloco.htmlFor).toBe('poFile');
    expect(bloco.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(bloco.textContent).toContain('Nenhum arquivo selecionado');
    expect(bloco.textContent).toContain('Somente PDF, até 10 MB');
    expect(scope.queryByText('Escolher arquivo')).toBeNull();

    const file = new File([new Uint8Array(440_401)], 'po.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    const selecionado = await scope.findByText(/Selecionado: po\.pdf/);
    expect(selecionado.textContent).toBe('Selecionado: po.pdf');
    const linha = selecionado.closest('p') as HTMLElement;
    expect(linha.textContent).toBe('Selecionado: po.pdf (0,42 MB)');
    expect(linha.querySelector('.cmp-mono')?.textContent).toBe('0,42');
    expect(linha.textContent).not.toContain('0.42');
    const ok = dialog.querySelector('label.cmp-po__arquivo--ok') as HTMLElement;
    expect(ok).not.toBeNull();
    expect(ok.querySelector('.cmp-po__arquivo-nome')?.textContent).toBe('po.pdf');
    const botao = ok.querySelector('.cmp-po__arquivo-botao') as HTMLElement;
    expect(botao.textContent).toBe('Escolher arquivo');
    expect(botao.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(inline(dialog)).toEqual([]);
  });

  it('erro do arquivo (acima de 10 MB): aviso de erro com role=alert e icone, texto de hoje ("10MB")', async () => {
    const { scope } = renderModal();
    const grande = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' });
    fireEvent.change(scope.getByLabelText('PDF da Ordem de Compra'), { target: { files: [grande] } });
    const erro = await scope.findByRole('alert');
    expect(erro.className).toContain('cmp-po-aviso--erro');
    expect(erro.querySelector(':scope > svg[aria-hidden="true"]')).not.toBeNull();
    expect(erro.textContent).toBe('O PDF excede o limite de 10MB.');
  });

  it('forwarder e contato: campos sem estilo inline; dica de "Nenhum forwarder cadastrado" com o link; contador em mono; assinatura com o link', async () => {
    vi.mocked(listForwarders).mockResolvedValue([]);
    const { scope, dialog } = renderModal();
    const dica = await scope.findByText(/Nenhum forwarder cadastrado/);
    expect(dica.className).toContain('cmp-po__dica');
    expect(within(dica).getByRole('link', { name: 'Forwarders' }).getAttribute('href')).toBe('/forwarders');
    expect(scope.getByText('0/2000').className).toContain('cmp-po__contador');
    expect(scope.getByText(/Assinatura: definida em/).className).toContain('cmp-po__dica');
    expect(scope.getByRole('link', { name: 'Minha conta' }).getAttribute('href')).toBe('/minha-conta');
    for (const id of ['poSubject', 'poForwarderSelect', 'poForwarderInfo', 'poMessage']) {
      expect(dialog.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(scope.getByLabelText('Forwarder').className).toContain('input');
    expect(inline(dialog)).toEqual([]);
  });

  it('acao primaria "Enviar Ordem de Compra" com icone; nenhum [style] no modal inteiro', async () => {
    const { scope, dialog } = renderModal();
    const enviar = scope.getByRole('button', { name: 'Enviar Ordem de Compra' });
    expect(enviar.className).toContain('primary-button');
    expect(enviar.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect((enviar as HTMLButtonElement).disabled).toBe(true);
    expect(inline(dialog)).toEqual([]);
    await waitFor(() => expect(listForwarders).toHaveBeenCalled());
  });
});
