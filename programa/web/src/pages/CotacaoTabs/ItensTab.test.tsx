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
  createPurchaseOrder, deletePurchaseOrder, moveItemToPurchaseOrder, renamePurchaseOrder,
} from '@/services/purchaseOrders';

const confirmMock = vi.fn(async (_opts?: unknown) => true);

const po = (id: number, position: number, label: string) => ({
  id, quoteRequestId: 9, label, position, createdAt: '', updatedAt: '',
});
const item = (id: number, name: string, purchaseOrderId: number | null): ItensTabItem => ({
  id, productName: name, quantity: 10, unit: 'KG', notes: null,
  desiredIncoterm: null, destinationPort: null, purchaseOrderId, catalogItem: null,
});

type TabProps = React.ComponentProps<typeof ItensTab>;

function renderTab(over: Partial<TabProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (extra: Partial<TabProps> = {}) => (
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
        {...extra}
      />
    </QueryClientProvider>
  );
  const utils = render(ui());
  return { ...utils, rerenderTab: (extra: Partial<TabProps>) => utils.rerender(ui(extra)) };
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
    // tabela única: um só thead
    expect(document.querySelectorAll('thead')).toHaveLength(1);
    expect(screen.getByText('3 itens · 2 POs')).toBeTruthy();
  });

  it('modo simples: Agrupar por PO chama POST com group:true', async () => {
    renderTab({ items: [item(1, 'Resina A', null)] });
    expect(screen.queryByText('+ Adicionar PO')).toBeNull();
    fireEvent.click(screen.getByText('Agrupar por PO'));
    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalledWith(9, { group: true }));
  });

  it('modo agrupado: + Adicionar PO não adota itens', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    expect(screen.queryByText('Agrupar por PO')).toBeNull();
    fireEvent.click(screen.getByText('+ Adicionar PO'));
    await waitFor(() =>
      expect(createPurchaseOrder).toHaveBeenCalledWith(9, { adoptUnassigned: false }));
  });

  it('agrupar: a PO 2 aparece vazia, recebe o foco e o status é anunciado', async () => {
    const po1 = po(1, 1, 'PO 1');
    const po2 = po(2, 2, 'PO 2');
    vi.mocked(createPurchaseOrder).mockResolvedValueOnce({
      purchaseOrder: po2, purchaseOrders: [po1, po2], movedItemIds: [1],
    });
    const { rerenderTab } = renderTab({ items: [item(1, 'A', null)] });
    fireEvent.click(screen.getByText('Agrupar por PO'));
    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalled());
    rerenderTab({ purchaseOrders: [po1, po2], items: [item(1, 'A', 1)] });

    const group2 = await screen.findByTestId('po-group-2');
    expect(within(group2).getByText(/PO vazia\. Arraste itens para cá/)).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(group2).getByRole('heading', { level: 3 })));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Itens agrupados em “PO 1”. “PO 2” foi criada vazia.'));
  });

  it('remover PO (3 POs) confirma informando a PO anterior, em tom danger, e chama DELETE', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2'), po(3, 3, 'PO 3')],
      items: [item(1, 'A', 1), item(2, 'B', 2), item(3, 'C', 3)],
    });
    fireEvent.click(screen.getByLabelText('Remover PO PO 2'));
    await waitFor(() => expect(deletePurchaseOrder).toHaveBeenCalledWith(2));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    const arg = confirmMock.mock.calls[0]?.[0] as { message: string };
    expect(arg.message).toContain('PO anterior');
    expect(arg.message).toContain('PO 1');
  });

  it('remover a primeira PO (3 POs) informa que os itens vão para a próxima', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2'), po(3, 3, 'PO 3')],
      items: [item(1, 'A', 1), item(2, 'B', 2), item(3, 'C', 3)],
    });
    fireEvent.click(screen.getByLabelText('Remover PO PO 1'));
    await waitFor(() => expect(deletePurchaseOrder).toHaveBeenCalledWith(1));
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    const arg = confirmMock.mock.calls[0]?.[0] as { message: string };
    expect(arg.message).toContain('próxima PO');
    expect(arg.message).toContain('PO 2');
    expect(arg.message).not.toContain('PO anterior');
  });

  it('remover com 2 POs desfaz o agrupamento (caso C) e anuncia o resultado', async () => {
    vi.mocked(deletePurchaseOrder).mockResolvedValueOnce({
      deletedId: 2,
      reassignedToPurchaseOrderId: null,
      movedItemIds: [1, 2],
      dissolved: true,
      dissolvedPurchaseOrder: { id: 1, label: 'PO 1', position: 1 },
    });
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1), item(2, 'B', 2)],
    });
    fireEvent.click(screen.getByLabelText('Remover PO PO 2'));
    await waitFor(() => expect(deletePurchaseOrder).toHaveBeenCalledWith(2));
    const arg = confirmMock.mock.calls[0]?.[0] as {
      title: string; message: string; confirmText: string; tone: string;
    };
    expect(arg.title).toContain('desfazer o agrupamento');
    expect(arg.message).toContain('lista única');
    expect(arg.message).toContain('2 itens');
    expect(arg.message).toContain('“PO 1” também será removida');
    expect(arg.confirmText).toBe('Remover e desagrupar');
    expect(arg.tone).toBe('danger');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Agrupamento desfeito'));
  });

  it('remover PO não chama DELETE se o usuário cancelar', async () => {
    confirmMock.mockResolvedValue(false);
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    fireEvent.click(screen.getByLabelText('Remover PO PO 1'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deletePurchaseOrder).not.toHaveBeenCalled();
  });

  it('modo agrupado não tem select "Mover para PO" e mantém Editar/Mover/Remover', () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1), item(2, 'B', null)],
    });
    expect(screen.queryByLabelText('Mover para PO')).toBeNull();
    expect(screen.queryByText('Mover para PO')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const row = within(screen.getByTestId('item-row-1'));
    expect(row.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Mover' })).toBeTruthy();
    expect(row.getByRole('button', { name: 'Remover' })).toBeTruthy();
    const unassignedRow = within(screen.getByTestId('item-row-2'));
    expect(unassignedRow.getByRole('button', { name: 'Editar' })).toBeTruthy();
    expect(unassignedRow.getByRole('button', { name: 'Remover' })).toBeTruthy();
  });

  it('Mover abre o modal com rádios (sem combobox) e move o item para a PO escolhida', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    fireEvent.click(within(screen.getByTestId('item-row-1')).getByRole('button', { name: 'Mover' }));

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3); // PO 1 (atual), PO 2, Sem PO
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Mover para PO/)).toBeNull();
    const current = screen.getByRole('radio', { name: 'PO 1 (atual)' }) as HTMLInputElement;
    expect(current.disabled).toBe(true);
    const moveBtn = screen.getByRole('button', { name: 'Mover item' }) as HTMLButtonElement;
    expect(moveBtn.disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'PO 2' }));
    expect(moveBtn.disabled).toBe(false);
    fireEvent.click(moveBtn);
    await waitFor(() => expect(moveItemToPurchaseOrder).toHaveBeenCalledWith(1, 2));
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
    fireEvent.dragOver(screen.getByTestId('po-group-2'), { dataTransfer });
    expect(screen.getByTestId('po-group-2').className).toContain('po-group--drop-target');
    // o grupo de origem não vira alvo
    fireEvent.dragOver(screen.getByTestId('po-group-1'), { dataTransfer });
    expect(screen.getByTestId('po-group-1').className).not.toContain('po-group--drop-target');
    fireEvent.drop(screen.getByTestId('po-group-2'), { dataTransfer });
    await waitFor(() => expect(moveItemToPurchaseOrder).toHaveBeenCalledWith(1, 2));
  });

  it('cotação closed fica somente leitura', () => {
    renderTab({
      status: 'closed',
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    expect(screen.queryByText('+ Adicionar PO')).toBeNull();
    expect(screen.queryByText('Agrupar por PO')).toBeNull();
    expect(screen.queryByLabelText('Mover para PO')).toBeNull();
    expect(screen.queryByLabelText(/^Remover PO/)).toBeNull();
    expect(screen.queryByLabelText(/^Renomear/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mover' })).toBeNull();
    expect(screen.getByText('Nenhum item nesta PO.')).toBeTruthy();
  });

  it('com 2 POs e envio/respostas mostra o aviso de reagrupamento', () => {
    renderTab({
      hasResponsesOrDispatch: true,
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    expect(screen.getByText(/reagrupar POs não altera/)).toBeTruthy();
  });

  it('modo legado (sem PO) não mostra o aviso mesmo com envio', () => {
    renderTab({ hasResponsesOrDispatch: true, items: [item(1, 'A', null)] });
    expect(screen.queryByText(/reagrupar POs não altera/)).toBeNull();
  });

  it('1 PO no banco renderiza o modo simples (PO única não existe)', () => {
    renderTab({
      hasResponsesOrDispatch: true,
      purchaseOrders: [po(1, 1, 'PO 1')],
      items: [item(1, 'A', 1), item(2, 'B', null)],
    });
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(screen.queryByTestId('po-group-1')).toBeNull();
    expect(screen.queryByTestId('po-group-none')).toBeNull();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('Agrupar por PO')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mover' })).toBeNull();
    expect(screen.queryByText(/reagrupar POs não altera/)).toBeNull();
  });

  it('renomear: Esc cancela, devolve o foco ao lápis e não chama PATCH', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Renomear PO 1' }));
    const input = screen.getByLabelText('Rótulo da PO') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'XYZ' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Rótulo da PO')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Renomear PO 1' })));
    expect(renamePurchaseOrder).not.toHaveBeenCalled();
  });

  it('renomear: Enter salva uma única vez (Enter + blur não duplica o PATCH)', async () => {
    renderTab({
      purchaseOrders: [po(1, 1, 'PO 1'), po(2, 2, 'PO 2')],
      items: [item(1, 'A', 1)],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Renomear PO 1' }));
    const input = screen.getByLabelText('Rótulo da PO');
    fireEvent.change(input, { target: { value: '4500012345' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => expect(renamePurchaseOrder).toHaveBeenCalledTimes(1));
    expect(renamePurchaseOrder).toHaveBeenCalledWith(1, '4500012345');
  });
});
