import type { ReactNode } from 'react';
import Destacar from './Destacar';
import RegiaoRolavel from './RegiaoRolavel';

interface FiguraProps {
  legenda: ReactNode;
  // Mostra o selo "Exemplo ficticio" antes da legenda (dados inventados).
  exemplo?: boolean;
  // Descricao da figura que rola na horizontal no estreito (vira a regiao focavel "Figura: ..., role na horizontal" so quando de fato rola).
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
        <RegiaoRolavel className="manual-figura__caixa manual-rolagem" nome={`Figura: ${rolagem}, role na horizontal`}>
          {children}
        </RegiaoRolavel>
      ) : (
        <div className="manual-figura__caixa">{children}</div>
      )}
      <figcaption className="manual-figura__legenda">
        {exemplo ? <span className="manual-exemplo">Exemplo fictício</span> : null}
        {exemplo ? ' ' : null}
        <Destacar>{legenda}</Destacar>
      </figcaption>
    </figure>
  );
}
