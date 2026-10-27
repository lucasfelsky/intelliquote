import { useId, useMemo } from 'react';
import Spinner from '@/components/Spinner';
import type { ForecastOcasiaoOcorrencia } from '@/services/forecastOcasioes';
import { MESES_ABREV, colunasDosMeses, posicaoDeHoje, segmentoNoAno } from './forecastOcasioes';
import { dataBr } from './forecastPainel';

export interface LinhaDoTempo {
  id: number;
  nome: string;
  ativa: boolean;
  ocorrencias: ForecastOcasiaoOcorrencia[];
}

interface Props {
  ano: number;
  hoje: string;
  linhas: LinhaDoTempo[];
  carregando: boolean;
  erro: string | null;
  onTentar: () => void;
}

const rotuloDe = (l: Pick<LinhaDoTempo, 'nome' | 'ativa'>): string => (l.ativa ? l.nome : `${l.nome} (inativa)`);

/**
 * Linha do tempo de 12 meses. As ocorrencias (inclusive a recorrencia anual expandida) vem do backend; a barra e so
 * apresentacao (aria-hidden): a tabela logo abaixo traz as mesmas datas em texto.
 */
export default function ForecastOcasioesLinhaDoTempo({ ano, hoje, linhas, carregando, erro, onTentar }: Props) {
  const tituloId = useId();
  const pctHoje = posicaoDeHoje(hoje, ano);

  const datas = useMemo(
    () =>
      linhas
        .flatMap((l) => l.ocorrencias.map((o) => ({ chave: `${l.id}-${o.inicio}`, nome: rotuloDe(l), inicio: o.inicio, fim: o.fim })))
        .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.nome.localeCompare(b.nome, 'pt-BR')),
    [linhas],
  );

  return (
    <section aria-labelledby={tituloId}>
      <h3 className="fcg-titulo" id={tituloId}>
        Linha do tempo de {ano}
      </h3>
      {carregando && (
        <div className="fcd-carregando" role="status">
          <Spinner /> Carregando a linha do tempo…
        </div>
      )}
      {erro && (
        <div className="alert alert--error" role="alert">
          <p className="fcd-alert__texto">{erro}</p>
          <button type="button" className="ghost-button" onClick={onTentar}>
            Tentar de novo
          </button>
        </div>
      )}
      {!carregando && !erro && linhas.length === 0 && (
        <p className="fcd-dica">Nenhuma ocasião em {ano} com estes filtros.</p>
      )}
      {!carregando && !erro && linhas.length > 0 && (
        <>
          <div className="fco-linha" aria-hidden="true">
            <div className="fco-linha__rolagem">
              <div className="fco-linha__grade">
                <div className="fco-linha__fila">
                  <span className="fco-linha__rotulo" />
                  <div className="fco-linha__meses" style={{ gridTemplateColumns: colunasDosMeses(ano) }}>
                    {MESES_ABREV.map((m) => (
                      <span key={m} className="fco-linha__mes">
                        {m}
                      </span>
                    ))}
                    {pctHoje !== null && (
                      <span className="fco-linha__hoje" style={{ left: `${pctHoje}%` }}>
                        <span className="fco-linha__hoje-rotulo">Hoje</span>
                      </span>
                    )}
                  </div>
                </div>
                {linhas.map((l) => (
                  <div key={l.id} className="fco-linha__fila">
                    <span className="fco-linha__rotulo">{rotuloDe(l)}</span>
                    <div className="fco-linha__trilho">
                      {l.ocorrencias.map((o) => {
                        const seg = segmentoNoAno(o, ano);
                        return seg ? (
                          <span
                            key={o.inicio}
                            className={l.ativa ? 'fco-linha__barra' : 'fco-linha__barra fco-linha__barra--inativa'}
                            style={{ left: `${seg.esquerdaPct}%`, width: `${seg.larguraPct}%` }}
                          />
                        ) : null;
                      })}
                      {pctHoje !== null && <span className="fco-linha__hoje" style={{ left: `${pctHoje}%` }} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="table fco-tabela-ano">
              <caption className="fco-legenda">Datas em {ano} (mesma informação da linha do tempo)</caption>
              <thead>
                <tr>
                  <th scope="col">Ocasião</th>
                  <th scope="col">De</th>
                  <th scope="col">Até</th>
                </tr>
              </thead>
              <tbody>
                {datas.map((d) => (
                  <tr key={d.chave}>
                    <th scope="row">{d.nome}</th>
                    <td data-rotulo="De">{dataBr(d.inicio)}</td>
                    <td data-rotulo="Até">{dataBr(d.fim)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
