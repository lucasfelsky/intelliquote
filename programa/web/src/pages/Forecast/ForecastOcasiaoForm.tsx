import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  FORECAST_OCASIAO_NOME_MAX,
  FORECAST_OCASIAO_OBS_MAX,
  forecastOcasioesErrorMessage,
  type ForecastOcasiao,
} from '@/services/forecastOcasioes';
import {
  CAMPOS_VAZIOS,
  ETAPAS_EM_ORDEM,
  ORDEM_CAMPOS_OCASIAO,
  ROTULO_ETAPA,
  camposDaOcasiao,
  camposDoModelo,
  montarEdicao,
  nomeDoPais,
  textoEfeito,
  validarOcasiao,
  type CampoOcasiao,
  type CamposOcasiao,
  type OpcaoPais,
} from './forecastOcasioes';
import { MODELOS, type PreenchimentoModelo } from './forecastOcasioesModelos';
import {
  TEXTO_REGIONAL,
  TEXTO_SOMA_POR_CIMA,
  corposPorAlvo,
  resumoDoSalvamento,
  selecaoDoModelo,
  validarAlvos,
  type FonteAtiva,
  type ResultadoAlvo,
  type SelecaoAlvos,
} from './forecastEventosAlvos';
import ForecastEventoAlvos, { AlcanceDaEdicao } from './ForecastEventoAlvos';
import { useGravarEvento } from './useGravarEvento';

interface Props {
  /** Presente = edicao (um registro so). */
  ocasiao?: ForecastOcasiao;
  /** Presente = novo evento com o formulario pre-preenchido pelo modelo (nada gravado ainda). */
  modelo?: PreenchimentoModelo;
  fontesAtivas: FonteAtiva[];
  opcoesPais: readonly OpcaoPais[];
  /** Sem mensagem = cancelou. */
  onVoltar: (mensagem?: string) => void;
}

type ErrosForm = Partial<Record<CampoOcasiao, string>>;

function camposIniciais(ocasiao?: ForecastOcasiao, modelo?: PreenchimentoModelo): CamposOcasiao {
  if (ocasiao) return camposDaOcasiao(ocasiao);
  if (modelo) return camposDoModelo(modelo);
  return CAMPOS_VAZIOS;
}

function tituloDoForm(ocasiao?: ForecastOcasiao, modelo?: PreenchimentoModelo): string {
  if (ocasiao) return `Editar o evento ${ocasiao.name}`;
  if (modelo) {
    const nomeDoModelo = MODELOS.find((m) => m.id === modelo.modeloId)?.nome ?? modelo.nome;
    return `Novo evento a partir do modelo ${nomeDoModelo}`;
  }
  return 'Novo evento';
}

const TEXTO_ALVO: Record<ResultadoAlvo['status'], (r: ResultadoAlvo) => string> = {
  criado: (r) => `${r.rotulo}: criado`,
  duplicado: (r) => `${r.rotulo}: já existia (há outro evento ativo com o mesmo período e etapa; nada mudou)`,
  erro: (r) => `${r.rotulo}: erro — ${r.mensagem ?? ''}`,
  'nao-enviado': (r) => `${r.rotulo}: não enviado`,
};

/** Formulario inline (Novo/Editar). O backend revalida tudo; aqui o erro aparece por campo, antes de enviar. */
export default function ForecastOcasiaoForm({ ocasiao, modelo, fontesAtivas, opcoesPais, onVoltar }: Props) {
  const baseId = useId();
  const id = (campo: string) => `${baseId}-${campo}`;
  const efeitoBloqueado = ocasiao?.effectKind === 'percentual';
  const titulo = useRef<HTMLHeadingElement>(null);
  const botaoSalvar = useRef<HTMLButtonElement>(null);

  const [campos, setCampos] = useState<CamposOcasiao>(() => camposIniciais(ocasiao, modelo));
  const [selecao, setSelecao] = useState<SelecaoAlvos>(() => selecaoDoModelo(modelo));
  const [erros, setErros] = useState<ErrosForm>({});
  const [semMudanca, setSemMudanca] = useState(false);
  const [lote, setLote] = useState<{ nome: string; resultados: ResultadoAlvo[] } | null>(null);
  const nomeDoLote = useRef('');

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const gravar = useGravarEvento(onVoltar, (resultados) => {
    setLote({ nome: nomeDoLote.current, resultados });
    // So o que falhou continua marcado: salvar de novo nao duplica o que ja foi criado ou ja existia.
    const falhou = resultados.filter((r) => r.status === 'erro' || r.status === 'nao-enviado').map((r) => r.alvo);
    setSelecao({
      modo: 'escolhidos',
      paises: falhou.flatMap((a) => (a.tipo === 'pais' ? [a.codigo] : [])),
      fontes: falhou.flatMap((a) => (a.tipo === 'fonte' ? [a.id] : [])),
    });
  });
  const pendente = gravar.isPending;

  // Depois do envio (o botao estava desabilitado), o foco volta ao Salvar para ler o resultado e tentar de novo.
  useEffect(() => {
    if (!pendente && lote) botaoSalvar.current?.focus();
  }, [pendente, lote]);

  const fontesPorId = useMemo(() => new Map(fontesAtivas.map((f) => [f.id, f])), [fontesAtivas]);

  const mudar = <K extends keyof CamposOcasiao>(campo: K, valor: CamposOcasiao[K], limpa?: CampoOcasiao[]) => {
    gravar.reset();
    setSemMudanca(false);
    setLote(null);
    setCampos((c) => ({ ...c, [campo]: valor }));
    if (limpa) setErros((e) => ({ ...e, ...Object.fromEntries(limpa.map((l) => [l, undefined])) }));
  };
  const mudarSelecao = (s: SelecaoAlvos) => {
    gravar.reset();
    setLote(null);
    setSelecao(s);
    setErros((e) => ({ ...e, escopo: undefined, fonte: undefined }));
  };

  const focar = (campo: CampoOcasiao) => {
    // Novo: o erro de alcance vai ao 1o pais da lista; o de fonte, ao campo de busca.
    const alvo = campo === 'escopo' ? (ocasiao ? id(`escopo-${campos.escopo}`) : id('pais')) : id(campo);
    document.getElementById(alvo)?.focus();
  };

  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (pendente) return;
    const { erros: achados, valores } = validarOcasiao(ocasiao ? campos : { ...campos, escopo: 'global' }, {
      efeitoBloqueado,
      fontesAtivas: new Set(fontesPorId.keys()),
      fonteOriginal: ocasiao?.sourceId ?? null,
      escopoOriginal: ocasiao?.scopeType ?? null,
      paisOriginal: ocasiao?.countryCode ?? null,
    });
    const alvos = ocasiao ? null : validarAlvos(selecao, fontesPorId, nomeDoPais);
    const todosErros = { ...achados, ...alvos?.erros };
    setErros(todosErros);
    setSemMudanca(false);
    setLote(null);
    if (!valores || (alvos && !alvos.alvos)) {
      const primeiro = ORDEM_CAMPOS_OCASIAO.find((c) => todosErros[c]);
      if (primeiro) focar(primeiro);
      return;
    }
    nomeDoLote.current = valores.nome;
    if (ocasiao) {
      const corpo = montarEdicao(ocasiao, valores);
      if (corpo === null) {
        setSemMudanca(true);
        return;
      }
      gravar.mutate({ tipo: 'edicao', id: ocasiao.id, corpo, nome: valores.nome });
      return;
    }
    gravar.mutate({ tipo: 'nova', itens: corposPorAlvo(valores, alvos?.alvos ?? [], nomeDoPais), nome: valores.nome });
  };

  const descricao = (campo: CampoOcasiao, extra?: string) =>
    [erros[campo] ? id(`${campo}-erro`) : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
  const erro = (campo: CampoOcasiao) =>
    erros[campo] ? (
      <p className="fcd-erro" id={id(`${campo}-erro`)}>
        {erros[campo]}
      </p>
    ) : null;

  const falhas = lote?.resultados.some((r) => r.status === 'erro' || r.status === 'nao-enviado') ?? false;

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

      {ocasiao ? (
        <AlcanceDaEdicao
          id={id}
          ocasiao={ocasiao}
          campos={campos}
          erros={erros}
          onMudar={mudar}
          fontesAtivas={fontesAtivas}
          opcoesPais={opcoesPais}
          desabilitado={pendente}
        />
      ) : (
        <ForecastEventoAlvos
          id={id}
          selecao={selecao}
          onMudar={mudarSelecao}
          fontesAtivas={fontesAtivas}
          opcoesPais={opcoesPais}
          erroEscopo={erros.escopo}
          erroFonte={erros.fonte}
          desabilitado={pendente}
        />
      )}
      <p className="fcd-dica">{TEXTO_REGIONAL}</p>

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
          Só para datas fixas (ex.: Natal). Datas móveis, como Páscoa e Ano Novo chinês, mudam a cada ano: cadastre um
          evento por ano.
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
              Este evento usa percentual, que a tela não edita. O efeito fica como está; os demais campos podem ser
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
              {TEXTO_SOMA_POR_CIMA}
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
      <div className="fco-vivo" aria-live="polite" aria-atomic="true">
        {lote ? (
          <div className="alert alert--error fco-resultado">
            <p>{resumoDoSalvamento(lote.nome, lote.resultados)}</p>
            <ul>
              {lote.resultados.map((r) => (
                <li key={`${r.alvo.tipo}-${r.rotulo}`}>{TEXTO_ALVO[r.status](r)}</li>
              ))}
            </ul>
            {falhas && <p>Os que deram erro continuam marcados: salve de novo para tentar só eles.</p>}
          </div>
        ) : null}
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={() => onVoltar()} disabled={pendente}>
          Cancelar
        </button>
        <button ref={botaoSalvar} type="submit" className="primary-button" disabled={pendente} aria-busy={pendente}>
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
