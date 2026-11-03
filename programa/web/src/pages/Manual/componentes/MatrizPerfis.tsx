import { Icon } from '@/components/icons';
import Destacar from './Destacar';
import TabelaManual from './TabelaManual';
import { MATRIZ_PERFIS, PERFIS, type Marca } from '../dados';

function Celula({ marca }: { marca: Marca }) {
  if (marca === 'sim') {
    return (
      <span className="manual-matriz__sim">
        <Icon name="check" size={12} strokeWidth={2.6} />
        <span className="sr-only">Sim</span>
      </span>
    );
  }
  if (marca === 'nao') {
    return (
      <>
        <span className="manual-matriz__nao" aria-hidden="true">
          —
        </span>
        <span className="sr-only">Não</span>
      </>
    );
  }
  // "ver" = consulta sem alterar; "parcial" = so parte da acao (legenda abaixo da tabela)
  return <span className="manual-matriz__parcial">{marca}</span>;
}

// Matriz de perfis do capitulo 2: 13 acoes x 5 perfis (dados em dados.ts).
export default function MatrizPerfis() {
  return (
    <TabelaManual rotulo="o que cada perfil pode fazer">
      <thead>
        <tr>
          <th>O que a pessoa pode fazer</th>
          {PERFIS.map((perfil) => (
            <th key={perfil} className="manual-tabela__centro">
              {perfil}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MATRIZ_PERFIS.map((linha) => (
          <tr key={linha.texto}>
            <td>
              <Destacar>{linha.texto}</Destacar>
            </td>
            {linha.marcas.map((marca, i) => (
              <td key={PERFIS[i]} className="manual-tabela__centro">
                <Celula marca={marca} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TabelaManual>
  );
}
