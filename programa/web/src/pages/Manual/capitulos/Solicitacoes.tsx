import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import { FluxoStatus, Rotulo, Seta } from '../componentes/FluxoStatus';
import { GradeMini, Mini } from '../componentes/GradeMini';
import { Passo, Passos } from '../componentes/Passos';
import RotuloUi from '../componentes/RotuloUi';

export default function Solicitacoes() {
  return (
    <Capitulo
      lead="O Comercial pede ao COMEX a cotação dos itens que um cliente precisa. O COMEX transforma o pedido em cotação e, no fim, o Comercial vê o preço final, sem acesso aos dados do fornecedor."
    >
      <Figura legenda="Status de uma solicitação. A cada mudança, o solicitante recebe um e-mail.">
        <FluxoStatus>
          <span className="badge badge--warning">Pendente</span>
          <Seta />
          <Rotulo>Criar cotação ou Vincular</Rotulo>
          <Seta />
          <span className="badge badge--info">Em cotação</span>
          <Seta />
          <Rotulo>Marcar atendida</Rotulo>
          <Seta />
          <span className="badge">Atendida</span>
        </FluxoStatus>
        <FluxoStatus>
          <Rotulo>A qualquer momento antes de “Atendida”:</Rotulo>
          <Rotulo>Recusar</Rotulo>
          <Seta />
          <span className="badge badge--danger">Recusada</span>
          <Rotulo>(o solicitante vê o motivo)</Rotulo>
        </FluxoStatus>
      </Figura>

      <h3 className="manual-secao">Para o Comercial: pedir uma cotação</h3>
      <Passos>
        <Passo>
          Em <strong>Solicitações</strong>, clique em{' '}
          <RotuloUi primario icone="plus">
            Solicitar uma cotação
          </RotuloUi>
          .
        </Passo>
        <Passo>
          Informe o <strong>Cliente</strong> e <strong>Observações</strong>, se quiser. Os dois são opcionais e o nome do cliente nunca chega ao fornecedor.
        </Passo>
        <Passo>
          Em <strong>Buscar item</strong>, digite ao menos duas letras do nome comercial e clique no resultado. Repita com <RotuloUi icone="plus">Adicionar outro item</RotuloUi> (até 50
          itens).
        </Passo>
        <Passo>
          Para cada item, preencha <strong>Quantidade</strong>, <strong>Unidade</strong> e, se tiver, <strong>Preço-alvo</strong> com a moeda. Use vírgula nos decimais: <code>1.234,50</code>.
        </Passo>
        <Passo>
          Clique em <RotuloUi primario>Enviar</RotuloUi>. O COMEX recebe um e-mail e a solicitação aparece em <strong>Minhas solicitações</strong> como{' '}
          <span className="badge badge--warning">Pendente</span>.
        </Passo>
      </Passos>

      <h3 className="manual-secao">Item que não está no catálogo</h3>
      <p>
        Se a busca não achar o produto, inclua-o como <strong>item novo</strong>: a solicitação passa a ser de desenvolvimento e o COMEX cadastra o item antes de cotar. Nesse caso dá para
        anexar documentos técnicos (TDS, MSDS ou outro), em PDF, PNG ou JPEG, de até 10 MB cada e no máximo 5.
      </p>

      <h3 className="manual-secao">Para o COMEX: atender o pedido</h3>
      <GradeMini colunas={2}>
        <Mini titulo={<RotuloUi>Criar cotação</RotuloUi>}>
          <p>
            Abre a Nova cotação já com itens, quantidades, unidades e preços-alvo. A descrição fica “Solicitação do comercial #N”. O preço-alvo só acompanha o item se estiver na mesma moeda
            da cotação.
          </p>
        </Mini>
        <Mini titulo={<RotuloUi>Vincular a cotação</RotuloUi>}>
          <p>Junta o pedido a uma cotação aberta que já existe. Busque pelo código ou descrição. Itens novos não entram nos links já enviados aos fornecedores.</p>
        </Mini>
        <Mini titulo={<RotuloUi>Marcar atendida</RotuloUi>}>
          <p>
            Disponível quando a cotação tem vencedora com preço para os itens do pedido (o admin pode marcar como atendida sem preço, com uma nota). O Comercial passa a ver o preço final.
          </p>
        </Mini>
        <Mini titulo={<RotuloUi>Recusar</RotuloUi>}>
          <p>Exige um motivo de 3 a 500 caracteres, que o solicitante vai ler.</p>
        </Mini>
      </GradeMini>
    </Capitulo>
  );
}
