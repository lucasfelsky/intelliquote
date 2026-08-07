import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmProvider } from '@/components/useConfirm';
import CotacaoDetalhe from './CotacaoDetalhe';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', email: 'a@b.c', role: 'admin' } }),
}));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/services/dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/dispatch')>();
  return {
    ...actual,
    previewDispatch: vi.fn(),
    sendDispatch: vi.fn(),
    listPortalTokens: vi.fn(),
    generatePortalTokens: vi.fn(),
    revokePortalToken: vi.fn(),
  };
});

import { api } from '@/api/client';
import {
  previewDispatch,
  sendDispatch,
  listPortalTokens,
  revokePortalToken,
  type DispatchPreviewResult,
  type DispatchSendResult,
  type PortalTokenListItem,
} from '@/services/dispatch';

const quoteFixture = {
  id: 1,
  requestCode: 'RFQ-001',
  productName: 'Produto X',
  quantity: 100,
  description: 'Descricao da cotacao',
  desiredIncoterm: ['FOB'],
  destinationPort: 'Santos',
  originPort: 'Shanghai',
  currency: 'USD',
  deadlineAt: null,
  status: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  createdById: 1,
  items: [
    {
      id: 10,
      quoteRequestId: 1,
      itemCode: null,
      productName: 'Produto X',
      description: null,
      quantity: 50,
      unit: 'KG',
      targetPrice: null,
      notes: null,
      desiredIncoterm: null,
      destinationPort: null,
      catalogItemId: 3,
      catalogItem: {
        id: 3,
        commercialName: 'Produto X',
        marketName: 'PX',
        isDangerousGood: false,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  quoteResponses: [],
};

const getImpl = async (path: string): Promise<unknown> => {
  if (path.startsWith('/v1/quote-requests/')) return quoteFixture;
  if (path === '/api/v1/company-profile') return { dispatchCc: [] };
  if (path === '/v1/suppliers') return [{ id: 5, name: 'ACME Ltda', status: 'active' }];
  if (path === '/v1/supplier-contacts') {
    return { bySupplier: { '5': [{ id: 10, name: 'Contato', email: 'c@acme.com', isPrimary: true }] } };
  }
  if (path === '/v1/catalog-items') {
    return [{ id: 3, commercialName: 'Produto X', marketName: 'PX', isDangerousGood: false, isActive: true }];
  }
  return [];
};

const previewFixture: DispatchPreviewResult = {
  recipientCount: 1,
  recipients: [
    {
      supplierContactId: 10,
      supplierId: 5,
      supplierName: 'ACME Ltda',
      contactName: 'Contato',
      contactEmail: 'c@acme.com',
      ccCount: 0,
      cc: [],
    },
  ],
  preview: { subject: 'Assunto teste', html: '<p>oi</p>', text: 'oi' },
  cc: [],
  companyCc: [],
};

const sendFixture: DispatchSendResult = {
  dispatchEventId: 1,
  status: 'completed',
  recipientsCount: 1,
  sentCount: 1,
  failedCount: 0,
  results: [{ supplierContactId: 10, status: 'sent', dispatchEventId: 1 }],
};

const tokenFixture: PortalTokenListItem = {
  id: 99,
  supplier: { id: 5, name: 'ACME Ltda' },
  contact: { id: 10, name: 'Contato', email: 'c@acme.com' },
  token: 'abc123',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revokedAt: null,
  firstSeenAt: null,
  lastSeenAt: null,
  accessCount: 0,
  respondedAt: null,
  createdAt: new Date().toISOString(),
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cotacoes/1']}>
        <ConfirmProvider>
          <Routes>
            <Route path="/cotacoes/:id" element={<CotacaoDetalhe />} />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function dialogByTitle(container: HTMLElement, title: string): HTMLDialogElement {
  const found = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog')).find(
    (d) => d.querySelector('.modal-header h2')?.textContent === title,
  );
  if (!found) throw new Error(`dialog "${title}" não encontrado`);
  return found;
}

async function openDispatchToPreview(container: HTMLElement, getByRole: ReturnType<typeof render>['getByRole']) {
  fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
  const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
  await waitFor(() => within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
  await waitFor(() => within(dialog).getByLabelText('Assunto'));
  return dialog;
}

describe('CotacaoDetalhe', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(api.get).mockImplementation(getImpl as typeof api.get);

    vi.mocked(previewDispatch).mockReset();
    vi.mocked(sendDispatch).mockReset();
    vi.mocked(listPortalTokens).mockReset();
    vi.mocked(revokePortalToken).mockReset();

    vi.mocked(previewDispatch).mockResolvedValue(previewFixture);
    vi.mocked(sendDispatch).mockResolvedValue(sendFixture);
    vi.mocked(listPortalTokens).mockResolvedValue([]);
    vi.mocked(revokePortalToken).mockResolvedValue({ ok: true });
  });

  it('1. load limpo: 5 dialogs no container, os 4 da página fechados', async () => {
    const { container, findByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelectorAll('dialog').length).toBe(5);
    for (const title of [
      'Enviar cotação para fornecedores',
      'Links do portal',
      'Novo item',
      'Editar cotação',
    ]) {
      expect(dialogByTitle(container, title).open).toBe(false);
    }
  });

  it('2. Modal C abre pela aba Itens: título "Novo item", tamanho default, sem título duplicado', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    expect(dialog.open).toBe(true);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).not.toContain('modal-dialog--wide');
    expect(dialog.querySelectorAll('h2').length).toBe(1);
  });

  it('3. Modal C em edição: título dinâmico, catálogo desabilitado, quantidade preenchida', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    const table = getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Editar' }));
    const dialog = dialogByTitle(container, 'Editar item');
    expect(dialog.open).toBe(true);
    const catalogSelect = within(dialog).getByLabelText('Item do catálogo *') as HTMLSelectElement;
    expect(catalogSelect.disabled).toBe(true);
    const qtyInput = within(dialog).getByLabelText('Quantidade *') as HTMLInputElement;
    expect(qtyInput.value).toBe('50');
  });

  it('4. Modal C cancela: fecha e não chama api.post', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('tab', { name: 'Itens' }));
    fireEvent.click(getByRole('button', { name: '+ Adicionar item' }));
    const dialog = dialogByTitle(container, 'Novo item');
    expect(dialog.open).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog.open).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('5. Guard do Modal D: #qrCurrency ausente no load, presente após abrir "Editar"', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelector('#qrCurrency')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const currencyInput = container.querySelector('#qrCurrency') as HTMLInputElement | null;
    expect(currencyInput).not.toBeNull();
    expect(currencyInput?.value).toBe('USD');
  });

  it('6. Modal D fecha e limpa editForm: × fecha o dialog e remove #qrCurrency do DOM', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const dialog = dialogByTitle(container, 'Editar cotação');
    expect(dialog.open).toBe(true);
    fireEvent.click(within(dialog).getByLabelText('Fechar'));
    expect(dialog.open).toBe(false);
    expect(container.querySelector('#qrCurrency')).toBeNull();
  });

  it('7. Modal A abre wide, com subtítulo e h2 único', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
    const dialog = dialogByTitle(container, 'Enviar cotação para fornecedores');
    expect(dialog.open).toBe(true);
    expect(dialog.className).toContain('modal-dialog--wide');
    expect(dialog.textContent).toContain('RFQ-001');
    expect(dialog.textContent).toContain('Produto X');
    expect(dialog.querySelectorAll('h2').length).toBe(1);
  });

  it('8. Guard do Modal A: .dispatcher-list ausente no load, presente com o dispatch aberto', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    expect(container.querySelector('.dispatcher-list')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Enviar cotacao' }));
    await waitFor(() => expect(container.querySelector('.dispatcher-list')).not.toBeNull());
  });

  it('9. fluxo select -> preview: previewDispatch chamado com o contato selecionado', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dialog = await openDispatchToPreview(container, getByRole);
    expect(previewDispatch).toHaveBeenCalledWith(1, [10]);
    const subjectInput = within(dialog).getByLabelText('Assunto') as HTMLInputElement;
    expect(subjectInput.value).toBe('Assunto teste');
  });

  it('10. EMPILHAMENTO Dispatch + Tokens: os dois dialogs abertos ao mesmo tempo', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dispatchDialog = await openDispatchToPreview(container, getByRole);

    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Enviar agora' }));
    const confirmDialog = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmDialog.open).toBe(true));
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(sendDispatch).toHaveBeenCalledWith(1, [10], {
        subject: 'Assunto teste',
        message: '',
        expiresInDays: 7,
      }),
    );

    await waitFor(() => within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));
    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));

    const tokensDialog = dialogByTitle(container, 'Links do portal');
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);
    await waitFor(() => expect(listPortalTokens).toHaveBeenCalledWith(1));
  });

  it('11. EMPILHAMENTO triplo + confirm() de dentro do modal de cima', async () => {
    vi.mocked(listPortalTokens).mockResolvedValue([tokenFixture]);

    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dispatchDialog = await openDispatchToPreview(container, getByRole);

    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Enviar agora' }));
    const confirmDialog = dialogByTitle(container, 'Confirmar ação');
    await waitFor(() => expect(confirmDialog.open).toBe(true));
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(sendDispatch).toHaveBeenCalled());

    await waitFor(() => within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));
    fireEvent.click(within(dispatchDialog).getByRole('button', { name: 'Gerenciar links' }));
    const tokensDialog = dialogByTitle(container, 'Links do portal');
    await waitFor(() => expect(listPortalTokens).toHaveBeenCalledWith(1));

    await waitFor(() => within(tokensDialog).getByRole('button', { name: 'Revogar' }));
    fireEvent.click(within(tokensDialog).getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(confirmDialog.open).toBe(true));
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(revokePortalToken).toHaveBeenCalledWith(99));
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);
  });

  it('12. #tokensExpires controlado: reflete alteração feita em #dispatchExpires sem remontar', async () => {
    const { container, findByRole, getByRole } = renderPage();
    await findByRole('heading', { name: 'RFQ-001' });
    const dispatchDialog = await openDispatchToPreview(container, getByRole);

    fireEvent.click(getByRole('button', { name: 'Links do portal' }));
    const tokensDialog = dialogByTitle(container, 'Links do portal');
    expect(dispatchDialog.open).toBe(true);
    expect(tokensDialog.open).toBe(true);

    const tokensExpiresInput = within(tokensDialog).getByLabelText('Validade (dias)') as HTMLInputElement;
    expect(tokensExpiresInput.value).toBe('7');

    const dispatchExpiresInput = within(dispatchDialog).getByLabelText(
      'Validade do link (dias)',
    ) as HTMLInputElement;
    fireEvent.change(dispatchExpiresInput, { target: { value: '30' } });

    expect(tokensExpiresInput.value).toBe('30');
  });
});
