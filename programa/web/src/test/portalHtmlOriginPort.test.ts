// Executa o <script> real de public/portal.html no jsdom (fetch mockado) e
// verifica o "Origin port" por item: heranca da origem geral, badge de
// override, "Clear" e o payload enviado ao backend (null = herda).
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
  originPort: string | null;
}

function makePayload(response: { originPort: string | null; items: RespItem[] } | null = null) {
  return {
    quoteRequest: {
      id: 5,
      requestCode: 'QR-5',
      productName: 'Acido',
      description: null,
      desiredIncoterm: ['FOB'],
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
          totalPrice: '300.00',
          totalPriceCurrency: 'USD',
          validityDays: 30,
          notes: null,
          originPort: response.originPort,
          submittedAt: '2026-10-01T00:00:00.000Z',
          items: response.items.map((item) => ({
            quoteRequestItemId: item.quoteRequestItemId,
            unitPrice: '10.00',
            quantity: 10 + item.quoteRequestItemId,
            totalPrice: '100.00',
            leadTimeDays: null,
            notes: null,
            incotermPrices: [{ incoterm: 'FOB', unitPrice: '10.00', totalPrice: '100.00' }],
            originPort: item.originPort,
          })),
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

const general = () => document.querySelector('input[name="originPort"]') as HTMLInputElement;
const itemInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[name="itemOriginPort"]'));
const itemInput = (index: number) => itemInputs()[index]!;
const hint = (index: number) =>
  itemInput(index).closest('.item-row')!.querySelector<HTMLElement>('[data-origin-override]')!;

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function blur(input: HTMLInputElement) {
  input.dispatchEvent(new Event('blur'));
}

async function submitAndReadPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const form = document.getElementById('portal-form') as HTMLFormElement;
  form.querySelectorAll<HTMLElement>('.item-row').forEach((row) => {
    const id = Number(row.getAttribute('data-item-id'));
    row.querySelectorAll<HTMLInputElement>('input[name="incotermPrice"]').forEach((input) => {
      input.value = String(id * 10);
    });
  });
  (form.elements.namedItem('totalPrice') as HTMLInputElement).value = '100';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  // GET inicial + POST + GET do reload pos-envio.
  await vi.waitFor(() => {
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  const call = fetchMock.mock.calls[1] as unknown as [string, { body: string }];
  return JSON.parse(call[1].body) as {
    originPort: string | null;
    items: Array<{ quoteRequestItemId: number; originPort: string | null }>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('portal.html - Origin port por item (jsdom)', () => {
  it('(a) sem resposta: geral = origem do pedido e todos os itens herdam, sem badge', async () => {
    await mountPortal(makePayload());
    expect(general().value).toBe('Shanghai');
    expect(itemInputs()).toHaveLength(3);
    itemInputs().forEach((input, index) => {
      expect(input.value).toBe('Shanghai');
      expect(input.getAttribute('data-origin-inherit')).toBe('1');
      expect(input.getAttribute('data-origin-initial-inherit')).toBe('1');
      expect(hint(index).hidden).toBe(true);
    });
  });

  it('(b) digitar no geral move so os itens que herdam; item ja editado nao muda', async () => {
    await mountPortal(makePayload());
    typeInto(itemInput(1), 'Ningbo');
    typeInto(general(), 'Qingdao');
    expect(itemInput(0).value).toBe('Qingdao');
    expect(itemInput(2).value).toBe('Qingdao');
    expect(itemInput(1).value).toBe('Ningbo');
    expect(itemInput(1).getAttribute('data-origin-inherit')).toBe('0');
    expect(hint(1).hidden).toBe(false);
    expect(hint(0).hidden).toBe(true);
    expect(hint(2).hidden).toBe(true);
  });

  it('(c) editar item mostra badge; voltar ao valor da geral (outra caixa) esconde e envia null', async () => {
    const fetchMock = await mountPortal(makePayload());
    typeInto(itemInput(1), 'Ningbo');
    expect(hint(1).hidden).toBe(false);
    typeInto(itemInput(1), 'shanghai');
    expect(hint(1).hidden).toBe(true);
    expect(itemInput(1).getAttribute('data-origin-inherit')).toBe('1');

    const body = await submitAndReadPayload(fetchMock);
    expect(body.originPort).toBe('Shanghai');
    expect(body.items.map((item) => item.originPort)).toEqual([null, null, null]);
  });

  it('(d) apagar o item e sair do campo volta para a origem geral', async () => {
    await mountPortal(makePayload());
    typeInto(itemInput(2), 'Busan');
    expect(itemInput(2).getAttribute('data-origin-inherit')).toBe('0');
    typeInto(itemInput(2), '   ');
    blur(itemInput(2));
    expect(itemInput(2).value).toBe('Shanghai');
    expect(itemInput(2).getAttribute('data-origin-inherit')).toBe('1');
    expect(hint(2).hidden).toBe(true);
  });

  it('(e) "Clear" restaura valores e flags iniciais (sem resposta e em revisao)', async () => {
    await mountPortal(makePayload());
    typeInto(itemInput(1), 'Ningbo');
    typeInto(general(), 'Qingdao');
    (document.getElementById('portal-cancel') as HTMLButtonElement).click();
    expect(general().value).toBe('Shanghai');
    itemInputs().forEach((input, index) => {
      expect(input.value).toBe('Shanghai');
      expect(input.getAttribute('data-origin-inherit')).toBe('1');
      expect(hint(index).hidden).toBe(true);
    });

    await mountPortal(
      makePayload({
        originPort: 'Ningbo',
        items: [
          { quoteRequestItemId: 1, originPort: null },
          { quoteRequestItemId: 2, originPort: 'Busan' },
          { quoteRequestItemId: 3, originPort: null },
        ],
      }),
    );
    typeInto(itemInput(1), 'Dalian');
    typeInto(itemInput(0), 'Tianjin');
    (document.getElementById('portal-cancel') as HTMLButtonElement).click();
    expect(general().value).toBe('Ningbo');
    expect(itemInput(1).value).toBe('Busan');
    expect(itemInput(1).getAttribute('data-origin-inherit')).toBe('0');
    expect(hint(1).hidden).toBe(false);
    expect(itemInput(0).value).toBe('Ningbo');
    expect(itemInput(0).getAttribute('data-origin-inherit')).toBe('1');
    expect(hint(0).hidden).toBe(true);
  });

  it('(f) revisao: geral da resposta salva, item com origem propria com badge, demais herdam', async () => {
    await mountPortal(
      makePayload({
        originPort: 'Ningbo',
        items: [
          { quoteRequestItemId: 1, originPort: null },
          { quoteRequestItemId: 2, originPort: 'Busan' },
          { quoteRequestItemId: 3, originPort: null },
        ],
      }),
    );
    expect(general().value).toBe('Ningbo');
    expect(itemInput(0).value).toBe('Ningbo');
    expect(itemInput(1).value).toBe('Busan');
    expect(itemInput(2).value).toBe('Ningbo');
    expect(hint(0).hidden).toBe(true);
    expect(hint(1).hidden).toBe(false);
    expect(hint(2).hidden).toBe(true);
    expect(itemInput(1).getAttribute('data-origin-inherit')).toBe('0');
  });

  it('(f2) revisao legada (geral null): cai na origem do pedido e itens herdam', async () => {
    await mountPortal(
      makePayload({
        originPort: null,
        items: [
          { quoteRequestItemId: 1, originPort: null },
          { quoteRequestItemId: 2, originPort: null },
          { quoteRequestItemId: 3, originPort: null },
        ],
      }),
    );
    expect(general().value).toBe('Shanghai');
    itemInputs().forEach((input) => expect(input.value).toBe('Shanghai'));
  });

  it('(g) payload: originPort geral + itens [null, Busan, null]', async () => {
    const fetchMock = await mountPortal(makePayload());
    typeInto(general(), '  Qingdao ');
    typeInto(itemInput(1), ' Busan ');
    const body = await submitAndReadPayload(fetchMock);
    expect(body.originPort).toBe('Qingdao');
    expect(body.items.map((item) => item.quoteRequestItemId)).toEqual([1, 2, 3]);
    expect(body.items.map((item) => item.originPort)).toEqual([null, 'Busan', null]);
  });

  it('(h) geral vazia: payload manda originPort null', async () => {
    const fetchMock = await mountPortal(makePayload());
    typeInto(general(), '   ');
    const body = await submitAndReadPayload(fetchMock);
    expect(body.originPort).toBeNull();
    expect(body.items.map((item) => item.originPort)).toEqual([null, null, null]);
  });

  it('(i) tabela "Requested items" mantem a origem pedida pelo comprador', async () => {
    await mountPortal(makePayload());
    const pills = Array.from(document.querySelectorAll('.origin-pill')).map((el) => el.textContent);
    expect(pills.length).toBeGreaterThan(0);
    pills.forEach((text) => expect(text).toBe('Pedido do comprador'));
  });
});
