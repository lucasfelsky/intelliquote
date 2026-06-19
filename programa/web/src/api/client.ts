// Fetch wrapper com:
// - prefixo configurado via VITE_INTELLIQUOTE_API_BASE (default '/api')
// - Authorization: Bearer <intelliquote-jwt>
// - auto-refresh em 401 (uma única tentativa)
// - tipagem genérica

const BASE = (import.meta.env.VITE_INTELLIQUOTE_API_BASE ?? '/api').replace(/\/$/, '');

// Endpoints que NAO devem ser interceptados pelo rewrite do Firebase Hosting
// porque o rewrite do `/api/**` -> Cloud Run so funciona com headers
// especificos do Hosting. Chamadas via fetch direto da SPA passam pelo
// rewrite mas o Cloud Run recebe a requisicao sem `Origin`, e o body e
// consumido de forma estranha em alguns cenarios. Workaround: chamar
// o Cloud Run diretamente quando possivel (mesma origem ou configurado
// via VITE_INTELLIQUOTE_API_BASE=https://intelliquote-api-...run.app).
// Incrementar BUILD_TAG para invalidar caches do navegador apos deploys.
export const BUILD_TAG = '2026-06-19-r46-catalog-items-admin';

// Limpa tokens velhos em deploys novos (storage fica sujo entre versoes
// e causa 401 em /me, que dispara tryRefresh, que cai no fallback HTML
// do Firebase Hosting rewrite e gera o "<!doctype" no console).
if (typeof window !== 'undefined') {
  try {
    const prev = localStorage.getItem('intelliquote.buildTag');
    if (prev && prev !== BUILD_TAG) {
      localStorage.removeItem('intelliquote.accessToken');
      localStorage.removeItem('intelliquote.refreshToken');
      localStorage.removeItem('intelliquote.user');
    }
    localStorage.setItem('intelliquote.buildTag', BUILD_TAG);
  } catch { /* noop */ }
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown> | unknown[] | null;

let refreshInFlight: Promise<void> | null = null;

async function tryRefresh(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem('intelliquote.refreshToken');
    if (!refreshToken) throw new ApiError(401, null, 'no refresh token');
    const r = await fetch(buildUrl('/v1/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!r.ok) throw new ApiError(r.status, await safeJson(r), 'refresh failed');
    const data = (await r.json()) as { accessToken: string; refreshToken: string; user: unknown };
    localStorage.setItem('intelliquote.accessToken', data.accessToken);
    localStorage.setItem('intelliquote.refreshToken', data.refreshToken);
    localStorage.setItem('intelliquote.user', JSON.stringify(data.user));
  })();
  try { await refreshInFlight; }
  finally { refreshInFlight = null; }
}

async function safeJson(r: Response): Promise<unknown> {
  try { return await r.json(); } catch { return null; }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Json | FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  _isRetry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  // Quando BASE e URL absoluta (Cloud Run direto), o backend expoe as
  // rotas em /api/v1/... (registradas em routes/index.ts com prefixo /api/v1).
  // /v1/... sozinho NAO esta registrado, so funciona com /api/v1.
  const baseIsAbsolute = /^https?:\/\//.test(BASE);
  let cleanPath: string;
  if (path.startsWith('/api/v1') || path.startsWith('/api/')) {
    cleanPath = path;
  } else if (path.startsWith('/v1')) {
    // Re-escreve /v1/... → /api/v1/...
    cleanPath = `/api${path}`;
  } else {
    cleanPath = `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  }
  const url = baseIsAbsolute
    ? new URL(cleanPath, BASE)
    : new URL(cleanPath, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined && opts.body !== null && Object.keys(opts.body as object).length > 0) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (!opts.skipAuth && !headers.Authorization) {
    const token = localStorage.getItem('intelliquote.accessToken');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const r = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers, body, credentials: 'omit',
  });

  if (r.status === 204) return undefined as T;

  if (r.status === 401 && !opts.skipAuth && !opts._isRetry && !path.includes('/auth/')) {
    try {
      await tryRefresh();
      return request<T>(path, { ...opts, _isRetry: true });
    } catch {
      // refresh failed → força logout via reload (AuthProvider limpa estado)
      localStorage.clear();
      window.location.assign('/');
      throw new ApiError(401, null, 'session expired');
    }
  }

  if (!r.ok) {
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const txt = await r.text().catch(() => '');
      throw new ApiError(r.status, { contentType: ct, body: txt.slice(0, 500) }, `Resposta não-JSON (CT=${ct}). Primeiros 200 chars: ${txt.slice(0, 200)}`);
    }
    const data = await safeJson(r);
    const message = (data && typeof data === 'object' && 'message' in (data as Record<string, unknown>))
      ? String((data as Record<string, unknown>).message)
      : `HTTP ${r.status}`;
    throw new ApiError(r.status, data, message);
  }
  // 200/201 com content-type nao-JSON tambem falha: provavelmente o rewrite
  // do Firebase Hosting caindo no fallback do SPA (que serve index.html).
  if (r.ok) {
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const txt = await r.text().catch(() => '');
      throw new ApiError(r.status, { contentType: ct, body: txt.slice(0, 500) }, `Resposta de sucesso não é JSON (CT=${ct}). Primeiros 200 chars: ${txt.slice(0, 200)}`);
    }
  }
  return (await r.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: Json) => request<T>(path, { method: 'POST', body: body ?? {} }),
  postWithIdToken: <T>(idToken: string) =>
    request<T>('/v1/auth/firebase', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${idToken}` } }),
  put:  <T>(path: string, body?: Json) => request<T>(path, { method: 'PUT',  body: body ?? {} }),
  patch:<T>(path: string, body?: Json) => request<T>(path, { method: 'PATCH',body: body ?? {} }),
  del:  <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  raw:  request,
};

// Log de diagnostico em dev
if (typeof window !== 'undefined') {
  console.info('[api] BASE =', BASE, '| location =', window.location.origin);
}
