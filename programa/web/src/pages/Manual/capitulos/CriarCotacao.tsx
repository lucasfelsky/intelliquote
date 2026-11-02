import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function CriarCotacao() {
  return (
    <Capitulo
      lead={<>A cotação define <strong>o quê</strong> (itens e quantidades) e <strong>em que condições</strong> (incoterms, portos, moeda e prazo). Os fornecedores são escolhidos depois, no envio.</>}
      quemFaz={['admin', 'comprador']}
    />
  );
}
