import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import { Passo, Passos } from '../componentes/Passos';
import RotuloUi from '../componentes/RotuloUi';
import TabelaManual from '../componentes/TabelaManual';
import { ITENS_DE_EXEMPLO } from '../dados';

export default function Itens() {
  return (
    <Capitulo
      lead={
        <>
          O catálogo guarda cada produto com dois nomes: o <strong>nome comercial</strong>, usado pela equipe, e o <strong>nome de mercado</strong>, que é o que o fornecedor vê no
          portal. As famílias agrupam os itens em pastas.
        </>
      }
    >
      <TabelaManual rotulo="itens de exemplo do catálogo">
        <thead>
          <tr>
            <th>Nome comercial</th>
            <th>Nome de mercado (fornecedor vê)</th>
            <th>Família</th>
            <th>NCM</th>
            <th>DBCorp</th>
          </tr>
        </thead>
        <tbody>
          {ITENS_DE_EXEMPLO.map((item) => (
            <tr key={item.dbcorp}>
              <td>
                <strong>{item.nomeComercial}</strong>
              </td>
              <td>{item.nomeDeMercado}</td>
              <td>{item.familia}</td>
              <td className="manual-tabela__num">{item.ncm}</td>
              <td>{item.dbcorp}</td>
            </tr>
          ))}
        </tbody>
      </TabelaManual>
      <p className="manual-nota">
        <span className="manual-exemplo">Exemplo fictício</span> Os mesmos dois itens aparecem nos exemplos dos próximos capítulos.
      </p>

      <h3 className="manual-secao">Cadastrar um item</h3>
      <ul className="manual-lista" role="list">
        <li>
          Em <strong>Itens</strong>, clique em{' '}
          <RotuloUi primario icone="plus">
            Novo item
          </RotuloUi>{' '}
          e preencha <strong>Nome comercial</strong> e <strong>Nome de mercado / fornecedor</strong> (obrigatórios; o nome de mercado não pode repetir).
        </li>
        <li>
          <strong>NCM</strong> tem exatamente 8 dígitos. <strong>Família</strong>, <strong>Código DBCorp</strong> e <strong>Observações</strong> são opcionais.
        </li>
        <li>
          Item que não se usa mais deve ser <RotuloUi>Inativar</RotuloUi>, não apagado. Marque <strong>Mostrar inativos</strong> para vê-los de novo.
        </li>
      </ul>

      <h3 className="manual-secao">Importar o catálogo por planilha</h3>
      <Passos>
        <Passo>
          Clique em <RotuloUi>Importar</RotuloUi> e escolha um <code>.xlsx</code> com até 500 linhas. A primeira linha é o cabeçalho; as colunas seguem esta ordem: Nome Comercial, Nome de
          Mercado, NCM, Código DB, Família, (coluna ignorada), Notas.
        </Passo>
        <Passo>
          Clique em <RotuloUi>Carregar e Validar</RotuloUi>. O sistema mostra quantos itens são válidos e lista as linhas com erro, que serão ignoradas.
        </Passo>
        <Passo>
          Confira e clique em <RotuloUi primario>Confirmar Importação</RotuloUi>.
        </Passo>
      </Passos>
      <Aviso tipo="dica">
        Família que ainda não existe é <strong>criada automaticamente</strong> na importação de itens, sem diferenciar maiúsculas e minúsculas.
      </Aviso>
    </Capitulo>
  );
}
