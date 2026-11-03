import Capitulo from '../componentes/Capitulo';
import Glossario from '../componentes/Glossario';
import { GLOSSARIO } from '../dados';

export default function GlossarioDoManual() {
  return (
    <Capitulo>
      <Glossario termos={GLOSSARIO} />
    </Capitulo>
  );
}
