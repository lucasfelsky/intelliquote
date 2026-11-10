import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import Regua from '../componentes/Regua';
import RotuloUi from '../componentes/RotuloUi';

export default function Fornecedores() {
  return (
    <Capitulo
      lead={
        <>
          Um fornecedor só recebe cotações se estiver <strong>Ativo</strong> e tiver ao menos um contato. As famílias que ele cota decidem em qual pasta ele aparece na hora do envio.
        </>
      }
    >
      <h3 className="manual-secao">Cadastro</h3>
      <ul className="manual-lista" role="list">
        <li>
          <RotuloUi primario icone="plus">
            Novo fornecedor
          </RotuloUi>
          : Nome, País, Website, <strong>Status</strong> (Ativo, Inativo ou Bloqueado), <strong>Prazo de pagamento</strong> (padrão 30 dias, já vem preenchido no portal do fornecedor),{' '}
          <strong>Incoterms aceitos</strong> (nenhum marcado = todos), <strong>Famílias que este fornecedor cota</strong>, Etiquetas e Observações.
        </li>
        <li>
          <strong>Contatos</strong>: use o botão de expandir (ícone +) da linha e depois{' '}
          <RotuloUi icone="plus">Adicionar contato</RotuloUi>. O contato marcado como <strong>principal</strong> recebe os e-mails no “Para”; os demais vão em cópia.
        </li>
        <li>Fornecedor com propostas não pode ser removido. Nesse caso, mude o status para Inativo ou Bloqueado.</li>
      </ul>

      <h3 className="manual-secao">Importar fornecedores</h3>
      <p>
        Em <RotuloUi>Importar planilha</RotuloUi>, clique em <RotuloUi>Baixar modelo</RotuloUi> e preencha as 12 colunas. Regras que mais geram erro:
      </p>
      <ul className="manual-lista" role="list">
        <li>
          Famílias separadas por <code>;</code> e <strong>já cadastradas</strong>. Diferente dos itens, aqui a família não é criada sozinha.
        </li>
        <li>
          Vários contatos na mesma célula, separados por <code>;</code>, na mesma ordem nos campos de nome e e-mail. O primeiro vira o principal (máximo de 20).
        </li>
        <li>Fornecedor com nome já cadastrado é recusado (“Fornecedor já cadastrado”).</li>
      </ul>

      <h3 className="manual-secao">Documentos com vencimento</h3>
      <p>
        Na linha expandida, a seção <strong>Documentos</strong> guarda certificados, licenças e afins: PDF, PNG ou JPEG de até 10 MB. A data de vencimento é opcional: documento sem vencimento fica com o selo “Sem vencimento” e não gera aviso. A lista mostra o selo{' '}
        <span className="badge badge--warning">Doc. vence em 7 d</span> ou <span className="badge badge--danger">Doc. vencido</span> ao lado do nome.
      </p>
      <Figura
        rolagem="régua dos avisos de vencimento"
        legenda="Quando a equipe COMEX recebe o e-mail de aviso de um documento. Os avisos do dia chegam agrupados num único e-mail, com link direto para o fornecedor."
      >
        <Regua />
      </Figura>
    </Capitulo>
  );
}
