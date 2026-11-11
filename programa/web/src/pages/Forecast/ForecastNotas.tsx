import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { InfoPopover } from '@/components/InfoPopover';

/**
 * Notas da quinzena num so icone (prancheta) da barra de filtros do Painel (refino de UX).
 *
 * As frases fixas da quinzena (pendentes de cadastro, sem venda nos ultimos 3 meses, amostras ignoradas) deixam de ocupar
 * a pagina: cada tela as registra com `useNotas`; o icone `ForecastNotasIcone` as lista num balao (hover, foco ou clique).
 * Sem o provedor (testes isolados, import), `useNotas` devolve false e o componente segue desenhando a frase no lugar de
 * antes. O texto das notas fica SEMPRE no DOM (lista so para leitor de tela na tela; visivel no papel).
 */

export type TomNota = 'atencao' | 'neutro';

export interface NotaForecast {
  id: string;
  texto: string;
  tom: TomNota;
}

interface Registro {
  registrar: (nota: NotaForecast) => void;
  remover: (id: string) => void;
}

// Dois contextos: quem registra (useNotas) nunca re-renderiza quando a lista muda.
const ContextoRegistro = createContext<Registro | null>(null);
const ContextoLista = createContext<NotaForecast[]>([]);

const ORDEM = ['pendentes', 'sem-venda', 'amostras', 'historico'];

export function ProvedorNotas({ children }: { children: ReactNode }) {
  const [porId, setPorId] = useState<Record<string, NotaForecast>>({});
  const registrar = useCallback((nota: NotaForecast) => {
    setPorId((atual) => {
      const antiga = atual[nota.id];
      return antiga && antiga.texto === nota.texto && antiga.tom === nota.tom ? atual : { ...atual, [nota.id]: nota };
    });
  }, []);
  const remover = useCallback((id: string) => {
    setPorId((atual) => {
      if (!(id in atual)) return atual;
      const { [id]: _removida, ...resto } = atual;
      return resto;
    });
  }, []);
  const registro = useMemo(() => ({ registrar, remover }), [registrar, remover]);
  // Ordem de leitura fixa (ids conhecidos primeiro, na ordem da tela de antes); id novo vai para o fim, na ordem do registro.
  const lista = useMemo(() => {
    const posicao = (id: string) => {
      const i = ORDEM.indexOf(id);
      return i < 0 ? ORDEM.length : i;
    };
    return Object.values(porId).sort((a, b) => posicao(a.id) - posicao(b.id));
  }, [porId]);
  return (
    <ContextoRegistro.Provider value={registro}>
      <ContextoLista.Provider value={lista}>{children}</ContextoLista.Provider>
    </ContextoRegistro.Provider>
  );
}

/**
 * Registra (ou remove, com `null`) uma nota no icone da barra. Devolve true quando a nota foi para o icone: nesse caso
 * o componente NAO desenha a frase no corpo da tela.
 */
export function useNotas(id: string, nota: Omit<NotaForecast, 'id'> | null): boolean {
  const registro = useContext(ContextoRegistro);
  const ativa = nota !== null;
  const texto = nota?.texto;
  const tom = nota?.tom;
  useEffect(() => {
    if (!registro || !texto || !tom) return undefined;
    registro.registrar({ id, texto, tom });
    return () => registro.remover(id);
  }, [registro, id, texto, tom]);
  return registro !== null && ativa;
}

/** Icone de prancheta com selo de contagem; sem notas nao desenha nada. */
export default function ForecastNotasIcone() {
  const notas = useContext(ContextoLista);
  if (notas.length === 0) return null;
  return (
    <div className="fcnt">
      <InfoPopover
        label={`Notas da quinzena: ${notas.length}`}
        tone="info"
        largo
        className="fcnt__botao"
        testId="fc-notas-botao"
        contentTestId="fc-notas-balao"
        trigger={
          <>
            <Icon name="clipboard" size={20} />
            <span className="fcnt__conta" aria-hidden="true">
              {notas.length}
            </span>
          </>
        }
      >
        <strong className="fcnt__titulo">Notas da quinzena</strong>
        <ul className="fcnt__lista">
          {notas.map((n) => (
            <li key={n.id} className="fcnt__item">
              <span className={`fcnt__marca fcnt__marca--${n.tom}`} aria-hidden="true" />
              <span>{n.texto}</span>
            </li>
          ))}
        </ul>
      </InfoPopover>
      {/* O balao so existe aberto: o texto fica aqui para leitor de tela e para o papel (no papel o icone some e a lista aparece). */}
      <ul className="fcnt__texto" data-testid="fc-notas-texto">
        {notas.map((n) => (
          <li key={n.id}>{n.texto}</li>
        ))}
      </ul>
    </div>
  );
}
