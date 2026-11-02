import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import PortalMock from '../componentes/PortalMock';

export default function Portal() {
  return (
    <Capitulo
      lead={
        <>
          O Supplier Portal é em inglês e abre direto pelo link do e-mail. O fornecedor vê os itens pelo nome de mercado e preenche o preço para <strong>cada incoterm</strong> da cotação.
        </>
      }
    >
      <Figura semCaixa exemplo legenda="Proposta da Lianyun Fine Chemicals: 1,62 × 20.000 + 1,77 × 5.000 (benzoato) = US$ 41.250.">
        <PortalMock />
      </Figura>
      <ul className="manual-lista" role="list">
        <li>
          O <strong>Main incoterm</strong> é o que entra no total e na comparação. O preço do incoterm principal tem de ser igual ao preço unitário do item.
        </li>
        <li>
          O fornecedor marca <strong>Temporarily unavailable</strong> no item que não tem e <strong>Dangerous goods</strong> quando o item é carga perigosa. Esse aviso vira o selo DG na
          cotação.
        </li>
        <li>
          <strong>Notes</strong> do fornecedor aparecem para você como <strong>Observações</strong> na resposta.
        </li>
        <li>
          O fornecedor pode <strong>revisar a proposta</strong> enquanto o link valer. Cada envio vira uma nova versão, guardada no histórico, e a revisão desfaz a vencedora já escolhida.
        </li>
        <li>A cada envio do fornecedor, quem gerou o link recebe um e-mail de aviso.</li>
      </ul>
      <Aviso tipo="info">
        <strong>“This page was updated. Please reload it (Ctrl+F5)”.</strong> O fornecedor abriu uma versão antiga do portal. Peça para recarregar com Ctrl+F5 e preencher o preço de cada
        incoterm.
      </Aviso>
    </Capitulo>
  );
}
