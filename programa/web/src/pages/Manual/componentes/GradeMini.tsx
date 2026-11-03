import type { ReactNode } from 'react';
import Destacar from './Destacar';

// Grade de 2 ou 3 colunas (1 coluna ate 1023); cada celula costuma ser um <Mini>.
export function GradeMini({ colunas, children }: { colunas: 2 | 3; children: ReactNode }) {
  return <div className={colunas === 3 ? 'manual-grade manual-grade--3' : 'manual-grade manual-grade--2'}>{children}</div>;
}

// `nivel`: h4 por padrao (o mini fica sob um h3 da secao); nos capitulos que abrem direto com a grade (Respostas, Relatorios) o titulo e h3, sem pular de h2 para h4.
export function Mini({ titulo, children, nivel = 4 }: { titulo: ReactNode; children: ReactNode; nivel?: 3 | 4 }) {
  const Titulo = nivel === 3 ? 'h3' : 'h4';
  return (
    <div className="manual-mini">
      <Titulo className="manual-mini__titulo">
        <Destacar>{titulo}</Destacar>
      </Titulo>
      {children}
    </div>
  );
}
