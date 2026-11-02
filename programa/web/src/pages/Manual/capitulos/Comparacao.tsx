import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Comparacao() {
  return (
    <Capitulo
      lead={<>A aba <strong>Comparações</strong> ordena as propostas completas por um score. Você escolhe <strong>1 ou 2 critérios</strong> e o ranking se recalcula na hora.</>}
    />
  );
}
