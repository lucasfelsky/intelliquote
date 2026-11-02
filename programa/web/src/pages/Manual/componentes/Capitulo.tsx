import { createContext, useContext, type ReactNode } from 'react';
import Destacar from './Destacar';

// Dados do capitulo que esta sendo desenhado: a pagina (Manual.tsx) fornece, cada capitulo so declara o `lead` e o corpo.
export interface MetaDoCapitulo {
  id: string;
  titulo: string;
  kicker: string;
  oculto: boolean;
}

const MetaContext = createContext<MetaDoCapitulo | null>(null);

export const MetaProvider = MetaContext.Provider;

interface CapituloProps {
  lead?: ReactNode;
  // Perfis que fazem a etapa ("Quem faz: admin comprador").
  quemFaz?: readonly string[];
  children?: ReactNode;
}

export default function Capitulo({ lead, quemFaz, children }: CapituloProps) {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error('Capitulo precisa de MetaProvider (Manual.tsx)');
  const idTitulo = `${meta.id}-titulo`;
  return (
    <section id={meta.id} className="manual-capitulo" aria-labelledby={idTitulo} hidden={meta.oculto} data-manual-capitulo="">
      <Destacar>
        <div className="manual-capitulo__cabecalho">
          <span className="manual-capitulo__kicker">{meta.kicker}</span>
          <h2 id={idTitulo} className="manual-capitulo__titulo" tabIndex={-1}>
            {meta.titulo}
          </h2>
          {lead ? <p className="manual-capitulo__lead">{lead}</p> : null}
          {quemFaz && quemFaz.length > 0 ? (
            <div className="manual-papeis">
              Quem faz:
              {quemFaz.map((papel) => (
                <span key={papel} className="badge">
                  {papel}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {children}
      </Destacar>
    </section>
  );
}
