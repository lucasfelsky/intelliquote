// Executa o <script> real de public/portal.html no jsdom (fetch mockado) e
// verifica o checkbox "Temporarily unavailable" por item: bloqueio/limpeza dos
// campos, restauracao do digitado, total, aviso de "todos indisponiveis",
// "Clear", modo revisao e o payload enviado ao backend.
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
    isDangerousGood: false,
    purchaseOrderId: null,
  };
}

interface RespItem {
  quoteRequestItemId: number;
  isUnavailable: boolean;
}

interface PayloadOptions {
  incoterms?: string[];
  response?: { items: RespItem[] } | null;
}

function makePayload({ incoterms = ['FOB', 'CIF'], response = null }: PayloadOptions = {}) {
  return {
    quoteRequest: {
      id: 5,
      requestCode: 'QR-5',
      productName: 'Acido',
      description: null,
      desiredIncoterm: incoterms,
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
          incoterm: incoterms[0] ?? 'FOB',
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
                }
              : {
                  quoteRequestItemId: item.quoteRequestItemId,
                  unitPrice: '10.00',
                  quantity: 10 + item.quoteRequestItemId,
                  totalPrice: '100.00',
                  leadTimeDays: 7,
                  notes: null,
                  incotermPrices: incoterms.map((incoterm) => ({
                    incoterm,
                    unitPrice: '10.00',
                    totalPrice: '100.00',
                  })),
                  originPort: null,
                  isUnavailable: false,
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
const checkbox = (index: number) =>
  row(index).querySelector<HTMLInputElement>('input[name="itemUnavailable"]')!;
const field = (index: number, selector: string) =>
  row(index).querySelector<HTMLInputElement>(selector)!;
const incotermField = (index: number, incoterm: string) =>
  field(index, `input[name="incotermPrice"][data-incoterm="${incoterm}"]`);
const hint = (index: number) => row(index).querySelector<HTMLElement>('[data-unavailable-hint]')!;
const total = () => form().elements.namedItem('totalPrice') as HTMLInputElement;
const allNotice = () => document.getElementById('portal-all-unavailable') as HTMLElement;
const general = () => document.querySelector('input[name="originPort"]') as HTMLInputElement;

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggle(index: number, checked: boolean) {
  const box = checkbox(index);
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillRow(index: number, values: { fob?: string; cif?: string; qty?: string; lead?: string; origin?: string }) {
  if (values.fob !== undefined) typeInto(incotermField(index, 'FOB'), values.fob);
  if (values.cif !== undefined) typeInto(incotermField(index, 'CIF'), values.cif);
  if (values.qty !== undefined) typeInto(field(index, 'input[name="quantity"]'), values.qty);
  if (values.lead !== undefined) typeInto(field(index, 'input[name="leadTimeDays"]'), values.lead);
  if (values.origin !== undefined) typeInto(field(index, 'input[name="itemOriginPort"]'), values.origin);
}

function fillAvailableRows(indexes: number[]) {
  indexes.forEach((index) => fillRow(index, { fob: '10', cif: '12', qty: String(10 + index + 1) }));
}

async function submitAndReadPayload(fetchMock: ReturnType<typeof vi.fn>) {
  form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  // GET inicial + POST + GET do reload pos-envio.
  await vi.waitFor(() => {
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  const call = fetchMock.mock.calls[1] as unknown as [string, { method: string; body: string }];
  expect(call[1].method).toBe('POST');
  return JSON.parse(call[1].body) as {
    totalPrice: number;
    items: Array<Record<string, unknown>>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('portal.html - Temporarily unavailable por item (jsdom)', () => {
  it('(a) cada item tem um checkbox acessivel pelo label "Temporarily unavailable"', async () => {
    await mountPortal(makePayload());
    expect(rows()).toHaveLength(3);
    rows().forEach((_, index) => {
      const box = checkbox(index);
      expect(box.type).toBe('checkbox');
      expect(box.checked).toBe(false);
      expect(box.labels?.[0]?.textContent?.trim()).toBe('Temporarily unavailable');
      expect(box.getAttribute('aria-describedby')).toBe(hint(index).id);
      expect(hint(index).hidden).toBe(true);
    });
  });

  it('(b) marcar desabilita e limpa precos por incoterm, quantidade, lead time e origem; desmarcar restaura o digitado', async () => {
    await mountPortal(makePayload());
    fillRow(1, { fob: '10', cif: '12', qty: '7', lead: '5', origin: 'Ningbo' });
    expect(field(1, 'input[name="itemOriginPort"]').getAttribute('data-origin-inherit')).toBe('0');

    toggle(1, true);
    const blocked = [
      incotermField(1, 'FOB'),
      incotermField(1, 'CIF'),
      field(1, 'input[name="quantity"]'),
      field(1, 'input[name="leadTimeDays"]'),
      field(1, 'input[name="itemOriginPort"]'),
    ];
    blocked.forEach((input) => {
      expect(input.disabled).toBe(true);
      expect(input.value).toBe('');
    });
    expect(row(1).classList.contains('is-unavailable')).toBe(true);
    expect(row(1).getAttribute('data-unavailable')).toBe('1');
    expect(hint(1).hidden).toBe(false);
    // as outras linhas nao sao afetadas
    expect(incotermField(0, 'FOB').disabled).toBe(false);
    expect(hint(0).hidden).toBe(true);
    // selects gerais (moeda/incoterm/origem geral) continuam livres
    expect((form().elements.namedItem('currency') as HTMLSelectElement).disabled).toBe(false);
    expect(general().disabled).toBe(false);

    toggle(1, false);
    expect(incotermField(1, 'FOB').value).toBe('10');
    expect(incotermField(1, 'CIF').value).toBe('12');
    expect(field(1, 'input[name="quantity"]').value).toBe('7');
    expect(field(1, 'input[name="leadTimeDays"]').value).toBe('5');
    expect(field(1, 'input[name="itemOriginPort"]').value).toBe('Ningbo');
    expect(field(1, 'input[name="itemOriginPort"]').getAttribute('data-origin-inherit')).toBe('0');
    blocked.forEach((input) => expect(input.disabled).toBe(false));
    expect(row(1).classList.contains('is-unavailable')).toBe(false);
    expect(row(1).hasAttribute('data-unavailable')).toBe(false);
    expect(hint(1).hidden).toBe(true);
  });

  it('(b2) cotacao sem incoterms: o preco unico tambem e bloqueado, limpo e restaurado', async () => {
    await mountPortal(makePayload({ incoterms: [] }));
    typeInto(field(0, 'input[name="unitPrice"]'), '4.5');
    toggle(0, true);
    expect(field(0, 'input[name="unitPrice"]').disabled).toBe(true);
    expect(field(0, 'input[name="unitPrice"]').value).toBe('');
    toggle(0, false);
    expect(field(0, 'input[name="unitPrice"]').value).toBe('4.5');
  });

  it('(c) payload: item indisponivel = { quoteRequestItemId, isUnavailable, notes } e o disponivel segue identico ao atual', async () => {
    const fetchMock = await mountPortal(makePayload());
    fillAvailableRows([0, 2]);
    fillRow(1, { fob: '99', cif: '99', qty: '5', lead: '3' });
    toggle(1, true);

    const body = await submitAndReadPayload(fetchMock);
    expect(body.items).toHaveLength(3);
    expect(body.items[1]).toEqual({ quoteRequestItemId: 2, isUnavailable: true, notes: null });
    for (const key of ['unitPrice', 'quantity', 'totalPrice', 'incotermPrices', 'leadTimeDays', 'originPort']) {
      expect(body.items[1]).not.toHaveProperty(key);
    }
    // item disponivel: mesmas chaves de antes, sem `isUnavailable`
    expect(Object.keys(body.items[0]!).sort()).toEqual(
      [
        'incotermPrices',
        'leadTimeDays',
        'notes',
        'originPort',
        'quantity',
        'quoteRequestItemId',
        'totalPrice',
        'unitPrice',
      ].sort(),
    );
    expect(body.items[0]).toMatchObject({ quoteRequestItemId: 1, unitPrice: 10, quantity: 11, totalPrice: 110 });
    expect(body.items[0]).not.toHaveProperty('isUnavailable');
    expect(body.items[2]).toMatchObject({ quoteRequestItemId: 3, unitPrice: 10, quantity: 13, totalPrice: 130 });
    // total = soma so dos disponiveis (110 + 130)
    expect(body.totalPrice).toBe(240);
  });

  it('(d) item disponivel vazio invalida o form; todos indisponiveis = valido (campos bloqueados saem da validacao)', async () => {
    await mountPortal(makePayload());
    expect(form().checkValidity()).toBe(false);
    toggle(0, true);
    toggle(1, true);
    expect(form().checkValidity()).toBe(false); // item 3 segue obrigatorio
    toggle(2, true);
    expect(form().checkValidity()).toBe(true);
  });

  it('(e) todos indisponiveis: total 0.00, aviso visivel (role=status) e o POST e enviado', async () => {
    const fetchMock = await mountPortal(makePayload());
    expect(allNotice().hidden).toBe(true);
    expect(allNotice().getAttribute('role')).toBe('status');
    toggle(0, true);
    toggle(1, true);
    expect(allNotice().hidden).toBe(true);
    toggle(2, true);
    expect(total().value).toBe('0.00');
    expect(allNotice().hidden).toBe(false);

    const body = await submitAndReadPayload(fetchMock);
    expect(body.totalPrice).toBe(0);
    expect(body.items.every((item) => item.isUnavailable === true)).toBe(true);
    await vi.waitFor(() => {
      expect(document.getElementById('portal-status')!.textContent).toContain(
        'Response sent: all items marked as temporarily unavailable. Thank you!',
      );
    });

    // desmarcar um esconde o aviso e o total volta a ser so dos disponiveis
    toggle(0, false);
    expect(allNotice().hidden).toBe(true);
    expect(total().value).toBe('');
  });

  it('(f) total ignora a linha indisponivel', async () => {
    await mountPortal(makePayload());
    fillAvailableRows([0, 1, 2]);
    expect(total().value).toBe('360.00'); // 10*11 + 10*12 + 10*13
    toggle(1, true);
    expect(total().value).toBe('240.00'); // 360 - 10*12
    toggle(1, false);
    expect(total().value).toBe('360.00');
  });

  it('(g) revisao com item indisponivel: checkbox marcado, campos vazios e desabilitados; desmarcar devolve quantidade pedida', async () => {
    await mountPortal(
      makePayload({
        response: {
          items: [
            { quoteRequestItemId: 1, isUnavailable: false },
            { quoteRequestItemId: 2, isUnavailable: true },
            { quoteRequestItemId: 3, isUnavailable: false },
          ],
        },
      }),
    );
    expect(checkbox(1).checked).toBe(true);
    expect(checkbox(0).checked).toBe(false);
    expect(row(1).classList.contains('is-unavailable')).toBe(true);
    expect(hint(1).hidden).toBe(false);
    [
      incotermField(1, 'FOB'),
      incotermField(1, 'CIF'),
      field(1, 'input[name="quantity"]'),
      field(1, 'input[name="leadTimeDays"]'),
      field(1, 'input[name="itemOriginPort"]'),
    ].forEach((input) => {
      expect(input.disabled).toBe(true);
      expect(input.value).toBe('');
    });
    // os demais seguem pre-preenchidos pela versao anterior
    expect(incotermField(0, 'FOB').value).toBe('10.00');
    expect(total().value).toBe('240.00'); // 10*11 + 10*13

    toggle(1, false);
    expect(field(1, 'input[name="quantity"]').value).toBe('12'); // quantidade pedida
    expect(incotermField(1, 'FOB').value).toBe('');
    expect(field(1, 'input[name="itemOriginPort"]').value).toBe('Shanghai'); // herda a geral
  });

  it('(h) "Clear" volta ao estado inicial (sem resposta e em revisao)', async () => {
    await mountPortal(makePayload());
    fillAvailableRows([0, 2]);
    toggle(1, true);
    (document.getElementById('portal-cancel') as HTMLButtonElement).click();
    rows().forEach((_, index) => {
      expect(checkbox(index).checked).toBe(false);
      expect(row(index).classList.contains('is-unavailable')).toBe(false);
      expect(hint(index).hidden).toBe(true);
      expect(incotermField(index, 'FOB').disabled).toBe(false);
      expect(incotermField(index, 'FOB').value).toBe('');
      expect(field(index, 'input[name="quantity"]').disabled).toBe(false);
    });
    expect(field(1, 'input[name="quantity"]').value).toBe('12');
    expect(allNotice().hidden).toBe(true);

    await mountPortal(
      makePayload({
        response: {
          items: [
            { quoteRequestItemId: 1, isUnavailable: false },
            { quoteRequestItemId: 2, isUnavailable: true },
            { quoteRequestItemId: 3, isUnavailable: false },
          ],
        },
      }),
    );
    toggle(1, false);
    typeInto(incotermField(1, 'FOB'), '55');
    toggle(0, true);
    (document.getElementById('portal-cancel') as HTMLButtonElement).click();
    expect(checkbox(1).checked).toBe(true);
    expect(incotermField(1, 'FOB').disabled).toBe(true);
    expect(incotermField(1, 'FOB').value).toBe('');
    expect(checkbox(0).checked).toBe(false);
    expect(incotermField(0, 'FOB').disabled).toBe(false);
    expect(incotermField(0, 'FOB').value).toBe('10.00');
  });

  it('(i) mudar a origem geral nao preenche a origem da linha indisponivel (volta ao desmarcar)', async () => {
    await mountPortal(makePayload());
    toggle(1, true);
    typeInto(general(), 'Qingdao');
    expect(field(0, 'input[name="itemOriginPort"]').value).toBe('Qingdao');
    expect(field(1, 'input[name="itemOriginPort"]').value).toBe('');
    toggle(1, false);
    expect(field(1, 'input[name="itemOriginPort"]').value).toBe('Qingdao');
    expect(field(1, 'input[name="itemOriginPort"]').getAttribute('data-origin-inherit')).toBe('1');
  });
});
