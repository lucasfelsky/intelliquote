// Servico de tema (claro / escuro / automatico).
//
// O tema RESOLVIDO ('light' | 'dark') e sempre gravado em <html data-theme="...">; "automatico" e resolvido
// aqui, em JS, lendo prefers-color-scheme. Assim o CSS tem um unico bloco :root[data-theme="dark"].
// A logica de resolucao tambem existe no script inline de web/index.html (roda antes do bundle, evita o
// flash do tema errado): ao mudar uma, mude a outra.
import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'iq-theme';
export const THEME_COLOR_LIGHT = '#00ae91';
export const THEME_COLOR_DARK = '#0b1518';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const SWITCHING_ATTR = 'data-theme-switching';

// Preferencia mantida so em memoria quando o localStorage falha (modo privado, site data bloqueado):
// o toggle continua funcionando na sessao, so nao persiste.
let memoryPreference: ThemePreference | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function isStoredPreference(value: unknown): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark';
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isStoredPreference(stored)) return stored;
  } catch {
    // storage indisponivel: cai para a memoria / automatico
  }
  return memoryPreference ?? 'auto';
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'auto') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
    memoryPreference = null;
  } catch {
    memoryPreference = preference === 'auto' ? null : preference;
  }
}

function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(DARK_QUERY);
}

export function systemPrefersDark(): boolean {
  return darkMediaQuery()?.matches === true;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'auto') return systemDark ? 'dark' : 'light';
  return preference;
}

let switchingToken = 0;

function endSwitchingSoon(root: HTMLElement): void {
  const token = ++switchingToken;
  const done = () => {
    if (token === switchingToken) root.removeAttribute(SWITCHING_ATTR);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(done));
  } else {
    setTimeout(done, 50);
  }
}

function updateThemeColorMetas(resolved: ResolvedTheme, preference: ThemePreference): void {
  const forced = resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    if (preference !== 'auto') {
      meta.setAttribute('content', forced);
      return;
    }
    // Automatico: cada meta volta a cor do seu proprio media (o navegador escolhe qual vale).
    const media = meta.getAttribute('media') ?? '';
    if (media.includes('dark')) meta.setAttribute('content', THEME_COLOR_DARK);
    else if (media.includes('light')) meta.setAttribute('content', THEME_COLOR_LIGHT);
    else meta.setAttribute('content', forced);
  });
}

export function applyTheme(resolved: ResolvedTheme, preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) {
    // Desliga transicoes so durante a troca (evita "arrastar" cores em dezenas de elementos).
    root.setAttribute(SWITCHING_ATTR, '');
    root.dataset.theme = resolved;
    endSwitchingSoon(root);
  }
  updateThemeColorMetas(resolved, preference);
}

function reapply(): void {
  const preference = readThemePreference();
  applyTheme(resolveTheme(preference, systemPrefersDark()), preference);
}

let teardown: (() => void) | null = null;

// Idempotente: chamadas seguintes devolvem o mesmo cleanup (so os testes o usam).
export function initTheme(): () => void {
  if (teardown) return teardown;
  reapply();

  const mql = darkMediaQuery();
  const onSystemChange = () => {
    if (readThemePreference() === 'auto') reapply();
  };
  if (mql) {
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onSystemChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onSystemChange);
  }

  const onStorage = (event: StorageEvent) => {
    // key === null: outra aba rodou localStorage.clear().
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    memoryPreference = null;
    reapply();
    notify();
  };
  window.addEventListener('storage', onStorage);

  teardown = () => {
    if (mql) {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onSystemChange);
      else if (typeof mql.removeListener === 'function') mql.removeListener(onSystemChange);
    }
    window.removeEventListener('storage', onStorage);
    teardown = null;
  };
  return teardown;
}

export function setThemePreference(preference: ThemePreference): void {
  writeThemePreference(preference);
  applyTheme(resolveTheme(preference, systemPrefersDark()), preference);
  notify();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, readThemePreference, () => 'auto');
}
