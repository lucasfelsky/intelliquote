import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Respostas() {
  return (
    <Capitulo
      lead={<>A aba <strong>Respostas</strong> reúne todas as propostas. Daqui você negocia, consulta o histórico de preços e encaminha a proposta a um parceiro de crédito.</>}
    />
  );
}
