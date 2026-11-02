import Capitulo from '../componentes/Capitulo';
import { GradeMini, Mini } from '../componentes/GradeMini';
import RotuloUi from '../componentes/RotuloUi';
import { CARTOES_RELATORIOS } from '../dados';

export default function Relatorios() {
  return (
    <Capitulo
      lead={
        <>
          Indicadores do período escolhido em <strong>De</strong> e <strong>Até</strong> (padrão: últimos 30 dias). Clique em <RotuloUi>Atualizar</RotuloUi> depois de mudar as datas.
        </>
      }
    >
      <GradeMini colunas={3}>
        {CARTOES_RELATORIOS.map((cartao) => (
          <Mini key={cartao.titulo} titulo={cartao.titulo}>
            <p>{cartao.texto}</p>
          </Mini>
        ))}
      </GradeMini>
    </Capitulo>
  );
}
