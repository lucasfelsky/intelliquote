import { Icon } from '@/components/icons';
import Aviso from '../componentes/Aviso';
import Capitulo from '../componentes/Capitulo';
import Figura from '../componentes/Figura';
import RotuloUi from '../componentes/RotuloUi';
import Simulador from '../componentes/Simulador';
import TabelaManual from '../componentes/TabelaManual';
import Waterfall from '../componentes/Waterfall';
import { SIM_FORNECEDORES } from '../dados';
import { formatar } from '../simulador';

export default function Comparacao() {
  return (
    <Capitulo
      lead={
        <>
          A aba <strong>Comparações</strong> ordena as propostas completas por um score. Você escolhe <strong>1 ou 2 critérios</strong> e o ranking se recalcula na hora.
        </>
      }
    >
      <h3 className="manual-secao">Como o score é calculado</h3>
      <p>Cada critério ativo vale até 1 ponto. Com dois critérios, o máximo é 2.</p>
      <TabelaManual rotulo="critérios do score">
        <thead>
          <tr>
            <th>Critério</th>
            <th>Fórmula</th>
            <th>Na prática</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>Preço</strong>
            </td>
            <td>
              <code>menor cesta ÷ cesta da proposta</code>
            </td>
            <td>A mais barata ganha 1,00. Uma 10% mais cara ganha cerca de 0,91.</td>
          </tr>
          <tr>
            <td>
              <strong>Condição de pagamento</strong>
            </td>
            <td>
              <code>dias da proposta ÷ maior prazo</code>
            </td>
            <td>O maior prazo ganha 1,00; metade do prazo, 0,50.</td>
          </tr>
          <tr>
            <td>
              <strong>Incoterm</strong>
            </td>
            <td>
              <code>nível ÷ 5</code>
            </td>
            <td>EXW 1 · FCA/FAS 2 · FOB/CFR/CPT 3 · CIF/CIP/DAP/DPU 4 · DDP 5.</td>
          </tr>
          <tr>
            <td>
              <strong>Qualidade</strong>
            </td>
            <td>
              <code>média das estrelas ÷ 5</code>
            </td>
            <td>Vem das avaliações feitas ao concluir cotações. Sem avaliação, 0.</td>
          </tr>
        </tbody>
      </TabelaManual>
      <p>
        <strong>Cesta</strong> é a soma de preço unitário × quantidade pedida de todos os itens, na moeda da proposta, sem frete, câmbio nem impostos. Em caso de empate, vence o menor preço, depois o
        maior prazo de pagamento, depois o melhor incoterm.
      </p>

      <h3 className="manual-secao">Simulador</h3>
      <Figura
        exemplo
        legenda="Clique nos critérios. Só com Preço, a Qingdao Harbor vence por ser a mais barata. Com Preço + Pagamento, a Jinhai passa à frente pelos 90 dias de prazo. Na aba Comparações o ranking começa só com Preço."
      >
        <Simulador />
      </Figura>
      <TabelaManual rotulo="propostas do simulador">
        <thead>
          <tr>
            <th>Fornecedor</th>
            <th className="manual-tabela__num">Cesta (US$)</th>
            <th className="manual-tabela__num">Pagamento</th>
            <th>Incoterm</th>
            <th className="manual-tabela__num">Qualidade</th>
          </tr>
        </thead>
        <tbody>
          {SIM_FORNECEDORES.map((f) => (
            <tr key={f.nome}>
              <td>
                <strong>{f.nome}</strong>
              </td>
              <td className="manual-tabela__num">{formatar(f.cesta, 0)}</td>
              <td className="manual-tabela__num">{f.dias} dias</td>
              <td>
                {f.incoterm} (nível {f.nivel})
              </td>
              <td className="manual-tabela__num">
                {f.qualidade ? (
                  <>
                    {formatar(f.qualidade, 1)} <Icon name="star" size={12} className="manual-estrela" />
                  </>
                ) : (
                  'sem avaliação'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TabelaManual>

      <h3 className="manual-secao">Fora do ranking</h3>
      <p>
        Proposta com item indisponível, item faltando, quantidade diferente ou alternativa de parceiro desatualizada fica abaixo do ranking, com o motivo. Se só faltam itens, você ainda pode usar{' '}
        <RotuloUi>Definir como vencedora mesmo assim</RotuloUi>. Para comparar, todas as propostas precisam estar <strong>na mesma moeda</strong>.
      </p>

      <h3 className="manual-secao">Escolher a vencedora</h3>
      <ul className="manual-lista" role="list">
        <li>
          A 1ª colocada recebe o selo <span className="badge">Vencedora</span> e os botões <RotuloUi primario>Enviar Ordem de Compra</RotuloUi> e <RotuloUi>Responder</RotuloUi>.
        </li>
        <li>
          Para escolher outra, use <RotuloUi>Definir como vencedora</RotuloUi>. Se for diferente da calculada, o <strong>motivo é obrigatório</strong> e fica registrado na auditoria.{' '}
          <RotuloUi>Usar vencedora pelo score</RotuloUi> desfaz a escolha manual.
        </li>
        <li>
          Quando parte dos itens fecha com outro fornecedor, use <RotuloUi>Enviar Ordem de Compra</RotuloUi> na proposta não vencedora. A vencedora continua a mesma.
        </li>
      </ul>

      <h3 className="manual-secao">Alçada de aprovação e landed cost</h3>
      <p>
        O landed cost <strong>não muda o ranking</strong>. Ele é registrado na comparação e decide se a escolha precisa de aprovação: acima do gatilho definido em <strong>Empresa</strong>, ou quando
        falta o câmbio da proposta, só gestor ou admin podem adjudicar.
      </p>
      <Figura
        exemplo
        legenda="Proposta da Jinhai (US$ 43.100) com câmbio de 5,42 e alíquotas ilustrativas: o total passa do gatilho de R$ 300.000 e a adjudicação pede aprovação."
      >
        <Waterfall />
      </Figura>
      <TabelaManual rotulo="componentes do landed cost">
        <thead>
          <tr>
            <th>Componente</th>
            <th>Fórmula</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>CIF</strong>
            </td>
            <td>
              <code>preço × câmbio + frete + seguro</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>II</strong>
            </td>
            <td>
              <code>CIF × alíquota de II</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>IPI</strong>
            </td>
            <td>
              <code>(CIF + II) × alíquota de IPI</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>PIS/COFINS</strong>
            </td>
            <td>
              <code>CIF × (PIS + COFINS)</code>
            </td>
          </tr>
          <tr>
            <td>
              <strong>Total landed</strong>
            </td>
            <td>
              <code>CIF + II + IPI + PIS/COFINS + outras taxas</code>
            </td>
          </tr>
        </tbody>
      </TabelaManual>
      <Aviso tipo="info">
        Nas propostas do portal, frete, seguro e impostos ficam zerados. Nelas, o landed é o valor da proposta convertido em reais pela PTAX do Banco Central (USD, EUR, GBP, JPY e CHF).
      </Aviso>
    </Capitulo>
  );
}
