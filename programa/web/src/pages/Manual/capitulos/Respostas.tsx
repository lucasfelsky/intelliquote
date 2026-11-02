import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import { GradeMini, Mini } from '../componentes/GradeMini';
import RotuloUi from '../componentes/RotuloUi';
import TabelaManual from '../componentes/TabelaManual';

export default function Respostas() {
  return (
    <Capitulo
      lead={
        <>
          A aba <strong>Respostas</strong> reúne todas as propostas. Daqui você negocia, consulta o histórico de preços e encaminha a proposta a um parceiro de crédito.
        </>
      }
    >
      <TabelaManual rotulo="propostas de exemplo">
        <thead>
          <tr>
            <th>Fornecedor</th>
            <th>Incoterm</th>
            <th className="manual-tabela__num">Pagamento</th>
            <th className="manual-tabela__num">Lead time</th>
            <th>Sinais</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Lianyun Fine Chemicals</strong>
              <span className="manual-tabela__sub">China · Origem: Shanghai</span>
            </td>
            <td>FOB</td>
            <td className="manual-tabela__num">60 dias</td>
            <td className="manual-tabela__num">25 dias</td>
            <td>
              <div className="manual-tabela__selos">
                <span className="badge badge--info">via portal</span>
              </div>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Jinhai Industrial</strong>
              <span className="manual-tabela__sub">China · Origem: Ningbo</span>
            </td>
            <td>CFR</td>
            <td className="manual-tabela__num">90 dias</td>
            <td className="manual-tabela__num">32 dias</td>
            <td>
              <div className="manual-tabela__selos">
                <span className="badge badge--info">via portal</span>
                <span className="badge badge--warning">1 item de outra origem</span>
              </div>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Shenghua Trading</strong>
              <span className="manual-tabela__sub">China · Origem: Qingdao</span>
            </td>
            <td>FOB</td>
            <td className="manual-tabela__num">45 dias</td>
            <td className="manual-tabela__num">20 dias</td>
            <td>
              <div className="manual-tabela__selos">
                <span className="badge badge--info">via portal</span>
                <span className="badge badge--danger">1 item indisponível</span>
              </div>
            </td>
          </tr>
        </tbody>
      </TabelaManual>
      <p className="manual-nota">
        <span className="manual-exemplo">Exemplo fictício</span> Clique no nome do fornecedor para ver item por item, com preços por incoterm.
      </p>

      <GradeMini colunas={2}>
        <Mini titulo={<RotuloUi>Responder</RotuloUi>}>
          <p>
            Escreve ao fornecedor com <strong>preço-alvo</strong> (um por item, se houver mais de um) e mostra o histórico de negociação. Com a cotação aberta, o e-mail leva um link novo para o
            fornecedor revisar o preço.
          </p>
        </Mini>
        <Mini titulo={<RotuloUi>Histórico</RotuloUi>}>
          <p>Todas as versões da proposta lado a lado, com as células que mudaram em destaque.</p>
        </Mini>
        <Mini titulo={<RotuloUi>Credit Support</RotuloUi>}>
          <p>Encaminha a proposta a um parceiro de crédito, que devolve preço e prazo próprios. A proposta do parceiro entra no ranking como alternativa “via parceiro”.</p>
        </Mini>
        <Mini titulo={<RotuloUi icone="plus">Nova resposta</RotuloUi>}>
          <p>Lança à mão uma proposta recebida fora do portal, com frete, seguro, impostos e câmbio.</p>
        </Mini>
      </GradeMini>

      <Aviso tipo="dica">
        <strong>Copiar alguém na resposta:</strong> escreva <code>@nome@empresa.com</code> no corpo da mensagem e o endereço entra em cópia.
      </Aviso>
      <Aviso tipo="atencao">
        A resposta lançada à mão não registra preço por item. Numa cotação com itens, ela aparece em <strong>Fora do ranking</strong>. Sempre que possível, peça ao fornecedor para responder pelo
        portal.
      </Aviso>
    </Capitulo>
  );
}
