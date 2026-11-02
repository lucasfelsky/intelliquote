import type { ReactNode } from 'react';
import Destacar from './Destacar';

// Grade de 2 ou 3 colunas (1 coluna ate 1023); cada celula costuma ser um <Mini>.
export function GradeMini({ colunas, children }: { colunas: 2 | 3; children: ReactNode }) {
  return <div className={colunas === 3 ? 'manual-grade manual-grade--3' : 'manual-grade manual-grade--2'}>{children}</div>;
}

export function Mini({ titulo, children }: { titulo: ReactNode; children: ReactNode }) {
  return (
    <div className="manual-mini">
      <h4 className="manual-mini__titulo">
        <Destacar>{titulo}</Destacar>
      </h4>
      {children}
    </div>
  );
}
