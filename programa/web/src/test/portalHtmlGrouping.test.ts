// Executa o <script> real de public/portal.html no jsdom (fetch mockado) e
// verifica o agrupamento por PO em "Requested items" e "Item pricing".
import { afterEach, describe, expect, it, vi } from 'vitest';
import portalHtml from '../../../public/portal.html?raw';

interface PortalItem {
  id: number;
  itemCode: string;
  productName: string;
  description: string | null;
  quantity: number;
  unit: string;
  desiredIncoterm: string;
  destinationPort: string;
  originPort: string;
  notes: string | null;
  isDangerousGood: boolean;
  purchaseOrderId: number | null;
}

interface PortalPo {
  id: number;
  label: string;
  position: number;
}

function makeItem(id: number, purchaseOrderId: number | null): PortalItem {
  return {
    id,
    itemCode: `IT-${id}`,
    productName: `Produto ${id}`,
    description: null,
    quantity: 10 + id,
    unit: 'KG',
    desiredIncoterm: 'FOB, CIF',
    destinationPort: 'Santos',
    originPort: 'Shanghai',
    notes: null,
    isDangerousGood: false,
    purchaseOrderId,
  };
}

function makePayload(purchaseOrders: PortalPo[], items: PortalItem[]) {
  return {
    quoteRequest: {
      id: 5,
      requestCode: 'QR-5',
      productName: 'Acido',
      description: null,
      desiredIncoterm: ['FOB', 'CIF'],
      destinationPort: 'Santos',
      originPort: 'Shanghai',
      currency: 'USD',
      deadlineAt: null,
      purchaseOrders,
      items,
    },
    supplier: { id: 2, name: 'Acme', paymentTermsDays: 30 },
    contact: { id: 9, name: 'John', email: 'john@acme.com' },
    expiresAt: '2030-01-01T00:00:00.000Z',
    alreadyResponded: false,
    respondedAt: null,
    suggestedExchangeRate: null,
    response: null,
    history: [],
  };
}

async function mountPortal(payload: unknown) {
  const parsed = new DOMParser().parseFromString(portalHtml, 'text/html');
  const scriptText = parsed.querySelector('script')?.textContent ?? '';
  parsed.querySelector('script')?.remove();
  document.body.innerHTML = parsed.body.innerHTML;
  window.history.replaceState({}, '', '/portal?token=' + 'x'.repeat(43));

  const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ revised: false }) };
    }
    return { ok: true, status: 200, json: async () => payload };
  });
  vi.stubGlobal('fetch', fetchMock);

  new Function(scriptText)();
  await vi.waitFor(() => {
    expect(document.getElementById('portal-form')).not.toBeNull();
  });
  return fetchMock;
}

function groupKeys(container: ParentNode, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map((el) => el.getAttribute('data-po-group') ?? '');
}

function itemIds(container: Element): number[] {
  return Array.from(container.querySelectorAll('.item-row')).map((row) => Number(row.getAttribute('data-item-id')));
}

async function submitAndReadPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const form = document.getElementById('portal-form') as HTMLFormElement;
  form.querySelectorAll<HTMLElement>('.item-row').forEach((row) => {
    const id = Number(row.getAttribute('data-item-id'));
    row.querySelectorAll<HTMLInputElement>('input[name="incotermPrice"]').forEach((input, idx) => {
      input.value = String(id * 10 + idx);
    });
    (row.querySelector('input[name="quantity"]') as HTMLInputElement).value = String(id + 1);
    (row.querySelector('input[name="leadTimeDays"]') as HTMLInputElement).value = id === 1 ? '5' : '';
  });
  (form.elements.namedItem('totalPrice') as HTMLInputElement).value = '100';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  // GET inicial + POST + GET do reload pos-envio: espera os tres para o script antigo
  // nao consumir o fetch do proximo cenario.
  await vi.waitFor(() => {
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  const call = fetchMock.mock.calls[1] as unknown as [string, { body: string }];
  const body = JSON.parse(call[1].body) as { items: Array<{ quoteRequestItemId: number }> } & Record<string, unknown>;
  return { ...body, items: [...body.items].sort((a, b) => a.quoteRequestItemId - b.quoteRequestItemId) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('portal.html - agrupamento por PO (jsdom)', () => {
  const pos: PortalPo[] = [
    { id: 20, label: 'PO <b>2</b>', position: 2 },
    { id: 10, label: 'PO 1', position: 1 },
    { id: 30, label: 'PO vazia', position: 3 },
  ];

  it('com PO: agrupa por PO ordenada, escapa o label, pula PO vazia e manda "Other items" por ultimo', async () => {
    await mountPortal(
      makePayload(pos, [makeItem(1, 20), makeItem(2, null), makeItem(3, 10), makeItem(4, 20)]),
    );

    const itemsContainer = document.getElementById('portal-items') as HTMLElement;
    const sections = Array.from(itemsContainer.querySelectorAll(':scope > section.po-group'));
    expect(groupKeys(itemsContainer, ':scope > [data-po-group]')).toEqual(['10', '20', 'other']);
    expect(sections.map((s) => itemIds(s))).toEqual([[3], [1, 4], [2]]);

    const title20 = itemsContainer.querySelector('[data-po-group="20"] .po-group-title') as HTMLElement;
    expect(title20.textContent).toBe('PO <b>2</b>');
    expect(title20.querySelector('b')).toBeNull();
    const lastTitle = sections[sections.length - 1]?.querySelector('.po-group-title');
    expect(lastTitle?.textContent).toBe('Other items');
    expect(itemsContainer.querySelector('[data-po-group="30"]')).toBeNull();

    const table = document.querySelector('.items-table') as HTMLTableElement;
    const bodies = Array.from(table.querySelectorAll('tbody[data-po-group]'));
    expect(bodies.map((b) => b.getAttribute('data-po-group'))).toEqual(['10', '20', 'other']);
    const theadCols = table.querySelectorAll('thead th').length;
    bodies.forEach((body) => {
      const th = body.querySelector('tr.po-group-head th') as HTMLTableCellElement;
      expect(th.getAttribute('colspan')).toBe(String(theadCols));
    });
    const tableTitle20 = table.querySelector('tbody[data-po-group="20"] th') as HTMLElement;
    expect(tableTitle20.textContent).toBe('PO <b>2</b>');
    expect(tableTitle20.querySelector('b')).toBeNull();
    expect(bodies.map((b) => b.querySelectorAll('tr:not(.po-group-head)').length)).toEqual([1, 2, 1]);
    expect(bodies[bodies.length - 1]?.querySelector('th')?.textContent).toBe('Other items');
  });

  it('sem PO: markup plano, sem grupos, .item-row filhos diretos de #portal-items', async () => {
    await mountPortal(
      makePayload([], [makeItem(1, null), makeItem(2, null), makeItem(3, null), makeItem(4, null)]),
    );

    expect(document.querySelector('.po-group')).toBeNull();
    expect(document.querySelector('.po-group-head')).toBeNull();
    expect(document.querySelector('[data-po-group]')).toBeNull();
    const itemsContainer = document.getElementById('portal-items') as HTMLElement;
    const rows = itemsContainer.querySelectorAll('.item-row');
    expect(rows).toHaveLength(4);
    rows.forEach((row) => expect(row.parentElement).toBe(itemsContainer));
  });

  it('nenhuma PO com itens: cai no modo plano (sem subtitulo unico "Other items")', async () => {
    await mountPortal(makePayload(pos, [makeItem(1, null), makeItem(2, null)]));
    expect(document.querySelector('.po-group')).toBeNull();
    expect(document.querySelector('.po-group-head')).toBeNull();
  });

  it('1 PO com todos os itens: modo plano (sem .po-group/.po-group-head)', async () => {
    await mountPortal(
      makePayload([{ id: 10, label: 'PO 1', position: 1 }], [makeItem(1, 10), makeItem(2, 10)]),
    );

    expect(document.querySelector('.po-group')).toBeNull();
    expect(document.querySelector('.po-group-head')).toBeNull();
    expect(document.querySelector('[data-po-group]')).toBeNull();
    const itemsContainer = document.getElementById('portal-items') as HTMLElement;
    const rows = itemsContainer.querySelectorAll('.item-row');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(row.parentElement).toBe(itemsContainer));
  });

  it('1 PO + itens soltos: modo plano', async () => {
    await mountPortal(
      makePayload([{ id: 10, label: 'PO 1', position: 1 }], [makeItem(1, 10), makeItem(2, null)]),
    );

    expect(document.querySelector('.po-group')).toBeNull();
    expect(document.querySelector('.po-group-head')).toBeNull();
    expect(document.querySelector('[data-po-group]')).toBeNull();
    expect(document.querySelectorAll('#portal-items .item-row')).toHaveLength(2);
  });

  it('payload enviado e equivalente com e sem agrupamento (comparacao ordenada por item)', async () => {
    const mountedA = await mountPortal(
      makePayload(pos, [makeItem(1, 20), makeItem(2, null), makeItem(3, 10), makeItem(4, 20)]),
    );
    const payloadA = await submitAndReadPayload(mountedA);

    const mountedB = await mountPortal(
      makePayload([], [makeItem(1, null), makeItem(2, null), makeItem(3, null), makeItem(4, null)]),
    );
    const payloadB = await submitAndReadPayload(mountedB);

    expect(payloadA.items).toHaveLength(4);
    expect(payloadA).toEqual(payloadB);
  });
});
