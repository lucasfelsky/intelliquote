import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Fornecedores from './Fornecedores';

vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/services/dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dispatch')>()),
  listSupplierContacts: vi.fn(),
  createSupplierContact: vi.fn(),
  updateSupplierContact: vi.fn(),
  deleteSupplierContact: vi.fn(),
}));

import { api } from '@/api/client';
import { listSupplierContacts } from '@/services/dispatch';

const suppliers = [
  {
    id: 10,
    name: 'ACME Ltda',
    website: null,
    status: 'active',
    country: 'CN',
    notes: null,
    acceptedIncoterms: ['FOB'],
    paymentTermsDays: 30,
    tags: ['confiável'],
    reviewStats: null,
  },
];

const contacts = [
  {
    id: 5,
    supplierId: 10,
    name: 'Contato Um',
    email: 'c@acme.com',
    phone: null,
    position: null,
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Fornecedores />
    </QueryClientProvider>
  );
}

function getDialogs(container: HTMLElement): HTMLDialogElement[] {
  return Array.from(container.querySelectorAll('dialog'));
}

function dialogAt(container: HTMLElement, index: number): HTMLDialogElement {
  const dialog = getDialogs(container)[index];
  if (!dialog) throw new Error(`dialog[${index}] não encontrado no container`);
  return dialog;
}

async function expandContacts(getByLabelText: any) {
  await waitFor(() => {
    const button = getByLabelText('Mostrar contatos') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
  fireEvent.click(getByLabelText('Mostrar contatos'));
}

describe('Fornecedores', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.del).mockReset();
    vi.mocked(listSupplierContacts).mockReset();
    vi.mocked(listSupplierContacts).mockResolvedValue(contacts);
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/v1/suppliers') return Promise.resolve(suppliers);
      if (url === '/api/v1/supplier-contacts') {
        return Promise.resolve({ bySupplier: { 10: contacts } });
      }
      return Promise.resolve([]);
    });
  });

  it('1. load: existem 2 dialogs e ambos com open === false', async () => {
    const { container, findByText } = renderPage();
    await findByText('ACME Ltda');
    expect(getDialogs(container).length).toBe(2);
    expect(dialogAt(container, 0).open).toBe(false);
    expect(dialogAt(container, 1).open).toBe(false);
  });

  it('2. "+ Novo fornecedor" abre só o índice 1 (fornecedor)', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    expect(dialogAt(container, 1).open).toBe(true);
    expect(dialogAt(container, 0).open).toBe(false);
    expect(dialogAt(container, 1).querySelector('.modal-header h2')?.textContent).toBe('Novo fornecedor');
  });

  it('3. "Editar" na linha do fornecedor: título "Editar fornecedor" e #name preenchido', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Editar' }));
    expect(dialogAt(container, 1).querySelector('.modal-header h2')?.textContent).toBe('Editar fornecedor');
    const nameInput = container.querySelector('#name') as HTMLInputElement;
    expect(nameInput.value).toBe('ACME Ltda');
  });

  it('4. tamanho default do modal de fornecedor: contém modal-dialog e não modal-dialog--wide', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    const dialog = dialogAt(container, 1);
    expect(dialog.className).toContain('modal-dialog');
    expect(dialog.className).not.toContain('modal-dialog--wide');
  });

  it('5. "Cancelar" no modal de fornecedor fecha e não chama api.post', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    const dialog = dialogAt(container, 1);
    expect(dialog.open).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog.open).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('6. sem título duplicado: modal de fornecedor aberto tem só 1 h2 escopado nele', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    const dialog = dialogAt(container, 1);
    expect(dialog.querySelectorAll('h2').length).toBe(1);
    expect(dialog.querySelector('.modal-body h2')).toBeNull();
  });

  it('7. guard de null: no load, dialog de contato não mostra "Fornecedor #" e não há #contactName no DOM', async () => {
    const { container, findByText } = renderPage();
    await findByText('ACME Ltda');
    const body = dialogAt(container, 0).querySelector('.modal-body')?.textContent ?? '';
    expect(body).not.toContain('Fornecedor #');
    expect(container.querySelector('#contactName')).toBeNull();
  });

  it('8. contato — abrir: "+ Adicionar contato" abre índice 0 com o nome real do fornecedor', async () => {
    const { container, findByText, getByRole, getByLabelText } = renderPage();
    await findByText('ACME Ltda');
    await expandContacts(getByLabelText);
    await waitFor(() => expect(listSupplierContacts).toHaveBeenCalled());
    fireEvent.click(getByRole('button', { name: '+ Adicionar contato' }));
    const dialog = dialogAt(container, 0);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Novo contato');
    expect(dialog.querySelector('.modal-body')?.textContent).toContain('ACME Ltda');
  });

  it('9. contato — título de edição: "Editar contato" e #contactName preenchido', async () => {
    const { container, findByText, getByLabelText, getAllByRole } = renderPage();
    await findByText('ACME Ltda');
    await expandContacts(getByLabelText);
    await findByText('Contato Um');
    const editButtons = getAllByRole('button', { name: 'Editar' });
    const lastEditButton = editButtons[editButtons.length - 1];
    if (!lastEditButton) throw new Error('botão Editar do contato não encontrado');
    fireEvent.click(lastEditButton);
    expect(dialogAt(container, 0).querySelector('.modal-header h2')?.textContent).toBe('Editar contato');
    const contactNameInput = container.querySelector('#contactName') as HTMLInputElement;
    expect(contactNameInput.value).toBe('Contato Um');
  });

  it('10. contato — botão × fecha o modal de contato', async () => {
    const { container, findByText, getByRole, getByLabelText, getAllByLabelText } = renderPage();
    await findByText('ACME Ltda');
    await expandContacts(getByLabelText);
    await findByText('Contato Um');
    fireEvent.click(getByRole('button', { name: '+ Adicionar contato' }));
    const dialog = dialogAt(container, 0);
    expect(dialog.open).toBe(true);
    const closeButtons = getAllByLabelText('Fechar');
    const firstCloseButton = closeButtons[0];
    if (!firstCloseButton) throw new Error('botão Fechar não encontrado');
    fireEvent.click(firstCloseButton);
    expect(dialog.open).toBe(false);
  });

  it('11. coluna de acoes nao quebra: .row-actions tem a variante --nowrap', async () => {
    const { container, findByText } = renderPage();
    await findByText('ACME Ltda');
    const rowActions = container.querySelectorAll('.row-actions');
    expect(rowActions.length).toBe(1);
    expect(rowActions[0]?.classList.contains('row-actions--nowrap')).toBe(true);
    expect(container.querySelector('.row-actions')?.querySelectorAll('button').length).toBe(2);
  });

  it('12. contato principal: célula tem .cell-truncate, mostra só o nome e o title traz nome+e-mail', async () => {
    const { container, findByText } = renderPage();
    await findByText('ACME Ltda');
    await findByText('Contato Um');
    const cell = container.querySelector('td.cell-truncate');
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toBe('Contato Um');
    expect(cell?.getAttribute('title')).toBe('Contato Um <c@acme.com>');
  });
});
