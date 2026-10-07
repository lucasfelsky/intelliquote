import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ItensTab, type ItensTabItem } from './ItensTab';

vi.mock('@/components/useConfirm', () => ({ useConfirm: () => confirmMock }));
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/services/purchaseOrders', () => ({
  createPurchaseOrder: vi.fn().mockResolvedValue({}),
  renamePurchaseOrder: vi.fn().mockResolvedValue({}),
  reorderPurchaseOrders: vi.fn().mockResolvedValue([]),
  deletePurchaseOrder: vi.fn().mockResolvedValue({}),
  moveItemToPurchaseOrder: vi.fn().mockResolvedValue({}),
}));

import {
  createPurchaseOrder, deletePurchaseOrder, moveItemToPurchaseOrder,
} from '@/services/purchaseOrders';

const confirmMock = vi.fn(async (_opts?: unknown) => true);

const po = (id: number, position: number, label: string) => ({
  id, quoteRequestId: 9, label, position, createdAt: '', updatedAt: '',
});
const item = (id: number, name: string, purchaseOrderId: number | null): ItensTabItem => ({
  id, productName: name, quantity: 10, unit: 'KG', notes: null,
  desiredIncoterm: null, destinationPort: null, purchaseOrderId, catalogItem: null,
});

function renderTab(over: Partial<React.ComponentProps<typeof ItensTab>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ItensTab
        quoteRequestId={9}
        status="open"
        canEdit
        items={[]}
        purchaseOrders={[]}
        defaultIncoterm="FOB"
        defaultPort="Itapoá"
        hasResponsesOrDispatch={false}
        onAddItem={vi.fn()}
        onEditItem={vi.fn()}
        onRemoveItem={vi.fn()}
        {...over}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
});

describe('ItensTab', () => {
  it('cotação sem PO renderiza tabela única sem grupos', () => {
    renderTab({ items: [item(1, 'Resina A', null)] });
    expect(screen.getByText('Resina A')).toBeTruthy();
    expect(screen.queryByText('Sem PO')).toBeNull();
    expect(screen.queryByLabelText('Mover para PO')).toBeNull();
  });

  it('renderiza grupos na ordem de position e "Sem PO"', () => {
    renderTab({
      purchaseOrders: [po(2, 2, 'PO B'), po(1, 1, 'PO A')],
      items: [item(1, 'Resina A', 1), item(2, 'Resina B', 2), item(3, 'Solta', null)],
    });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe('PO A');
    expect(headings[1]).toBe('PO B');
    expect(headings[2]).toContain('Sem PO');
    expect(within(screen.getByTestId('po-group-none')).getByText('Solta')).toBeTruthy();
  });

  it('adicionar PO sem PO existente adota itens sem PO', async () => {
    renderTab({ items: [item(1, 'Resina A', null)] });
    fireEvent.click(screen.getByText('+ Adicionar PO'));
    await waitFor(() =>
      expect(createPurchaseOrder).toHaveBeenCalledWith(9, { adoptUnassigned: true }));
  });

  it('adicionar PO com POs existentes não adota itens', async () => {
    renderTab({ purchaseOrders: [po(1, 1, 'PO 1')], items: [item(1, 'A', 1)] });
    fireEvent.click(screen.getByText('+ Adicionar PO'));
    await waitFor(() =>
      expect(createPurchaseOrder).toHaveBeenCalledWith(9, { adoptUnassigned: false }));
  });

  it('remover PO confirma informando a PO anterior e chama DELETE', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1), item(2, 'B', 2)],
    });
    fireEvent.click(screen.getByLabelText('Remover PO PO 2'));
    await waitFor(() => expect(deletePurchaseOrder).toHaveBeenCalledWith(2));
    const arg = confirmMock.mock.calls[0]?.[0] as { message: string };
    expect(arg.message).toContain('PO anterior');
    expect(arg.message).toContain('PO 1');
  });

  it('remover a primeira PO informa que os itens vão para a próxima', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1), item(2, 'B', 2)],
    });
    fireEvent.click(screen.getByLabelText('Remover PO PO 1'));
    await waitFor(() => expect(deletePurchaseOrder).toHaveBeenCalledWith(1));
    const arg = confirmMock.mock.calls[0]?.[0] as { message: string };
    expect(arg.message).toContain('próxima PO');
    expect(arg.message).toContain('PO 2');
    expect(arg.message).not.toContain('PO anterior');
  });

  it('remover PO não chama DELETE se o usuário cancelar', async () => {
    confirmMock.mockResolvedValue(false);
    renderTab({ purchaseOrders: [po(1, 1, 'PO 1')], items: [item(1, 'A', 1)] });
    fireEvent.click(screen.getByLabelText('Remover PO PO 1'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deletePurchaseOrder).not.toHaveBeenCalled();
  });

  it('modo agrupado não tem select "Mover para PO" e mantém Editar/Remover', () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1), item(2, 'B', null)],
    });
    expect(screen.queryByLabelText('Mover para PO')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const row = within(screen.getByTestId('item-row-1'));
    expect(row.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Remover' })).toBeTruthy();
    const unassignedRow = within(screen.getByTestId('item-row-2'));
    expect(unassignedRow.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(unassignedRow.getByRole('button', { name: 'Remover' })).toBeTruthy();
  });

  it('arrastar e soltar item em outro grupo move o item', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => { store[k] = v; },
      getData: (k: string) => store[k] ?? '',
      effectAllowed: '',
    };
    fireEvent.dragStart(screen.getByTestId('item-row-1'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('drop-2'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('drop-2'), { dataTransfer });
    await waitFor(() => expect(moveItemToPurchaseOrder).toHaveBeenCalledWith(1, 2));
  });

  it('cotação closed fica somente leitura', () => {
    renderTab({
      status: 'closed',
      purchaseOrders: [po(1, 1, 'PO 1')],
      items: [item(1, 'A', 1)],
    });
    expect(screen.queryByText('+ Adicionar PO')).toBeNull();
    expect(screen.queryByLabelText('Mover para PO')).toBeNull();
    expect(screen.queryByText('Remover PO')).toBeNull();
  });

  it('com PO e envio/respostas mostra o aviso de reagrupamento', () => {
    renderTab({
      hasResponsesOrDispatch: true,
      purchaseOrders: [po(1, 1, 'PO 1')],
      items: [item(1, 'A', 1)],
    });
    expect(screen.getByText(/reagrupar POs não altera/)).toBeTruthy();
  });

  it('modo legado (sem PO) não mostra o aviso mesmo com envio', () => {
    renderTab({ hasResponsesOrDispatch: true, items: [item(1, 'A', null)] });
    expect(screen.queryByText(/reagrupar POs não altera/)).toBeNull();
  });
});
