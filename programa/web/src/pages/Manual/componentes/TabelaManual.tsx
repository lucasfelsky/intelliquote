import type { ReactNode } from 'react';

interface TabelaManualProps {
  // Nome da tabela para a regiao que rola na horizontal ("Tabela: <rotulo>, role na horizontal").
  rotulo: string;
  children: ReactNode;
}

// Tabela da Suite (.table) dentro de uma regiao focavel: a rolagem horizontal nunca esconde coluna nem acao sem o teclado alcancar.
export default function TabelaManual({ rotulo, children }: TabelaManualProps) {
  return (
    <div className="table-wrapper manual-tabela manual-rolagem" tabIndex={0} role="region" aria-label={`Tabela: ${rotulo}, role na horizontal`}>
      <table className="table manual-tabela__tabela">{children}</table>
    </div>
  );
}
