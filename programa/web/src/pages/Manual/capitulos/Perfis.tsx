import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import MatrizPerfis from '../componentes/MatrizPerfis';

export default function Perfis() {
  return (
    <Capitulo lead="Cada pessoa tem um perfil, que vem do Portal COMEX a cada login. O perfil define o que aparece no menu e quais botões ficam disponíveis.">
      <MatrizPerfis />
      <p className="manual-nota">
        “ver” = consulta sem alterar. “parcial” = o comprador edita os dados da empresa, mas não o gatilho de aprovação nem os parceiros de crédito; e o gestor, nas cotações, gera link novo
        e revoga links existentes.
      </p>
      <Aviso tipo="info">
        <strong>Perfil Comercial.</strong> Quem é da Área Comercial no Portal entra com o perfil <strong>comercial</strong> e vê a tela Solicitações e, no Manual, só este capítulo. Esse
        perfil fica fixo: o login não o troca.
      </Aviso>
    </Capitulo>
  );
}
