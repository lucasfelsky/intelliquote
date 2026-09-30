import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
}));

vi.mock('@/firebase/client', () => ({ auth: { currentUser: null } }));

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), postWithIdToken: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import { signOut } from 'firebase/auth';
import { api } from '@/api/client';

let logoutFn: (() => Promise<void>) | null = null;

function Probe() {
  logoutFn = useAuth().logout;
  return null;
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider.logout', () => {
  beforeEach(() => {
    localStorage.clear();
    logoutFn = null;
    vi.mocked(api.post).mockReset();
    vi.mocked(signOut).mockReset();
    vi.mocked(signOut).mockResolvedValue(undefined);
  });

  it('chama POST /auth/logout com o refresh token ANTES do signOut do Firebase', async () => {
    localStorage.setItem('intelliquote.refreshToken', 'refresh-abc');
    vi.mocked(api.post).mockResolvedValue(undefined);
    renderProvider();

    await act(async () => {
      await logoutFn!();
    });

    expect(api.post).toHaveBeenCalledWith('/api/v1/auth/logout', { refreshToken: 'refresh-abc' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(signOut).mock.invocationCallOrder[0]!,
    );
    expect(localStorage.getItem('intelliquote.refreshToken')).toBeNull();
  });

  it('falha de rede no logout do servidor nao impede o logout local', async () => {
    localStorage.setItem('intelliquote.refreshToken', 'refresh-abc');
    localStorage.setItem('intelliquote.accessToken', 'access-abc');
    vi.mocked(api.post).mockRejectedValue(new Error('network'));
    renderProvider();

    await act(async () => {
      await logoutFn!();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('intelliquote.refreshToken')).toBeNull();
    expect(localStorage.getItem('intelliquote.accessToken')).toBeNull();
  });

  it('sem refresh token nao chama o servidor, mas faz o logout local', async () => {
    renderProvider();

    await act(async () => {
      await logoutFn!();
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
