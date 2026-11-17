import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { THEME_STORAGE_KEY } from '@/theme/theme';

// Sessao expirada: o refresh falha e o client limpa o localStorage e recarrega. A preferencia de tema
// (iq-theme) nao e dado de sessao e tem de sobreviver ao clear().

function expireSession() {
  localStorage.setItem('intelliquote.accessToken', 'velho');
  localStorage.setItem('intelliquote.user', '{"id":1}');
  // sem refreshToken => tryRefresh rejeita e cai no ramo de logout
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
  // jsdom nao implementa navegacao: window.location.assign('/') so loga "Not implemented".
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('api/client: logout por sessao expirada', () => {
  it('limpa a sessao mas preserva iq-theme', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expireSession();

    await expect(api.get('/v1/quote-requests')).rejects.toMatchObject({ status: 401 });

    expect(localStorage.getItem('intelliquote.accessToken')).toBeNull();
    expect(localStorage.getItem('intelliquote.user')).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('nao cria iq-theme quando ele nao existia', async () => {
    expireSession();

    await expect(api.get('/v1/quote-requests')).rejects.toMatchObject({ status: 401 });

    expect(localStorage.getItem('intelliquote.accessToken')).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

// api.blob: download autenticado de binario (PDF do anexo do fornecedor). So Authorization; 1 retry com refresh em 401; 2xx HTML/JSON nao e arquivo.
describe('api/client: api.blob', () => {
  const PDF = '%PDF-1.4 fake';
  const URL_PDF = 'http://localhost:3000/api/v1/indent/quotes/7/portal-attachments/3';
  const pdfResponse = () => new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('200 application/pdf: devolve o Blob com os bytes, so com Authorization e na URL completa', async () => {
    localStorage.setItem('intelliquote.accessToken', 'tok-1');
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal('fetch', fetchMock);

    const blob = await api.blob('/api/v1/indent/quotes/7/portal-attachments/3');

    expect(await blob.text()).toBe(PDF);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_PDF);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-1' });
  });

  it('401 -> refresh -> repete UMA vez e entrega o Blob', async () => {
    localStorage.setItem('intelliquote.accessToken', 'velho');
    localStorage.setItem('intelliquote.refreshToken', 'ref-1');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/refresh')) return jsonResponse(200, { accessToken: 'novo', refreshToken: 'ref-2', user: { id: 1 } });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === 'Bearer novo' ? pdfResponse() : jsonResponse(401, { message: 'x' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const blob = await api.blob('/api/v1/indent/quotes/7/portal-attachments/3');

    expect(await blob.text()).toBe(PDF);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([URL_PDF, 'http://localhost:3000/api/v1/auth/refresh', URL_PDF]);
  });

  it('401 e o refresh falha: propaga ApiError 401 SEM limpar a sessao nem redirecionar', async () => {
    localStorage.setItem('intelliquote.accessToken', 'velho');
    localStorage.setItem('intelliquote.user', '{"id":1}');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'x' })));
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as unknown as Location);

    await expect(api.blob('/api/v1/indent/quotes/7/portal-attachments/3')).rejects.toMatchObject({ status: 401 });

    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem('intelliquote.accessToken')).toBe('velho');
    expect(localStorage.getItem('intelliquote.user')).toBe('{"id":1}');
  });

  it('404 JSON: ApiError com status 404 e a mensagem do corpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { message: 'Anexo não encontrado.' })));

    await expect(api.blob('/api/v1/indent/quotes/7/portal-attachments/9')).rejects.toMatchObject({
      status: 404,
      message: 'Anexo não encontrado.',
    });
  });

  it('erro nao-JSON: ApiError com o content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>boom</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })));

    await expect(api.blob('/api/v1/indent/quotes/7/portal-attachments/9')).rejects.toMatchObject({
      status: 502,
      body: { contentType: 'text/html' },
    });
  });

  it('200 text/html (fallback do Hosting) e 200 JSON: rejeitam, nao viram arquivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    await expect(api.blob('/api/v1/indent/quotes/7/portal-attachments/3')).rejects.toMatchObject({
      status: 200,
      message: 'Resposta inesperada do servidor ao baixar o arquivo.',
    });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })));
    await expect(api.blob('/api/v1/indent/quotes/7/portal-attachments/3')).rejects.toMatchObject({
      message: 'Resposta inesperada do servidor ao baixar o arquivo.',
    });
  });
});
