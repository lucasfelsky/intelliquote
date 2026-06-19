// Tokens são guardados em localStorage. Não usamos cookies HttpOnly (Firebase
// Hosting → Cloud Run rewrite não propaga Cookie). XSS é mitigado por:
// (1) StrictMode + sanitização de input,
// (2) tokens expiram em 15 min (access) / 7 dias (refresh).
// Para produção futura, considerar mover tokens para memória + refresh silencioso.

const KEYS = {
  access: 'intelliquote.accessToken',
  refresh: 'intelliquote.refreshToken',
  user: 'intelliquote.user',
} as const;

export const tokenStore = {
  getAccess(): string | null {
    return localStorage.getItem(KEYS.access);
  },
  getRefresh(): string | null {
    return localStorage.getItem(KEYS.refresh);
  },
  getUser<T = unknown>(): T | null {
    const raw = localStorage.getItem(KEYS.user);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  },
  set(access: string, refresh: string, user: unknown): void {
    localStorage.setItem(KEYS.access, access);
    localStorage.setItem(KEYS.refresh, refresh);
    localStorage.setItem(KEYS.user, JSON.stringify(user));
  },
  setAccess(access: string): void {
    localStorage.setItem(KEYS.access, access);
  },
  setRefresh(refresh: string): void {
    localStorage.setItem(KEYS.refresh, refresh);
  },
  setUser(user: unknown): void {
    localStorage.setItem(KEYS.user, JSON.stringify(user));
  },
  clear(): void {
    localStorage.removeItem(KEYS.access);
    localStorage.removeItem(KEYS.refresh);
    localStorage.removeItem(KEYS.user);
  },
};
