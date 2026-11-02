import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Perfis() {
  return (
    <Capitulo
      lead={<>Cada pessoa tem um perfil, que vem do Portal COMEX a cada login. O perfil define o que aparece no menu e quais botões ficam disponíveis.</>}
    />
  );
}
