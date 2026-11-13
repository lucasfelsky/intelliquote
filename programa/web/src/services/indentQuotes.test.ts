import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
}));

import { api } from '@/api/client';
import {
  acceptIndentQuote,
  addIndentQuoteFreeItem,
  getIndentQuote,
  listIndentQuotes,
  markIndentQuoteSent,
  recordIndentQuoteResponse,
  refuseIndentQuote,
  requestIndentQuoteRevision,
} from './indentQuotes';

const PREFIXO = '/api/v1/indent/quotes';

function urls(): string[] {
  return [api.get, api.post, api.put, api.del].flatMap((fn) => vi.mocked(fn).mock.calls.map((call) => String(call[0])));
}

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({});
  vi.mocked(api.post).mockReset().mockResolvedValue({});
});

describe('services/indentQuotes', () => {
  it('TODAS as URLs comecam por /api/v1/indent/quotes', async () => {
    await listIndentQuotes();
    await getIndentQuote(100);
    await markIndentQuoteSent(100, '2026-11-13');
    await addIndentQuoteFreeItem(100, { description: 'X', quantityKg: 1 });
    await recordIndentQuoteResponse(100, {
      respondedOn: '2026-11-13',
      currency: 'USD',
      validUntil: '2026-11-30',
      productionLeadTimeDays: 20,
      paymentTerms: 'T/T',
      items: [],
    });
    await acceptIndentQuote(100);
    await refuseIndentQuote(100);
    await requestIndentQuoteRevision(100);

    const todas = urls();
    expect(todas).toHaveLength(8);
    for (const url of todas) {
      expect(url.startsWith(PREFIXO), url).toBe(true);
    }
  });

  it('usa o verbo e o caminho certos em cada chamada', async () => {
    await listIndentQuotes();
    await getIndentQuote(100);
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toEqual([PREFIXO, `${PREFIXO}/100`]);

    await markIndentQuoteSent(100, '2026-11-13');
    await addIndentQuoteFreeItem(100, { description: 'Item X', quantityKg: 10.5 });
    await acceptIndentQuote(100);
    await refuseIndentQuote(100);
    await requestIndentQuoteRevision(100);
    expect(vi.mocked(api.post).mock.calls).toEqual([
      [`${PREFIXO}/100/mark-sent`, { sentOn: '2026-11-13' }],
      [`${PREFIXO}/100/items`, { description: 'Item X', quantityKg: 10.5 }],
      [`${PREFIXO}/100/accept`, {}],
      [`${PREFIXO}/100/refuse`, {}],
      [`${PREFIXO}/100/revision`, {}],
    ]);
  });

  it('o registro da resposta envia o corpo como esta (precos em string decimal)', async () => {
    const input = {
      respondedOn: '2026-11-13',
      currency: 'EUR',
      validUntil: '2026-12-01',
      productionLeadTimeDays: 20,
      paymentTerms: 'T/T 60 dias',
      items: [{ quoteItemId: 201, packaging: 'Tambor', fobPricePerKg: '0.795', cfrPricePerKg: '0.8' }],
    };

    await recordIndentQuoteResponse(100, input);

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(`${PREFIXO}/100/response`, input);
  });
});
