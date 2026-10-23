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
} from '@/services/forecast';
import ForecastGrid, { chaveDaDivergencia } from './Forecast/ForecastGrid';
import ForecastImportModal from './Forecast/ForecastImportModal';
import ForecastMemoria from './Forecast/ForecastMemoria';
import ForecastPendentesCadastro from './Forecast/ForecastPendentesCadastro';
import ForecastRelatorioCompras from './Forecast/ForecastRelatorioCompras';
import {
  casaBusca,
  colunasDoPainel,
  contarPorFiltro,
  dataBr,
  FILTROS,
  STATUS_ORDEM,
  STATUS_ROTULO,
  regraALDoPainel,
  textoDoSelo,
  type FiltroId,
} from './Forecast/forecastPainel';

const ORIGEM_ROTULO: Record<ForecastOrigin, string> = {
  planilha: 'planilha',
  dbcorp: 'relatórios DBCorp',
};

function Selo({ detail }: { detail: ForecastSnapshotDetail }) {
  const selo = textoDoSelo(detail, { regraAL: regraALDoPainel(detail) });
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
    </div>
  );
}

function Painel({ detail, podeEditar }: { detail: ForecastSnapshotDetail; podeEditar: boolean }) {
  const [filtro, setFiltro] = useState<FiltroId>('todos');
  const [busca, setBusca] = useState('');
  const [ocultas, setOcultas] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const termo = useDeferredValue(busca);

  const colunas = useMemo(() => colunasDoPainel(detail.months, { ocultas }), [detail.months, ocultas]);
  const contagem = useMemo(() => contarPorFiltro(detail.linhas), [detail.linhas]);
  const divergencias = useMemo(() => {
    const mapa = new Map<string, ForecastDivergencia>();
    for (const d of detail.conferencia?.divergencias ?? []) mapa.set(chaveDaDivergencia(d.linha, d.coluna), d);
    return mapa;
  }, [detail.conferencia]);

  const visiveis = useMemo(() => {
    const teste = FILTROS.find((f) => f.id === filtro)?.teste ?? (() => true);
    return detail.linhas.filter((l) => teste(l) && casaBusca(l, termo));
  }, [detail.linhas, filtro, termo]);

  const selecionada = detail.linhas.find((l) => l.linha === sel) ?? detail.linhas[0];
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
        <ForecastGrid
          colunas={colunas}
          linhas={visiveis}
          selecionada={selecionada?.linha ?? null}
          divergencias={divergencias}
          onSelect={onSelect}
          legenda={`Forecast da quinzena ${detail.label}: ${visiveis.length} de ${detail.linhas.length} produtos`}
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

  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu.
  useEffect(() => {
    if (importando) {
      importouAntes.current = true;
    } else if (importouAntes.current) {
      importouAntes.current = false;
      botaoImportar.current?.focus();
    }
  }, [importando]);

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
      setImportada(label);
    },
    [queryClient, setParams],
  );

  const subtitulo = escolhida
    ? detail
      ? `Quinzena ${detail.label} · base ${dataBr(detail.baseDate)} · ${detail.linhas.length} produtos · origem ${ORIGEM_ROTULO[detail.origin]}`
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
          <p>{subtitulo}</p>
          <p className="fc-beta-aviso">Em validação: confira os números com a planilha do Forecast.</p>
        </div>
        {(quinzenas.length > 0 || podeImportar) && (
          <div className="page-header__actions">
            {quinzenas.length > 0 && (
              <div className="fc-quinzena">
                <label className="field-label" htmlFor="fc-quinzena">
                  Quinzena
                </label>
                <select
                  id="fc-quinzena"
                  className="select"
                  value={escolhidaId}
                  onChange={(e) => {
                    setImportada(null);
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
            {podeImportar && (
              <button ref={botaoImportar} type="button" className="primary-button" onClick={() => setImportando(true)}>
                Importar quinzena
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
      {lista.isLoading && <Spinner />}
      {lista.isError && (
        <div className="alert alert--error" role="alert">
          {forecastErrorMessage(lista.error)}
        </div>
      )}
      {lista.isSuccess && quinzenas.length === 0 && (
        <div className="empty-state">
          {podeImportar
            ? 'Nenhuma quinzena importada ainda. Use “Importar quinzena” para enviar a planilha ou os relatórios do DBCorp.'
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
      {detail && visao === 'painel' && <Painel key={detail.id} detail={detail} podeEditar={podeImportar} />}
      {detail && visao === 'compras' && (
        <ForecastRelatorioCompras key={detail.id} snapshotId={detail.id} podeEditar={podeImportar} />
      )}
      <ForecastImportModal
        aberto={importando}
        onFechar={() => setImportando(false)}
        quinzenasExistentes={quinzenas.map((q) => q.label)}
        onImportada={aoImportar}
      />
    </div>
  );
}
