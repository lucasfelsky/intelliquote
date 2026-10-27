import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FORECAST_OCASIAO_NOME_MAX,
  FORECAST_OCASIAO_OBS_MAX,
  alterarOcasiao,
  criarOcasiao,
  forecastOcasioesErrorMessage,
  forecastOcasioesKeys,
  ocasiaoSumiu,
  type ForecastOcasiao,
  type ForecastOcasiaoEdicao,
  type ForecastOcasiaoEscopo,
  type ForecastOcasiaoNova,
} from '@/services/forecastOcasioes';
import {
  CAMPOS_VAZIOS,
  ETAPAS_EM_ORDEM,
  ORDEM_CAMPOS_OCASIAO,
  ROTULO_ESCOPO,
  ROTULO_ETAPA,
  camposDaOcasiao,
  camposDoModelo,
  montarCorpoNovo,
  montarEdicao,
  textoEfeito,
  validarOcasiao,
  type CampoOcasiao,
  type CamposOcasiao,
  type OpcaoPais,
} from './forecastOcasioes';
import { MODELOS, type PreenchimentoModelo } from './forecastOcasioesModelos';
import ForecastPaisCampo from './ForecastPaisCampo';

interface Props {
  /** Presente = edicao. */
  ocasiao?: ForecastOcasiao;
  /** Presente = nova ocasiao com o formulario pre-preenchido pelo modelo (nada gravado ainda). */
  modelo?: PreenchimentoModelo;
  fontesAtivas: Array<{ id: number; nome: string; countryCode: string | null }>;
  opcoesPais: readonly OpcaoPais[];
  /** Sem mensagem = cancelou. */
  onVoltar: (mensagem?: string) => void;
}

type Envio =
  | { tipo: 'nova'; corpo: ForecastOcasiaoNova; nome: string }
  | { tipo: 'edicao'; id: number; corpo: ForecastOcasiaoEdicao; nome: string };

const ESCOPOS: ForecastOcasiaoEscopo[] = ['global', 'pais', 'fonte'];

function camposIniciais(ocasiao?: ForecastOcasiao, modelo?: PreenchimentoModelo): CamposOcasiao {
  if (ocasiao) return camposDaOcasiao(ocasiao);
  if (modelo) return camposDoModelo(modelo);
  return CAMPOS_VAZIOS;
}

function tituloDoForm(ocasiao?: ForecastOcasiao, modelo?: PreenchimentoModelo): string {
  if (ocasiao) return `Editar a ocasião ${ocasiao.name}`;
  if (modelo) {
    const nomeDoModelo = MODELOS.find((m) => m.id === modelo.modeloId)?.nome ?? modelo.nome;
    return `Nova ocasião a partir do modelo ${nomeDoModelo}`;
  }
  return 'Nova ocasião';
}

function textoFontesDoPais(n: number): string {
  if (n === 0) return 'Nenhuma fonte ativa tem este país ainda: informe o país das fontes na aba Lead time por fonte.';
  return n === 1 ? '1 fonte ativa com este país.' : `${n} fontes ativas com este país.`;
}

/** Formulario inline (Nova/Editar). O backend revalida tudo; aqui o erro aparece por campo, antes de enviar. */
export default function ForecastOcasiaoForm({ ocasiao, modelo, fontesAtivas, opcoesPais, onVoltar }: Props) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const id = (campo: string) => `${baseId}-${campo}`;
  const efeitoBloqueado = ocasiao?.effectKind === 'percentual';
  const titulo = useRef<HTMLHeadingElement>(null);

  const [campos, setCampos] = useState<CamposOcasiao>(() => camposIniciais(ocasiao, modelo));
  const [erros, setErros] = useState<Partial<Record<CampoOcasiao, string>>>({});
  const [semMudanca, setSemMudanca] = useState(false);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const gravar = useMutation({
    mutationFn: (envio: Envio) =>
      envio.tipo === 'nova' ? criarOcasiao(envio.corpo) : alterarOcasiao(envio.id, envio.corpo),
    onSuccess: async (_salva, envio) => {
      await queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
      onVoltar(envio.tipo === 'nova' ? `Ocasião ${envio.nome} cadastrada.` : `Ocasião ${envio.nome} atualizada.`);
    },
    onError: (err) => {
      if (ocasiaoSumiu(err)) void queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
    },
  });
  const pendente = gravar.isPending;

  const fontesAtivasIds = useMemo(() => new Set(fontesAtivas.map((f) => f.id)), [fontesAtivas]);
  const fonteInativaDaOcasiao =
    ocasiao && ocasiao.sourceId !== null && !fontesAtivasIds.has(ocasiao.sourceId)
      ? { id: ocasiao.sourceId, nome: ocasiao.source?.name ?? `Fonte ${ocasiao.sourceId}` }
      : null;
  const fontesDoSelect = useMemo(
    () => [...fontesAtivas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [fontesAtivas],
  );

  const mudar = <K extends keyof CamposOcasiao>(campo: K, valor: CamposOcasiao[K], limpa?: CampoOcasiao[]) => {
    gravar.reset();
    setSemMudanca(false);
    setCampos((c) => ({ ...c, [campo]: valor }));
    if (limpa) setErros((e) => ({ ...e, ...Object.fromEntries(limpa.map((l) => [l, undefined])) }));
  };

  const focar = (campo: CampoOcasiao) => {
    const alvo = campo === 'escopo' ? id(`escopo-${campos.escopo}`) : id(campo);
    document.getElementById(alvo)?.focus();
  };

  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (pendente) return;
    const { erros: achados, valores } = validarOcasiao(campos, {
      efeitoBloqueado,
      fontesAtivas: fontesAtivasIds,
      fonteOriginal: ocasiao?.sourceId ?? null,
    });
    setErros(achados);
    setSemMudanca(false);
    if (!valores) {
      const primeiro = ORDEM_CAMPOS_OCASIAO.find((c) => achados[c]);
      if (primeiro) focar(primeiro);
      return;
    }
    if (ocasiao) {
      const corpo = montarEdicao(ocasiao, valores);
      if (corpo === null) {
        setSemMudanca(true);
        return;
      }
      gravar.mutate({ tipo: 'edicao', id: ocasiao.id, corpo, nome: valores.nome });
      return;
    }
    gravar.mutate({ tipo: 'nova', corpo: montarCorpoNovo(valores), nome: valores.nome });
  };

  const descricao = (campo: CampoOcasiao, extra?: string) =>
    [erros[campo] ? id(`${campo}-erro`) : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
  const erro = (campo: CampoOcasiao) =>
    erros[campo] ? (
      <p className="fcd-erro" id={id(`${campo}-erro`)}>
        {erros[campo]}
      </p>
    ) : null;

  const paisDigitado = campos.pais.trim().toUpperCase();
  const fontesDoPais = fontesAtivas.filter((f) => f.countryCode === paisDigitado).length;

  return (
    <form className="fcd-form fco-form" onSubmit={aoEnviar} noValidate>
      <h3 className="fcg-titulo" tabIndex={-1} ref={titulo}>
        {tituloDoForm(ocasiao, modelo)}
      </h3>
      {modelo && modelo.avisos.length > 0 && (
        <ul className="fco-avisos">
          {modelo.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <div className="fcd-campo">
        <label className="field-label" htmlFor={id('nome')}>
          Nome
        </label>
        <input
          id={id('nome')}
          className="input"
          maxLength={FORECAST_OCASIAO_NOME_MAX}
          autoComplete="off"
          value={campos.nome}
          onChange={(e) => mudar('nome', e.target.value, ['nome'])}
          aria-invalid={erros.nome ? true : undefined}
          aria-describedby={descricao('nome')}
          disabled={pendente}
        />
        {erro('nome')}
      </div>

      <fieldset className="fcd-campo fco-escopo" disabled={pendente}>
        <legend className="field-label">Alcance</legend>
        {ESCOPOS.map((e) => (
          <label key={e} className="checkbox-field">
            <input
              id={id(`escopo-${e}`)}
              type="radio"
              name={id('escopo')}
              checked={campos.escopo === e}
              onChange={() => mudar('escopo', e, ['pais', 'fonte'])}
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
            onMudar={(c) => mudar('pais', c, ['pais'])}
            opcoes={opcoesPais}
            invalido={Boolean(erros.pais)}
            descritoPor={descricao('pais', paisDigitado.length === 2 ? id('pais-dica') : undefined)}
            desabilitado={pendente}
          />
          {paisDigitado.length === 2 && (
            <p className="fcd-dica" id={id('pais-dica')}>
              {textoFontesDoPais(fontesDoPais)}
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
            onChange={(e) => mudar('fonte', e.target.value, ['fonte'])}
            aria-invalid={erros.fonte ? true : undefined}
            aria-describedby={descricao('fonte')}
            disabled={pendente}
          >
            <option value="">Escolha a fonte</option>
            {fonteInativaDaOcasiao && (
              <option value={String(fonteInativaDaOcasiao.id)}>{fonteInativaDaOcasiao.nome} (inativa)</option>
            )}
            {fontesDoSelect.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.nome}
              </option>
            ))}
          </select>
          {erro('fonte')}
        </div>
      )}

      <div className="fcd-grade">
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('inicio')}>
            Início
          </label>
          <input
            id={id('inicio')}
            className="input"
            type="date"
            value={campos.inicio}
            onChange={(e) => mudar('inicio', e.target.value, ['inicio', 'fim'])}
            aria-invalid={erros.inicio ? true : undefined}
            aria-describedby={descricao('inicio', id('periodo-dica'))}
            disabled={pendente}
          />
          {erro('inicio')}
        </div>
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('fim')}>
            Fim
          </label>
          <input
            id={id('fim')}
            className="input"
            type="date"
            value={campos.fim}
            onChange={(e) => mudar('fim', e.target.value, ['fim'])}
            aria-invalid={erros.fim ? true : undefined}
            aria-describedby={descricao('fim', id('periodo-dica'))}
            disabled={pendente}
          />
          {erro('fim')}
        </div>
      </div>
      <p className="fcd-dica" id={id('periodo-dica')}>
        Datas inclusivas. Até 120 dias.
      </p>

      <div className="fcd-campo">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={campos.anual}
            onChange={(e) => mudar('anual', e.target.checked)}
            aria-describedby={id('anual-dica')}
            disabled={pendente || Boolean(modelo?.movel)}
          />
          Repete todo ano
        </label>
        <p className="fcd-dica" id={id('anual-dica')}>
          Só para datas fixas (ex.: Natal). Datas móveis, como Páscoa e Ano Novo chinês, mudam a cada ano: cadastre uma por
          ano.
        </p>
      </div>

      <div className="fcd-grade">
        <div className="fcd-campo">
          <label className="field-label" htmlFor={id('etapa')}>
            Etapa afetada
          </label>
          <select
            id={id('etapa')}
            className="select"
            value={campos.etapa}
            onChange={(e) => mudar('etapa', e.target.value as CamposOcasiao['etapa'])}
            disabled={pendente}
          >
            {ETAPAS_EM_ORDEM.map((etapa) => (
              <option key={etapa} value={etapa}>
                {ROTULO_ETAPA[etapa]}
              </option>
            ))}
          </select>
        </div>
        {ocasiao && efeitoBloqueado ? (
          <div className="fcd-campo">
            <span className="field-label">Efeito</span>
            <p className="fcd-dica">Efeito: {textoEfeito(ocasiao)}</p>
            <p className="fcd-dica fco-aviso-percentual">
              Esta ocasião usa percentual, que a tela não edita. O efeito fica como está; os demais campos podem ser
              alterados.
            </p>
          </div>
        ) : (
          <div className="fcd-campo">
            <label className="field-label" htmlFor={id('dias')}>
              Dias a mais
            </label>
            <input
              id={id('dias')}
              className="input fcd-input-num"
              inputMode="numeric"
              autoComplete="off"
              value={campos.dias}
              onChange={(e) => mudar('dias', e.target.value, ['dias'])}
              aria-invalid={erros.dias ? true : undefined}
              aria-describedby={descricao('dias', id('dias-dica'))}
              disabled={pendente}
            />
            <p className="fcd-dica" id={id('dias-dica')}>
              Dias a MAIS do que o lead time da fonte já considera (a folga de feriados e o prazo real médio já estão nele).
              Inteiro de 0 a 120.
            </p>
            {erro('dias')}
          </div>
        )}
      </div>

      <div className="fcd-campo">
        <label className="field-label" htmlFor={id('observacao')}>
          Observação (opcional)
        </label>
        <textarea
          id={id('observacao')}
          className="input fcd-motivo"
          rows={2}
          maxLength={FORECAST_OCASIAO_OBS_MAX}
          value={campos.observacao}
          onChange={(e) => mudar('observacao', e.target.value, ['observacao'])}
          aria-invalid={erros.observacao ? true : undefined}
          aria-describedby={descricao('observacao', id('observacao-dica'))}
          disabled={pendente}
        />
        <p className="fcd-dica" id={id('observacao-dica')}>
          ({campos.observacao.length}/{FORECAST_OCASIAO_OBS_MAX})
        </p>
        {erro('observacao')}
      </div>

      {semMudanca && (
        <p className="fcd-dica" role="status">
          Nenhuma alteração para salvar.
        </p>
      )}
      {gravar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastOcasioesErrorMessage(gravar.error, 'salvar')}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={() => onVoltar()} disabled={pendente}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={pendente} aria-busy={pendente}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
