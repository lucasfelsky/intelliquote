import Destacar from './Destacar';
import { GRUPOS_DE_PO } from '../dados';

// Itens da cotacao separados em POs (PO 1, PO 2 e a coluna "Sem PO"), como no agrupamento da aba Itens. As colunas viram 1 ate 1023.
export default function PoAgrupada() {
  return (
    <div className="manual-po-colunas">
      {GRUPOS_DE_PO.map((grupo) => (
        <div key={grupo.id} className={grupo.semPo ? 'manual-po manual-po--sem' : 'manual-po'}>
          <Destacar>
            <div className="manual-po__cabecalho">
              <span>{grupo.titulo}</span>
              <span className="badge badge--muted">{grupo.contagem}</span>
            </div>
            {grupo.itens.map((item) => (
              <div key={item.nome} className="manual-po__item">
                <b>{item.nome}</b>
                <span>{item.quantidade}</span>
              </div>
            ))}
            {grupo.dica ? <p className="manual-po__dica">{grupo.dica}</p> : null}
          </Destacar>
        </div>
      ))}
    </div>
  );
}
