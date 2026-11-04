import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_STORAGE_KEY,
  applyTheme,
  initTheme,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
  systemPrefersDark,
  writeThemePreference,
} from './theme';

type MqlListener = (event: { matches: boolean }) => void;

function mockMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<MqlListener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, cb: MqlListener) => listeners.add(cb),
    removeEventListener: (_type: string, cb: MqlListener) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
  return {
    listenerCount: () => listeners.size,
    setSystemDark(value: boolean) {
      matches = value;
      listeners.forEach((cb) => cb({ matches: value }));
    },
  };
}

const metas = () =>
  Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((m) => m.getAttribute('content'));
const html = () => document.documentElement;
const originalMatchMedia = window.matchMedia;
let teardown: (() => void) | null = null;

beforeEach(() => {
  document.head.insertAdjacentHTML(
    'beforeend',
    '<meta name="theme-color" content="#00ae91" media="(prefers-color-scheme: light)" />' +
      '<meta name="theme-color" content="#0b1518" media="(prefers-color-scheme: dark)" />',
  );
});

afterEach(() => {
  teardown?.();
  teardown = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  writeThemePreference('auto'); // zera a preferencia em memoria
  localStorage.clear();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  html().removeAttribute('data-theme');
  html().removeAttribute('data-theme-switching');
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  else delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('preferencia persistida', () => {
  it('sem chave => auto', () => {
    expect(readThemePreference()).toBe('auto');
  });

  it('grava e le light/dark; auto remove a chave', () => {
    writeThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemePreference()).toBe('dark');
    writeThemePreference('light');
    expect(readThemePreference()).toBe('light');
    writeThemePreference('auto');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemePreference()).toBe('auto');
  });

  it('valor invalido => auto', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('auto');
    localStorage.setItem(THEME_STORAGE_KEY, 'auto');
    expect(readThemePreference()).toBe('auto');
  });

  it('getItem lancando nao lanca e cai em auto', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => readThemePreference()).not.toThrow();
    expect(readThemePreference()).toBe('auto');
  });

  it('setItem/removeItem lancando nao lancam; a escolha vale na sessao (memoria)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeThemePreference('dark')).not.toThrow();
    expect(readThemePreference()).toBe('dark');
    expect(() => writeThemePreference('auto')).not.toThrow();
    expect(readThemePreference()).toBe('auto');
  });
});

describe('resolucao', () => {
  it('resolveTheme e pura', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('sem matchMedia (jsdom) => claro', () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    expect(systemPrefersDark()).toBe(false);
    teardown = initTheme();
    expect(html().dataset.theme).toBe('light');
  });
});

describe('initTheme / applyTheme', () => {
  it('auto + sistema escuro => data-theme="dark"', () => {
    mockMatchMedia(true);
    teardown = initTheme();
    expect(html().dataset.theme).toBe('dark');
  });

  it('preferencia forcada vence o sistema', () => {
    mockMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    teardown = initTheme();
    expect(html().dataset.theme).toBe('light');
  });

  it('evento change troca o tema em auto e nao troca com preferencia forcada', () => {
    const mq = mockMatchMedia(false);
    teardown = initTheme();
    expect(html().dataset.theme).toBe('light');
    mq.setSystemDark(true);
    expect(html().dataset.theme).toBe('dark');
    mq.setSystemDark(false);
    expect(html().dataset.theme).toBe('light');

    setThemePreference('dark');
    mq.setSystemDark(false);
    expect(html().dataset.theme).toBe('dark');
    mq.setSystemDark(true);
    expect(html().dataset.theme).toBe('dark');
  });

  it('e idempotente: segunda chamada nao assina de novo; cleanup desassina', () => {
    const mq = mockMatchMedia(false);
    teardown = initTheme();
    expect(initTheme()).toBe(teardown);
    expect(mq.listenerCount()).toBe(1);
    teardown();
    teardown = null;
    expect(mq.listenerCount()).toBe(0);
  });

  it('metas theme-color: forcado => as duas com a cor do tema; auto => cada uma a sua', () => {
    mockMatchMedia(false);
    teardown = initTheme();
    expect(metas()).toEqual([THEME_COLOR_LIGHT, THEME_COLOR_DARK]);

    setThemePreference('dark');
    expect(metas()).toEqual([THEME_COLOR_DARK, THEME_COLOR_DARK]);
    setThemePreference('light');
    expect(metas()).toEqual([THEME_COLOR_LIGHT, THEME_COLOR_LIGHT]);
    setThemePreference('auto');
    expect(metas()).toEqual([THEME_COLOR_LIGHT, THEME_COLOR_DARK]);
  });

  it('evento storage de outra aba reaplica o tema e avisa os assinantes', () => {
    mockMatchMedia(false);
    teardown = initTheme();
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    expect(html().dataset.theme).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent('storage', { key: 'outra-chave', newValue: 'x' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(html().dataset.theme).toBe('light');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('data-theme-switching liga na troca e sai depois de 2 frames', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const runFrames = () => frames.splice(0).forEach((cb) => cb(0));

    applyTheme('dark', 'dark');
    expect(html().hasAttribute('data-theme-switching')).toBe(true);
    runFrames();
    expect(html().hasAttribute('data-theme-switching')).toBe(true);
    runFrames();
    expect(html().hasAttribute('data-theme-switching')).toBe(false);

    // sem mudanca de tema nao liga a flag
    applyTheme('dark', 'dark');
    expect(html().hasAttribute('data-theme-switching')).toBe(false);
  });

  it('sem requestAnimationFrame usa setTimeout de 50 ms', () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('requestAnimationFrame', undefined);
      applyTheme('dark', 'dark');
      expect(html().hasAttribute('data-theme-switching')).toBe(true);
      vi.advanceTimersByTime(50);
      expect(html().hasAttribute('data-theme-switching')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('impressao (F12-S): o papel e sempre claro', () => {
  it('beforeprint aplica light com data-theme-switching e afterprint reaplica o tema resolvido (forcado ou automatico)', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const mq = mockMatchMedia(true);
    teardown = initTheme();
    expect(html().dataset.theme).toBe('dark');
    frames.splice(0).forEach((cb) => cb(0));
    frames.splice(0).forEach((cb) => cb(0));

    window.dispatchEvent(new Event('beforeprint'));
    expect(html().dataset.theme).toBe('light');
    expect(html().hasAttribute('data-theme-switching')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(html().dataset.theme).toBe('dark');

    // o sistema muda durante a impressao: o afterprint le a preferencia de novo (auto => segue o sistema)
    window.dispatchEvent(new Event('beforeprint'));
    mq.setSystemDark(false);
    window.dispatchEvent(new Event('afterprint'));
    expect(html().dataset.theme).toBe('light');

    // preferencia forcada vence o sistema
    setThemePreference('dark');
    window.dispatchEvent(new Event('beforeprint'));
    expect(html().dataset.theme).toBe('light');
    window.dispatchEvent(new Event('afterprint'));
    expect(html().dataset.theme).toBe('dark');
  });

  it('o teardown remove os 2 ouvintes: beforeprint e afterprint depois dele nao mexem no tema', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    mockMatchMedia(true);
    const stop = initTheme();
    expect(add.mock.calls.filter(([type]) => type === 'beforeprint' || type === 'afterprint')).toHaveLength(2);
    expect(html().dataset.theme).toBe('dark');
    stop();
    expect(remove.mock.calls.filter(([type]) => type === 'beforeprint' || type === 'afterprint')).toHaveLength(2);
    window.dispatchEvent(new Event('beforeprint'));
    expect(html().dataset.theme).toBe('dark');
  });
});
