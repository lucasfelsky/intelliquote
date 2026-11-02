import { Icon } from '@/components/icons';
import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import { Passo, Passos } from '../componentes/Passos';
import PoAgrupada from '../componentes/PoAgrupada';
import RotuloUi from '../componentes/RotuloUi';
import TabelaManual from '../componentes/TabelaManual';
import CicloStatus from '../figuras/CicloStatus';
import { COTACAO_DE_EXEMPLO as C } from '../dados';

// Seta dentro de uma frase ("Shanghai para Porto de Santos"): o icone e decorativo, entao o leitor de tela ouve "para".
function SetaNoTexto() {
  return (
    <>
      <Icon name="arrow-right" size={13} strokeWidth={2.2} className="manual-seta-texto" />
      <span className="sr-only"> para </span>
    </>
  );
}

export default function CriarCotacao() {
  return (
    <Capitulo
      lead={
        <>
          A cotação define <strong>o quê</strong> (itens e quantidades) e <strong>em que condições</strong> (incoterms, portos, moeda e prazo). Os fornecedores são escolhidos depois, no
          envio.
        </>
      }
      quemFaz={['admin', 'comprador']}
    >
      <Passos>
        <Passo>
          Em <strong>Cotações</strong>, clique em{' '}
          <RotuloUi primario icone="plus">
            Nova cotação
          </RotuloUi>
          .
        </Passo>
        <Passo>
          <strong>Passo 1 · Cotação.</strong> Deixe o <strong>Código</strong> em branco para gerar automaticamente. Marque os <strong>Incoterms aceitáveis</strong> (padrão FOB), confira{' '}
          <strong>Porto de embarque</strong>, <strong>Porto de destino</strong>, <strong>Moeda</strong> (padrão USD) e o <strong>Prazo</strong> de resposta. A <strong>Descrição</strong>{' '}
          aparece para o fornecedor como “Notes from the buyer”.
        </Passo>
        <Passo>
          <strong>Passo 2 · Itens do catálogo.</strong> Clique em <RotuloUi icone="plus">Adicionar item</RotuloUi>, busque o item ou navegue pelas pastas de famílias, e informe{' '}
          <strong>Quantidade</strong>, <strong>Unidade</strong> (KG, UN, M3, L, TON, BOX) e <strong>Notas</strong>.
        </Passo>
        <Passo>
          Clique em <RotuloUi primario>Criar cotação</RotuloUi>. Você pode criar sem itens e completar depois na aba <strong>Itens</strong>, mas só envia com ao menos um item.
        </Passo>
      </Passos>
      <Figura semCaixa exemplo legenda="A cotação que acompanha o restante do manual.">
        <TabelaManual rotulo="a cotação de exemplo">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Valor no exemplo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Código</td>
              <td>
                <strong>{C.codigo}</strong>
              </td>
            </tr>
            <tr>
              <td>Incoterms aceitáveis</td>
              <td>
                <div className="manual-tabela__selos">
                  {C.incoterms.map((incoterm) => (
                    <span key={incoterm} className="badge badge--muted">
                      {incoterm}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
            <tr>
              <td>
                Embarque <SetaNoTexto /> destino
              </td>
              <td>
                {C.embarque} <SetaNoTexto /> {C.destino}
              </td>
            </tr>
            <tr>
              <td>Moeda · prazo</td>
              <td>
                {C.moeda} · resposta até {C.prazo}
              </td>
            </tr>
            <tr>
              <td>Itens</td>
              <td>
                {C.itens.map((item) => (
                  <span key={item.nome} className="manual-tabela__linha">
                    {item.nome} · {item.quantidade}
                  </span>
                ))}
              </td>
            </tr>
          </tbody>
        </TabelaManual>
      </Figura>

      <h3 className="manual-secao">Itens com condições próprias</h3>
      <p>
        Na aba <strong>Itens</strong>, ao adicionar um item, desmarque “Usar o INCOTERM da cotação” (ou “Usar os INCOTERMS da cotação”, quando a cotação aceita mais de um) ou “Usar o porto
        da cotação” para definir um incoterm ou porto só para aquele item. O selo <span className="badge badge--danger">DG</span> aparece quando algum fornecedor informa que o item é carga
        perigosa.
      </p>

      <h3 className="manual-secao">Separar a compra em várias POs</h3>
      <p>
        Quando os itens vão virar pedidos diferentes, clique em <RotuloUi>Agrupar por PO</RotuloUi>. O sistema cria a “PO 1” com todos os itens e uma “PO 2” vazia. Arraste os itens entre os
        grupos ou use <RotuloUi>Mover</RotuloUi>. Renomeie cada PO pelo lápis.
      </p>
      <Figura exemplo legenda="No portal, o fornecedor vê os itens separados nos mesmos grupos.">
        <PoAgrupada />
      </Figura>
      <Aviso tipo="atencao">
        Reagrupar depois do envio <strong>não altera</strong> os e-mails já enviados nem as propostas recebidas. Remover a penúltima PO desfaz o agrupamento.
      </Aviso>

      <h3 className="manual-secao">Status da cotação</h3>
      <Figura
        rolagem="ciclo de status da cotação"
        legenda="Só existem dois estados, aberta e fechada. “Reaberta” é uma cotação aberta de novo: sobe para o topo da lista e passa a contar no mês da reabertura."
      >
        <CicloStatus />
      </Figura>
      <ul className="manual-lista" role="list">
        <li>
          <strong>Reabrir</strong> (admin e gestor) desfaz a escolha da vencedora.
        </li>
        <li>
          <strong>Apagar</strong> (só admin) remove a cotação com as respostas e os itens, e invalida os links dos fornecedores. Não tem volta.
        </li>
        <li>
          Na lista, filtre por <strong>Status</strong>, <strong>Incoterm</strong>, <strong>PO</strong> (enviada ou não) e <strong>Mês</strong>, ou busque por código e produto.
        </li>
      </ul>
    </Capitulo>
  );
}
