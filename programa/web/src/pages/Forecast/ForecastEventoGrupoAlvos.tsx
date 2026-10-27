import type { ForecastOcasiao } from '@/services/forecastOcasioes';
import { ROTULO_SITUACAO, situacaoDaOcasiao, textoAlcance } from './forecastOcasioes';
import { CLASSE_SITUACAO, type GrupoEvento } from './forecastEventosAlvos';

interface AcoesProps {
  o: ForecastOcasiao;
  /** Nome do evento (rotulos de acessibilidade). */
  nome: string;
  /** Alcance do registro; presente so quando ha varios alvos no grupo (desambigua os rotulos). */
  alcance?: string;
  pendente: boolean;
  registrarBotao: (chave: string, el: HTMLButtonElement | null) => void;
  onEditar: (o: ForecastOcasiao) => void;
  onAlternar: (o: ForecastOcasiao) => void;
  onExcluir: (o: ForecastOcasiao) => void;
  className?: string;
}

/** Editar, Inativar/Reativar e Excluir de UM registro (linha unica ou alvo de um grupo). */
export function AcoesDoRegistro({
  o,
  nome,
  alcance,
  pendente,
  registrarBotao,
  onEditar,
  onAlternar,
  onExcluir,
  className = 'row-actions fco-acoes',
}: AcoesProps) {
  const sufixo = alcance ? ` (${alcance})` : '';
  return (
    <div className={className} role="group" aria-label={`Ações do evento ${nome}${sufixo}`}>
      <button
        ref={(el) => registrarBotao(`editar-${o.id}`, el)}
        type="button"
        className="ghost-button"
        aria-label={`Editar o evento ${nome}${sufixo}`}
        onClick={() => onEditar(o)}
        disabled={pendente}
      >
        Editar
      </button>
      <button
        ref={(el) => registrarBotao(`alternar-${o.id}`, el)}
        type="button"
        className="ghost-button"
        aria-label={`${o.isActive ? 'Inativar' : 'Reativar'} o evento ${nome}${sufixo}`}
        onClick={() => onAlternar(o)}
        disabled={pendente}
      >
        {o.isActive ? 'Inativar' : 'Reativar'}
      </button>
      <button
        ref={(el) => registrarBotao(`excluir-${o.id}`, el)}
        type="button"
        className="ghost-button danger-button"
        aria-label={`Excluir o evento ${nome}${sufixo}`}
        onClick={() => onExcluir(o)}
        disabled={pendente}
      >
        Excluir
      </button>
    </div>
  );
}

interface Props {
  grupo: GrupoEvento;
  hoje: string;
  podeEditar: boolean;
  pendente: boolean;
  registrarBotao: (chave: string, el: HTMLButtonElement | null) => void;
  onEditar: (o: ForecastOcasiao) => void;
  onAlternar: (o: ForecastOcasiao) => void;
  onExcluir: (o: ForecastOcasiao) => void;
  nomeDoPais: (codigo: string | null | undefined) => string;
}

/** Linha expandida de um grupo: um item por alvo, com a situacao e (para quem edita) as acoes daquele registro. */
export default function ForecastEventoGrupoAlvos({ grupo, hoje, podeEditar, nomeDoPais, ...acoes }: Props) {
  return (
    <ul className="fco-grupo-alvos">
      {grupo.membros.map((o) => {
        const alcance = textoAlcance(o, nomeDoPais);
        const situacao = situacaoDaOcasiao(o, hoje);
        return (
          <li key={o.id}>
            <span>{alcance}</span>
            <span className={CLASSE_SITUACAO[situacao]}>{ROTULO_SITUACAO[situacao]}</span>
            {podeEditar && (
              <AcoesDoRegistro o={o} nome={grupo.nome} alcance={alcance} className="row-actions" {...acoes} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
