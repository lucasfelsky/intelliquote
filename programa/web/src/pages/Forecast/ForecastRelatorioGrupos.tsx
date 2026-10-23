import type { ForecastDadosDoGrupo, ForecastItemCobertoPorGrupo } from '@/services/forecast';
import { d1, inteiroBr, STATUS_ROTULO } from './forecastPainel';
import {
  APOIO_COBERTOS_POR_GRUPO,
  textoDemandaIndividual,
  textoMediaSem,
  textoMotivoCobertoPorGrupo,
  textoObservacao,
  textoPrincipalDoGrupo,
  textoResumoDoGrupo,
  tituloCobertosPorGrupo,
} from './forecastRelatorioTextos';

// Grupos de equivalencia (PR 6b) no relatorio de compras: selo, sublinhas dos membros e secao dos cobertos.

/** Selo discreto no item cuja linha e um grupo. */
export function SeloGrupo({ grupo }: { grupo?: ForecastDadosDoGrupo }) {
  return grupo ? (
    <span className="badge badge--info fcg-selo" title="Os membros têm o estoque avaliado somado; a compra sai pelo principal.">
      Grupo de equivalência
    </span>
  ) : null;
}

/** Linha de apoio na celula Item do grupo: quem e o principal. */
export function PrincipalDoGrupo({ grupo }: { grupo: ForecastDadosDoGrupo }) {
  return <span className="fcr-item__grupo">{textoPrincipalDoGrupo(grupo.principalItem)}</span>;
}

/** Sublinhas do grupo: um membro por linha, com os componentes que entram na soma. */
export function SublinhasDoGrupo({ grupo }: { grupo: ForecastDadosDoGrupo }) {
  return (
    <div className="fcg-sublinhas">
      <p className="fcg-sublinhas__resumo">{textoResumoDoGrupo(grupo)}</p>
      <div className="fcg-sublinhas__rolagem">
        <table className="fcr-tabela fcr-tabela--compacta fcg-tabela">
          <caption className="sr-only">Membros do grupo {grupo.nome}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Fonte</th>
              <th scope="col" className="fcr-num">
                Estoque
              </th>
              <th scope="col" className="fcr-num">
                Chegadas
              </th>
              <th scope="col" className="fcr-num">
                Programação
              </th>
              <th scope="col" className="fcr-num">
                Média tri.
              </th>
              <th scope="col" className="fcr-num">
                Demanda individual
              </th>
            </tr>
          </thead>
          <tbody>
            {grupo.membros.map((m) => (
              <tr key={m.productId} className="fcr-linha">
                <th scope="row">
                  <div className="fcr-item">
                    <span className="fcr-item__nome">
                      {m.item}
                      {m.principal && <span className="badge badge--info fcg-selo">Principal</span>}
                    </span>
                    <span className="fcr-item__codigos">{m.codigos.join(' · ')}</span>
                  </div>
                </th>
                <td data-rotulo="Fonte">{m.fonte || 'Sem fonte'}</td>
                <td className="fcr-num" data-rotulo="Estoque">
                  {inteiroBr(m.estoque)}
                </td>
                <td className="fcr-num" data-rotulo="Chegadas">
                  {inteiroBr(m.chegadas)}
                </td>
                <td className="fcr-num" data-rotulo="Programação">
                  {inteiroBr(m.programado)}
                </td>
                <td className="fcr-num" data-rotulo="Média tri.">
                  {d1(m.mediaTrimestral)}
                </td>
                <td className={m.semLeadTime ? 'fcr-num fcr-fraco' : 'fcr-num'} data-rotulo="Demanda individual">
                  {textoDemandaIndividual(m.demandaIndividual)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Props {
  itens: ForecastItemCobertoPorGrupo[];
}

// Membros que entrariam sozinhos na lista de compra, mas o estoque somado do grupo cobre. So conferencia: a secao deixa
// visivel o que o grupo escondeu da lista (grupo errado esconde compra).
export default function ForecastRelatorioGrupos({ itens }: Props) {
  return (
    <section className="fc-card fcr-grupo fcg-cobertos" aria-label="Cobertos pelo grupo de equivalência">
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label="Itens cobertos por grupo de equivalência">
        <table className="fcr-tabela fcr-tabela--compacta">
          <caption className="fcr-caption">{tituloCobertosPorGrupo(itens.length)}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Fonte</th>
              <th scope="col">Status</th>
              <th scope="col" className="fcr-num">
                Demanda individual
              </th>
              <th scope="col">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const obs = textoObservacao(i.obs);
              const mediaSem = textoMediaSem(i.mesesForaDaMedia);
              return (
                <tr key={i.linha} className="fcr-linha">
                  <th scope="row">
                    <div className="fcr-item">
                      <span className="fcr-item__nome">{i.item}</span>
                      <span className="fcr-item__codigos">{i.codigos.join(' · ')}</span>
                      {mediaSem && (
                        <span
                          className="fcr-item__media"
                          title="A média deste item não conta o mês marcado como venda atípica."
                        >
                          {mediaSem}
                        </span>
                      )}
                      {obs && <span className="fcr-item__obs">{obs}</span>}
                    </div>
                  </th>
                  <td>{i.fonte || 'Sem fonte'}</td>
                  <td>{STATUS_ROTULO[i.status] ?? i.status}</td>
                  <td className="fcr-num">{d1(i.demanda)}</td>
                  <td className="fcg-motivo">{textoMotivoCobertoPorGrupo(i)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fcr-sem-consumo__nota">{APOIO_COBERTOS_POR_GRUPO}</p>
    </section>
  );
}
