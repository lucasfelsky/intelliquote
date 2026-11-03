import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import { Passo, Passos } from '../componentes/Passos';
import RotuloUi from '../componentes/RotuloUi';

export default function OrdemDeCompra() {
  return (
    <Capitulo lead={<>A PO sai por e-mail para o fornecedor com o PDF anexado e o contato do forwarder. Depois, a cotação é concluída com a avaliação do fornecedor.</>}>
      <Passos>
        <Passo>
          Na vencedora, clique em <RotuloUi primario>Enviar Ordem de Compra</RotuloUi>.
        </Passo>
        <Passo>
          Anexe o <strong>PDF da Ordem de Compra</strong> (obrigatório, até 10 MB), escolha o <strong>Forwarder</strong> (o padrão já vem marcado) e confira o contato do despachante. O assunto padrão é
          “Purchase Order - {'{produto}'}”.
        </Passo>
        <Passo>
          Envie. A cotação ganha o selo <span className="badge">PO enviada</span> na lista e os lembretes param. A assinatura do e-mail é a configurada em <a href="#administracao">Minha conta</a>.
        </Passo>
        <Passo>
          O sistema abre <strong>Avaliar fornecedor</strong>: dê de 1 a 5 estrelas para <strong>Preço</strong>, <strong>Prazo</strong> e <strong>Qualidade</strong> (as três ou nenhuma) e, se quiser,
          marque <strong>Avisar não selecionados</strong> para mandar um e-mail aos fornecedores que não venceram.
        </Passo>
        <Passo>
          Admin ou gestor clicam em <RotuloUi primario>Concluir cotação</RotuloUi>. A cotação fica <span className="badge badge--muted">Fechada</span>.
        </Passo>
      </Passos>
      <Aviso tipo="dica">
        As estrelas alimentam o critério <strong>Qualidade</strong> nas próximas comparações. Avaliar sempre deixa o ranking mais justo.
      </Aviso>
    </Capitulo>
  );
}
