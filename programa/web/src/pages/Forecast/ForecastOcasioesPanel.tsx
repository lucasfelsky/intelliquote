import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Spinner from '@/components/Spinner';
import { forecastFontesKeys, listForecastSources, type ForecastFonte } from '@/services/forecastFontes';
import {
  alterarOcasiao,
  forecastOcasioesErrorMessage,
  forecastOcasioesKeys,
  listarOcasioes,
  ocasiaoSumiu,
  type ForecastOcasiao,
} from '@/services/forecastOcasioes';
import {
  FILTROS_PADRAO,
  anoDe,
  anosDoFiltro,
  chaveDataLocal,
  contarSemPais,
  filtrarOcasioes,
  nomeDoPais,
  opcoesDePais,
  ordenarOcasioes,
  paisPorFonte,
  textoAlcance,
  textoFontesSemPais,
  type FiltrosOcasioes,
} from './forecastOcasioes';
import {
  TEXTO_REGIONAL,
  agruparEventos,
  executarEmSequencia,
  resumoEmLote,
} from './forecastEventosAlvos';
import type { PreenchimentoModelo } from './forecastOcasioesModelos';
import ForecastOcasiaoExcluir from './ForecastOcasiaoExcluir';
import ForecastOcasiaoForm from './ForecastOcasiaoForm';
import ForecastOcasioesFiltros from './ForecastOcasioesFiltros';
import ForecastOcasioesLinhaDoTempo, { type LinhaDoTempo } from './ForecastOcasioesLinhaDoTempo';
import ForecastOcasioesLista from './ForecastOcasioesLista';
import ForecastUsarModelo from './ForecastUsarModelo';

interface Props {
  /** admin/comprador cadastram e alteram; os demais so leem. */
  podeEditar: boolean;
  /** AAAA-MM-DD; so os testes passam. Sem ela, vale o dia local do navegador (unica leitura do relogio desta funcionalidade). */
  hoje?: string;
}

type Modo =
  | { tipo: 'lista' }
  | { tipo: 'form'; ocasiao?: ForecastOcasiao; modelo?: PreenchimentoModelo; origem: string }
  | { tipo: 'excluir'; ocasioes: ForecastOcasiao[]; nome: string; origem: string };

interface VariaveisAlternar {
  ocasioes: ForecastOcasiao[];
  ativar: boolean;
  nome: string;
  origem: string;
}

const TEXTO_FIXO =
  'Eventos estrangeiros são períodos no exterior (feriados, fechamento de fábrica, greve, pico de frete) que esticam o lead time. ' +
  'Os dias de cada evento são somados por cima do lead time cadastrado da fonte: a folga FERIADOS do cadastro não é descontada. ' +
  'Por enquanto só informam: nenhum cálculo do Forecast muda.';

/** Conteudo da aba "Eventos estrangeiros" do dialogo ("Fontes e lead time" / "Eventos estrangeiros"). */
export default function ForecastOcasioesPanel({ podeEditar, hoje: hojeProp }: Props) {
  const queryClient = useQueryClient();
  const [hojeLocal] = useState(() => chaveDataLocal(new Date()));
  const hoje = hojeProp ?? hojeLocal;

  const [filtros, setFiltros] = useState<FiltrosOcasioes>(FILTROS_PADRAO);
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [aviso, setAviso] = useState('');
  const [falhaLote, setFalhaLote] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const [focoPara, setFocoPara] = useState<string | null>(null);
  const botoes = useRef(new Map<string, HTMLButtonElement>());
  const topo = useRef<HTMLParagraphElement>(null);

  const anoLinha = filtros.ano === 'todos' ? anoDe(hoje) : filtros.ano;

  const lista = useQuery({ queryKey: forecastOcasioesKeys.lista, queryFn: () => listarOcasioes() });
  // As ocorrencias (recorrencia anual ja expandida) vem do backend: o web nao reimplementa a expansao.
  const doAno = useQuery({
    queryKey: forecastOcasioesKeys.ano(anoLinha),
    queryFn: () => listarOcasioes({ de: `${anoLinha}-01-01`, ate: `${anoLinha}-12-31` }),
    enabled: lista.isSuccess,
  });
  const fontes = useQuery({ queryKey: forecastFontesKeys.todas, queryFn: listForecastSources });

  // Inativar/reativar 1 registro (lanca em erro, como sempre) ou todos os alvos de um grupo (um PATCH por vez).
  const alternar = useMutation({
    mutationFn: async (v: VariaveisAlternar) => {
      const unico = v.ocasioes[0];
      if (unico && v.ocasioes.length === 1) {
        await alterarOcasiao(unico.id, { isActive: v.ativar });
        return null;
      }
      return executarEmSequencia(v.ocasioes, (o) => alterarOcasiao(o.id, { isActive: v.ativar }));
    },
    onSuccess: async (res, v) => {
      await queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
      const verbo = v.ativar ? 'reativado' : 'inativado';
      if (res === null) {
        setAviso(`Evento ${v.nome} ${verbo}.`);
        return;
      }
      const falhas = res.filter((r) => r.naoEnviado || r.erro !== null);
      if (falhas.length === 0) {
        setAviso(resumoEmLote(v.nome, verbo, res.length, 0, null));
        return;
      }
      const primeira = falhas.find((f) => f.erro !== null);
      setFalhaLote(
        resumoEmLote(
          v.nome,
          verbo,
          res.length - falhas.length,
          falhas.length,
          primeira ? forecastOcasioesErrorMessage(primeira.erro, 'salvar') : null,
        ),
      );
    },
    onError: (err) => {
      if (ocasiaoSumiu(err)) void queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
    },
    onSettled: (_dados, _erro, v) => setFocoPara(v.origem),
  });

  // Devolve o foco ao botao que abriu o formulario/confirmacao (ou ao topo se ele nao existe mais).
  useEffect(() => {
    if (focoPara !== null && modo.tipo === 'lista' && !alternar.isPending) {
      (botoes.current.get(focoPara) ?? topo.current)?.focus();
      setFocoPara(null);
    }
  }, [focoPara, modo, alternar.isPending]);

  const registrarBotao = (chave: string, el: HTMLButtonElement | null) => {
    if (el) botoes.current.set(chave, el);
    else botoes.current.delete(chave);
  };

  const todas = useMemo(() => ordenarOcasioes(lista.data ?? []), [lista.data]);
  const visiveis = useMemo(() => filtrarOcasioes(todas, filtros, hoje), [todas, filtros, hoje]);
  // 1 grupo por conteudo (nome, periodo, recorrencia, etapa, efeito e observacao): os alvos ficam em `membros`.
  const grupos = useMemo(() => agruparEventos(visiveis, nomeDoPais), [visiveis]);
  const totalGrupos = useMemo(() => agruparEventos(todas, nomeDoPais).length, [todas]);

  const fontesAtivas = useMemo(
    () =>
      (Array.isArray(fontes.data) ? (fontes.data as ForecastFonte[]) : [])
        .filter((f) => f.isActive)
        .map((f) => ({ id: f.id, nome: f.name, countryCode: f.countryCode ?? null })),
    [fontes.data],
  );
  const mapaPaises = useMemo(() => paisPorFonte(fontes.data), [fontes.data]);
  const avisoSemPais = mapaPaises
    ? textoFontesSemPais(
        contarSemPais(
          fontesAtivas.map((f) => f.id),
          mapaPaises,
        ),
      )
    : null;

  const paisesDasOcasioes = useMemo(
    () => new Set(todas.filter((o) => o.scopeType === 'pais' && o.countryCode).map((o) => o.countryCode as string)),
    [todas],
  );
  const paisesDoFiltro = useMemo(
    () => opcoesDePais(paisesDasOcasioes).filter((o) => paisesDasOcasioes.has(o.codigo)),
    [paisesDasOcasioes],
  );
  const fontesDoFiltro = useMemo(() => {
    const porId = new Map<number, string>();
    for (const o of todas) {
      if (o.scopeType === 'fonte' && o.sourceId !== null) porId.set(o.sourceId, o.source?.name ?? `Fonte ${o.sourceId}`);
    }
    return [...porId].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [todas]);
  const opcoesPaisForm = useMemo(
    () => opcoesDePais([...paisesDasOcasioes, ...fontesAtivas.flatMap((f) => (f.countryCode ? [f.countryCode] : []))]),
    [paisesDasOcasioes, fontesAtivas],
  );

  const linhas = useMemo<LinhaDoTempo[]>(() => {
    const porId = new Map((doAno.data ?? []).map((o) => [o.id, o.ocorrencias ?? []]));
    // Os membros de um grupo tem o mesmo periodo e a mesma recorrencia: uma barra por grupo, com as ocorrencias do 1o.
    return grupos.flatMap((g) => {
      const ocorrencias = g.membros.map((o) => porId.get(o.id) ?? []).find((oc) => oc.length > 0) ?? [];
      return ocorrencias.length > 0
        ? [
            {
              chave: g.chave,
              nome: g.membros.length > 1 ? `${g.nome} (${g.membros.length} alvos)` : g.nome,
              alcance: g.membros.map((o) => textoAlcance(o, nomeDoPais)).join(', '),
              ativa: g.membros.some((o) => o.isActive),
              ocorrencias,
            },
          ]
        : [];
    });
  }, [grupos, doAno.data]);

  const abrirForm = (dados: { ocasiao?: ForecastOcasiao; modelo?: PreenchimentoModelo }, origem: string) => {
    alternar.reset();
    setAviso('');
    setFalhaLote(null);
    setModo({ tipo: 'form', ...dados, origem });
  };
  const aoAlternar = (nome: string, ocasioes: ForecastOcasiao[], ativar: boolean, origem: string) => {
    setAviso('');
    setFalhaLote(null);
    alternar.mutate({ ocasioes, ativar, nome, origem });
  };
  const aoExcluir = (nome: string, ocasioes: ForecastOcasiao[], origem: string) => {
    alternar.reset();
    setAviso('');
    setFalhaLote(null);
    setModo({ tipo: 'excluir', ocasioes, nome, origem });
  };
  const alternarAberto = (chave: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(chave)) novo.add(chave);
      return novo;
    });
  const voltar = (origem: string) => (mensagem?: string) => {
    if (mensagem) setAviso(mensagem);
    setFocoPara(origem);
    setModo({ tipo: 'lista' });
  };

  return (
    <div className="fco-painel">
      <p className="fcd-dica" tabIndex={-1} ref={topo}>
        {TEXTO_FIXO}
      </p>
      <p className="fcd-dica">{TEXTO_REGIONAL}</p>
      {avisoSemPais && <p className="fcd-dica">{avisoSemPais}</p>}
      {!podeEditar && <p className="fcd-dica">Só administrador e comprador cadastram ou alteram eventos.</p>}
      <div className="fco-vivo" role="status" aria-atomic="true">
        {aviso ? <div className="alert alert--success">{aviso}</div> : null}
      </div>
      {alternar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastOcasioesErrorMessage(alternar.error, 'salvar')}
        </div>
      )}
      {falhaLote && (
        <div className="alert alert--error" role="alert">
          {falhaLote}
        </div>
      )}

      {lista.isLoading && (
        <div className="fcd-carregando" role="status">
          <Spinner /> Carregando eventos…
        </div>
      )}
      {lista.isError && (
        <div className="alert alert--error" role="alert">
          <p className="fcd-alert__texto">{forecastOcasioesErrorMessage(lista.error, 'listar')}</p>
          <button type="button" className="ghost-button" onClick={() => void queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.lista })}>
            Tentar de novo
          </button>
        </div>
      )}

      {lista.isSuccess && modo.tipo === 'form' && (
        <ForecastOcasiaoForm
          key={modo.ocasiao?.id ?? modo.modelo?.modeloId ?? 'nova'}
          ocasiao={modo.ocasiao}
          modelo={modo.modelo}
          fontesAtivas={fontesAtivas}
          opcoesPais={opcoesPaisForm}
          onVoltar={voltar(modo.origem)}
        />
      )}
      {lista.isSuccess && modo.tipo === 'excluir' && (
        <ForecastOcasiaoExcluir ocasioes={modo.ocasioes} nome={modo.nome} onVoltar={voltar(modo.origem)} />
      )}

      {lista.isSuccess && modo.tipo === 'lista' && (
        <>
          {podeEditar && (
            <div className="fco-barra">
              <button
                ref={(el) => registrarBotao('nova', el)}
                type="button"
                className="primary-button"
                onClick={() => abrirForm({}, 'nova')}
              >
                Novo evento
              </button>
              <ForecastUsarModelo
                hoje={hoje}
                desabilitado={alternar.isPending}
                registrarBotao={registrarBotao}
                onUsar={(modelo) => abrirForm({ modelo }, 'modelo')}
              />
            </div>
          )}
          {todas.length === 0 ? (
            <p className="empty-state">
              {podeEditar
                ? 'Nenhum evento cadastrado. Use um modelo ou cadastre o primeiro.'
                : 'Nenhum evento cadastrado.'}
            </p>
          ) : (
            <>
              <ForecastOcasioesFiltros
                filtros={filtros}
                onMudar={setFiltros}
                paises={paisesDoFiltro}
                fontes={fontesDoFiltro}
                anos={anosDoFiltro(hoje)}
                total={totalGrupos}
                visiveis={grupos.length}
                registros={todas.length}
                onLimpar={() => setFiltros(FILTROS_PADRAO)}
              />
              <ForecastOcasioesLinhaDoTempo
                ano={anoLinha}
                hoje={hoje}
                linhas={linhas}
                carregando={doAno.isLoading}
                erro={doAno.isError ? forecastOcasioesErrorMessage(doAno.error, 'listar') : null}
                onTentar={() => void queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.ano(anoLinha) })}
              />
              {visiveis.length === 0 ? (
                <>
                  <p className="empty-state">Nenhum evento com estes filtros.</p>
                  <button type="button" className="ghost-button" onClick={() => setFiltros(FILTROS_PADRAO)}>
                    Limpar filtros
                  </button>
                </>
              ) : (
                <ForecastOcasioesLista
                  grupos={grupos}
                  abertos={abertos}
                  onAlternarAberto={alternarAberto}
                  hoje={hoje}
                  podeEditar={podeEditar}
                  pendente={alternar.isPending}
                  registrarBotao={registrarBotao}
                  onEditar={(o) => abrirForm({ ocasiao: o }, `editar-${o.id}`)}
                  onAlternar={(o) => aoAlternar(o.name, [o], !o.isActive, `alternar-${o.id}`)}
                  onExcluir={(o) => aoExcluir(o.name, [o], `excluir-${o.id}`)}
                  onAlternarGrupo={(g, ativar) =>
                    aoAlternar(g.nome, ativar ? g.membros : g.membros.filter((o) => o.isActive), ativar, `alternar-grupo-${g.chave}`)
                  }
                  onExcluirGrupo={(g) => aoExcluir(g.nome, g.membros, `excluir-grupo-${g.chave}`)}
                  nomeDoPais={nomeDoPais}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
