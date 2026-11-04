import Capitulo from '../componentes/Capitulo';
import RotuloUi from '../componentes/RotuloUi';

export default function Forwarders() {
  return (
    <Capitulo lead="Agentes de carga cujo contato vai no e-mail da Ordem de Compra, para o fornecedor saber com quem combinar o embarque.">
      <ul className="manual-lista" role="list">
        <li>
          <RotuloUi primario icone="plus">
            Novo forwarder
          </RotuloUi>
          : Empresa, Endereço, Website, Observações (uso interno, não vão no e-mail) e de 1 a 20 contatos.
        </li>
        <li>
          <RotuloUi>Definir como padrão</RotuloUi> deixa o forwarder pré-selecionado em toda nova PO. Só um forwarder ativo pode ser o padrão.
        </li>
        <li>Se o forwarder da PO não estiver cadastrado, dá para digitar o contato à mão no próprio envio.</li>
      </ul>
    </Capitulo>
  );
}
