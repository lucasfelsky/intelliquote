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

const families = [
  { id: 1, name: 'Silano', isActive: true },
  { id: 2, name: 'Resina', isActive: true },
];

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
    families: [{ id: 1, name: 'Silano' }],
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
      if (url === '/api/v1/item-families') {
        return Promise.resolve({ data: families });
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

  it('13. familias — "Editar" pré-marca os chips vinculados e "Novo fornecedor" abre sem nenhum marcado', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    let dialog = dialogAt(container, 1);
    await waitFor(() => {
      expect(within(dialog).getByText('Silano').className).toContain('chip--active');
    });
    expect(within(dialog).getByText('Resina').className).not.toContain('chip--active');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    dialog = dialogAt(container, 1);
    await waitFor(() => {
      expect(within(dialog).getByText('Silano')).toBeTruthy();
    });
    expect(within(dialog).getByText('Silano').className).not.toContain('chip--active');
    expect(within(dialog).getByText('Resina').className).not.toContain('chip--active');
  });

  it('14. familias — clicar num chip inclui o id em familyIds no payload de create', async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: 30,
      name: 'Fornecedor Chip',
      acceptedIncoterms: ['FOB'],
      tags: [],
      families: [{ id: 2, name: 'Resina' }],
    });

    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    const dialog = dialogAt(container, 1);
    await waitFor(() => {
      expect(within(dialog).getByText('Resina')).toBeTruthy();
    });

    fireEvent.change(dialog.querySelector('#name') as HTMLInputElement, {
      target: { value: 'Fornecedor Chip' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'FOB' }));
    fireEvent.click(within(dialog).getByText('Resina'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls[0]?.[1] as { familyIds?: number[] };
    expect(payload.familyIds).toEqual([2]);
  });

  const ALL_INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

  function mockSupplierWithAllIncoterms() {
    const allSupplier = { ...suppliers[0], acceptedIncoterms: ALL_INCOTERMS };
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/api/v1/suppliers') return Promise.resolve([allSupplier]);
      if (url === '/api/v1/supplier-contacts') {
        return Promise.resolve({ bySupplier: { 10: contacts } });
      }
      if (url === '/api/v1/item-families') {
        return Promise.resolve({ data: families });
      }
      return Promise.resolve([]);
    });
  }

  it('15. incoterms — fornecedor com os 11 mostra "Todos" na lista e abre sem chip marcado + dica', async () => {
    mockSupplierWithAllIncoterms();
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    expect(await findByText('Todos')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const dialog = dialogAt(container, 1);
    for (const term of ALL_INCOTERMS) {
      expect(within(dialog).getByRole('button', { name: term }).className).not.toContain('chip--active');
    }
    expect(within(dialog).getByText('Nenhum selecionado = todos os Incoterms.')).toBeTruthy();
  });

  it('16. incoterms — a partir do estado "todos", clicar CIF seleciona só CIF e o PUT envia ["CIF"]', async () => {
    mockSupplierWithAllIncoterms();
    vi.mocked(api.put).mockResolvedValue({});
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const dialog = dialogAt(container, 1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'CIF' }));
    for (const term of ALL_INCOTERMS) {
      const className = within(dialog).getByRole('button', { name: term }).className;
      if (term === 'CIF') expect(className).toContain('chip--active');
      else expect(className).not.toContain('chip--active');
    }

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const payload = vi.mocked(api.put).mock.calls[0]?.[1] as { acceptedIncoterms?: string[] };
    expect(payload.acceptedIncoterms).toEqual(['CIF']);
  });

  it('17. incoterms — cadastrar sem chip não bloqueia e o POST envia []', async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: 31,
      name: 'Fornecedor Sem Incoterm',
      acceptedIncoterms: ALL_INCOTERMS,
      tags: [],
      families: [],
    });
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: '+ Novo fornecedor' }));
    const dialog = dialogAt(container, 1);

    fireEvent.change(dialog.querySelector('#name') as HTMLInputElement, {
      target: { value: 'Fornecedor Sem Incoterm' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls[0]?.[1] as { acceptedIncoterms?: string[] };
    expect(payload.acceptedIncoterms).toEqual([]);
    expect(within(dialog).queryByText('Selecione pelo menos um Incoterm aceito.')).toBeNull();
  });

  it('18. incoterms — desmarcar o último chip volta ao estado "todos" e o PUT envia []', async () => {
    vi.mocked(api.put).mockResolvedValue({});
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');

    fireEvent.click(getByRole('button', { name: 'Editar' }));
    const dialog = dialogAt(container, 1);
    expect(within(dialog).getByRole('button', { name: 'FOB' }).className).toContain('chip--active');
    fireEvent.click(within(dialog).getByRole('button', { name: 'FOB' }));
    for (const term of ALL_INCOTERMS) {
      expect(within(dialog).getByRole('button', { name: term }).className).not.toContain('chip--active');
    }

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const payload = vi.mocked(api.put).mock.calls[0]?.[1] as { acceptedIncoterms?: string[] };
    expect(payload.acceptedIncoterms).toEqual([]);
  });
});

describe('Fornecedores — importação de planilha', () => {
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
      if (url === '/api/v1/item-families') {
        return Promise.resolve({ data: families });
      }
      if (url === '/v1/suppliers/import/template') {
        return Promise.resolve({
          data: { fileName: 'modelo-importacao-fornecedores.xlsx', contentBase64: 'AAAA' },
        });
      }
      return Promise.resolve([]);
    });

    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = vi.fn(
        () => 'blob:mock',
      );
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }
  });

  it('a. "Importar planilha" abre dialog com título "Importar fornecedores"', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Importar planilha' }));
    await waitFor(() => expect(getDialogs(container).length).toBe(3));
    const dialog = dialogAt(container, 2);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('.modal-header h2')?.textContent).toBe('Importar fornecedores');
  });

  it('b. selecionar .xlsx e "Carregar e validar" chama preview e mostra a contagem + "Linha 3"', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        validLines: [{ row: 2, name: 'Fornecedor Novo', familyNames: [] }],
        errorLines: [{ row: 3, name: 'Fornecedor Ruim', reason: 'Nome é obrigatório' }],
      },
    });

    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Importar planilha' }));
    await waitFor(() => expect(getDialogs(container).length).toBe(3));
    const dialog = dialogAt(container, 2);

    const file = new File(['conteudo'], 'fornecedores.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Carregar e validar' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/suppliers/import', {
        contentBase64: expect.any(String),
      }),
    );
    await waitFor(() => {
      expect(dialog.textContent).toContain('Linha 3');
      expect(dialog.textContent).toContain('Fornecedor Ruim');
      expect(dialog.textContent).toContain('Nome é obrigatório');
    });
  });

  it('c. "Confirmar importação" chama confirm sem familyNames e mostra o resultado', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/v1/suppliers/import') {
        return Promise.resolve({
          data: {
            validLines: [
              { row: 2, name: 'Fornecedor Novo', familyNames: ['Silano'], familyIds: [1] },
            ],
            errorLines: [],
          },
        });
      }
      if (url === '/v1/suppliers/import/confirm') {
        return Promise.resolve({
          data: {
            successLines: [{ row: 2, supplierId: 99, name: 'Fornecedor Novo' }],
            errorLines: [],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Importar planilha' }));
    await waitFor(() => expect(getDialogs(container).length).toBe(3));
    const dialog = dialogAt(container, 2);

    const file = new File(['conteudo'], 'fornecedores.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Carregar e validar' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/suppliers/import', expect.anything()));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Confirmar importação' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/suppliers/import/confirm', {
        rows: [{ row: 2, data: { name: 'Fornecedor Novo', familyIds: [1] } }],
      }),
    );
    await within(dialog).findByText('fornecedores importados com sucesso.', { exact: false });
  });

  it('e. não fecha pelo "Fechar" enquanto o confirm está em andamento', async () => {
    let resolveConfirm: (value: unknown) => void = () => {};
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/v1/suppliers/import') {
        return Promise.resolve({
          data: {
            validLines: [{ row: 2, name: 'Fornecedor Novo', familyNames: [], familyIds: [] }],
            errorLines: [],
          },
        });
      }
      if (url === '/v1/suppliers/import/confirm') {
        return new Promise((resolve) => {
          resolveConfirm = resolve;
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Importar planilha' }));
    await waitFor(() => expect(getDialogs(container).length).toBe(3));
    const dialog = dialogAt(container, 2);

    const file = new File(['conteudo'], 'fornecedores.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Carregar e validar' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Confirmar importação' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/suppliers/import/confirm', expect.anything()),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(getDialogs(container).length).toBe(3);

    resolveConfirm({
      data: { successLines: [{ row: 2, supplierId: 99, name: 'Fornecedor Novo' }], errorLines: [] },
    });
    await within(dialog).findByText('fornecedores importados com sucesso.', { exact: false });
  });

  it('d. "Baixar modelo" chama o template com createObjectURL/revokeObjectURL', async () => {
    const { container, findByText, getByRole } = renderPage();
    await findByText('ACME Ltda');
    fireEvent.click(getByRole('button', { name: 'Importar planilha' }));
    await waitFor(() => expect(getDialogs(container).length).toBe(3));
    const dialog = dialogAt(container, 2);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Baixar modelo' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/v1/suppliers/import/template'),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
  });
});
