import type { ForecastOcasiao } from '@/services/forecastOcasioes';
import {
  ROTULO_ETAPA,
  ROTULO_SITUACAO,
  situacaoDaOcasiao,
  textoAlcance,
  textoEfeito,
  textoPeriodo,
  type SituacaoOcasiao,
} from './forecastOcasioes';

interface Props {
  /** Ja filtradas e ordenadas. */
  ocasioes: ForecastOcasiao[];
  hoje: string;
  podeEditar: boolean;
  /** Mutacao de inativar/reativar em andamento: trava os botoes. */
  pendente: boolean;
  registrarBotao: (chave: string, el: HTMLButtonElement | null) => void;
  onEditar: (o: ForecastOcasiao) => void;
  onAlternar: (o: ForecastOcasiao) => void;
  onExcluir: (o: ForecastOcasiao) => void;
  nomeDoPais: (codigo: string | null | undefined) => string;
}

const CLASSE_SITUACAO: Record<SituacaoOcasiao, string> = {
  ativa: 'badge',
  passada: 'badge badge--muted',
  inativa: 'badge badge--warning',
};

export default function ForecastOcasioesLista({
  ocasioes,
  hoje,
  podeEditar,
  pendente,
  registrarBotao,
  onEditar,
  onAlternar,
  onExcluir,
  nomeDoPais,
}: Props) {
  return (
    <div className="table-wrapper">
      <table className="table fco-tabela">
        <caption className="sr-only">Ocasiões que afetam o lead time</caption>
        <thead>
          <tr>
            <th scope="col">Ocasião</th>
            <th scope="col">Alcance</th>
            <th scope="col">Período</th>
            <th scope="col">Etapa</th>
            <th scope="col">Efeito</th>
            <th scope="col">Situação</th>
            {podeEditar && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {ocasioes.map((o) => {
            const situacao = situacaoDaOcasiao(o, hoje);
            return (
              <tr key={o.id}>
                <th scope="row">
                  {o.name}
                  {o.notes && <p className="fcd-dica">{o.notes}</p>}
                </th>
                <td data-rotulo="Alcance">{textoAlcance(o, nomeDoPais)}</td>
                <td data-rotulo="Período">{textoPeriodo(o)}</td>
                <td data-rotulo="Etapa">{ROTULO_ETAPA[o.component]}</td>
                <td data-rotulo="Efeito">
                  {textoEfeito(o)}
                  {o.effectKind === 'percentual' && (
                    <>
                      {' '}
                      <span className="badge badge--info">percentual</span>
                    </>
                  )}
                </td>
                <td data-rotulo="Situação">
                  <span className={CLASSE_SITUACAO[situacao]}>{ROTULO_SITUACAO[situacao]}</span>
                </td>
                {podeEditar && (
                  <td data-rotulo="Ações">
                    <div className="row-actions fco-acoes" role="group" aria-label={`Ações da ocasião ${o.name}`}>
                      <button
                        ref={(el) => registrarBotao(`editar-${o.id}`, el)}
                        type="button"
                        className="ghost-button"
                        aria-label={`Editar a ocasião ${o.name}`}
                        onClick={() => onEditar(o)}
                        disabled={pendente}
                      >
                        Editar
                      </button>
                      <button
                        ref={(el) => registrarBotao(`alternar-${o.id}`, el)}
                        type="button"
                        className="ghost-button"
                        aria-label={`${o.isActive ? 'Inativar' : 'Reativar'} a ocasião ${o.name}`}
                        onClick={() => onAlternar(o)}
                        disabled={pendente}
                      >
                        {o.isActive ? 'Inativar' : 'Reativar'}
                      </button>
                      <button
                        ref={(el) => registrarBotao(`excluir-${o.id}`, el)}
                        type="button"
                        className="ghost-button danger-button"
                        aria-label={`Excluir a ocasião ${o.name}`}
                        onClick={() => onExcluir(o)}
                        disabled={pendente}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
