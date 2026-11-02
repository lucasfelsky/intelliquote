import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function ComeceAqui() {
  return (
    <Capitulo
      lead={<>O IntelliQuote centraliza as cotações internacionais da SQ Química. O COMEX monta a cotação, envia aos fornecedores com um link único, recebe as propostas, compara com critérios objetivos e manda a Ordem de Compra. Tudo fica registrado.</>}
    />
  );
}
