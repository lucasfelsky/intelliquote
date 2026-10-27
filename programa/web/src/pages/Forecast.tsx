import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import Spinner from '@/components/Spinner';
import {
  forecastErrorMessage,
  forecastKeys,
  getForecastSnapshot,
  listForecastSnapshots,
  type ForecastDivergencia,
  type ForecastOrigin,
  type ForecastSnapshotDetail,
  type ForecastSnapshotSummary,
} from '@/services/forecast';
import { forecastDecisoesKeys, listForecastDecisoes, type ForecastDecisao } from '@/services/forecastDecisoes';
import { forecastPendentesKeys } from '@/services/forecastPendentes';
import { colunasComDecisoes } from './Forecast/forecastAnaliseDecidida';
import ForecastGrid, { chaveDaDivergencia } from './Forecast/ForecastGrid';
import ForecastExcluirQuinzenaModal from './Forecast/ForecastExcluirQuinzenaModal';
import ForecastExportarMacro from './Forecast/ForecastExportarMacro';
import ForecastFiltroSemVenda from './Forecast/ForecastFiltroSemVenda';
import ForecastFontesModal from './Forecast/ForecastFontesModal';
import { ProvedorGerarCotacao } from './Forecast/ForecastGerarCotacao';
import ForecastGruposModal from './Forecast/ForecastGruposModal';
import ForecastImportModal from './Forecast/ForecastImportModal';
import ForecastMemoria from './Forecast/ForecastMemoria';
import ForecastPendentesCadastro from './Forecast/ForecastPendentesCadastro';
import { hojeEmSaoPaulo, proximaAnalise } from './Forecast/forecastProximaAnalise';
import ForecastRelatorioCompras from './Forecast/ForecastRelatorioCompras';
import {
  casaBusca,
  colunasDoPainel,
  contarPorFiltro,
  dataBr,
  FILTROS,
  STATUS_ORDEM,
  STATUS_ROTULO,
  mediaAjustadaDoPainel,
  regraALDoPainel,
  textoDoSelo,
  type FiltroId,
} from './Forecast/forecastPainel';
import {
  contarOcultaveis,
  filtrarPorSemVenda,
  ocultavelPorSemVenda,
  useMostrarSemVenda,
} from './Forecast/forecastSemVenda';

const ORIGEM_ROTULO: Record<ForecastOrigin, string> = {
  planilha: 'planilha',
  dbcorp: 'relatórios DBCorp',
};

function Selo({ detail }: { detail: ForecastSnapshotDetail }) {
  const selo = textoDoSelo(detail, { regraAL: regraALDoPainel(detail), mediaAjustada: mediaAjustadaDoPainel(detail) });
  return (
    <div className={`fc-selo-conferencia fc-selo-conferencia--${selo.tom}`} role="status">
      <strong>{selo.titulo}</strong>
      {selo.detalhe && <span>{selo.detalhe}</span>}
      {selo.colunas && (
        <ul className="fc-selo-conferencia__colunas">
          {selo.colunas.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {selo.informativa && <span className="fc-selo-conferencia__nota">{selo.informativa}</span>}
      {selo.nota && <span className="fc-selo-conferencia__nota">{selo.nota}</span>}
      {selo.notaRegra && <span className="fc-selo-conferencia__nota">{selo.notaRegra}</span>}
      {selo.notaMedia && <span className="fc-selo-conferencia__nota">{selo.notaMedia}</span>}
    </div>
  );
}

interface PainelProps {
  detail: ForecastSnapshotDetail;
  podeEditar: boolean;
  mostrarSemVenda: boolean;
  onMostrarSemVenda: (mostrar: boolean) => void;
  ocultaveis: number;
}

function Painel({ detail, podeEditar, mostrarSemVenda, onMostrarSemVenda, ocultaveis }: PainelProps) {
  const [filtro, setFiltro] = useState<FiltroId>('todos');
  const [busca, setBusca] = useState('');
  const [ocultas, setOcultas] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const termo = useDeferredValue(busca);

  // Quantidades decididas pelo comprador: mesma chave do relatorio de compras (salvar la atualiza a grade). A grade
  // nunca some: sem dados (carregando ou erro sem cache) a coluna ANALISE FORECAST mostra o valor congelado.
  const decisoes = useQuery({
    queryKey: forecastDecisoesKeys.lista(detail.id),
    queryFn: () => listForecastDecisoes(detail.id),
  });
  const decisoesData = decisoes.data;
  const mapaDecisoes = useMemo(
    () => (decisoesData ? new Map<number, ForecastDecisao>(decisoesData.map((d) => [d.productId, d])) : null),
    [decisoesData],
  );
  const colunas = useMemo(
    () => colunasComDecisoes(colunasDoPainel(detail.months, { ocultas }), mapaDecisoes),
    [detail.months, ocultas, mapaDecisoes],
  );
  const base = useMemo(() => filtrarPorSemVenda(detail.linhas, mostrarSemVenda), [detail.linhas, mostrarSemVenda]);
  const contagem = useMemo(() => contarPorFiltro(base), [base]);
  const divergencias = useMemo(() => {
    const mapa = new Map<string, ForecastDivergencia>();
    for (const d of detail.conferencia?.divergencias ?? []) mapa.set(chaveDaDivergencia(d.linha, d.coluna), d);
    return mapa;
  }, [detail.conferencia]);

  const visiveis = useMemo(() => {
    const teste = FILTROS.find((f) => f.id === filtro)?.teste ?? (() => true);
    return base.filter((l) => teste(l) && casaBusca(l, termo));
  }, [base, filtro, termo]);

  // Itens ocultos pelo filtro de sem venda que casariam com o chip e a busca atuais (explica o estado vazio).
  const ocultosQueCasariam = useMemo(() => {
    if (mostrarSemVenda || visiveis.length > 0) return 0;
    const teste = FILTROS.find((f) => f.id === filtro)?.teste ?? (() => true);
    return detail.linhas.filter((l) => ocultavelPorSemVenda(l) && teste(l) && casaBusca(l, termo)).length;
  }, [detail.linhas, mostrarSemVenda, visiveis.length, filtro, termo]);

  let mensagemVazia: string | undefined;
  if (base.length === 0 && detail.linhas.length > 0) {
    mensagemVazia = 'Todos os produtos desta quinzena estão ocultos pelo filtro “sem venda há 6 meses ou mais”.';
  } else if (ocultosQueCasariam > 0) {
    mensagemVazia = `Nenhum produto visível com esses filtros: ${ocultosQueCasariam} sem venda há 6 meses ou mais ${ocultosQueCasariam === 1 ? 'está oculto' : 'estão ocultos'}.`;
  }

  const selecionada = base.find((l) => l.linha === sel) ?? base[0];
  const onSelect = useCallback((linha: number) => setSel(linha), []);

  return (
    <>
      <Selo detail={detail} />
      <section className="fc-card" aria-label="Produtos da quinzena">
        <div className="fc-barra">
          <div className="fc-filtros" role="group" aria-label="Filtros">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="fc-filtro"
                aria-pressed={filtro === f.id}
                onClick={() => setFiltro(f.id)}
              >
                {f.rotulo(detail.baseDate)} <span className="fc-filtro__conta">{contagem[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="fc-filtros">
            <div className="fc-busca">
              <label className="sr-only" htmlFor="fc-busca">
                Buscar produto, código ou fonte
              </label>
              <input
                id="fc-busca"
                className="input"
                type="search"
                placeholder="Produto, código ou fonte"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={ocultas}
              className="fc-chave"
              onClick={() => setOcultas((v) => !v)}
            >
              <span className={ocultas ? 'fc-trilho fc-trilho--on' : 'fc-trilho'} aria-hidden="true">
                <span />
              </span>
              Colunas ocultas da planilha
            </button>
            <ForecastFiltroSemVenda
              mostrar={mostrarSemVenda}
              ocultaveis={ocultaveis}
              onAlternar={() => onMostrarSemVenda(!mostrarSemVenda)}
            />
          </div>
        </div>
        <div className="fc-legenda">
          <span>Status da compra</span>
          {STATUS_ORDEM.map((s) => (
            <span key={s} className="fc-legenda__item">
              <i className={`fc-legenda__marca fc-status--${s}`} aria-hidden="true" />
              {STATUS_ROTULO[s]}
            </span>
          ))}
          <span className="fc-legenda__total">
            {visiveis.length} de {detail.linhas.length} produtos
          </span>
        </div>
        {decisoes.isLoading && (
          <p className="fcad-aviso" role="status">
            Carregando as quantidades decididas…
          </p>
        )}
        {decisoes.isError && decisoesData === undefined && (
          <p className="fcad-aviso" role="status">
            Não foi possível carregar as quantidades decididas. A coluna ANÁLISE FORECAST mostra o valor importado da
            quinzena.
            <button type="button" className="ghost-button ghost-button--sm" onClick={() => void decisoes.refetch()}>
              Tentar de novo
            </button>
          </p>
        )}
        <ForecastGrid
          colunas={colunas}
          linhas={visiveis}
          selecionada={selecionada?.linha ?? null}
          divergencias={divergencias}
          onSelect={onSelect}
          legenda={`Forecast da quinzena ${detail.label}: ${visiveis.length} de ${detail.linhas.length} produtos`}
          mensagemVazia={mensagemVazia}
        />
      </section>
      {selecionada && (
        <ForecastMemoria
          linha={selecionada}
          half={detail.half}
          baseDate={detail.baseDate}
          hoje={detail.hoje}
          podeEditar={podeEditar}
        />
      )}
    </>
  );
}

export default function Forecast() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const podeImportar = user?.role === 'admin' || user?.role === 'comprador';
  const [importando, setImportando] = useState(false);
  const [importada, setImportada] = useState<string | null>(null);
  const botaoImportar = useRef<HTMLButtonElement>(null);
  const importouAntes = useRef(false);
  // Excluir quinzena: o alvo e capturado ao abrir (a lista pode mudar por baixo do dialogo).
  const [excluirAlvo, setExcluirAlvo] = useState<ForecastSnapshotSummary | null>(null);
  const [excluida, setExcluida] = useState<string | null>(null);
  const botaoExcluir = useRef<HTMLButtonElement>(null);
  const seletor = useRef<HTMLSelectElement>(null);
  const excluirAbriuAntes = useRef(false);
  const focoAposExcluir = useRef<'seletor' | 'importar' | null>(null);
  const excluirAberto = excluirAlvo !== null;
  // Grupos de equivalencia (PR 6b): todos os papeis COMEX veem; admin/comprador editam.
  const [gruposAberto, setGruposAberto] = useState(false);
  const botaoGrupos = useRef<HTMLButtonElement>(null);
  const gruposAbriuAntes = useRef(false);
  // Fontes e lead time (3C): todos os papeis COMEX veem; admin/comprador editam o lead time.
  const [fontesAberto, setFontesAberto] = useState(false);
  const botaoFontes = useRef<HTMLButtonElement>(null);
  const fontesAbriuAntes = useRef(false);
  const lista = useQuery({ queryKey: forecastKeys.snapshots, queryFn: listForecastSnapshots });
  const quinzenas = lista.data ?? [];

  const visao = params.get('visao') === 'compras' ? 'compras' : 'painel';
  const pedida = Number(params.get('quinzena'));
  const escolhida = quinzenas.find((q) => q.id === pedida) ?? quinzenas[0];
  const escolhidaId = escolhida?.id;

  const detalhe = useQuery({
    queryKey: forecastKeys.snapshot(escolhidaId ?? 0),
    queryFn: () => getForecastSnapshot(escolhidaId ?? 0),
    enabled: escolhidaId !== undefined,
  });
  const detail = detalhe.data;
  const [mostrarSemVenda, setMostrarSemVenda] = useMostrarSemVenda(user?.id);
  const ocultaveis = useMemo(() => (detail ? contarOcultaveis(detail.linhas) : 0), [detail]);
  // PO.COMP.01: calculado no front (hoje em Sao Paulo, uma vez por montagem); null fora da tabela de feriados.
  const proxima = useMemo(() => proximaAnalise(hojeEmSaoPaulo(new Date())), []);

  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu.
  useEffect(() => {
    if (importando) {
      importouAntes.current = true;
    } else if (importouAntes.current) {
      importouAntes.current = false;
      botaoImportar.current?.focus();
    }
  }, [importando]);

  useEffect(() => {
    if (excluirAberto) {
      excluirAbriuAntes.current = true;
    } else if (excluirAbriuAntes.current) {
      excluirAbriuAntes.current = false;
      const alvo = focoAposExcluir.current;
      focoAposExcluir.current = null;
      if (alvo === 'seletor') seletor.current?.focus();
      else if (alvo === 'importar') botaoImportar.current?.focus();
      else botaoExcluir.current?.focus();
    }
  }, [excluirAberto]);

  useEffect(() => {
    if (gruposAberto) {
      gruposAbriuAntes.current = true;
    } else if (gruposAbriuAntes.current) {
      gruposAbriuAntes.current = false;
      botaoGrupos.current?.focus();
    }
  }, [gruposAberto]);

  useEffect(() => {
    if (fontesAberto) {
      fontesAbriuAntes.current = true;
    } else if (fontesAbriuAntes.current) {
      fontesAbriuAntes.current = false;
      botaoFontes.current?.focus();
    }
  }, [fontesAberto]);

  // Trocar de visao preserva a quinzena da URL.
  const mudarVisao = (proxima: 'painel' | 'compras') => {
    const next = new URLSearchParams(params);
    if (proxima === 'compras') next.set('visao', 'compras');
    else next.delete('visao');
    setParams(next);
  };

  const aoImportar = useCallback(
    async (snapshotId: number, label: string) => {
      setImportando(false);
      await queryClient.invalidateQueries({ queryKey: ['forecast'] });
      setParams({ quinzena: String(snapshotId) });
      setExcluida(null);
      setImportada(label);
    },
    [queryClient, setParams],
  );

  // Exclusao confirmada: a quinzena some da lista na hora, as consultas dela saem do cache (um GET so daria 404),
  // a tela passa para a mais recente que sobrou (ou para o estado vazio) e o resto do modulo e revalidado.
  const aoExcluir = useCallback(
    async (id: number, label: string) => {
      const restantes = (queryClient.getQueryData<ForecastSnapshotSummary[]>(forecastKeys.snapshots) ?? []).filter(
        (q) => q.id !== id,
      );
      queryClient.setQueryData(forecastKeys.snapshots, restantes);
      queryClient.removeQueries({ queryKey: forecastKeys.snapshot(id) });
      queryClient.removeQueries({ queryKey: forecastKeys.relatorio(id) });
      queryClient.removeQueries({ queryKey: forecastPendentesKeys.snapshot(id) });
      queryClient.removeQueries({ queryKey: forecastDecisoesKeys.lista(id) });
      focoAposExcluir.current = restantes.length > 0 ? 'seletor' : 'importar';
      setImportada(null);
      setExcluida(label);
      setExcluirAlvo(null);
      const proxima = restantes[0];
      const proximos: Record<string, string> = {};
      if (proxima) proximos.quinzena = String(proxima.id);
      if (visao === 'compras') proximos.visao = visao;
      setParams(proximos);
      await queryClient.invalidateQueries({ queryKey: ['forecast'] });
    },
    [queryClient, setParams, visao],
  );

  const subtitulo = escolhida
    ? detail
      ? `Quinzena ${detail.label} · base ${dataBr(detail.baseDate)} · ${detail.linhas.length} produtos${
          mostrarSemVenda || ocultaveis === 0 || visao !== 'painel'
            ? ''
            : ` (${ocultaveis} ocultos sem venda ≥6 meses)`
        } · origem ${ORIGEM_ROTULO[detail.origin]}`
      : `Quinzena ${escolhida.label} · base ${dataBr(escolhida.baseDate)} · origem ${ORIGEM_ROTULO[escolhida.origin]}`
    : 'Projeção de estoque e demanda por quinzena, no layout da planilha FORECAST (MACRO).';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Planejamento · PO.COMP.01</p>
          <h1>
            Forecast de compras <span className="badge badge--warning fc-beta">Beta</span>
          </h1>
          <p>
            {subtitulo}
            {escolhida && proxima && <span className="fcpa-proxima"> · próxima análise {dataBr(proxima)}</span>}
          </p>
          <p className="fc-beta-aviso">Em validação: confira os números com a planilha do Forecast.</p>
        </div>
        {(quinzenas.length > 0 || podeImportar || lista.isSuccess) && (
          <div className="page-header__actions">
            {quinzenas.length > 0 && (
              <div className="fc-quinzena">
                <label className="field-label" htmlFor="fc-quinzena">
                  Quinzena
                </label>
                <select
                  ref={seletor}
                  id="fc-quinzena"
                  className="select"
                  value={escolhidaId}
                  onChange={(e) => {
                    setImportada(null);
                    setExcluida(null);
                    setParams(visao === 'compras' ? { quinzena: e.target.value, visao } : { quinzena: e.target.value });
                  }}
                >
                  {quinzenas.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label} · {dataBr(q.baseDate)} · {ORIGEM_ROTULO[q.origin]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              ref={botaoFontes}
              type="button"
              className="ghost-button"
              aria-haspopup="dialog"
              onClick={() => setFontesAberto(true)}
            >
              Fontes e lead time
            </button>
            <button
              ref={botaoGrupos}
              type="button"
              className="ghost-button"
              aria-haspopup="dialog"
              onClick={() => setGruposAberto(true)}
            >
              Grupos de equivalência
            </button>
            {detail && visao === 'painel' && <ForecastExportarMacro key={detail.id} snapshotId={detail.id} hoje={detail.hoje} />}
            {podeImportar && (
              <button ref={botaoImportar} type="button" className="primary-button" onClick={() => setImportando(true)}>
                Importar quinzena
              </button>
            )}
            {podeImportar && escolhida && (
              <button
                ref={botaoExcluir}
                type="button"
                className="ghost-button danger-button fcx-gatilho"
                aria-haspopup="dialog"
                onClick={() => setExcluirAlvo(escolhida)}
              >
                Excluir quinzena
              </button>
            )}
          </div>
        )}
      </div>

      {importada && (
        <div className="alert alert--success" role="status">
          Quinzena {importada} importada.
        </div>
      )}
      {excluida && (
        <div className="alert alert--success" role="status">
          Quinzena {excluida} excluída.
        </div>
      )}
      {lista.isLoading && <Spinner />}
      {lista.isError && (
        <div className="alert alert--error" role="alert">
          {forecastErrorMessage(lista.error)}
        </div>
      )}
      {lista.isSuccess && quinzenas.length === 0 && (
        <div className="empty-state">
          {podeImportar
            ? 'Nenhuma quinzena importada ainda. Use “Importar quinzena” para enviar os relatórios do DBCorp.'
            : 'Nenhuma quinzena importada ainda. Peça a um comprador ou administrador para importar.'}
        </div>
      )}
      {escolhida && detalhe.isLoading && <Spinner />}
      {escolhida && detalhe.isError && (
        <div className="alert alert--error" role="alert">
          {forecastErrorMessage(detalhe.error)}
        </div>
      )}
      {detail && (
        <div className="fc-filtros fc-visoes" role="group" aria-label="Visão">
          <button type="button" className="fc-filtro" aria-pressed={visao === 'painel'} onClick={() => mudarVisao('painel')}>
            Painel
          </button>
          <button type="button" className="fc-filtro" aria-pressed={visao === 'compras'} onClick={() => mudarVisao('compras')}>
            Relatório de compras
          </button>
        </div>
      )}
      {detail && detail.origin === 'dbcorp' && (
        <ForecastPendentesCadastro key={`pendentes-${detail.id}`} snapshotId={detail.id} label={detail.label} podeEditar={podeImportar} />
      )}
      {detail && visao === 'painel' && (
        <Painel
          key={detail.id}
          detail={detail}
          podeEditar={podeImportar}
          mostrarSemVenda={mostrarSemVenda}
          onMostrarSemVenda={setMostrarSemVenda}
          ocultaveis={ocultaveis}
        />
      )}
      {detail && visao === 'compras' && (
        <ProvedorGerarCotacao snapshotId={detail.id} podeCriar={podeImportar}>
          <ForecastRelatorioCompras key={detail.id} snapshotId={detail.id} podeEditar={podeImportar} />
        </ProvedorGerarCotacao>
      )}
      {gruposAberto && <ForecastGruposModal podeEditar={podeImportar} onFechar={() => setGruposAberto(false)} />}
      {fontesAberto && <ForecastFontesModal podeEditar={podeImportar} onFechar={() => setFontesAberto(false)} />}
      {excluirAlvo && (
        <ForecastExcluirQuinzenaModal
          quinzena={excluirAlvo}
          produtos={detail && detail.id === excluirAlvo.id ? detail.linhas.length : null}
          onFechar={() => setExcluirAlvo(null)}
          onExcluida={aoExcluir}
        />
      )}
      <ForecastImportModal
        aberto={importando}
        onFechar={() => setImportando(false)}
        quinzenasExistentes={quinzenas.map((q) => q.label)}
        onImportada={aoImportar}
        somenteDbcorp={user?.role !== 'admin'}
      />
    </div>
  );
}
