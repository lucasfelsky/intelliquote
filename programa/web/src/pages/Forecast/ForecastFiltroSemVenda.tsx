interface Props {
  mostrar: boolean;
  ocultaveis: number;
  onAlternar: () => void;
}

/** Chave "Mostrar produtos sem venda ha 6 meses ou mais" + aviso (role=status) de quantos estao ocultos. */
export default function ForecastFiltroSemVenda({ mostrar, ocultaveis, onAlternar }: Props) {
  const ocultos = !mostrar && ocultaveis > 0;
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={mostrar}
        className="fc-chave fcsv-chave"
        onClick={onAlternar}
      >
        <span className={mostrar ? 'fc-trilho fc-trilho--on' : 'fc-trilho'} aria-hidden="true">
          <span />
        </span>
        Mostrar produtos sem venda há 6 meses ou mais <span className="fc-filtro__conta">{ocultaveis}</span>
      </button>
      <span role="status" className="fcsv-ocultos">
        {ocultos ? `${ocultaveis} ${ocultaveis === 1 ? 'produto oculto' : 'produtos ocultos'} pelo filtro de sem venda` : ''}
      </span>
    </>
  );
}
