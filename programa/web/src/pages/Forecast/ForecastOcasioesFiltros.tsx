import { useId } from 'react';
import { FORECAST_OCASIOES_LISTA_MAX } from '@/services/forecastOcasioes';
import type { FiltrosOcasioes, OpcaoPais } from './forecastOcasioes';

interface Props {
  filtros: FiltrosOcasioes;
  onMudar: (filtros: FiltrosOcasioes) => void;
  /** So os paises usados em eventos por pais. */
  paises: OpcaoPais[];
  /** So as fontes usadas em eventos por fonte. */
  fontes: Array<{ id: number; nome: string }>;
  anos: number[];
  /** Eventos (grupos) cadastrados e os que passam pelos filtros. */
  total: number;
  visiveis: number;
  /** Registros que o servidor devolveu (o corte de 500 olha registros, nao grupos). Padrao: `total`. */
  registros?: number;
  onLimpar: () => void;
}

// Rotulo curto (cabe no select em larguras medias); a descricao completa vai no title.
const SITUACOES: Array<[FiltrosOcasioes['situacao'], string, string]> = [
  ['ativa', 'Ativos', 'Ativos: em vigor ou futuros'],
  ['passada', 'Passados', 'Passados: sem repetição e já encerrados'],
  ['inativa', 'Inativos', 'Inativos: desligados pelo usuário'],
  ['todas', 'Todos', 'Todas as situações'],
];

const ALCANCES: Array<[FiltrosOcasioes['escopo'], string]> = [
  ['todos', 'Todos'],
  ['global', 'Todas as fontes'],
  ['pais', 'Por país'],
  ['fonte', 'Por fonte'],
];

function textoContagem(total: number, visiveis: number, registros: number): string {
  const plural = (n: number) => (n === 1 ? '1 evento' : `${n} eventos`);
  const base = visiveis === total ? plural(total) : `Mostrando ${visiveis} de ${total} eventos.`;
  if (registros < FORECAST_OCASIOES_LISTA_MAX) return base;
  return `${base.endsWith('.') ? base : `${base}.`} Mostrando os ${FORECAST_OCASIOES_LISTA_MAX} primeiros registros por data de início.`;
}

export default function ForecastOcasioesFiltros({
  filtros,
  onMudar,
  paises,
  fontes,
  anos,
  total,
  visiveis,
  registros,
  onLimpar,
}: Props) {
  const baseId = useId();
  const id = (campo: string) => `${baseId}-${campo}`;
  const mostraPais = filtros.escopo === 'todos' || filtros.escopo === 'pais';
  const mostraFonte = filtros.escopo === 'todos' || filtros.escopo === 'fonte';
  const alterado =
    filtros.situacao !== 'ativa' ||
    filtros.escopo !== 'todos' ||
    filtros.pais !== '' ||
    filtros.fonte !== '' ||
    filtros.ano !== 'todos';

  return (
    <div>
      <div className="fco-filtros">
        <div className="fco-filtro">
          <label className="field-label" htmlFor={id('situacao')}>
            Situação
          </label>
          <select
            id={id('situacao')}
            className="select"
            value={filtros.situacao}
            title={SITUACOES.find(([valor]) => valor === filtros.situacao)?.[2]}
            onChange={(e) => onMudar({ ...filtros, situacao: e.target.value as FiltrosOcasioes['situacao'] })}
          >
            {SITUACOES.map(([valor, rotulo, descricao]) => (
              <option key={valor} value={valor} title={descricao}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="fco-filtro">
          <label className="field-label" htmlFor={id('escopo')}>
            Alcance
          </label>
          <select
            id={id('escopo')}
            className="select"
            value={filtros.escopo}
            onChange={(e) => {
              const escopo = e.target.value as FiltrosOcasioes['escopo'];
              onMudar({
                ...filtros,
                escopo,
                pais: escopo === 'todos' || escopo === 'pais' ? filtros.pais : '',
                fonte: escopo === 'todos' || escopo === 'fonte' ? filtros.fonte : '',
              });
            }}
          >
            {ALCANCES.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>
        {mostraPais && (
          <div className="fco-filtro">
            <label className="field-label" htmlFor={id('pais')}>
              País
            </label>
            <select
              id={id('pais')}
              className="select"
              value={filtros.pais}
              onChange={(e) => onMudar({ ...filtros, pais: e.target.value })}
            >
              <option value="">Todos os países</option>
              {paises.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nome === p.codigo ? p.codigo : `${p.nome} (${p.codigo})`}
                </option>
              ))}
            </select>
          </div>
        )}
        {mostraFonte && (
          <div className="fco-filtro">
            <label className="field-label" htmlFor={id('fonte')}>
              Fonte
            </label>
            <select
              id={id('fonte')}
              className="select"
              value={filtros.fonte}
              onChange={(e) => onMudar({ ...filtros, fonte: e.target.value })}
            >
              <option value="">Todas as fontes</option>
              {fontes.map((f) => (
                <option key={f.id} value={String(f.id)}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="fco-filtro">
          <label className="field-label" htmlFor={id('ano')}>
            Ano
          </label>
          <select
            id={id('ano')}
            className="select"
            value={filtros.ano === 'todos' ? 'todos' : String(filtros.ano)}
            onChange={(e) => onMudar({ ...filtros, ano: e.target.value === 'todos' ? 'todos' : Number(e.target.value) })}
          >
            <option value="todos">Todos os anos</option>
            {anos.map((a) => (
              <option key={a} value={String(a)}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="fcd-dica" aria-live="polite">
        {textoContagem(total, visiveis, registros ?? total)}
      </p>
      {/* Sem resultado, o botao fica no aviso "Nenhum evento com estes filtros." (um so "Limpar filtros" na tela). */}
      {alterado && visiveis > 0 && (
        <button type="button" className="ghost-button ghost-button--sm" onClick={onLimpar}>
          Limpar filtros
        </button>
      )}
    </div>
  );
}
