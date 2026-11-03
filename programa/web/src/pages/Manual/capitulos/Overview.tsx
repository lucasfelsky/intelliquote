import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import Kpis from '../componentes/Kpis';
import { KPIS_OVERVIEW } from '../dados';

export default function Overview() {
  return (
    <Capitulo lead="A primeira tela depois do login resume todo o histórico: volume de cotações, comparações, fornecedores ativos e a economia gerada.">
      <Figura exemplo legenda="Os quatro indicadores do topo do Overview.">
        <Kpis itens={KPIS_OVERVIEW} />
      </Figura>
      <ul className="manual-lista" role="list">
        <li>
          <strong>Economia gerada</strong> compara a vencedora com a proposta mais cara de cada comparação.
        </li>
        <li>
          <strong>Top fornecedores</strong> lista os cinco fornecedores com mais vitórias, com respostas, vitórias, taxa de vitória e score médio. Taxa de 50% ou mais ganha destaque.
        </li>
        <li>
          Os números do Overview consideram todo o histórico. Para analisar um período, use <a href="#relatorios">Relatórios</a>.
        </li>
      </ul>
    </Capitulo>
  );
}
