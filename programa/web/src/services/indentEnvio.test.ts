import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), blob: vi.fn() },
}));

import { api } from '@/api/client';
import {
  downloadIndentPortalAttachment,
  getIndentPortalState,
  getIndentSendContext,
  normalizePortalState,
  resendIndentQuoteLink,
  sendIndentQuote,
} from './indentEnvio';

// Envio da cotacao ao fornecedor (PR 4b): URLs e corpos EXATOS das chamadas, normalizacao tolerante do estado do portal e download binario.
// Dados sinteticos.

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.blob).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chamadas do envio', () => {
  it('send-context: GET /:id/send-context', async () => {
    vi.mocked(api.get).mockResolvedValue({ processRef: '275/26' });
    await getIndentSendContext(7);
    expect(api.get).toHaveBeenCalledWith('/api/v1/indent/quotes/7/send-context');
  });

  it('send: POST /:id/send com o corpo exato', async () => {
    vi.mocked(api.post).mockResolvedValue({ results: [], quote: {} });
    const input = {
      recipients: ['a@x.test'],
      saveToSupplier: false,
      message: null,
      showClientName: true,
      destinationPort: 'Paranaguá',
    };
    await sendIndentQuote(7, input);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/7/send', input);
  });

  it('resend: POST /:id/resend com corpo {}', async () => {
    vi.mocked(api.post).mockResolvedValue({ results: [], quote: {} });
    await resendIndentQuoteLink(7);
    expect(api.post).toHaveBeenCalledWith('/api/v1/indent/quotes/7/resend', {});
  });

  it('portal: GET /:id/portal passa pela normalizacao', async () => {
    vi.mocked(api.get).mockResolvedValue({ state: 'NAO_ENVIADO' });
    const estado = await getIndentPortalState(7);
    expect(api.get).toHaveBeenCalledWith('/api/v1/indent/quotes/7/portal');
    expect(estado).toMatchObject({ state: 'NAO_ENVIADO', recipients: [], mails: [], attachments: [], canResend: false, response: null });

    vi.mocked(api.get).mockResolvedValue({});
    expect(await getIndentPortalState(7)).toBeNull();
  });
});

describe('normalizePortalState', () => {
  it('forma invalida (objeto vazio, lista, null, texto, numero) e estado desconhecido = null', () => {
    expect(normalizePortalState({})).toBeNull();
    expect(normalizePortalState([])).toBeNull();
    expect(normalizePortalState(null)).toBeNull();
    expect(normalizePortalState(undefined)).toBeNull();
    expect(normalizePortalState('AGUARDANDO')).toBeNull();
    expect(normalizePortalState(3)).toBeNull();
    expect(normalizePortalState({ state: 'OUTRO' })).toBeNull();
  });

  it('listas ausentes viram [] e os escalares ausentes ficam nulos/falsos', () => {
    expect(normalizePortalState({ state: 'AGUARDANDO' })).toEqual({
      state: 'AGUARDANDO',
      lastSentAt: null,
      recipients: [],
      lastAccessAt: null,
      expiresAt: null,
      canResend: false,
      mails: [],
      response: null,
      attachments: [],
    });
  });

  it('forma completa: mantem os campos, descarta itens malformados das listas', () => {
    const estado = normalizePortalState({
      state: 'RESPONDIDO',
      lastSentAt: '2026-11-12T18:40:00.000Z',
      recipients: ['a@x.test', 7, 'b@x.test'],
      lastAccessAt: '2026-11-13T12:12:00.000Z',
      expiresAt: '2026-11-26T18:40:00.000Z',
      canResend: true,
      mails: [
        { id: 1, kind: 'REQUEST', toEmail: 'a@x.test', status: 'failed', errorMessage: 'caixa cheia', createdAt: '2026-11-12T18:40:00.000Z', sentAt: null, attachmentNames: ['a.pdf', 3] },
        { id: 'x', kind: 'REQUEST', toEmail: 'b@x.test', status: 'sent', createdAt: '2026-11-12T18:40:00.000Z' },
        { id: 2, kind: 'REQUEST', toEmail: 'b@x.test', status: 'estranho', createdAt: '2026-11-12T18:40:00.000Z' },
        'lixo',
      ],
      response: { version: 2, submittedAt: '2026-11-13T12:20:00.000Z', via: 'portal' },
      attachments: [{ id: 4, fileName: 'tds.pdf', fileSize: 870400, createdAt: '2026-11-13T12:19:00.000Z' }, { id: 'z' }, null],
    });

    expect(estado?.recipients).toEqual(['a@x.test', 'b@x.test']);
    expect(estado?.mails).toEqual([
      { id: 1, kind: 'REQUEST', toEmail: 'a@x.test', status: 'failed', errorMessage: 'caixa cheia', createdAt: '2026-11-12T18:40:00.000Z', sentAt: null, attachmentNames: ['a.pdf'] },
    ]);
    expect(estado?.response).toEqual({ version: 2, submittedAt: '2026-11-13T12:20:00.000Z', via: 'portal' });
    expect(estado?.attachments).toEqual([{ id: 4, fileName: 'tds.pdf', fileSize: 870400, createdAt: '2026-11-13T12:19:00.000Z' }]);
    expect(estado?.canResend).toBe(true);
  });

  it('response manual (version null) e via desconhecida', () => {
    expect(normalizePortalState({ state: 'RESPONDIDO', response: { version: null, submittedAt: '2026-11-13T12:20:00.000Z', via: 'manual' } })?.response).toEqual({
      version: null,
      submittedAt: '2026-11-13T12:20:00.000Z',
      via: 'manual',
    });
    expect(normalizePortalState({ state: 'RESPONDIDO', response: { version: 1, via: 'fax' } })?.response).toBeNull();
  });
});

describe('downloadIndentPortalAttachment', () => {
  it('baixa por api.blob (URL exata) e entrega por <a download> com o nome do arquivo', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
    let clicado: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicado = this;
    });
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    vi.mocked(api.blob).mockResolvedValue(blob);

    await downloadIndentPortalAttachment(7, { id: 3, fileName: 'TDS final.pdf', fileSize: 10, createdAt: '2026-11-13T12:19:00.000Z' });

    expect(api.blob).toHaveBeenCalledWith('/api/v1/indent/quotes/7/portal-attachments/3');
    expect(api.get).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicado).not.toBeNull();
    expect((clicado as unknown as HTMLAnchorElement).download).toBe('TDS final.pdf');
    expect((clicado as unknown as HTMLAnchorElement).href).toBe('blob:fake');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('falha do download propaga (a tela mostra o erro)', async () => {
    vi.mocked(api.blob).mockRejectedValue(new Error('Anexo não encontrado.'));
    await expect(downloadIndentPortalAttachment(7, { id: 3, fileName: 'a.pdf', fileSize: 1, createdAt: '' })).rejects.toThrow('Anexo não encontrado.');
  });
});
