import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Fornecedores() {
  return (
    <Capitulo
      lead={<>Um fornecedor só recebe cotações se estiver <strong>Ativo</strong> e tiver ao menos um contato. As famílias que ele cota decidem em qual pasta ele aparece na hora do envio.</>}
    />
  );
}
