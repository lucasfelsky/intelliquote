import type { ForecastItemSobDemanda } from '@/services/forecast';
import { d1, inteiroBr, mesAbrevDoAnoMes, STATUS_ROTULO } from './forecastPainel';
import {
  APOIO_SOB_DEMANDA,
  textoMotivoSobDemanda,
  textoObservacao,
  tituloSobDemanda,
} from './forecastRelatorioTextos';

interface Props {
  itens: ForecastItemSobDemanda[];
}

function ListaDeMeses({ prefixo, meses }: { prefixo: string; meses: Array<{ anoMes: string; quantidade: number }> }) {
  if (meses.length === 0) {
    return <span className="fcr-fraco">—</span>;
  }
  return (
    <ul className="fcr-andamento">
      {meses.map((m) => (
        <li key={m.anoMes}>
          {prefixo} {mesAbrevDoAnoMes(m.anoMes)}: {inteiroBr(m.quantidade)}
        </li>
      ))}
    </ul>
  );
}

// Itens marcados como "compra sob demanda" que entrariam na lista de compra: saem dela e ficam aqui, com o motivo e a
// programacao ainda nao coberta por estoque e chegadas. So conferencia; nunca voltam sozinhos para a lista.
export default function ForecastRelatorioSobDemanda({ itens }: Props) {
  return (
    <section className="fc-card fcr-grupo fcr-sob-demanda" aria-label="Sob demanda: só com programação do cliente">
      <div className="fcr-scroll" role="region" tabIndex={0} aria-label="Itens sob demanda">
        <table className="fcr-tabela fcr-tabela--compacta">
          <caption className="fcr-caption">{tituloSobDemanda(itens.length)}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Fonte</th>
              <th scope="col">Status</th>
              <th scope="col">Motivo</th>
              <th scope="col" className="fcr-num">
                Demanda
              </th>
              <th scope="col">Programações</th>
              <th scope="col" className="fcr-num">
                Programação descoberta
              </th>
              <th scope="col" className="fcr-num">
                Estoque
              </th>
              <th scope="col">Chegadas</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const obs = textoObservacao(i.obs);
              return (
                <tr key={i.linha} className="fcr-linha">
                  <th scope="row">
                    <div className="fcr-item">
                      <span className="fcr-item__nome">{i.item}</span>
                      <span className="fcr-item__codigos">{i.codigos.join(' · ')}</span>
                      {obs && <span className="fcr-item__obs">{obs}</span>}
                    </div>
                  </th>
                  <td>{i.fonte || 'Sem fonte'}</td>
                  <td>{STATUS_ROTULO[i.status] ?? i.status}</td>
                  <td>{textoMotivoSobDemanda(i.motivo)}</td>
                  <td className="fcr-num">{d1(i.demanda)}</td>
                  <td>
                    <ListaDeMeses prefixo="Programação" meses={i.programacoes} />
                  </td>
                  <td className={i.programacaoDescoberta > 0 ? 'fcr-num fcr-forte fcr-descoberta' : 'fcr-num fcr-fraco'}>
                    {d1(i.programacaoDescoberta)}
                  </td>
                  <td className="fcr-num">{d1(i.estoque)}</td>
                  <td>
                    <ListaDeMeses prefixo="Chegada" meses={i.chegadas} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fcr-sem-consumo__nota">{APOIO_SOB_DEMANDA}</p>
    </section>
  );
}
