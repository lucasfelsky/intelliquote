import { useEffect, useState } from 'react';

// Build que esta rodando nesta aba (injetado pelo vite.config.ts). 'dev' = vite dev/vitest: sem checagem.
export const CURRENT_BUILD_ID: string = import.meta.env.VITE_APP_BUILD_ID ?? 'dev';

const POLL_MS = 5 * 60_000;
// Foco/visibilidade disparam checagem, mas no maximo 1 por minuto.
const MIN_GAP_MS = 60_000;

// Build publicado agora no Hosting. null = nao deu para saber (offline, deploy antigo sem
// version.json -> rewrite devolve o index.html); nesses casos nunca avisa.
export async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const buildId = data && typeof data === 'object' ? (data as { buildId?: unknown }).buildId : undefined;
    return typeof buildId === 'string' && buildId ? buildId : null;
  } catch {
    return null;
  }
}

// true quando o Hosting ja serve outro build: a aba segue com o JS antigo ate recarregar.
export function useNewVersionCheck(currentBuildId: string = CURRENT_BUILD_ID, pollMs: number = POLL_MS): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (currentBuildId === 'dev' || available) return;
    let cancelled = false;
    let lastCheck = 0;

    async function check() {
      const now = Date.now();
      if (now - lastCheck < MIN_GAP_MS) return;
      lastCheck = now;
      const deployed = await fetchDeployedBuildId();
      if (!cancelled && deployed && deployed !== currentBuildId) setAvailable(true);
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void check();
    }

    const timer = window.setInterval(() => void check(), pollMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [currentBuildId, pollMs, available]);

  return available;
}
