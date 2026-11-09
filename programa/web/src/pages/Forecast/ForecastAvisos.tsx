import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/icons';

/**
 * Avisos do Forecast num so icone do cabecalho (refino visual, etapa 1).
 *
 * Cada tela registra seus avisos com `useAviso`; o icone `ForecastAvisos` lista todos num balao (hover, foco ou clique;
 * Esc fecha; Tab alcanca as acoes). Sem o provedor (testes isolados, outras telas), `useAviso` devolve false e o
 * componente segue desenhando o aviso no lugar de antes. Na impressao o balao some e os avisos saem em texto.
 */

export type TomAviso = 'erro' | 'atencao' | 'info';

export interface AvisoForecast {
  id: string;
  tom: TomAviso;
  titulo: string;
  texto?: string;
  acao?: { rotulo: string; aoClicar: () => void };
}

interface Registro {
  registrar: (aviso: AvisoForecast) => void;
  remover: (id: string) => void;
}

// Dois contextos: quem registra (useAviso) nunca re-renderiza quando a lista muda.
const ContextoRegistro = createContext<Registro | null>(null);
const ContextoLista = createContext<AvisoForecast[]>([]);

const ORDEM_TOM: Record<TomAviso, number> = { erro: 0, atencao: 1, info: 2 };
const ROTULO_TOM: Record<TomAviso, string> = { erro: 'Erro', atencao: 'Atenção', info: 'Informação' };

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [porId, setPorId] = useState<Record<string, AvisoForecast>>({});
  const registrar = useCallback((aviso: AvisoForecast) => {
    setPorId((atual) => ({ ...atual, [aviso.id]: aviso }));
  }, []);
  const remover = useCallback((id: string) => {
    setPorId((atual) => {
      if (!(id in atual)) return atual;
      const { [id]: _removido, ...resto } = atual;
      return resto;
    });
  }, []);
  const registro = useMemo(() => ({ registrar, remover }), [registrar, remover]);
  const lista = useMemo(
    () => Object.values(porId).sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom]),
    [porId],
  );
  return (
    <ContextoRegistro.Provider value={registro}>
      <ContextoLista.Provider value={lista}>{children}</ContextoLista.Provider>
    </ContextoRegistro.Provider>
  );
}

/**
 * Registra (ou remove, com `null`) um aviso no icone do cabecalho. Devolve true quando o aviso foi para o icone:
 * nesse caso o componente NAO desenha o aviso no corpo da tela.
 */
export function useAviso(id: string, aviso: Omit<AvisoForecast, 'id'> | null): boolean {
  const registro = useContext(ContextoRegistro);
  const aoClicar = useRef<(() => void) | undefined>(undefined);
  aoClicar.current = aviso?.acao?.aoClicar;
  const ativo = aviso !== null;
  const tom = aviso?.tom;
  const titulo = aviso?.titulo;
  const texto = aviso?.texto;
  const rotulo = aviso?.acao?.rotulo;
  useEffect(() => {
    if (!registro || !tom || !titulo) return undefined;
    registro.registrar({
      id,
      tom,
      titulo,
      texto,
      acao: rotulo ? { rotulo, aoClicar: () => aoClicar.current?.() } : undefined,
    });
    return () => registro.remover(id);
  }, [registro, id, tom, titulo, texto, rotulo]);
  return registro !== null && ativo;
}

const ATRASO_FECHAR_MS = 150;

export default function ForecastAvisos() {
  const avisos = useContext(ContextoLista);
  const idPainel = useId();
  const [aberto, setAberto] = useState(false);
  const [fixado, setFixado] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pularFoco = useRef(false);

  const limparTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const fechar = useCallback(() => {
    limparTimer();
    setAberto(false);
    setFixado(false);
  }, [limparTimer]);
  const abrir = useCallback(() => {
    limparTimer();
    setAberto(true);
  }, [limparTimer]);

  useEffect(() => limparTimer, [limparTimer]);

  // Clique fora fecha, mesmo fixado.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoApontar = (e: Event) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) fechar();
    };
    document.addEventListener('pointerdown', aoApontar);
    return () => document.removeEventListener('pointerdown', aoApontar);
  }, [aberto, fechar]);

  // Sem avisos o icone some (e o balao com ele).
  useEffect(() => {
    if (avisos.length === 0) fechar();
  }, [avisos.length, fechar]);

  if (avisos.length === 0) return null;

  const maior = avisos[0]?.tom ?? 'info';
  const aoSair = () => {
    if (fixado) return;
    limparTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      setAberto(false);
    }, ATRASO_FECHAR_MS);
  };
  const aoPerderFoco = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.relatedTarget || !raiz.current?.contains(e.relatedTarget as Node)) fechar();
  };
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && aberto) {
      e.stopPropagation();
      fechar();
      // Devolver o foco ao botao dispara onFocus: sem o guard o balao reabriria na hora.
      pularFoco.current = true;
      botao.current?.focus();
      pularFoco.current = false;
    }
  };

  return (
    <div
      ref={raiz}
      className="fc-avisos"
      onMouseEnter={abrir}
      onMouseLeave={aoSair}
      onFocus={() => {
        if (!pularFoco.current) abrir();
      }}
      onBlur={aoPerderFoco}
      onKeyDown={aoTeclar}
    >
      <button
        ref={botao}
        type="button"
        className={`fc-avisos__botao fc-avisos__botao--${maior}`}
        aria-label={`Avisos: ${avisos.length}`}
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        data-testid="fc-avisos-botao"
        onClick={() => {
          if (aberto && fixado) {
            fechar();
          } else {
            limparTimer();
            setAberto(true);
            setFixado(true);
          }
        }}
      >
        <Icon name={maior === 'info' ? 'info' : 'alert-triangle'} size={20} />
        <span className="fc-avisos__conta" aria-hidden="true">
          {avisos.length}
        </span>
      </button>
      {aberto && (
        <div id={idPainel} className="fc-avisos__painel" role="region" aria-label="Avisos">
          <p className="fc-avisos__titulo">{avisos.length === 1 ? 'Aviso' : 'Avisos'}</p>
          <ul className="fc-avisos__lista">
            {avisos.map((a) => (
              <li key={a.id} className={`fc-avisos__item fc-avisos__item--${a.tom}`}>
                <span className="fc-avisos__marca" aria-hidden="true" />
                <div>
                  <strong>
                    <span className="sr-only">{ROTULO_TOM[a.tom]}: </span>
                    {a.titulo}
                  </strong>
                  {a.texto && <span className="fc-avisos__texto">{a.texto}</span>}
                  {a.acao && (
                    <button
                      type="button"
                      className="ghost-button ghost-button--sm fc-avisos__acao"
                      onClick={() => {
                        a.acao?.aoClicar();
                        fechar();
                      }}
                    >
                      {a.acao.rotulo}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Papel: o balao some na impressao e os avisos seguem no relatorio, em texto (classe so-papel = oculta na tela). */}
      <ul className="fc-so-papel fc-avisos__papel">
        {avisos.map((a) => (
          <li key={a.id}>
            <strong>{a.titulo}</strong>
            {a.texto ? `: ${a.texto}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
