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
  textoFontesSemPais,
  type FiltrosOcasioes,
} from './forecastOcasioes';
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
  | { tipo: 'excluir'; ocasiao: ForecastOcasiao; origem: string };

const TEXTO_FIXO =
  'Ocasiões são períodos (feriados, fechamento de fábrica, greve, pico de frete) que esticam o lead time. ' +
  'Por enquanto só informam: nenhum cálculo do Forecast muda.';

/** Conteudo da aba "Ocasiões" do dialogo "Fontes e lead time". */
export default function ForecastOcasioesPanel({ podeEditar, hoje: hojeProp }: Props) {
  const queryClient = useQueryClient();
  const [hojeLocal] = useState(() => chaveDataLocal(new Date()));
  const hoje = hojeProp ?? hojeLocal;

  const [filtros, setFiltros] = useState<FiltrosOcasioes>(FILTROS_PADRAO);
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [aviso, setAviso] = useState('');
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

  const alternar = useMutation({
    mutationFn: (o: ForecastOcasiao) => alterarOcasiao(o.id, { isActive: !o.isActive }),
    onSuccess: async (_salva, o) => {
      await queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
      setAviso(`Ocasião ${o.name} ${o.isActive ? 'inativada' : 'reativada'}.`);
    },
    onError: (err) => {
      if (ocasiaoSumiu(err)) void queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
    },
    onSettled: (_dados, _erro, o) => setFocoPara(`alternar-${o.id}`),
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
    return visiveis.flatMap((o) => {
      const ocorrencias = porId.get(o.id) ?? [];
      return ocorrencias.length > 0 ? [{ id: o.id, nome: o.name, ativa: o.isActive, ocorrencias }] : [];
    });
  }, [visiveis, doAno.data]);

  const abrirForm = (dados: { ocasiao?: ForecastOcasiao; modelo?: PreenchimentoModelo }, origem: string) => {
    alternar.reset();
    setAviso('');
    setModo({ tipo: 'form', ...dados, origem });
  };
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
      {avisoSemPais && <p className="fcd-dica">{avisoSemPais}</p>}
      {!podeEditar && <p className="fcd-dica">Só administrador e comprador cadastram ou alteram ocasiões.</p>}
      {aviso && (
        <div className="alert alert--success" role="status">
          {aviso}
        </div>
      )}
      {alternar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastOcasioesErrorMessage(alternar.error, 'salvar')}
        </div>
      )}

      {lista.isLoading && (
        <div className="fcd-carregando" role="status">
          <Spinner /> Carregando ocasiões…
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
        <ForecastOcasiaoExcluir ocasiao={modo.ocasiao} onVoltar={voltar(modo.origem)} />
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
                Nova ocasião
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
                ? 'Nenhuma ocasião cadastrada. Use um modelo ou cadastre a primeira.'
                : 'Nenhuma ocasião cadastrada.'}
            </p>
          ) : (
            <>
              <ForecastOcasioesFiltros
                filtros={filtros}
                onMudar={setFiltros}
                paises={paisesDoFiltro}
                fontes={fontesDoFiltro}
                anos={anosDoFiltro(hoje)}
                total={todas.length}
                visiveis={visiveis.length}
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
                  <p className="empty-state">Nenhuma ocasião com estes filtros.</p>
                  <button type="button" className="ghost-button" onClick={() => setFiltros(FILTROS_PADRAO)}>
                    Limpar filtros
                  </button>
                </>
              ) : (
                <ForecastOcasioesLista
                  ocasioes={visiveis}
                  hoje={hoje}
                  podeEditar={podeEditar}
                  pendente={alternar.isPending}
                  registrarBotao={registrarBotao}
                  onEditar={(o) => abrirForm({ ocasiao: o }, `editar-${o.id}`)}
                  onAlternar={(o) => {
                    setAviso('');
                    alternar.mutate(o);
                  }}
                  onExcluir={(o) => {
                    alternar.reset();
                    setAviso('');
                    setModo({ tipo: 'excluir', ocasiao: o, origem: `excluir-${o.id}` });
                  }}
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
