// Executa o <script> real de public/credit-portal.html no jsdom (fetch mockado) e
// verifica render, % ao vivo, validacao no cliente, payload do POST, so leitura,
// resposta previa, 404 e escape de HTML.
import { afterEach, describe, expect, it, vi } from 'vitest';
import creditPortalHtml from '../../../public/credit-portal.html?raw';

const INVALID_LINK_MESSAGE =
  'This link is invalid or has expired. Please contact your buyer to request a new one.';

interface CreditItem {
  quoteRequestItemId: number;
  productName: string;
  itemCode: string | null;
  unit: string;
  quantity: number;
  isUnavailable: boolean;
  originPort: string | null;
  isDangerousGood: boolean;
  originalUnitPrice: string;
  originalTotalPrice: string;
  partnerUnitPrice: string | null;
  partnerTotalPrice: string | null;
  markupPercent: string | null;
}

interface CreditPayload {
  request: {
    requestCode: string;
    currency: string;
    incoterm: string;
    originPort: string | null;
    expiresAt: string;
    closed: boolean;
    readOnly: boolean;
  };
  supplier: { name: string; country: string | null };
  partner: { name: string };
  items: CreditItem[];
  totals: { original: string; partner: string | null; markupPercent: string | null };
  response: {
    paymentTermsDays: number | null;
    validityDays: number | null;
    notes: string | null;
    respondedAt: string;
    version: number;
  } | null;
}

function makeItems(): CreditItem[] {
  return [
    {
      quoteRequestItemId: 11,
      productName: 'Sodium Hydroxide 99% flakes',
      itemCode: 'A-1',
      unit: 'KG',
      quantity: 5,
      isUnavailable: false,
      originPort: null,
      isDangerousGood: false,
      originalUnitPrice: '10.00',
      originalTotalPrice: '50.00',
      partnerUnitPrice: null,
      partnerTotalPrice: null,
      markupPercent: null,
    },
    {
      quoteRequestItemId: 12,
      productName: 'Citric Acid',
      itemCode: 'B-2',
      unit: 'KG',
      quantity: 3,
      isUnavailable: true,
      originPort: null,
      isDangerousGood: false,
      originalUnitPrice: '0.00',
      originalTotalPrice: '0.00',
      partnerUnitPrice: null,
      partnerTotalPrice: null,
      markupPercent: null,
    },
    {
      quoteRequestItemId: 13,
      productName: 'Acetone',
      itemCode: 'C-3',
      unit: 'L',
      quantity: 2,
      isUnavailable: false,
      originPort: 'Ningbo',
      isDangerousGood: true,
      originalUnitPrice: '20.00',
      originalTotalPrice: '40.00',
      partnerUnitPrice: null,
      partnerTotalPrice: null,
      markupPercent: null,
    },
  ];
}

function makePayload(overrides: Partial<CreditPayload> = {}): CreditPayload {
  return {
    request: {
      requestCode: 'QR-5',
      currency: 'USD',
      incoterm: 'FOB',
      originPort: 'Shanghai',
      expiresAt: '2030-01-01T12:00:00.000Z',
      closed: false,
      readOnly: false,
    },
    supplier: { name: 'Acme Chem', country: 'CN' },
    partner: { name: 'Banco Alfa' },
    items: makeItems(),
    totals: { original: '90.00', partner: null, markupPercent: null },
    response: null,
    ...overrides,
  };
}

type FetchMock = ReturnType<typeof vi.fn>;

async function mountPortal(
  payload: unknown,
  options: { status?: number; postStatus?: number; postBody?: unknown } = {},
): Promise<FetchMock> {
  const parsed = new DOMParser().parseFromString(creditPortalHtml, 'text/html');
  const scriptText = parsed.querySelector('script')?.textContent ?? '';
  parsed.querySelector('script')?.remove();
  document.body.innerHTML = parsed.body.innerHTML;
  window.history.replaceState({}, '', '/portal/credit?token=' + 'x'.repeat(43));

  const status = options.status ?? 200;
  const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      const postStatus = options.postStatus ?? 201;
      return {
        ok: postStatus < 400,
        status: postStatus,
        json: async () => options.postBody ?? { respondedAt: '2026-10-09T12:00:00.000Z', version: 1, totals: {}, items: [] },
      };
    }
    return { ok: status < 400, status, json: async () => payload };
  });
  vi.stubGlobal('fetch', fetchMock);

  new Function(scriptText)();
  await vi.waitFor(() => {
    expect(
      document.getElementById('credit-form') ?? document.querySelector('#portal-status .status-banner'),
    ).not.toBeNull();
  });
  return fetchMock;
}

function row(id: number): HTMLElement {
  const el = document.querySelector(`.item-row[data-item-id="${id}"]`);
  if (!el) throw new Error(`item-row ${id} not found`);
  return el as HTMLElement;
}

function setUnitPrice(id: number, value: string) {
  const input = row(id).querySelector('input[name="unitPrice"]') as HTMLInputElement | null;
  if (!input) throw new Error(`unitPrice input ${id} not found`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setField(name: string, value: string) {
  const form = document.getElementById('credit-form') as HTMLFormElement;
  const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitForm() {
  const form = document.getElementById('credit-form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function bannerText(): string {
  return document.querySelector('#portal-status .status-banner')?.textContent?.trim() ?? '';
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('credit-portal.html (jsdom)', () => {
  it('renderiza os 3 itens: indisponivel sem input, badge DG e origem do item', async () => {
    await mountPortal(makePayload());

    expect(document.documentElement.getAttribute('data-portal-version')).toBe('credit-v1-20261009');
    const rows = document.querySelectorAll('#credit-items .item-row');
    expect(rows).toHaveLength(3);
    expect(Array.from(rows).map((r) => r.getAttribute('data-item-id'))).toEqual(['11', '12', '13']);

    expect(row(11).querySelector('input[name="unitPrice"]')).not.toBeNull();
    expect(row(13).querySelector('input[name="unitPrice"]')).not.toBeNull();
    expect(row(12).querySelector('input')).toBeNull();
    expect(row(12).classList.contains('is-unavailable')).toBe(true);
    expect(row(12).textContent).toContain('Temporarily unavailable');

    expect(row(13).querySelector('.badge.dg')?.textContent).toBe('Dangerous goods');
    expect(row(11).querySelector('.badge.dg')).toBeNull();
    expect(row(13).textContent).toContain('Ningbo');
    expect(row(11).textContent).toContain('Sodium Hydroxide 99% flakes');
    expect(row(11).textContent).toContain('5 KG');

    expect(document.body.textContent).toContain('QR-5');
    expect(document.body.textContent).toContain('Acme Chem');
    expect(document.body.textContent).toContain('Banco Alfa');
    expect(document.body.textContent).toContain('Shanghai');
    expect(document.body.textContent).toContain('01 Jan 2030');
    expect(document.querySelector('#credit-form button[type="submit"]')?.textContent).toBe('Submit response');
    expect(document.querySelectorAll('#credit-form input[name="unitPrice"]')).toHaveLength(2);
  });

  it('atualiza o % ao vivo com sinal (+10.00% / -5.00%) e os totais', async () => {
    await mountPortal(makePayload());

    expect(row(11).querySelector('[data-markup]')?.textContent).toBe('-');
    setUnitPrice(11, '11');
    expect(row(11).querySelector('[data-markup]')?.textContent).toBe('+10.00%');
    expect(row(11).querySelector('[data-total]')?.textContent).toBe('55.00 USD');
    setUnitPrice(11, '9.5');
    expect(row(11).querySelector('[data-markup]')?.textContent).toBe('-5.00%');
    setUnitPrice(11, '10');
    expect(row(11).querySelector('[data-markup]')?.textContent).toBe('0.00%');

    // Total geral so mostra % com todos os disponiveis precificados.
    expect(document.querySelector('[data-total-markup]')?.textContent).toBe('-');
    setUnitPrice(13, '22');
    expect(document.querySelector('[data-total-partner]')?.textContent).toBe('94.00 USD');
    expect(document.querySelector('[data-total-markup]')?.textContent).toBe('+4.44%');
  });

  it('submit sem preco em item disponivel: banner de erro e nenhum POST', async () => {
    const fetchMock = await mountPortal(makePayload());
    setUnitPrice(11, '11');
    setField('paymentTermsDays', '90');
    setField('validityDays', '30');
    submitForm();

    await vi.waitFor(() => {
      expect(document.querySelector('#portal-status .status-banner.error')).not.toBeNull();
    });
    expect(bannerText()).toMatch(/unit price/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submit valido envia so os itens disponiveis e recarrega com banner de sucesso', async () => {
    const fetchMock = await mountPortal(makePayload());
    setUnitPrice(11, '11');
    setUnitPrice(13, '19');
    setField('paymentTermsDays', '90');
    setField('validityDays', '30');
    setField('notes', '  Hello  ');
    submitForm();

    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    const call = fetchMock.mock.calls[1] as unknown as [string, { method: string; body: string }];
    expect(call[0]).toBe(`http://localhost:3000/api/credit-portal/${'x'.repeat(43)}/respond`);
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({
      paymentTermsDays: 90,
      validityDays: 30,
      notes: 'Hello',
      items: [
        { quoteRequestItemId: 11, unitPrice: 11 },
        { quoteRequestItemId: 13, unitPrice: 19 },
      ],
    });
    await vi.waitFor(() => {
      expect(document.querySelector('#portal-status .status-banner.success')).not.toBeNull();
    });
    expect(bannerText()).toBe('Response submitted. Thank you!');
  });

  it('readOnly: banner de aviso, sem botao de envio e inputs desabilitados', async () => {
    const payload = makePayload();
    payload.request.closed = true;
    payload.request.readOnly = true;
    await mountPortal(payload);

    expect(document.querySelector('#credit-form button[type="submit"]')).toBeNull();
    const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('#credit-form input, #credit-form textarea');
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach((field) => expect(field.disabled).toBe(true));
    expect(document.querySelector('#portal-status .status-banner.warn')?.textContent).toBe(
      'This quote has been closed. Responses are no longer accepted.',
    );
  });

  it('resposta previa: inputs pre-preenchidos, banner info com a versao e botao "Update response"', async () => {
    const payload = makePayload({
      response: {
        paymentTermsDays: 60,
        validityDays: 20,
        notes: 'Previous <notes>',
        respondedAt: '2026-10-08T12:00:00.000Z',
        version: 2,
      },
    });
    payload.items[0]!.partnerUnitPrice = '11.00';
    payload.items[0]!.partnerTotalPrice = '55.00';
    payload.items[0]!.markupPercent = '10.00';
    payload.items[2]!.partnerUnitPrice = '19.00';
    payload.items[2]!.partnerTotalPrice = '38.00';
    payload.items[2]!.markupPercent = '-5.00';
    payload.totals = { original: '90.00', partner: '93.00', markupPercent: '3.33' };
    const fetchMock = await mountPortal(payload, {
      postBody: { respondedAt: '2026-10-08T12:00:00.000Z', version: 3, totals: {}, items: [] },
    });

    expect((row(11).querySelector('input[name="unitPrice"]') as HTMLInputElement).value).toBe('11.00');
    expect((row(13).querySelector('input[name="unitPrice"]') as HTMLInputElement).value).toBe('19.00');
    expect(row(11).querySelector('[data-markup]')?.textContent).toBe('+10.00%');
    expect(row(13).querySelector('[data-markup]')?.textContent).toBe('-5.00%');
    const form = document.getElementById('credit-form') as HTMLFormElement;
    expect((form.elements.namedItem('paymentTermsDays') as HTMLInputElement).value).toBe('60');
    expect((form.elements.namedItem('validityDays') as HTMLInputElement).value).toBe('20');
    expect((form.elements.namedItem('notes') as HTMLTextAreaElement).value).toBe('Previous <notes>');
    expect(document.querySelector('#credit-form button[type="submit"]')?.textContent).toBe('Update response');
    expect(document.querySelector('#portal-status .status-banner.info')?.textContent).toContain('(v2)');

    submitForm();
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    await vi.waitFor(() => {
      expect(document.querySelector('#portal-status .status-banner.success')).not.toBeNull();
    });
    expect(bannerText()).toBe('Response updated (v3). Thank you!');
  });

  it('404 mostra a mensagem da API e a nota de rodape', async () => {
    await mountPortal({ message: INVALID_LINK_MESSAGE }, { status: 404 });
    expect(document.getElementById('credit-form')).toBeNull();
    expect(document.querySelector('#portal-status .status-banner.error')?.textContent).toBe(INVALID_LINK_MESSAGE);
    expect(document.getElementById('portal-footer')?.textContent).toContain('Need a new link?');
  });

  it('escapa HTML vindo da API (nome do fornecedor com <img onerror>)', async () => {
    const payload = makePayload();
    payload.supplier.name = '<img src=x onerror=alert(1)>';
    payload.items[0]!.productName = '<b>bold</b>';
    await mountPortal(payload);

    expect(document.querySelectorAll('img[src="x"]').length).toBe(0);
    expect(document.querySelector('.supplier-card .name')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(row(11).querySelector('h3 b')).toBeNull();
    expect(row(11).querySelector('h3')?.textContent).toBe('<b>bold</b>');
  });

  it('erro da API no POST mostra a mensagem escapada e reabilita o botao', async () => {
    await mountPortal(makePayload(), {
      postStatus: 400,
      postBody: { message: 'Provide a unit price for every available item. <script>x</script>' },
    });
    setUnitPrice(11, '11');
    setUnitPrice(13, '19');
    setField('paymentTermsDays', '90');
    setField('validityDays', '30');
    submitForm();

    await vi.waitFor(() => {
      expect(document.querySelector('#portal-status .status-banner.error')).not.toBeNull();
    });
    expect(bannerText()).toBe('Provide a unit price for every available item. <script>x</script>');
    expect(document.querySelector('#portal-status script')).toBeNull();
    expect((document.querySelector('#credit-form button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
