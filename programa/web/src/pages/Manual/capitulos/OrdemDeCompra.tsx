import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function OrdemDeCompra() {
  return (
    <Capitulo
      lead={<>A PO sai por e-mail para o fornecedor com o PDF anexado e o contato do forwarder. Depois, a cotação é concluída com a avaliação do fornecedor.</>}
    />
  );
}
