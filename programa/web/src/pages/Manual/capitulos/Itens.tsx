import Capitulo from '../componentes/Capitulo';

// Corpo do capitulo: entra nos passos seguintes da fase M (M1 so tem o cabecalho).
export default function Itens() {
  return (
    <Capitulo
      lead={<>O catálogo guarda cada produto com dois nomes: o <strong>nome comercial</strong>, usado pela equipe, e o <strong>nome de mercado</strong>, que é o que o fornecedor vê no portal. As famílias agrupam os itens em pastas.</>}
    />
  );
}
