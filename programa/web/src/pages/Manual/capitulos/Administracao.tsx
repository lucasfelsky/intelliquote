import Capitulo from '../componentes/Capitulo';
import RotuloUi from '../componentes/RotuloUi';
import { VARIAVEIS_DE_TEMPLATE } from '../dados';

export default function Administracao() {
  return (
    <Capitulo lead={<>Configurações que valem para todo mundo. A maioria se faz uma vez e raramente muda.</>}>
      <h3 className="manual-secao">Empresa</h3>
      <ul className="manual-lista" role="list">
        <li>
          <strong>Dados da empresa</strong> (razão social, CNPJ, endereço, contatos de compras, logotipo) aparecem nos e-mails automáticos.
        </li>
        <li>
          <strong>Gatilho de Aprovação de Adjudicação (R$)</strong>: acima desse landed cost, só gestor ou admin escolhem a vencedora.
        </li>
        <li>
          <strong>Cópia automática (CC)</strong>: perfis e e-mails externos (até 50) que vão em cópia nos envios.
        </li>
        <li>
          <strong>Avisos de nova solicitação</strong>: quem recebe o e-mail quando o Comercial abre um pedido. Vazio, vai para a equipe COMEX e para a cópia automática.
        </li>
        <li>
          <strong>Parceiros de crédito</strong>: cadastro usado pelo Credit Support.
        </li>
      </ul>

      <h3 className="manual-secao">Usuários</h3>
      <p>
        Só o admin acessa. Quem entra pelo Portal COMEX tem o perfil reajustado pelo Portal a cada login; só o perfil Comercial fica fixo. Ninguém consegue desativar a própria conta nem mudar o
        próprio perfil.
      </p>

      <h3 className="manual-secao">Templates de e-mail</h3>
      <p>
        Sete modelos editáveis: envio de cotação, resposta ao fornecedor, ordem de compra, lembrete, fornecedor não selecionado, aviso de resposta recebida e aviso de resposta do parceiro. Cada um em
        inglês, português ou espanhol. Os chips de variáveis inserem campos que o sistema preenche no envio:
      </p>
      <div className="manual-variaveis">
        {VARIAVEIS_DE_TEMPLATE.map((variavel) => (
          <code key={variavel}>{variavel}</code>
        ))}
      </div>
      <p>
        Todos veem os modelos; só o admin salva. <RotuloUi>Restaurar padrão</RotuloUi> volta ao texto original.
      </p>

      <h3 className="manual-secao">Auditoria</h3>
      <p>
        Admin e gestor consultam quem fez o quê e quando. Filtre por entidade, ação ou autor e use <RotuloUi>Ver diff</RotuloUi> para comparar o antes e o depois.
      </p>

      <h3 className="manual-secao">Minha conta</h3>
      <p>
        Define a assinatura dos e-mails de Ordem de Compra: texto de até 2.000 caracteres e uma imagem PNG ou JPEG de até 300 KB (máximo 600 × 300 px). Sem assinatura, o e-mail termina com “Best
        regards,” + seu nome e e-mail.
      </p>
    </Capitulo>
  );
}
