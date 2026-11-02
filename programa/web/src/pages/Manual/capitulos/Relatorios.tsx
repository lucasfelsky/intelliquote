import Capitulo from '../componentes/Capitulo';

// M5: o rotulo "Atualizar" do lead vira <RotuloUi> quando o componente entrar no capitulo.
// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Relatorios() {
  return (
    <Capitulo
      lead={<>Indicadores do período escolhido em <strong>De</strong> e <strong>Até</strong> (padrão: últimos 30 dias). Clique em <strong>Atualizar</strong> depois de mudar as datas.</>}
    />
  );
}
