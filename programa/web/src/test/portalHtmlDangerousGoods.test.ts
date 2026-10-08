// Executa o <script> real de public/portal.html no jsdom (fetch mockado) e
// verifica o checkbox simples "Dangerous goods (DG)" por item: estado inicial,
// payload, interacao com "Temporarily unavailable" (bloqueia, desmarca e restaura),
// pre-marcacao na revisao e o Cancel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import portalHtml from '../../../public/portal.html?raw';

function makeItem(id: number) {
  return {
    id,
    itemCode: `IT-${id}`,
    productName: `Produto ${id}`,
    description: null,
    quantity: 10 + id,
    unit: 'KG',
    desiredIncoterm: 'FOB',
    destinationPort: 'Santos',
    originPort: 'Pedido do comprador',
    notes: null,
    purchaseOrderId: null,
  };
}

interface RespItem {
  quoteRequestItemId: number;
  isUnavailable?: boolean;
  isDangerousGood?: boolean;
}

function makePayload(response: { items: RespItem[] } | null = null) {
  return {
    quoteRequest: {
      id: 5,
      requestCode: 'QR-5',
      productName: 'Acido',
      description: null,
      desiredIncoterm: [],
      destinationPort: 'Santos',
      originPort: 'Shanghai',
      currency: 'USD',
      deadlineAt: null,
      purchaseOrders: [],
      items: [makeItem(1), makeItem(2), makeItem(3)],
    },
    supplier: { id: 2, name: 'Acme', paymentTermsDays: 30 },
    contact: { id: 9, name: 'John', email: 'john@acme.com' },
    expiresAt: '2030-01-01T00:00:00.000Z',
    alreadyResponded: response !== null,
    respondedAt: null,
    suggestedExchangeRate: null,
    response: response
      ? {
          id: 99,
          version: 1,
          currency: 'USD',
          incoterm: 'FOB',
          paymentTermsDays: 30,
          totalPrice: '200.00',
          totalPriceCurrency: 'USD',
          validityDays: 30,
          notes: null,
          originPort: 'Shanghai',
          submittedAt: '2026-10-01T00:00:00.000Z',
          items: response.items.map((item) =>
            item.isUnavailable
              ? {
                  quoteRequestItemId: item.quoteRequestItemId,
                  unitPrice: '0.00',
                  quantity: 0,
                  totalPrice: '0.00',
                  leadTimeDays: null,
                  notes: null,
                  incotermPrices: null,
                  originPort: null,
                  isUnavailable: true,
                  // inconsistente de proposito: o portal nunca pre-marca DG em item indisponivel
                  isDangerousGood: item.isDangerousGood ?? false,
                }
              : {
                  quoteRequestItemId: item.quoteRequestItemId,
                  unitPrice: '10.00',
                  quantity: 10 + item.quoteRequestItemId,
                  totalPrice: '100.00',
                  leadTimeDays: 7,
                  notes: null,
                  incotermPrices: null,
                  originPort: null,
                  isUnavailable: false,
                  isDangerousGood: item.isDangerousGood ?? false,
                },
          ),
        }
      : null,
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

const form = () => document.getElementById('portal-form') as HTMLFormElement;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.item-row'));
const row = (index: number) => rows()[index]!;
const dgBox = (index: number) =>
  row(index).querySelector<HTMLInputElement>('input[name="itemDangerousGood"]')!;
const unavailableBox = (index: number) =>
  row(index).querySelector<HTMLInputElement>('input[name="itemUnavailable"]')!;
const field = (index: number, selector: string) =>
  row(index).querySelector<HTMLInputElement>(selector)!;

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setChecked(box: HTMLInputElement, checked: boolean) {
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillAvailable(indexes: number[]) {
  indexes.forEach((index) => {
    typeInto(field(index, 'input[name="unitPrice"]'), '10');
    typeInto(field(index, 'input[name="quantity"]'), String(10 + index + 1));
  });
}

async function submitAndReadPayload(fetchMock: ReturnType<typeof vi.fn>) {
  form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  const call = fetchMock.mock.calls[1] as unknown as [string, { method: string; body: string }];
  expect(call[1].method).toBe('POST');
  return JSON.parse(call[1].body) as { items: Array<Record<string, unknown>> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('portal.html - Dangerous goods (DG) por item (jsdom)', () => {
  it('(a) cada item tem o checkbox "Dangerous goods (DG)" desmarcado e sem o badge antigo do catalogo', async () => {
    await mountPortal(makePayload());
    expect(rows()).toHaveLength(3);
    rows().forEach((_, index) => {
      const box = dgBox(index);
      expect(box.type).toBe('checkbox');
      expect(box.checked).toBe(false);
      expect(box.disabled).toBe(false);
      expect(box.labels?.[0]?.textContent?.trim()).toBe('Dangerous goods (DG)');
    });
    expect(document.querySelector('.dg-badge')).toBeNull();
  });

  it('(b) payload: marcado = true, desmarcado = false; item indisponivel nao envia DG', async () => {
    const fetchMock = await mountPortal(makePayload());
    fillAvailable([0, 1]);
    setChecked(dgBox(0), true);
    setChecked(unavailableBox(2), true);

    const body = await submitAndReadPayload(fetchMock);
    expect(body.items[0]).toMatchObject({ quoteRequestItemId: 1, isDangerousGood: true });
    expect(body.items[1]).toMatchObject({ quoteRequestItemId: 2, isDangerousGood: false });
    expect(body.items[2]).toEqual({ quoteRequestItemId: 3, isUnavailable: true, notes: null });
    expect(body.items[2]).not.toHaveProperty('isDangerousGood');
  });

  it('(c) marcar "Temporarily unavailable" desabilita e desmarca o DG; desmarcar restaura o valor', async () => {
    await mountPortal(makePayload());
    setChecked(dgBox(1), true);
    expect(dgBox(1).checked).toBe(true);

    setChecked(unavailableBox(1), true);
    expect(dgBox(1).disabled).toBe(true);
    expect(dgBox(1).checked).toBe(false);
    // as outras linhas nao sao afetadas
    expect(dgBox(0).disabled).toBe(false);

    setChecked(unavailableBox(1), false);
    expect(dgBox(1).disabled).toBe(false);
    expect(dgBox(1).checked).toBe(true);

    // linha sem DG marcado volta desmarcada
    setChecked(unavailableBox(2), true);
    setChecked(unavailableBox(2), false);
    expect(dgBox(2).checked).toBe(false);
    expect(dgBox(2).disabled).toBe(false);
  });

  it('(d) revisao pre-marca o DG enviado antes; item indisponivel volta desabilitado e desmarcado', async () => {
    await mountPortal(
      makePayload({
        items: [
          { quoteRequestItemId: 1, isDangerousGood: true },
          { quoteRequestItemId: 2, isDangerousGood: false },
          { quoteRequestItemId: 3, isUnavailable: true, isDangerousGood: true },
        ],
      }),
    );
    expect(dgBox(0).checked).toBe(true);
    expect(dgBox(1).checked).toBe(false);
    expect(dgBox(2).checked).toBe(false);
    expect(dgBox(2).disabled).toBe(true);

    // desmarcar "unavailable" libera o checkbox (sem DG restaurado: nada foi digitado)
    setChecked(unavailableBox(2), false);
    expect(dgBox(2).disabled).toBe(false);
    expect(dgBox(2).checked).toBe(false);
  });

  it('(e) Cancel volta ao estado inicial do DG e reaplica o bloqueio dos indisponiveis', async () => {
    await mountPortal(
      makePayload({
        items: [
          { quoteRequestItemId: 1, isDangerousGood: true },
          { quoteRequestItemId: 2 },
          { quoteRequestItemId: 3, isUnavailable: true },
        ],
      }),
    );
    setChecked(dgBox(0), false);
    setChecked(dgBox(1), true);
    setChecked(unavailableBox(2), false);

    (document.getElementById('portal-cancel') as HTMLButtonElement).click();

    expect(dgBox(0).checked).toBe(true);
    expect(dgBox(1).checked).toBe(false);
    expect(dgBox(2).checked).toBe(false);
    expect(dgBox(2).disabled).toBe(true);
    expect(dgBox(0).disabled).toBe(false);
  });

  it('(f) versao do portal v60', () => {
    expect(portalHtml).toContain("'v60-20261008'");
  });
});
