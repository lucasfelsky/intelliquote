import { Children, cloneElement, createContext, isValidElement, useContext, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { fatiar } from '../busca';

// Destaque da busca sem mexer no DOM do React: o termo vem por contexto e `Destacar` percorre `children` (strings viram fatias com
// <mark>); nao entra em SVG nem em componente marcado com `semDestaque` (ex.: o simulador).
const TermoContext = createContext('');

export const TermoProvider = TermoContext.Provider;

// Termo de busca ja normalizado ('' = sem busca).
export function useTermo(): string {
  return useContext(TermoContext);
}

export function semDestaque<P extends object>(componente: ComponentType<P>): ComponentType<P> {
  (componente as ComponentType<P> & { semDestaque?: boolean }).semDestaque = true;
  return componente;
}

const TAGS_FORA = new Set(['svg', 'input', 'textarea', 'select', 'option', 'script', 'style', 'mark']);

function ehExcluido(elemento: ReactElement): boolean {
  const tipo = elemento.type;
  if (typeof tipo === 'string') return TAGS_FORA.has(tipo);
  return (tipo as { semDestaque?: boolean }).semDestaque === true;
}

function marcar(no: ReactNode, termo: string): ReactNode {
  if (typeof no === 'string') {
    const fatias = fatiar(no, termo);
    if (fatias.length === 1 && !fatias[0]?.marca) return no;
    return fatias.map((fatia, i) =>
      fatia.marca ? (
        <mark key={i} className="manual-marca">
          {fatia.texto}
        </mark>
      ) : (
        fatia.texto
      ),
    );
  }
  if (!isValidElement(no)) return no;
  const elemento = no as ReactElement<{ children?: ReactNode }>;
  if (ehExcluido(elemento)) return elemento;
  const filhos = elemento.props.children;
  if (filhos === undefined || filhos === null || typeof filhos === 'function') return elemento;
  return cloneElement(elemento, undefined, ...Children.toArray(filhos).map((filho) => marcar(filho, termo)));
}

export default function Destacar({ children }: { children?: ReactNode }) {
  const termo = useContext(TermoContext);
  if (!termo) return <>{children}</>;
  return <>{Children.toArray(children).map((filho) => marcar(filho, termo))}</>;
}
