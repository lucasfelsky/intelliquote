import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';

/**
 * Aviso flutuante (toast) do Forecast: confirma uma gravacao sem ocupar a pagina (refino de UX do Painel).
 *
 * Canto inferior direito, role="status" + aria-live="polite". Entra deslizando, o icone se desenha, uma barra mostra o
 * tempo e some sozinho em ~4 s (ou no X). Pausa com o mouse ou o foco em cima. Erro e conflito NAO usam o toast: seguem
 * como alerta persistente (role="alert") no corpo da tela. Politica de varias gravacoes seguidas: um aviso por vez; o
 * novo SUBSTITUI o anterior (a chave `id` reinicia a animacao e o tempo). So tela: no papel o toast some.
 */

export const DURACAO_TOAST_MS = 4000;
/** Tempo da animacao de saida (CSS .fct--saindo); sem movimento (reduced-motion) sai na hora. */
export const SAIDA_TOAST_MS = 300;

export interface DadosToast {
  /** Muda a cada aviso: troca de aviso reinicia animacao e tempo. */
  id: number;
  tipo: 'salvo' | 'removido';
  titulo: string;
  texto: string;
}

const reduzirMovimento = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ToastProps {
  dados: DadosToast;
  onFechar: () => void;
  duracaoMs?: number;
}

/** Um aviso. Monte com `key={dados.id}` para que um aviso novo comece do zero. */
export function ForecastToast({ dados, onFechar, duracaoMs = DURACAO_TOAST_MS }: ToastProps) {
  const [saindo, setSaindo] = useState(false);
  const [pausado, setPausado] = useState(false);
  const restante = useRef(duracaoMs);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  // Tempo restante: roda enquanto nao esta pausado nem saindo; pausar guarda o que sobrou.
  useEffect(() => {
    if (saindo || pausado) return undefined;
    const inicio = Date.now();
    const t = window.setTimeout(() => setSaindo(true), restante.current);
    return () => {
      window.clearTimeout(t);
      restante.current = Math.max(0, restante.current - (Date.now() - inicio));
    };
  }, [saindo, pausado]);

  // Saida: anima e some; reduced-motion remove na hora.
  useEffect(() => {
    if (!saindo) return undefined;
    const t = window.setTimeout(() => fechar.current(), reduzirMovimento() ? 0 : SAIDA_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [saindo]);

  return (
    <div
      className={`fct fct--${dados.tipo}${saindo ? ' fct--saindo' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="fc-toast"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <span className="fct__icone" aria-hidden="true">
        {dados.tipo === 'salvo' ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <path className="fct__marca" d="m5 12 5 5 9-10" />
          </svg>
        ) : (
          <Icon name="trash" size={18} strokeWidth={2.2} />
        )}
      </span>
      <div className="fct__corpo">
        <p className="fct__titulo">{dados.titulo}</p>
        <p className="fct__texto">{dados.texto}</p>
      </div>
      <button type="button" className="fct__fechar" aria-label="Fechar aviso" onClick={() => setSaindo(true)}>
        <Icon name="x" size={14} />
      </button>
      <span className="fct__barra" aria-hidden="true" style={{ animationDuration: `${duracaoMs}ms` }} />
    </div>
  );
}

/** Estado do toast do Painel: `mostrar` troca o aviso atual por um novo; `fechar` o remove. */
export function useToastForecast() {
  const [toast, setToast] = useState<DadosToast | null>(null);
  const contador = useRef(0);
  const mostrar = useCallback((tipo: DadosToast['tipo'], titulo: string, texto: string) => {
    contador.current += 1;
    setToast({ id: contador.current, tipo, titulo, texto });
  }, []);
  const fechar = useCallback(() => setToast(null), []);
  return { toast, mostrar, fechar };
}
