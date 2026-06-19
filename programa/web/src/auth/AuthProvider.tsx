import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  signInWithEmailAndPassword, signOut as fbSignOut,
  onAuthStateChanged, type User as FbUser,
} from 'firebase/auth';
import { auth } from '@/firebase/client';
import { api } from '@/api/client';
import { tokenStore } from './tokenStore';
import type { AuthUser, LoginResponse } from './types';

interface AuthContextValue {
  user: AuthUser | null;
  firebaseUser: FbUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  exchangeError: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(tokenStore.getUser<AuthUser>());
  const [firebaseUser, setFirebaseUser] = useState<FbUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>(
    tokenStore.getAccess() ? 'authenticated' : 'loading',
  );
  const exchangeInFlight = useRef<Promise<LoginResponse> | null>(null);
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  // 1) Ao detectar login do Firebase, troca o ID token pelo JWT IntelliQuote.
  const exchange = useCallback(async (fb: FbUser): Promise<LoginResponse> => {
    if (exchangeInFlight.current) return exchangeInFlight.current;
    const promise = (async () => {
      const idToken = await fb.getIdToken(/* forceRefresh */ true);
      const res = await api.postWithIdToken<LoginResponse>(idToken);
      tokenStore.set(res.accessToken, res.refreshToken, res.user);
      setExchangeError(null);
      return res;
    })();
    exchangeInFlight.current = promise;
    try { return await promise; }
    catch (err) {
      // Mensagem detalhada para diagnosticar CORS/HTML fallback.
      const msg = err instanceof Error ? err.message : String(err);
      setExchangeError(msg);
      throw err;
    }
    finally { exchangeInFlight.current = null; }
  }, []);

  // 2) Sincroniza o estado com onAuthStateChanged (login/logout/refresh do Firebase).
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fb) => {
      setFirebaseUser(fb);
      if (!fb) {
        tokenStore.clear();
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      // Se ja temos accessToken em storage, validamos com /me antes de
      // chamar o exchange. Isso evita o loop de 401 -> tryRefresh -> 401
      // quando o accessToken esta expirado e o tryRefresh tambem falha.
      const existingAccess = tokenStore.getAccess();
      if (existingAccess) {
        try {
          const me = await api.get<{ user: AuthUser }>('/v1/auth/me');
          setUser(me.user);
          setStatus('authenticated');
          return;
        } catch {
          // access expirado/ invalido → faz exchange com o id token novo
        }
      }
      try {
        const res = await exchange(fb);
        setUser(res.user);
        setStatus('authenticated');
      } catch (err) {
        console.error('[auth] exchange failed', err);
        const msg = err instanceof Error ? err.message : String(err);
        setExchangeError(msg);
        tokenStore.clear();
        setUser(null);
        setStatus('unauthenticated');
      }
    });
    return unsub;
  }, [exchange]);

  // 3) Refresh proativo a cada 13 minutos (token expira em 15).
  useEffect(() => {
    if (status !== 'authenticated') return;
    const t = setInterval(async () => {
      const refreshToken = tokenStore.getRefresh();
      if (!refreshToken) return;
      try {
        const res = await api.post<LoginResponse>('/api/v1/auth/refresh', { refreshToken });
        tokenStore.setAccess(res.accessToken);
        tokenStore.setRefresh(res.refreshToken);
        tokenStore.setUser(res.user);
        setUser(res.user);
      } catch (err) {
        console.error('[auth] silent refresh failed', err);
      }
    }, 13 * 60 * 1000);
    return () => clearInterval(t);
  }, [status]);

  const login = useCallback(async (email: string, password: string) => {
    // O onAuthStateChanged do Firebase dispara o exchange() automaticamente.
    // Aqui so precisamos garantir que o Firebase fez sign-in; o resto
    // (status='authenticated') sera setado pelo onAuthStateChanged.
    await signInWithEmailAndPassword(auth, email, password);
  }, [exchange]);

  const logout = useCallback(async () => {
    try { await fbSignOut(auth); } catch { /* ignore */ }
    tokenStore.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    const fb = auth.currentUser;
    if (!fb) throw new Error('not authenticated');
    const res = await exchange(fb);
    setUser(res.user);
  }, [exchange]);

  const value = useMemo<AuthContextValue>(() => ({
    user, firebaseUser, status, login, logout, refresh, exchangeError,
  }), [user, firebaseUser, status, login, logout, refresh, exchangeError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
