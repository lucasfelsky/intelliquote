import type { ReactNode } from 'react';

// Lista numerada so onde a ordem importa; o numero vem do contador do CSS.
export function Passos({ children }: { children: ReactNode }) {
  return (
    <ol className="manual-passos" role="list">
      {children}
    </ol>
  );
}

// O texto do passo (nos, <strong>, pilulas) vai num unico <span>: o .manual-passos__conteudo empilha BLOCOS, entao sem o span cada fragmento viraria uma linha propria.
export function Passo({ children }: { children: ReactNode }) {
  return (
    <li className="manual-passos__item">
      <div className="manual-passos__conteudo">
        <span>{children}</span>
      </div>
    </li>
  );
}
