import Capitulo from '../componentes/Capitulo';
import EmailExemplo from '../componentes/EmailExemplo';
import Figura from '../componentes/Figura';
import { GradeMini } from '../componentes/GradeMini';
import { Passo, Passos } from '../componentes/Passos';
import RotuloUi from '../componentes/RotuloUi';
import Semana from '../componentes/Semana';

export default function Envio() {
  return (
    <Capitulo
      lead={
        <>
          Cada contato recebe um e-mail em inglês com um <strong>link único</strong> para responder no portal, sem login. Você confere o e-mail antes de disparar.
        </>
      }
      quemFaz={['admin', 'comprador']}
    >
      <Passos>
        <Passo>
          No detalhe da cotação, clique em <RotuloUi primario>Enviar cotação</RotuloUi>.
        </Passo>
        <Passo>
          <strong>Seleção.</strong> Escolha uma pasta. <strong>Famílias desta cotação</strong> já mostra quem cota esses itens. Marque os fornecedores ou use{' '}
          <RotuloUi>Selecionar todos</RotuloUi>. Só aparecem fornecedores ativos.
        </Passo>
        <Passo>
          <strong>Preview.</strong> Ajuste o <strong>Assunto</strong>, a <strong>Validade do link</strong> (1 a 60 dias; a tela sugere 7) e a <strong>Mensagem adicional</strong>, que aparece no
          topo do e-mail. O preview se atualiza enquanto você digita.
        </Passo>
        <Passo>
          Clique em <RotuloUi primario>Enviar agora</RotuloUi>. O resultado mostra cada contato como enviado ou com falha.
        </Passo>
      </Passos>

      <h3 className="manual-secao">Quem recebe o quê</h3>
      <Figura semCaixa exemplo legenda="A opção “Equipe COMEX em cópia só no primeiro e-mail” vem ligada, para a equipe não receber uma cópia por fornecedor.">
        <EmailExemplo />
      </Figura>

      <h3 className="manual-secao">Links do portal</h3>
      <p>
        O botão <RotuloUi>Links do portal</RotuloUi> mostra cada link como <span className="badge badge--warning">Pendente</span>, <span className="badge">Respondido</span> ou{' '}
        <span className="badge badge--muted">Expirado</span>.
      </p>
      <ul className="manual-lista" role="list">
        <li>
          <RotuloUi>Gerar novo link</RotuloUi> cria um link novo, copia para a área de transferência e <strong>desativa o anterior na hora</strong>. Use quando o fornecedor perdeu o e-mail ou
          o link expirou.
        </li>
        <li>
          <RotuloUi>Revogar</RotuloUi> impede o fornecedor de responder por aquele link.
        </li>
        <li>
          <RotuloUi>Gerar para todos os fornecedores</RotuloUi> cria links só para quem ainda não tem um ativo.
        </li>
      </ul>

      <h3 className="manual-secao">Lembretes automáticos</h3>
      <Figura legenda="Horário de Brasília. Quem tem várias cotações pendentes recebe um único e-mail com o resumo.">
        <Semana />
      </Figura>
      <p>
        O fornecedor que ainda não respondeu recebe um lembrete por dia útil, só para o contato principal, com um link novo. O lembrete <strong>para sozinho</strong> quando:
      </p>
      <GradeMini colunas={2}>
        <ul className="manual-lista" role="list">
          <li>o fornecedor respondeu, pelo portal ou por lançamento manual;</li>
          <li>a vencedora foi escolhida ou a PO foi enviada;</li>
          <li>a cotação foi fechada ou apagada;</li>
        </ul>
        <ul className="manual-lista" role="list">
          <li>o prazo da cotação venceu;</li>
          <li>o fornecedor ficou inativo ou bloqueado;</li>
          <li>o link foi criado hoje ou aberto nas últimas 24 horas.</li>
        </ul>
      </GradeMini>
    </Capitulo>
  );
}
