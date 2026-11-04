import Capitulo from '../componentes/Capitulo';
import Faq from '../componentes/Faq';
import { PERGUNTAS_FREQUENTES } from '../dados';

export default function Perguntas() {
  return (
    <Capitulo>
      <Faq perguntas={PERGUNTAS_FREQUENTES} />
    </Capitulo>
  );
}
