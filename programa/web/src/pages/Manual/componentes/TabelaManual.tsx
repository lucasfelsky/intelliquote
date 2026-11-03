import type { ReactNode } from 'react';
import RegiaoRolavel from './RegiaoRolavel';

interface TabelaManualProps {
  // Nome da tabela para a regiao que rola na horizontal ("Tabela: <rotulo>, role na horizontal").
  rotulo: string;
  children: ReactNode;
}

// Tabela da Suite (.table) dentro de uma regiao focavel: quando a rolagem horizontal aparece, o teclado alcanca a regiao (sem rolagem, sem parada de Tab).
export default function TabelaManual({ rotulo, children }: TabelaManualProps) {
  return (
    <RegiaoRolavel className="table-wrapper manual-tabela manual-rolagem" nome={`Tabela: ${rotulo}, role na horizontal`}>
      <table className="table manual-tabela__tabela">{children}</table>
    </RegiaoRolavel>
  );
}
