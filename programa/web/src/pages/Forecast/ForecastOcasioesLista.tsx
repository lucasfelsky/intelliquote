import { Fragment, useId } from 'react';
import type { ForecastOcasiao } from '@/services/forecastOcasioes';
import { ROTULO_ETAPA, textoAlcance, textoEfeito, textoPeriodo } from './forecastOcasioes';
import { situacaoDoGrupo, type GrupoEvento } from './forecastEventosAlvos';
import ForecastEventoGrupoAlvos, { AcoesDoRegistro } from './ForecastEventoGrupoAlvos';

interface Props {
  /** Ja filtrados e ordenados (1 por conteudo; os alvos ficam em `membros`). */
  grupos: GrupoEvento[];
  /** Chaves dos grupos com a lista de alvos aberta (o estado mora no Panel: a lista desmonta com o formulario). */
  abertos: ReadonlySet<string>;
  onAlternarAberto: (chave: string) => void;
  hoje: string;
  podeEditar: boolean;
  /** Mutacao de inativar/reativar em andamento: trava os botoes. */
  pendente: boolean;
  registrarBotao: (chave: string, el: HTMLButtonElement | null) => void;
  onEditar: (o: ForecastOcasiao) => void;
  onAlternar: (o: ForecastOcasiao) => void;
  onExcluir: (o: ForecastOcasiao) => void;
  onAlternarGrupo: (g: GrupoEvento, ativar: boolean) => void;
  onExcluirGrupo: (g: GrupoEvento) => void;
  nomeDoPais: (codigo: string | null | undefined) => string;
}

export default function ForecastOcasioesLista({
  grupos,
  abertos,
  onAlternarAberto,
  hoje,
  podeEditar,
  pendente,
  registrarBotao,
  onEditar,
  onAlternar,
  onExcluir,
  onAlternarGrupo,
  onExcluirGrupo,
  nomeDoPais,
}: Props) {
  const baseId = useId();
  const acoes = { pendente, registrarBotao, onEditar, onAlternar, onExcluir };
  return (
    <div className="table-wrapper">
      <table className="table fco-tabela">
        <caption className="sr-only">Eventos estrangeiros que afetam o lead time</caption>
        <thead>
          <tr>
            <th scope="col">Evento</th>
            <th scope="col">Alcance</th>
            <th scope="col">Período</th>
            <th scope="col">Etapa</th>
            <th scope="col">Efeito</th>
            <th scope="col">Situação</th>
            {podeEditar && <th scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {grupos.map((g, indice) => {
            const o = g.membros[0];
            if (!o) return null;
            const n = g.membros.length;
            const situacao = situacaoDoGrupo(g, hoje);
            const aberto = abertos.has(g.chave);
            const idLinha = `${baseId}-alvos-${indice}`;
            const ativos = g.membros.filter((m) => m.isActive).length;
            return (
              <Fragment key={g.chave}>
                <tr>
                  <th scope="row">
                    {g.nome}
                    {g.notas && <p className="fcd-dica">{g.notas}</p>}
                  </th>
                  <td data-rotulo="Alcance">
                    {n === 1 ? (
                      textoAlcance(o, nomeDoPais)
                    ) : (
                      <>
                        <ul className="fco-chips" aria-label={`Alvos do evento ${g.nome}`}>
                          {g.membros.map((m) => (
                            <li key={m.id} className="fco-chip">
                              {textoAlcance(m, nomeDoPais)}
                            </li>
                          ))}
                        </ul>
                        <button
                          ref={(el) => registrarBotao(`alvos-${g.chave}`, el)}
                          type="button"
                          className="ghost-button ghost-button--sm"
                          aria-expanded={aberto}
                          aria-controls={idLinha}
                          onClick={() => onAlternarAberto(g.chave)}
                        >
                          {aberto ? 'Ocultar alvos' : `Ver alvos (${n})`}
                        </button>
                      </>
                    )}
                  </td>
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
                    <span className={situacao.classe}>{situacao.rotulo}</span>
                    {situacao.detalhe && <span className="fcd-dica"> {situacao.detalhe}</span>}
                  </td>
                  {podeEditar && (
                    <td data-rotulo="Ações">
                      {n === 1 ? (
                        <AcoesDoRegistro o={o} nome={g.nome} {...acoes} />
                      ) : (
                        <div className="row-actions fco-acoes" role="group" aria-label={`Ações do evento ${g.nome}`}>
                          <button
                            ref={(el) => registrarBotao(`alternar-grupo-${g.chave}`, el)}
                            type="button"
                            className="ghost-button"
                            aria-label={`${ativos > 0 ? 'Inativar' : 'Reativar'} o evento ${g.nome} em todos os alvos`}
                            onClick={() => onAlternarGrupo(g, ativos === 0)}
                            disabled={pendente}
                          >
                            {ativos > 0 ? `Inativar todos (${ativos})` : `Reativar todos (${n})`}
                          </button>
                          <button
                            ref={(el) => registrarBotao(`excluir-grupo-${g.chave}`, el)}
                            type="button"
                            className="ghost-button danger-button"
                            aria-label={`Excluir o evento ${g.nome} em todos os alvos`}
                            onClick={() => onExcluirGrupo(g)}
                            disabled={pendente}
                          >
                            Excluir todos
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
                {n > 1 && aberto && (
                  <tr className="fco-grupo">
                    <td colSpan={podeEditar ? 7 : 6} id={idLinha} data-rotulo="Alvos">
                      <ForecastEventoGrupoAlvos
                        grupo={g}
                        hoje={hoje}
                        podeEditar={podeEditar}
                        nomeDoPais={nomeDoPais}
                        {...acoes}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
