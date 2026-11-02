import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Solicitacoes() {
  return (
    <Capitulo
      lead={<>O Comercial pede ao COMEX a cotação dos itens que um cliente precisa. O COMEX transforma o pedido em cotação e, no fim, o Comercial vê o preço final, sem acesso aos dados do fornecedor.</>}
    />
  );
}
