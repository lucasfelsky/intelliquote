import { useEffect, useId, useRef } from 'react';
import type { ForecastLinhasKg, ForecastPrazosEstimativa } from '@/services/forecast';
import { inteiroBr } from './forecastPainel';
import {
  rascunhoInvalido,
  prazosMudaram,
  textoPadraoSalvo,
  textoPadroesAlterados,
  validarDias,
  type CampoPrazo,
  type RascunhoPrazos,
} from './forecastPrazosChegada';

interface Props {
  prazos: ForecastPrazosEstimativa;
  rascunho: RascunhoPrazos;
  onMudar: (sourceId: number, campo: CampoPrazo, texto: string) => void;
  onRecalcular: () => void;
  /** Leitura, recalculo ou gravacao em andamento: a tabela fica travada. */
  ocupado: boolean;
  /** Quantas vezes o recalculo terminou (o foco vai para a mensagem de retorno a cada uma). */
  recalculos: number;
}

function Contagem({ valor }: { valor: ForecastLinhasKg }) {
  if (valor.linhas === 0) return <>—</>;
  return (
    <>
      {inteiroBr(valor.linhas)} {valor.linhas === 1 ? 'linha' : 'linhas'} · {inteiroBr(valor.kg)} kg
    </>
  );
}

interface CampoProps {
  id: string;
  rotulo: string;
  valor: string;
  habilitado: boolean;
  padrao: number;
  onMudar: (texto: string) => void;
}

function CampoDias({ id, rotulo, valor, habilitado, padrao, onMudar }: CampoProps) {
  if (!habilitado) return <span className="fci-prazo__sem" title="Nenhuma linha estimada por este critério">—</span>;
  const erro = validarDias(valor);
  return (
    <div className="fci-prazo__campo">
      <input
        id={id}
        className="input fci-prazo__input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={valor}
        placeholder={String(padrao)}
        aria-label={rotulo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        onChange={(e) => onMudar(e.target.value)}
      />
      {erro && (
        <span id={`${id}-erro`} className="fci-prazo__erro">
          {erro}
        </span>
      )}
    </div>
  );
}

/**
 * Tabela do prazo das chegadas estimadas do FUP, por fonte. Editar os dias nao muda a pre-visualizacao: o botao
 * recalcula com o corpo ja lido e o Confirmar fica bloqueado ate la.
 */
export default function ForecastPrazosPorFonte({ prazos, rascunho, onMudar, onRecalcular, ocupado, recalculos }: Props) {
  const base = useId();
  const retornoRef = useRef<HTMLParagraphElement>(null);
  const mudou = prazosMudaram(rascunho, prazos);
  const invalido = rascunhoInvalido(rascunho, prazos);
  const alterados = textoPadroesAlterados(prazos.padroesAlterados);
  const { semFonte } = prazos;
  const temSemFonte =
    semFonte.prontidao.linhas > 0 || semFonte.etd.linhas > 0;

  // Depois do recalculo o botao se desabilita (nada a recalcular) e perderia o foco: ele vai para a mensagem de retorno.
  useEffect(() => {
    if (recalculos > 0) retornoRef.current?.focus();
  }, [recalculos]);

  return (
    <div className="fci-bloco fci-prazo">
      <h4>Prazo das chegadas estimadas, por fonte</h4>
      <p>
        Chegadas sem ETA usam a data do FUP + o prazo da fonte e ficam marcadas ESTIMADA. Ao confirmar, o prazo usado vira
        o padrão da fonte nas próximas importações.
      </p>
      {alterados && <p className="fci-prazo__alterados">{alterados}</p>}
      {(prazos.fontes.length > 0 || temSemFonte) && (
        <p>
          As linhas e os kg desta tabela incluem as chegadas estimadas que, com o prazo da fonte, caem depois da janela e
          ficam fora do cálculo; por isso podem somar mais que as linhas “Estimadas por…” acima.
        </p>
      )}
      {prazos.fontes.length === 0 && !temSemFonte ? (
        <p>Nenhuma chegada do FUP precisou de estimativa.</p>
      ) : (
        <fieldset className="fci-fieldset" disabled={ocupado}>
          <div className="table-wrapper">
            <table className="table fci-prazo__tabela">
              <caption className="sr-only">Prazo das chegadas estimadas do FUP, por fonte</caption>
              <thead>
                <tr>
                  <th scope="col">Fonte</th>
                  <th scope="col">Por DATA PRONTIDÃO</th>
                  <th scope="col">Prontidão → chegada (dias)</th>
                  <th scope="col">Por ETD</th>
                  <th scope="col">ETD → chegada (dias)</th>
                  <th scope="col">Padrão salvo</th>
                </tr>
              </thead>
              <tbody>
                {prazos.fontes.map((f) => {
                  const linha = rascunho[f.sourceId] ?? {
                    prontidao: String(f.usado.prontidaoDias),
                    etd: String(f.usado.etdDias),
                  };
                  return (
                    <tr key={f.sourceId}>
                      <th scope="row">{f.nome}</th>
                      <td>
                        <Contagem valor={f.prontidao} />
                      </td>
                      <td>
                        <CampoDias
                          id={`${base}-${f.sourceId}-prontidao`}
                          rotulo={`Dias da DATA PRONTIDÃO até a chegada - ${f.nome}`}
                          valor={linha.prontidao}
                          habilitado={f.prontidao.linhas > 0}
                          padrao={prazos.padrao.prontidaoDias}
                          onMudar={(texto) => onMudar(f.sourceId, 'prontidao', texto)}
                        />
                      </td>
                      <td>
                        <Contagem valor={f.etd} />
                      </td>
                      <td>
                        <CampoDias
                          id={`${base}-${f.sourceId}-etd`}
                          rotulo={`Dias do ETD até a chegada - ${f.nome}`}
                          valor={linha.etd}
                          habilitado={f.etd.linhas > 0}
                          padrao={prazos.padrao.etdDias}
                          onMudar={(texto) => onMudar(f.sourceId, 'etd', texto)}
                        />
                      </td>
                      <td>{textoPadraoSalvo(f.salvo)}</td>
                    </tr>
                  );
                })}
                {temSemFonte && (
                  <tr>
                    <th scope="row">Sem fonte no cadastro</th>
                    <td>
                      <Contagem valor={semFonte.prontidao} />
                    </td>
                    <td>{semFonte.prontidao.linhas > 0 ? `${prazos.padrao.prontidaoDias} (padrão)` : '—'}</td>
                    <td>
                      <Contagem valor={semFonte.etd} />
                    </td>
                    <td>{semFonte.etd.linhas > 0 ? `${prazos.padrao.etdDias} (padrão)` : '—'}</td>
                    <td>—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </fieldset>
      )}
      <div className="fci-prazo__acoes">
        <button
          type="button"
          className="ghost-button"
          onClick={onRecalcular}
          disabled={ocupado || !mudou || invalido}
        >
          Recalcular pré-visualização
        </button>
        {mudou && (
          <span className="fci-faltam" role="status">
            {invalido
              ? 'Corrija os dias destacados para recalcular.'
              : 'Você editou prazos: recalcule a pré-visualização antes de confirmar.'}
          </span>
        )}
      </div>
      {recalculos > 0 && !mudou && (
        <p ref={retornoRef} tabIndex={-1} role="status" className="fci-prazo__retorno">
          Pré-visualização recalculada com os prazos informados.
        </p>
      )}
    </div>
  );
}
