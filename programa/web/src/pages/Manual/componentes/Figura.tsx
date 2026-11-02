import type { ReactNode } from 'react';
import Destacar from './Destacar';

interface FiguraProps {
  legenda: ReactNode;
  // Mostra o selo "Exemplo ficticio" antes da legenda (dados inventados).
  exemplo?: boolean;
  // Descricao da figura que rola na horizontal no estreito (vira a regiao focavel "Figura: ..., role na horizontal").
  rolagem?: string;
  // Sem a caixa da figura (tabela larga, que ja tem a propria moldura).
  semCaixa?: boolean;
  children: ReactNode;
}

export default function Figura({ legenda, exemplo = false, rolagem, semCaixa = false, children }: FiguraProps) {
  return (
    <figure className="manual-figura">
      {semCaixa ? (
        children
      ) : rolagem !== undefined ? (
        <div className="manual-figura__caixa manual-rolagem" tabIndex={0} role="region" aria-label={`Figura: ${rolagem}, role na horizontal`}>
          {children}
        </div>
      ) : (
        <div className="manual-figura__caixa">{children}</div>
      )}
      <figcaption className="manual-figura__legenda">
        {exemplo ? <span className="manual-exemplo">Exemplo fictício</span> : null}
        <Destacar>{legenda}</Destacar>
      </figcaption>
    </figure>
  );
}
