import type { ReactNode } from 'react';

// Lista numerada so onde a ordem importa; o numero vem do contador do CSS.
export function Passos({ children }: { children: ReactNode }) {
  return (
    <ol className="manual-passos" role="list">
      {children}
    </ol>
  );
}

export function Passo({ children }: { children: ReactNode }) {
  return (
    <li className="manual-passos__item">
      <div className="manual-passos__conteudo">{children}</div>
    </li>
  );
}
