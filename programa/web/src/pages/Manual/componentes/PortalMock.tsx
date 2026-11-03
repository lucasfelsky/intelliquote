import Destacar from './Destacar';
import { PORTAL_DE_EXEMPLO as P } from '../dados';

// Tela do Supplier Portal (em ingles, como o fornecedor ve). So ilustra: os campos nao sao editaveis. O texto vem de dados.ts, entao o destaque da
// busca entra por <Destacar> aqui dentro.
export default function PortalMock() {
  return (
    <div className="manual-portal" role="group" aria-label="Exemplo da tela do portal do fornecedor">
      <Destacar>
        <div className="manual-portal__barra">
          <span>{P.empresa}</span>
          <span>{P.cotacao}</span>
        </div>
        <div className="manual-portal__corpo">
          <div className="manual-portal__campos">
            {P.campos.map((campo) => (
              <div key={campo.rotulo} className="manual-portal__campo">
                <span>{campo.rotulo}</span>
                <span className="manual-portal__valor">{campo.valor}</span>
              </div>
            ))}
          </div>
          <div className="manual-portal__item">
            <div className="manual-portal__item-cabecalho">
              <span>{P.item.nome}</span>
              <span className="badge badge--muted">{P.item.po}</span>
            </div>
            <div className="manual-portal__campos">
              {P.item.precos.map((preco) => (
                <div key={preco.rotulo} className="manual-portal__campo">
                  <span>{preco.rotulo}</span>
                  <span className="manual-portal__valor">
                    {preco.valor}
                    {preco.principal ? <span className="badge">Main</span> : null}
                  </span>
                </div>
              ))}
              <div className="manual-portal__campo">
                <span>{P.item.leadTime.rotulo}</span>
                <span className="manual-portal__valor">{P.item.leadTime.valor}</span>
              </div>
            </div>
            <div className="manual-portal__marcas">
              {P.item.marcas.map((marca) => (
                <span key={marca} className="manual-portal__marca">
                  {marca}
                </span>
              ))}
            </div>
          </div>
          <div className="manual-portal__campo manual-portal__campo--total">
            <span>{P.total.rotulo}</span>
            <span className="manual-portal__valor">{P.total.valor}</span>
          </div>
        </div>
      </Destacar>
    </div>
  );
}
