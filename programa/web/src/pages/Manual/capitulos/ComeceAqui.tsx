import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import { GradeMini, Mini } from '../componentes/GradeMini';
import { Passo, Passos } from '../componentes/Passos';
import RotuloUi from '../componentes/RotuloUi';
import FluxoCompleto from '../figuras/FluxoCompleto';

export default function ComeceAqui() {
  return (
    <Capitulo
      lead={
        <>
          O IntelliQuote centraliza as cotações internacionais da SQ Química. O COMEX monta a cotação, envia aos fornecedores com um link único, recebe as propostas, compara com
          critérios objetivos e manda a Ordem de Compra. Tudo fica registrado.
        </>
      }
    >
      <Figura
        rolagem="fluxo completo de uma compra"
        legenda="O ciclo completo de uma compra. Caixas tracejadas são opcionais: uma cotação também pode nascer direto no COMEX, sem solicitação."
      >
        <FluxoCompleto />
      </Figura>

      <h3 className="manual-secao">Como entrar</h3>
      <Passos>
        <Passo>Abra o IntelliQuote pelo Portal COMEX ou pelo endereço do sistema.</Passo>
        <Passo>
          Use <strong>o mesmo e-mail e a mesma senha do Portal COMEX</strong>. Não existe cadastro separado: no primeiro acesso o seu usuário é criado sozinho, com um perfil derivado
          do Portal (admin e viewer iguais; os demais entram como comprador; quem é da Área Comercial entra como comercial).
        </Passo>
        <Passo>
          Clique em <RotuloUi primario>Entrar</RotuloUi>. A sessão se renova sozinha enquanto a aba estiver aberta. Para sair, use <RotuloUi>Sair</RotuloUi> no rodapé do menu lateral.
        </Passo>
      </Passos>
      <Aviso tipo="info">
        <strong>Esqueceu a senha?</strong> A senha é a do Portal COMEX. Recupere por lá e volte a entrar no IntelliQuote.
      </Aviso>

      <h3 className="manual-secao">Navegação</h3>
      <GradeMini colunas={3}>
        <Mini titulo="Menu lateral">
          <p>
            Mostra só as telas que o seu perfil pode usar. O grupo <strong>Administração</strong> aparece para admin, gestor, comprador e viewer, conforme o caso.
          </p>
        </Mini>
        <Mini titulo="Contador de Solicitações">
          <p>
            O número ao lado de <strong>Solicitações</strong> são os pedidos do Comercial ainda pendentes. Atualiza a cada minuto.
          </p>
        </Mini>
        <Mini titulo="Tema claro ou escuro">
          <p>
            O botão <strong>Tema</strong>, no rodapé do menu lateral, alterna <strong>Automático</strong> (segue o computador), <strong>Noturno</strong> e <strong>Claro</strong>.
          </p>
        </Mini>
      </GradeMini>
      <Aviso tipo="dica">
        <strong>Aviso de nova versão.</strong> Quando o sistema é atualizado aparece a faixa “Há uma nova versão do IntelliQuote”. Salve o que estiver editando e clique em{' '}
        <RotuloUi>Recarregar</RotuloUi>. A página nunca recarrega sozinha, então nada se perde.
      </Aviso>
    </Capitulo>
  );
}
