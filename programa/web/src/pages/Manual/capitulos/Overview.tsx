import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Overview() {
  return (
    <Capitulo
      lead={<>A primeira tela depois do login resume todo o histórico: volume de cotações, comparações, fornecedores ativos e a economia gerada.</>}
    />
  );
}
