interface Props {
  mostrar: boolean;
  ocultaveis: number;
}

/**
 * Aviso (role=status) de quantos produtos o filtro de sem venda esconde. A chave em si mora no menu "Filtros"
 * (`ForecastFiltrosMenu`); o aviso fica de fora do balao para ser anunciado mesmo com ele fechado, e so o leitor de
 * tela o le (a tela ja mostra o contador do botao, a chave e o "N de M produtos").
 */
export default function ForecastFiltroSemVenda({ mostrar, ocultaveis }: Props) {
  const ocultos = !mostrar && ocultaveis > 0;
  return (
    <span role="status" className="fcsv-ocultos sr-only">
      {ocultos ? `${ocultaveis} ${ocultaveis === 1 ? 'produto oculto' : 'produtos ocultos'} pelo filtro de sem venda` : ''}
    </span>
  );
}
