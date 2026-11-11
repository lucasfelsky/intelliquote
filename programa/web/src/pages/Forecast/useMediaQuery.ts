import { useEffect, useState } from 'react';

/**
 * Segue uma media query (ex.: a barra do Painel vira so lupa abaixo de 980 px). Sem matchMedia (jsdom, SSR) devolve
 * `padrao` e nao assina nada.
 */
export function useMediaQuery(consulta: string, padrao = false): boolean {
  const [casa, setCasa] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(consulta).matches : padrao,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(consulta);
    const aoMudar = () => setCasa(mql.matches);
    aoMudar();
    mql.addEventListener('change', aoMudar);
    return () => mql.removeEventListener('change', aoMudar);
  }, [consulta]);
  return casa;
}
