import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Portal() {
  return (
    <Capitulo
      lead={<>O Supplier Portal é em inglês e abre direto pelo link do e-mail. O fornecedor vê os itens pelo nome de mercado e preenche o preço para <strong>cada incoterm</strong> da cotação.</>}
    />
  );
}
