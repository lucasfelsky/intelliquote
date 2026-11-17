// Helpers compartilhados dos testes jsdom da pagina publica do portal Indent (HTML e JS reais, fetch mockado). Nao e um arquivo de teste.
import { expect, vi } from 'vitest';
import indentHtml from '../../../public/indent-portal.html?raw';
import indentJs from '../../../public/indent-portal.js?raw';

export const TOKEN = 'Ab3_'.repeat(10) + 'xyz'; // 43 caracteres base64url
export const API = `http://localhost:3000/api/indent-portal/${TOKEN}`;
export const XSS = '<img src=x onerror=alert(1)>';
export const PACKAGING = ['25 kg bag', '50 kg bag', '200 kg drum', '1,000 kg IBC', 'Bulk'];
export const PAYMENT = ['T/T 30 days after B/L date', 'T/T 60 days after B/L date', 'T/T 90 days after B/L date', 'L/C at sight', 'Other, see notes'];

export function dayKey(offset: number): string {
  const base = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [y, m, d] = base.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export type Json = Record<string, unknown>;

export function makeView(overrides: Json = {}): Json {
  return {
    state: 'open',
    processRef: '275/26',
    revision: 1,
    expiresAt: '2030-11-26T14:00:00.000Z',
    requestedBy: 'SQ Quimica',
    endCustomer: 'Industria Quimica Vale do Itajai Ltda',
    requestType: 'Indent',
    destination: 'Itajai',
    incoterm: 'CFR',
    currency: 'USD',
    message: null,
    manufacturerRequired: false,
    items: [
      { quoteItemId: 201, name: 'Citric acid anhydrous', cas: '77-92-9', quantityKg: '25000.000' },
      { quoteItemId: 202, name: 'Sodium tripolyphosphate (STPP)', cas: '7758-29-4', quantityKg: '10000.000' },
    ],
    previousOffer: null,
    response: null,
    attachments: [],
    options: { packaging: PACKAGING, paymentTerms: PAYMENT, currencies: ['USD', 'EUR'], maxFiles: 5, maxFileBytes: 10 * 1024 * 1024 },
    ...overrides,
  };
}

export const offerItems = [
  { quoteItemId: 201, packaging: '25 kg bag', fobPricePerKg: '0.7200', cfrPricePerKg: '0.7950' },
  { quoteItemId: 202, packaging: '50 kg bag', fobPricePerKg: '0.9400', cfrPricePerKg: '1.0150' },
];

export function makeSent(overrides: Json = {}): Json {
  return makeView({
    state: 'sent',
    response: {
      via: 'portal',
      version: 1,
      submittedAt: '2026-11-12T18:42:00.000Z',
      currency: 'USD',
      productionLeadTimeDays: 20,
      paymentTerms: PAYMENT[1],
      validUntil: '2030-11-30',
      manufacturer: 'Own production, Shandong',
      notes: 'Prices ex-works.',
      items: offerItems,
    },
    ...overrides,
  });
}

export type Reply = { status?: number; body?: unknown; nonJson?: boolean; reject?: boolean };
export type Handler = (method: string, url: string, init: RequestInit) => Reply | Promise<Reply>;

export function installFetch(handler: Handler) {
  const mock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const reply = await handler(init.method ?? 'GET', url, init);
    if (reply.reject) throw new TypeError('network down');
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => {
        if (reply.nonJson) throw new SyntaxError('Unexpected token <');
        return reply.body;
      },
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function mountPage(url = `/portal/indent?token=${TOKEN}`) {
  const parsed = new DOMParser().parseFromString(indentHtml, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  document.title = 'x';
  window.history.replaceState(null, '', url);
  new Function('module', indentJs)(undefined);
}

export async function loaded() {
  await vi.waitFor(() => expect(app().getAttribute('data-state')).not.toBe('loading'));
}

export const app = () => document.getElementById('ip-app') as HTMLElement;
export const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
export const text = () => app().textContent ?? '';
export const state = () => app().getAttribute('data-state');
export const h1 = () => document.querySelector('.p-h1')?.textContent;

export function type(id: string, value: string) {
  const input = el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fillOffer(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    pkg0: '25 kg bag',
    fob0: '0,720',
    cfr0: '0,795',
    pkg1: '50 kg bag',
    fob1: '0.94',
    cfr1: '1.0150',
    lead: '20',
    pay: PAYMENT[1]!,
    valid: dayKey(30),
    maker: '  Own production, Shandong ',
    notes: ' Prices ex-works. ',
    ...overrides,
  };
  for (const [id, value] of Object.entries(values)) type(id, value);
}

export const submit = () => el<HTMLButtonElement>('submit').click();
export const posts = (mock: ReturnType<typeof installFetch>) => mock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
export const ok = (body: unknown, status = 200): Reply => ({ status, body });

export function chooseFiles(files: File[]) {
  const input = el('files');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export const pdf = (name: string, size = 64) => {
  const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

