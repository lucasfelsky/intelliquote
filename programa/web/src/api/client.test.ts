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
