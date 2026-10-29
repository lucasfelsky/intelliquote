import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ICONS } from '@/components/icons';
import { ItensTab, type ItensTabItem } from './ItensTab';

// F6 (Suite COMEX, mock v68: CotacaoItens): a aba Itens usa os icones do icons.tsx (os do board), "Adicionar item"/"Adicionar PO" com
// icone no lugar do "+", aviso alert--info, selo DG com ponto e a tabela de PO no contorno do board. Dados 100% ficticios.

vi.mock('@/components/useConfirm', () => ({ useConfirm: () => async () => true }));
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

const po = (id: number, position: number, label: string) => ({
  id,
  quoteRequestId: 9,
  label,
  position,
  createdAt: '',
  updatedAt: '',
});
const item = (id: number, name: string, purchaseOrderId: number | null): ItensTabItem => ({
  id,
  productName: name,
  quantity: 1000,
  unit: 'KG',
  notes: null,
  desiredIncoterm: null,
  destinationPort: null,
  purchaseOrderId,
  catalogItem: { commercialName: name, marketName: `${name} (mercado)` },
});

type TabProps = React.ComponentProps<typeof ItensTab>;

function renderTab(over: Partial<TabProps> = {}) {
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
        defaultPort="Porto Ficticio"
        hasResponsesOrDispatch={false}
        onAddItem={vi.fn()}
        onEditItem={vi.fn()}
        onRemoveItem={vi.fn()}
        {...over}
      />
    </QueryClientProvider>,
  );
}

const agrupado = (over: Partial<TabProps> = {}) =>
  renderTab({
    purchaseOrders: [po(1, 1, 'PO A'), po(2, 2, 'PO B'), po(3, 3, 'PO C')],
    items: [item(1, 'Resina A', 1), item(2, 'Resina B', 2), item(3, 'Solta', null)],
    dgCountByItemId: { 2: 2 },
    ...over,
  });

const caminhos = (raiz: ParentNode) => Array.from(raiz.querySelectorAll('svg path')).map((p) => p.getAttribute('d'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ItensTab (F6): icones, botoes e aviso', () => {
  it('as acoes do grupo usam os icones do icons.tsx (renomear, subir, descer, remover) e o ponto de pega, todos aria-hidden', () => {
    const { container } = agrupado();
    const grupo = screen.getByTestId('po-group-1');
    const botoes = within(grupo).getAllByRole('button');
    const nomes = botoes.map((b) => b.getAttribute('aria-label')).filter(Boolean);
    expect(nomes).toEqual(['Renomear PO A', 'Subir PO A', 'Descer PO A', 'Remover PO PO A', 'Adicionar item em PO A']);
    const desenhos = botoes.slice(0, 4).map((b) => b.querySelector('svg')?.querySelector('path')?.getAttribute('d'));
    expect(desenhos).toEqual([ICONS.edit, ICONS['chevron-up'], ICONS['chevron-down'], ICONS.trash]);
    for (const svg of Array.from(container.querySelectorAll('svg'))) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(grupo.querySelector('.item-grip svg path')?.getAttribute('d')).toBe(ICONS.grip);
  });

  it('nenhum caminho dos SVGs antigos (lapis, lixeira, chevrons e grip do ItensTabIcons) sobrou na aba', () => {
    const { container } = agrupado({ hasResponsesOrDispatch: true });
    const antigos = ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z', 'M3 6h18', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'];
    const atuais = caminhos(container);
    for (const d of antigos) expect(atuais, d).not.toContain(d);
    expect(container.querySelector('svg circle, svg polyline, svg line')).toBeNull();
  });

  it('"Adicionar item" e "Adicionar PO" com icone plus no lugar do "+" do texto', () => {
    agrupado();
    const item = screen.getByRole('button', { name: 'Adicionar item' });
    const adicionarPo = screen.getByRole('button', { name: 'Adicionar PO' });
    expect(item.className).toBe('primary-button');
    expect(item.querySelector('svg path')?.getAttribute('d')).toBe(ICONS.plus);
    expect(adicionarPo.className).toBe('ghost-button');
    expect(adicionarPo.querySelector('svg path')?.getAttribute('d')).toBe(ICONS.plus);
    for (const botao of [item, adicionarPo, screen.getByRole('button', { name: 'Adicionar item em PO A' })]) {
      expect(botao.textContent, botao.getAttribute('aria-label') ?? '').not.toMatch(/\+/);
    }
    expect(screen.getByRole('button', { name: 'Adicionar item em PO A' }).querySelector('svg path')?.getAttribute('d')).toBe(ICONS.plus);
  });

  it('modo simples: "Agrupar por PO" sem icone e "Adicionar item" com icone', () => {
    renderTab({ items: [item(1, 'Resina A', null)] });
    expect(screen.getByRole('button', { name: 'Agrupar por PO' }).querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar item' }).querySelector('svg')).not.toBeNull();
  });

  it('aviso de reagrupamento: alert alert--info com o icone info do icons.tsx e role=note', () => {
    agrupado({ hasResponsesOrDispatch: true });
    const aviso = screen.getByRole('note');
    expect(aviso.className).toBe('alert alert--info itens-tab__notice');
    expect(aviso.querySelector(':scope > svg path')?.getAttribute('d')).toBe(ICONS.info);
    expect(aviso.textContent).toContain('reagrupar POs não altera');
  });

  it('zona de soltar ganha o icone download so quando e o alvo do arrasto; vazio sem itens com icone file-text', () => {
    const { container } = agrupado({ items: [item(1, 'Resina A', 1), item(3, 'Solta', null)] });
    expect(screen.getAllByText(/PO vazia\. Arraste itens/)[0]?.querySelector('svg')).toBeNull();
    fireEvent.dragStart(screen.getByTestId('item-row-1'));
    fireEvent.dragOver(screen.getByTestId('po-group-2'));
    const alvo = container.querySelector('.po-group--drop-target .po-drop-empty') as HTMLElement;
    expect(alvo.textContent).toBe('Soltar em “PO B”');
    expect(alvo.querySelector('svg path')?.getAttribute('d')).toBe(ICONS.download);
    renderTab({ items: [] });
    const vazio = screen.getByText('Nenhum item cadastrado').closest('.empty-state') as HTMLElement;
    expect(vazio.querySelector('.empty-state__icon svg path')?.getAttribute('d')).toBe(ICONS['file-text']);
  });
});

describe('ItensTab (F6): selo DG, tabela e estilo', () => {
  it('selo DG com ponto (badge--danger badge--dot) e o title de hoje', () => {
    agrupado();
    const selo = screen.getByTestId('item-row-2').querySelector('.badge--danger') as HTMLElement;
    expect(selo.className).toBe('badge badge--danger badge--dot');
    expect(selo.getAttribute('title')).toBe('Informado como DG por 2 fornecedores');
    expect(selo.textContent).toBe('DG');
  });

  it('a tabela de PO fica num .table-wrapper (o contorno do board vem do CSS) e as celulas tem as classes de tipografia', () => {
    const { container } = agrupado();
    expect(container.querySelectorAll('.table-wrapper.po-table-wrapper > table.table.po-table')).toHaveLength(1);
    const celulas = Array.from(screen.getByTestId('item-row-1').querySelectorAll('td'));
    expect(celulas[2]?.className).toBe('num');
    expect(celulas[3]?.className).toContain('po-cell-mono');
    expect(celulas[4]?.className).toContain('po-cell-mono');
    expect(celulas[1]?.className).toBe('po-cell-suave');
  });

  it('nenhum [style] na aba (agrupada, simples, vazia e somente leitura)', () => {
    const a = agrupado({ hasResponsesOrDispatch: true });
    expect(a.container.querySelectorAll('[style]')).toHaveLength(0);
    a.unmount();
    const b = renderTab({ items: [item(1, 'Resina A', null)] });
    expect(b.container.querySelectorAll('[style]')).toHaveLength(0);
    b.unmount();
    const c = renderTab({ items: [], status: 'closed' });
    expect(c.container.querySelectorAll('[style]')).toHaveLength(0);
    c.unmount();
    const d = agrupado({ canEdit: false });
    expect(d.container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('Mover (modal): rotulos de destino com o PO em mono e o texto "(atual)" preservado', () => {
    agrupado();
    fireEvent.click(within(screen.getByTestId('item-row-1')).getByRole('button', { name: 'Mover' }));
    const modal = document.querySelector('.move-item-modal') as HTMLElement;
    expect(modal.querySelectorAll('.move-item-modal__option')).toHaveLength(4);
    expect(within(modal).getByLabelText('PO A (atual)')).toBeTruthy();
    expect(modal.querySelectorAll('.move-item-modal__po')).toHaveLength(3);
    expect(modal.textContent).toContain('Sem PO');
  });
});
