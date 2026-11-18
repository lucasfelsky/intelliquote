import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/icons';
import {
  forecastCotacaoLoteKeys,
  getForecastRascunho,
  type ForecastCotacoesCriadas,
  type ForecastRascunho,
  type ForecastRascunhoItem,
} from '@/services/forecastCotacaoLote';
import { cotacaoAbertaDaDecisao, forecastDecisoesKeys } from '@/services/forecastDecisoes';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { ForecastPoDiretaEnviada } from '@/services/forecastPoDireta';
import { useDecisoesDaQuinzena } from './ForecastDecisaoCompra';
import { useVinculosDeCotacao } from './ForecastGerarCotacao';
import PopupCriarCotacao from './ForecastCriarCotacaoPopup';
import ForecastPoDiretaModal from './ForecastPoDiretaModal';
import { MAX_ITENS_DO_LOTE, type ItemSelecionado } from './forecastCriarCotacaoRegras';
import { kgBr } from './forecastPainel';
import { textoSalvaEm } from './forecastDecisaoCampos';

// Selecao em varias linhas e pop-up "Criar cotacao" (E6 do relatorio enxuto). O provedor guarda a selecao das tabelas, o
// rascunho da quinzena (E5), abre o pop-up (portal) e mostra o aviso com os links das cotacoes criadas (T8: a pessoa fica na
// tela). Inerte (sem barra, sem consulta, sem checkbox) para quem so le e fora do provedor do "Gerar cotacao".

interface Contexto {
  quinzena: string;
  selecionados: ReadonlyMap<number, ItemSelecionado>;
  /** `true` quando o item pode ser marcado (tem produto no cadastro e nao esta em cotacao aberta). */
  podeSelecionar: (item: ItemSelecionado['item']) => boolean;
  motivoSemSelecao: (item: ItemSelecionado['item']) => string | null;
  alternar: (sel: ItemSelecionado) => void;
  marcar: (sels: ItemSelecionado[], marcado: boolean) => void;
  limpar: () => void;
  /**
   * Sem `itens` abre com a selecao atual; com `itens`, com aqueles pre-escolhidos. `origem` e o elemento que recebe o foco
   * de volta ao fechar (padrao: o que tinha o foco).
   */
  abrir: (itens?: ItemSelecionado[], origem?: HTMLElement | null) => void;
  /** PO direta de item de PRECO FECHADO (sem cotacao): abre o modal de envio. `origem` recebe o foco de volta ao fechar. */
  abrirPoDireta: (item: ForecastItemRelatorio, origem?: HTMLElement | null) => void;
  /** Item da linha no rascunho (so quando o rascunho ja carregou). */
  noRascunho: (productId: number) => ForecastRascunhoItem | undefined;
  rascunho: ForecastRascunho | null | undefined;
}

const ContextoCriarCotacao = createContext<Contexto | null>(null);

/** `null` fora do provedor ou sem permissao de criar cotacao: a tela nao mostra checkbox, barra nem "Cotar". */
export function useCriarCotacao(): Contexto | null {
  return useContext(ContextoCriarCotacao);
}

interface BarraProps {
  selecionados: ReadonlyMap<number, ItemSelecionado>;
  onCriar: (origem: HTMLElement) => void;
  onLimpar: () => void;
}

function BarraDeSelecao({ selecionados, onCriar, onLimpar }: BarraProps) {
  const n = selecionados.size;
  if (n === 0) return null;
  const itens = [...selecionados.values()];
  const fontes = new Set(itens.map((s) => s.fonte.trim().toUpperCase())).size;
  const kg = itens.reduce((t, s) => t + s.item.quantidadeFinal, 0);
  const demais = n > MAX_ITENS_DO_LOTE;
  return (
    <div className="fcl-barra" role="region" aria-label="Itens selecionados">
      <span className="badge badge--success fcl-barra__n" role="status">
        <Icon name="check" size={14} />
        {n} {n === 1 ? 'item selecionado' : 'itens selecionados'}
      </span>
      <span className="fcl-barra__resumo">
        {fontes} {fontes === 1 ? 'fonte' : 'fontes'} · {kgBr(kg)} kg sugeridos
      </span>
      {demais && (
        <span className="fcl-barra__aviso" role="alert">
          O lote aceita no máximo {MAX_ITENS_DO_LOTE} itens: tire {n - MAX_ITENS_DO_LOTE} da seleção.
        </span>
      )}
      <span className="fcl-barra__espaco" />
      <button type="button" className="ghost-button ghost-button--sm" onClick={onLimpar}>
        Limpar seleção
      </button>
      <button type="button" className="primary-button fcl-barra__criar" disabled={demais} onClick={(e) => onCriar(e.currentTarget)}>
        <Icon name="file-plus" size={16} />
        Criar cotação
      </button>
    </div>
  );
}

function AvisoCriadas({ criadas, onDispensar }: { criadas: ForecastCotacoesCriadas; onDispensar: () => void }) {
  const ref = useRef<HTMLElement>(null);
  // O pop-up fecha e a barra some: o foco vai para o aviso (os links sao o proximo passo).
  useEffect(() => ref.current?.focus(), [criadas]);
  const n = criadas.cotacoes.length;
  return (
    <section ref={ref} tabIndex={-1} className="alert alert--success fcl-criadas" role="status" aria-label="Cotações criadas">
      <div className="fcl-criadas__corpo">
        <strong>{n === 1 ? '1 cotação criada' : `${n} cotações criadas`}</strong>
        <span>Escolha os fornecedores e envie pela página de cada cotação.</span>
        <ul className="fcl-criadas__lista">
          {criadas.cotacoes.map((c) => (
            <li key={c.id}>
              <Link to={`/cotacoes/${c.id}`}>Abrir {c.requestCode}</Link>{' '}
              <span className="fcl-criadas__fonte">
                · {c.fonte} ({c.itens.length} {c.itens.length === 1 ? 'item' : 'itens'})
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="ghost-button ghost-button--sm" onClick={onDispensar}>
        Dispensar
      </button>
    </section>
  );
}

interface ProvedorProps {
  snapshotId: number;
  /** Rotulo da quinzena (ex.: 10-2), para o subtitulo do pop-up. */
  quinzena: string;
  diasCritico: number;
  /** Itens da lista de compra com a fonte do grupo (todos; o filtro da tela nao muda o que o pop-up pode oferecer). */
  itensDaLista: ItemSelecionado[];
  children: ReactNode;
}

export function ProvedorCriarCotacao({ snapshotId, quinzena, diasCritico, itensDaLista, children }: ProvedorProps) {
  const vinculos = useVinculosDeCotacao();
  if (!vinculos) return <>{children}</>;
  return (
    <ProvedorAtivo snapshotId={snapshotId} quinzena={quinzena} diasCritico={diasCritico} itensDaLista={itensDaLista}>
      {children}
    </ProvedorAtivo>
  );
}

function ProvedorAtivo({ snapshotId, quinzena, diasCritico, itensDaLista, children }: ProvedorProps) {
  const decisoes = useDecisoesDaQuinzena();
  const rascunho = useQuery({
    queryKey: forecastCotacaoLoteKeys.rascunho(snapshotId),
    queryFn: () => getForecastRascunho(snapshotId),
  });
  const [selecionados, setSelecionados] = useState<ReadonlyMap<number, ItemSelecionado>>(() => new Map());
  const [popup, setPopup] = useState<{ itens: ItemSelecionado[] } | null>(null);
  const [criadas, setCriadas] = useState<ForecastCotacoesCriadas | null>(null);
  const [po, setPo] = useState<ForecastItemRelatorio | null>(null);
  const [poEnviada, setPoEnviada] = useState<{ item: string; resultado: ForecastPoDiretaEnviada } | null>(null);
  const aberturaRef = useRef<HTMLElement | null>(null);
  const qc = useQueryClient();

  const cotacaoAberta = useCallback(
    (productId: number) => cotacaoAbertaDaDecisao(decisoes?.mapa.get(productId)),
    [decisoes],
  );
  const motivoSemSelecao = useCallback(
    (item: ItemSelecionado['item']): string | null => {
      if (item.productId === null || item.productId === undefined) return 'Item fora do cadastro do Forecast.';
      const aberta = cotacaoAberta(item.productId);
      return aberta ? `Já está na cotação aberta ${aberta.requestCode}.` : null;
    },
    [cotacaoAberta],
  );
  const podeSelecionar = useCallback((item: ItemSelecionado['item']) => motivoSemSelecao(item) === null, [motivoSemSelecao]);

  const alternar = useCallback((sel: ItemSelecionado) => {
    const id = sel.item.productId;
    if (id === null || id === undefined) return;
    setSelecionados((atual) => {
      const novo = new Map(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.set(id, sel);
      return novo;
    });
  }, []);
  const marcar = useCallback((sels: ItemSelecionado[], marcado: boolean) => {
    setSelecionados((atual) => {
      const novo = new Map(atual);
      for (const sel of sels) {
        const id = sel.item.productId;
        if (id === null || id === undefined) continue;
        if (marcado) novo.set(id, sel);
        else novo.delete(id);
      }
      return novo;
    });
  }, []);
  const limpar = useCallback(() => setSelecionados(new Map()), []);

  const abrir = useCallback(
    (itens?: ItemSelecionado[], origem?: HTMLElement | null) => {
      aberturaRef.current = origem ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setCriadas(null);
      setPopup({ itens: itens ?? [...selecionados.values()] });
    },
    [selecionados],
  );

  const fechar = useCallback(() => {
    setPopup(null);
    // O pop-up e desmontado: devolve o foco a quem o abriu (se ainda estiver na tela).
    const origem = aberturaRef.current;
    aberturaRef.current = null;
    window.setTimeout(() => {
      if (origem?.isConnected) origem.focus();
    }, 0);
  }, []);

  const aoGerar = useCallback((r: ForecastCotacoesCriadas) => {
    setPopup(null);
    aberturaRef.current = null;
    setSelecionados(new Map());
    setCriadas(r);
  }, []);

  const abrirPoDireta = useCallback((item: ForecastItemRelatorio, origem?: HTMLElement | null) => {
    aberturaRef.current = origem ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPoEnviada(null);
    setPo(item);
  }, []);

  const fecharPo = useCallback(() => {
    setPo(null);
    const origem = aberturaRef.current;
    aberturaRef.current = null;
    window.setTimeout(() => {
      if (origem?.isConnected) origem.focus();
    }, 0);
  }, []);

  // PO enviada: fecha o modal, mostra o aviso e recarrega as decisoes (Qtd. final e status vem delas).
  const aoEnviarPo = useCallback(
    (resultado: ForecastPoDiretaEnviada) => {
      setPo((atual) => {
        if (atual) setPoEnviada({ item: atual.item, resultado });
        return null;
      });
      aberturaRef.current = null;
      void qc.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
    },
    [qc, snapshotId],
  );

  const noRascunho = useCallback(
    (productId: number) => rascunho.data?.itens.find((i) => i.productId === productId),
    [rascunho.data],
  );

  const valor = useMemo<Contexto>(
    () => ({
      quinzena,
      selecionados,
      podeSelecionar,
      motivoSemSelecao,
      alternar,
      marcar,
      limpar,
      abrir,
      abrirPoDireta,
      noRascunho,
      rascunho: rascunho.isSuccess ? rascunho.data : undefined,
    }),
    [quinzena, selecionados, podeSelecionar, motivoSemSelecao, alternar, marcar, limpar, abrir, abrirPoDireta, noRascunho, rascunho.isSuccess, rascunho.data],
  );

  return (
    <ContextoCriarCotacao.Provider value={valor}>
      {criadas && <AvisoCriadas criadas={criadas} onDispensar={() => setCriadas(null)} />}
      {poEnviada && <AvisoPoEnviada enviada={poEnviada} onDispensar={() => setPoEnviada(null)} />}
      {children}
      <BarraDeSelecao selecionados={selecionados} onCriar={(origem) => abrir(undefined, origem)} onLimpar={limpar} />
      {/* Fora da tabela (portal): o CSS .fcr-tabela td/th nao pode vazar para o pop-up. */}
      {popup &&
        createPortal(
          <PopupCriarCotacao
            snapshotId={snapshotId}
            quinzena={quinzena}
            diasCritico={diasCritico}
            itensDaLista={itensDaLista}
            preselecionados={popup.itens}
            onFechar={fechar}
            onGerado={aoGerar}
          />,
          document.body,
        )}
      {/* Fora da tabela (portal), como o pop-up de cotacao. */}
      {po &&
        createPortal(
          <ForecastPoDiretaModal snapshotId={snapshotId} quinzena={quinzena} item={po} onClose={fecharPo} onEnviada={aoEnviarPo} />,
          document.body,
        )}
    </ContextoCriarCotacao.Provider>
  );
}

function AvisoPoEnviada({ enviada, onDispensar }: { enviada: { item: string; resultado: ForecastPoDiretaEnviada }; onDispensar: () => void }) {
  const { resultado } = enviada;
  const pendente = resultado.registro === 'pendente';
  return (
    <section className={`alert ${pendente ? 'alert--warning' : 'alert--success'} fcl-criadas`} role="status" aria-label="PO enviada">
      <div className="fcl-criadas__corpo">
        <strong>
          {pendente ? 'PO enviada, mas o registro na quinzena não foi concluído.' : `PO de ${enviada.item} enviada a ${resultado.fornecedor}.`}
        </strong>
        <span>
          {pendente
            ? 'O e-mail saiu. Confira o status do item antes de enviar outra PO e avise a TI se a Qtd. final não aparecer.'
            : `Para ${resultado.para}${resultado.copia.length > 0 ? `, com ${resultado.copia.length} em cópia` : ''}. A Qtd. final do item foi atualizada.`}
        </span>
      </div>
      <button type="button" className="ghost-button ghost-button--sm" onClick={onDispensar}>
        Dispensar
      </button>
    </section>
  );
}

/** "Rascunho salvo em dd/mm hh:mm" da linha: o rascunho e do usuario logado, entao so ele ve. */
export function textoRascunhoDaLinha(rascunho: ForecastRascunho | null | undefined, item: ForecastRascunhoItem): string {
  const quando = rascunho ? textoSalvaEm(rascunho.atualizadoEm) : '';
  const kg = item.quantidadeKg > 0 ? `${kgBr(item.quantidadeKg)} kg a cotar` : 'sem quantidade';
  return quando ? `${quando.replace(/^salva/, 'salvo')} · ${kg}` : kg;
}
