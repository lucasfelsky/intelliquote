import { useMemo, useState } from 'react';
import type { ForecastOcasiao, ForecastOcasiaoEscopo } from '@/services/forecastOcasioes';
import {
  ROTULO_ESCOPO,
  lerCodigoPais,
  nomeDoPais,
  type CampoOcasiao,
  type CamposOcasiao,
  type OpcaoPais,
} from './forecastOcasioes';
import { textoAplicaA, type FonteAtiva, type SelecaoAlvos } from './forecastEventosAlvos';
import ForecastEventoFontesLista from './ForecastEventoFontesLista';
import ForecastPaisCampo from './ForecastPaisCampo';

const textoFontesDoPais = (n: number): string =>
  n === 0 ? 'nenhuma fonte ativa' : n === 1 ? '1 fonte ativa' : `${n} fontes ativas`;

interface Props {
  id: (campo: string) => string;
  selecao: SelecaoAlvos;
  onMudar: (s: SelecaoAlvos) => void;
  fontesAtivas: readonly FonteAtiva[];
  opcoesPais: readonly OpcaoPais[];
  erroEscopo?: string;
  erroFonte?: string;
  desabilitado: boolean;
}

/** Alcance de um NOVO evento: todas as fontes, ou varios paises e/ou varias fontes (1 registro por alvo ao salvar). */
export default function ForecastEventoAlvos({
  id,
  selecao,
  onMudar,
  fontesAtivas,
  opcoesPais,
  erroEscopo,
  erroFonte,
  desabilitado,
}: Props) {
  const [outro, setOutro] = useState('');
  const [erroOutro, setErroOutro] = useState('');
  const escolhidos = selecao.modo === 'escolhidos';

  // Paises das opcoes + os marcados que vieram de "Outro" (ou do modelo) e nao estao nelas.
  const paises = useMemo(() => {
    const extras = selecao.paises
      .filter((c) => !opcoesPais.some((o) => o.codigo === c))
      .map((codigo) => ({ codigo, nome: codigo }));
    return [...opcoesPais, ...extras];
  }, [opcoesPais, selecao.paises]);

  const fontesDoPais = (codigo: string) => fontesAtivas.filter((f) => f.countryCode === codigo).length;

  const marcarPais = (codigo: string, marcar: boolean) =>
    onMudar({
      ...selecao,
      paises: marcar
        ? selecao.paises.includes(codigo)
          ? selecao.paises
          : [...selecao.paises, codigo]
        : selecao.paises.filter((c) => c !== codigo),
    });

  const adicionarOutro = () => {
    const lido = lerCodigoPais(outro);
    if ('erro' in lido) {
      setErroOutro(lido.erro);
      return;
    }
    setErroOutro('');
    setOutro('');
    marcarPais(lido.codigo, true);
  };

  return (
    <>
      <fieldset
        className="fcd-campo fco-escopo"
        disabled={desabilitado}
        aria-describedby={erroEscopo ? id('escopo-erro') : undefined}
      >
        <legend className="field-label">Alcance</legend>
        <label className="checkbox-field">
          <input
            id={id('escopo-todas')}
            type="radio"
            name={id('escopo')}
            checked={!escolhidos}
            onChange={() => onMudar({ ...selecao, modo: 'todas' })}
          />
          Todas as fontes
        </label>
        <label className="checkbox-field">
          <input
            id={id('escopo-escolhidos')}
            type="radio"
            name={id('escopo')}
            checked={escolhidos}
            onChange={() => onMudar({ ...selecao, modo: 'escolhidos' })}
          />
          Países e/ou fontes escolhidos
        </label>
      </fieldset>

      {escolhidos && (
        <>
          <fieldset className="fco-alvos" disabled={desabilitado}>
            <legend className="field-label">Países</legend>
            <ul className="fco-checklist">
              {paises.map((p, i) => (
                <li key={p.codigo}>
                  <label className="checkbox-field">
                    <input
                      id={i === 0 ? id('pais') : undefined}
                      type="checkbox"
                      checked={selecao.paises.includes(p.codigo)}
                      onChange={(e) => marcarPais(p.codigo, e.target.checked)}
                    />
                    {`${nomeDoPais(p.codigo)} · ${textoFontesDoPais(fontesDoPais(p.codigo))}`}
                  </label>
                </li>
              ))}
            </ul>
            <div className="fco-outro-pais">
              <div className="fcd-campo">
                <label className="field-label" htmlFor={id('pais-outro')}>
                  Outro país (código ISO, 2 letras)
                </label>
                <input
                  id={id('pais-outro')}
                  className="input fco-pais__codigo"
                  maxLength={2}
                  autoCapitalize="characters"
                  autoComplete="off"
                  value={outro}
                  onChange={(e) => {
                    setOutro(e.target.value.toUpperCase());
                    setErroOutro('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      adicionarOutro();
                    }
                  }}
                  aria-invalid={erroOutro ? true : undefined}
                  aria-describedby={erroOutro ? id('pais-erro') : undefined}
                />
              </div>
              <button type="button" className="ghost-button" onClick={adicionarOutro}>
                Adicionar país
              </button>
            </div>
            {erroOutro && (
              <p className="fcd-erro" role="alert" id={id('pais-erro')}>
                {erroOutro}
              </p>
            )}
            {selecao.paises
              .filter((c) => fontesDoPais(c) === 0)
              .map((c) => (
                <p key={c} className="fcd-dica">
                  {`Nenhuma fonte ativa tem ${nomeDoPais(c)} ainda: informe o país das fontes na aba Lead time por fonte.`}
                </p>
              ))}
          </fieldset>
          <ForecastEventoFontesLista
            id={id}
            fontesAtivas={fontesAtivas}
            marcadas={selecao.fontes}
            onMudar={(fontes) => onMudar({ ...selecao, fontes })}
            desabilitado={desabilitado}
            erro={erroFonte}
          />
          {erroEscopo && (
            <p className="fcd-erro" id={id('escopo-erro')}>
              {erroEscopo}
            </p>
          )}
        </>
      )}
      <p className="fcd-dica" id={id('aplica')} aria-live="polite">
        {textoAplicaA(selecao, fontesAtivas, nomeDoPais)}
      </p>
    </>
  );
}

// ---------- edicao de UM registro (o alcance continua editavel, como no PR: troca para outro pais/fonte unico) ----------

interface EdicaoProps {
  id: (campo: string) => string;
  ocasiao: ForecastOcasiao;
  campos: CamposOcasiao;
  erros: Partial<Record<CampoOcasiao, string>>;
  onMudar: <K extends 'escopo' | 'pais' | 'fonte'>(campo: K, valor: CamposOcasiao[K], limpa: CampoOcasiao[]) => void;
  fontesAtivas: readonly FonteAtiva[];
  opcoesPais: readonly OpcaoPais[];
  desabilitado: boolean;
}

const ESCOPOS: ForecastOcasiaoEscopo[] = ['global', 'pais', 'fonte'];

/** Alcance no modo EDITAR: um registro so (sem selecao multipla); o usuario ainda pode trocar para outro pais ou fonte. */
export function AlcanceDaEdicao({ id, ocasiao, campos, erros, onMudar, fontesAtivas, opcoesPais, desabilitado }: EdicaoProps) {
  const fonteInativa =
    ocasiao.sourceId !== null && !fontesAtivas.some((f) => f.id === ocasiao.sourceId)
      ? { id: ocasiao.sourceId, nome: ocasiao.source?.name ?? `Fonte ${ocasiao.sourceId}` }
      : null;
  const ordenadas = [...fontesAtivas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const paisDigitado = campos.pais.trim().toUpperCase();
  const nDoPais = fontesAtivas.filter((f) => f.countryCode === paisDigitado).length;
  const descricao = (campo: CampoOcasiao, extra?: string) =>
    [erros[campo] ? id(`${campo}-erro`) : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
  const erro = (campo: CampoOcasiao) =>
    erros[campo] ? (
      <p className="fcd-erro" id={id(`${campo}-erro`)}>
        {erros[campo]}
      </p>
    ) : null;

  return (
    <>
      <fieldset className="fcd-campo fco-escopo" disabled={desabilitado}>
        <legend className="field-label">Alcance</legend>
        {ESCOPOS.map((e) => (
          <label key={e} className="checkbox-field">
            <input
              id={id(`escopo-${e}`)}
              type="radio"
              name={id('escopo')}
              checked={campos.escopo === e}
              onChange={() => onMudar('escopo', e, ['pais', 'fonte'])}
            />
            {ROTULO_ESCOPO[e]}
          </label>
        ))}
      </fieldset>

      {campos.escopo === 'pais' && (
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('pais')}>
            País
          </label>
          <ForecastPaisCampo
            id={id('pais')}
            rotulo="País"
            valor={campos.pais}
            onMudar={(c) => onMudar('pais', c, ['pais'])}
            opcoes={opcoesPais}
            invalido={Boolean(erros.pais)}
            descritoPor={descricao('pais', paisDigitado.length === 2 ? id('pais-dica') : undefined)}
            desabilitado={desabilitado}
          />
          {paisDigitado.length === 2 && (
            <p className="fcd-dica" id={id('pais-dica')}>
              {nDoPais === 0
                ? 'Nenhuma fonte ativa tem este país ainda: informe o país das fontes na aba Lead time por fonte.'
                : nDoPais === 1
                  ? '1 fonte ativa com este país.'
                  : `${nDoPais} fontes ativas com este país.`}
            </p>
          )}
          {erro('pais')}
        </div>
      )}

      {campos.escopo === 'fonte' && (
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('fonte')}>
            Fonte
          </label>
          <select
            id={id('fonte')}
            className="select"
            value={campos.fonte}
            onChange={(e) => onMudar('fonte', e.target.value, ['fonte'])}
            aria-invalid={erros.fonte ? true : undefined}
            aria-describedby={descricao('fonte')}
            disabled={desabilitado}
          >
            <option value="">Escolha a fonte</option>
            {fonteInativa && <option value={String(fonteInativa.id)}>{fonteInativa.nome} (inativa)</option>}
            {ordenadas.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.nome}
              </option>
            ))}
          </select>
          {erro('fonte')}
        </div>
      )}
    </>
  );
}
