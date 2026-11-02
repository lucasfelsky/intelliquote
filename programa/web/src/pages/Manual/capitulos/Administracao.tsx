import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Administracao() {
  return (
    <Capitulo
      lead={<>Configurações que valem para todo mundo. A maioria se faz uma vez e raramente muda.</>}
    />
  );
}
