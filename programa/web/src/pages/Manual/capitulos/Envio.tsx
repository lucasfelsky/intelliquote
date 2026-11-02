import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Envio() {
  return (
    <Capitulo
      lead={<>Cada contato recebe um e-mail em inglês com um <strong>link único</strong> para responder no portal, sem login. Você confere o e-mail antes de disparar.</>}
      quemFaz={['admin', 'comprador']}
    />
  );
}
