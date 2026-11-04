import type { ReactNode } from 'react';
import RegiaoRolavel from '../Manual/componentes/RegiaoRolavel';

interface Props {
  // Nome da tabela para a regiao que rola na horizontal ("Tabela: <rotulo>, role na horizontal"), igual ao do Manual.
  rotulo: string;
  children: ReactNode;
}

// `.table-wrapper` das tabelas dos modais do Forecast: so vira regiao focavel (tabIndex 0 + role region + nome) quando a tabela de fato
// excede a caixa, para o teclado conseguir rolar (a 390 px, com o papel viewer, nao ha nenhum campo/botao para parar o Tab).
export default function TabelaRolavel({ rotulo, children }: Props) {
  return (
    <RegiaoRolavel className="table-wrapper" nome={`Tabela: ${rotulo}, role na horizontal`}>
      {children}
    </RegiaoRolavel>
  );
}
