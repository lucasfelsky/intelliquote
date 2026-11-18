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
import { PO_ITENS_MAX, type ForecastPoDiretaEnviada } from '@/services/forecastPoDireta';
import { forecastPrecosKeys, getForecastPrecosFechados, type PrecoFechadoDoItem } from '@/services/forecastPrecoFechado';
import { useDecisoesDaQuinzena } from './ForecastDecisaoCompra';
import { useVinculosDeCotacao } from './ForecastGerarCotacao';
import PopupCriarCotacao from './ForecastCriarCotacaoPopup';
import ForecastPoDiretaModal from './ForecastPoDiretaModal';
import ForecastPrecoFechadoModal from './ForecastPrecoFechadoModal';
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
  /**
   * PO direta de itens de PRECO FECHADO (sem cotacao): abre o modal de envio com UM item ou varios (um e-mail e um PDF; o servidor
   * exige o mesmo fornecedor). `origem` recebe o foco de volta ao fechar.
   */
  abrirPoDireta: (itens: ForecastItemRelatorio[], origem?: HTMLElement | null) => void;
  /**
   * Envia PO dos itens SELECIONADOS que sao de preco fechado: uma PO por fonte, uma de cada vez (o modal mostra "PO 1 de 2").
   * Itens sem preco valido no cadastro ficam de fora.
   */
  abrirPoDaSelecao: (origem?: HTMLElement | null) => void;
  /**
   * Preco fechado do item no cadastro atual (valor, moeda, incoterm, validade e estado). So o provedor de quem edita consulta
   * (admin/comprador); `undefined` enquanto carrega, se a consulta falhar ou se o item nao tem o selo no cadastro.
   */
  precoFechado: (productId: number) => PrecoFechadoDoItem | undefined;
  /** Data de hoje (AAAA-MM-DD, Sao Paulo) da ultima consulta de precos; vazio antes de carregar. */
  hojePrecos: string;
  /** Abre o cadastro do preco fechado do item. `origem` recebe o foco de volta ao fechar. */
  abrirPreco: (item: ForecastItemRelatorio, origem?: HTMLElement | null) => void;
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
  /** Quantos dos selecionados podem seguir como PO direta (preco fechado com preco valido). */
  nPo: number;
  onEnviarPo: (origem: HTMLElement) => void;
}

function BarraDeSelecao({ selecionados, onCriar, onLimpar, nPo, onEnviarPo }: BarraProps) {
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
      {nPo > 0 && (
        <button
          type="button"
          className="ghost-button ghost-button--sm fcl-barra__po"
          aria-haspopup="dialog"
          disabled={nPo > PO_ITENS_MAX}
          title={
            nPo > PO_ITENS_MAX
              ? `A PO aceita no máximo ${PO_ITENS_MAX} itens: tire ${nPo - PO_ITENS_MAX} da seleção.`
              : 'Envia a Ordem de Compra dos itens de preço fechado selecionados, sem cotação (uma PO por fonte)'
          }
          onClick={(e) => onEnviarPo(e.currentTarget)}
        >
          <Icon name="file-text" size={16} />
          Enviar PO ({nPo})
        </button>
      )}
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
  // PO direta: `po` e o envio aberto (um ou varios itens do mesmo fornecedor); `filaPo` guarda os grupos que ainda faltam
  // quando a selecao tem varias fontes (uma PO por fonte, uma de cada vez).
  const [po, setPo] = useState<{ itens: ForecastItemRelatorio[]; posicao?: { atual: number; total: number } } | null>(null);
  const filaPoRef = useRef<{ grupos: ForecastItemRelatorio[][]; total: number }>({ grupos: [], total: 0 });
  const [posEnviadas, setPosEnviadas] = useState<PoEnviadaAviso[]>([]);
  const aberturaRef = useRef<HTMLElement | null>(null);
  const qc = useQueryClient();
  const [precoItem, setPrecoItem] = useState<ForecastItemRelatorio | null>(null);
  const [avisoPreco, setAvisoPreco] = useState<string | null>(null);
  // Precos fechados da quinzena (so o provedor de quem edita chega aqui): o selo da linha mostra o valor e o botao muda por estado.
  const precos = useQuery({
    queryKey: forecastPrecosKeys.lista(snapshotId),
    queryFn: () => getForecastPrecosFechados(snapshotId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const precoPorProduto = useMemo(
    () => new Map((precos.data?.itens ?? []).map((i) => [i.productId, i] as const)),
    [precos.data],
  );
  const precoFechado = useCallback((productId: number) => precoPorProduto.get(productId), [precoPorProduto]);
  const hojePrecos = precos.data?.hoje ?? '';

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

  const abrirPreco = useCallback((item: ForecastItemRelatorio, origem?: HTMLElement | null) => {
    aberturaRef.current = origem ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setAvisoPreco(null);
    setPrecoItem(item);
  }, []);

  const fecharPreco = useCallback(() => {
    setPrecoItem(null);
    const origem = aberturaRef.current;
    aberturaRef.current = null;
    window.setTimeout(() => {
      if (origem?.isConnected) origem.focus();
    }, 0);
  }, []);

  const aoSalvarPreco = useCallback(
    (_preco: PrecoFechadoDoItem, removido: boolean) => {
      setPrecoItem((atual) => {
        setAvisoPreco(atual ? `Preço fechado de ${atual.item} ${removido ? 'removido' : 'salvo'}.` : null);
        return null;
      });
      aberturaRef.current = null;
      void qc.invalidateQueries({ queryKey: forecastPrecosKeys.lista(snapshotId) });
    },
    [qc, snapshotId],
  );

  const abrirPoDireta = useCallback((itens: ForecastItemRelatorio[], origem?: HTMLElement | null) => {
    if (itens.length === 0) return;
    aberturaRef.current = origem ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    filaPoRef.current = { grupos: [], total: 0 };
    setPosEnviadas([]);
    setPo({ itens });
  }, []);

  // Itens selecionados que seguem como PO direta: preco fechado, no cadastro e sem preco ausente/vencido (o servidor valida de novo).
  const itensParaPo = useMemo(
    () =>
      [...selecionados.values()].filter((s) => {
        const id = s.item.productId;
        if (s.item.precoFixo !== true || id === null || id === undefined) return false;
        // So com o preco carregado e valido (o servidor valida de novo, mas a barra nao promete o que daria 409).
        return precoPorProduto.get(id)?.estado === 'ok';
      }),
    [selecionados, precoPorProduto],
  );

  const abrirPoDaSelecao = useCallback(
    (origem?: HTMLElement | null) => {
      if (itensParaPo.length === 0) return;
      // Uma PO por fonte (cada fonte tem o seu fornecedor), na ordem em que as fontes aparecem na selecao.
      const porFonte = new Map<string, ForecastItemRelatorio[]>();
      for (const s of itensParaPo) {
        const chave = s.fonte.trim().toUpperCase();
        porFonte.set(chave, [...(porFonte.get(chave) ?? []), s.item]);
      }
      const [primeiro, ...resto] = [...porFonte.values()];
      aberturaRef.current = origem ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      filaPoRef.current = { grupos: resto, total: porFonte.size };
      setPosEnviadas([]);
      setPo({ itens: primeiro as ForecastItemRelatorio[], posicao: porFonte.size > 1 ? { atual: 1, total: porFonte.size } : undefined });
    },
    [itensParaPo],
  );

  const fecharPo = useCallback(() => {
    setPo(null);
    // Cancelar no meio da fila descarta so os grupos que faltam; os itens continuam selecionados.
    filaPoRef.current = { grupos: [], total: 0 };
    const origem = aberturaRef.current;
    aberturaRef.current = null;
    window.setTimeout(() => {
      if (origem?.isConnected) origem.focus();
    }, 0);
  }, []);

  // PO enviada: fecha o modal, mostra o aviso e recarrega as decisoes (Qtd. final e status vem delas).
  const aoEnviarPo = useCallback(
    (resultado: ForecastPoDiretaEnviada) => {
      // As decisoes recarregam sempre: o e-mail saiu mesmo que o modal ja nao seja o mesmo.
      void qc.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
      const atual = po;
      if (!atual) return;
      setPosEnviadas((lista) => [...lista, { itens: atual.itens.map((i) => i.item), resultado }]);
      // Os itens da PO saem da selecao (viraram "PO enviada"); os das outras fontes seguem para a proxima PO.
      const enviados = new Set(atual.itens.map((i) => i.productId));
      setSelecionados((sel) => {
        const novo = new Map(sel);
        for (const id of enviados) if (id !== null && id !== undefined) novo.delete(id);
        return novo;
      });
      const [proximo, ...resto] = filaPoRef.current.grupos;
      if (proximo) {
        const total = filaPoRef.current.total;
        filaPoRef.current = { grupos: resto, total };
        setPo({ itens: proximo, posicao: { atual: total - resto.length, total } });
        return;
      }
      filaPoRef.current = { grupos: [], total: 0 };
      setPo(null);
      aberturaRef.current = null;
    },
    [po, qc, snapshotId],
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
      abrirPoDaSelecao,
      precoFechado,
      hojePrecos,
      abrirPreco,
      noRascunho,
      rascunho: rascunho.isSuccess ? rascunho.data : undefined,
    }),
    [quinzena, selecionados, podeSelecionar, motivoSemSelecao, alternar, marcar, limpar, abrir, abrirPoDireta, abrirPoDaSelecao, precoFechado, hojePrecos, abrirPreco, noRascunho, rascunho.isSuccess, rascunho.data],
  );

  return (
    <ContextoCriarCotacao.Provider value={valor}>
      {criadas && <AvisoCriadas criadas={criadas} onDispensar={() => setCriadas(null)} />}
      {posEnviadas.map((enviada, i) => (
        <AvisoPoEnviada
          key={enviada.resultado.purchaseOrderIds.join('-') || i}
          enviada={enviada}
          onDispensar={() => setPosEnviadas((lista) => lista.filter((x) => x !== enviada))}
        />
      ))}
      {avisoPreco && (
        <section className="alert alert--success fcl-criadas" role="status" aria-label="Preço fechado">
          <div className="fcl-criadas__corpo">
            <strong>{avisoPreco}</strong>
          </div>
          <button type="button" className="ghost-button ghost-button--sm" onClick={() => setAvisoPreco(null)}>
            Dispensar
          </button>
        </section>
      )}
      {children}
      <BarraDeSelecao
        selecionados={selecionados}
        onCriar={(origem) => abrir(undefined, origem)}
        onLimpar={limpar}
        nPo={itensParaPo.length}
        onEnviarPo={(origem) => abrirPoDaSelecao(origem)}
      />
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
          <ForecastPoDiretaModal
            // Uma instancia nova por grupo da fila: quantidades, assunto e chave de envio nascem a cada PO.
            key={po.itens.map((i) => i.productId).join('-')}
            snapshotId={snapshotId}
            quinzena={quinzena}
            itens={po.itens}
            posicao={po.posicao}
            onClose={fecharPo}
            onEnviada={aoEnviarPo}
          />,
          document.body,
        )}
      {precoItem &&
        createPortal(
          <ForecastPrecoFechadoModal
            item={precoItem}
            atual={precoItem.productId == null ? undefined : precoPorProduto.get(precoItem.productId)}
            hoje={hojePrecos}
            onFechar={fecharPreco}
            onSalvo={aoSalvarPreco}
          />,
          document.body,
        )}
    </ContextoCriarCotacao.Provider>
  );
}

interface PoEnviadaAviso {
  /** Nomes dos itens da PO, na ordem do envio. */
  itens: string[];
  resultado: ForecastPoDiretaEnviada;
}

function AvisoPoEnviada({ enviada, onDispensar }: { enviada: PoEnviadaAviso; onDispensar: () => void }) {
  const { resultado } = enviada;
  const pendente = resultado.registro === 'pendente';
  const descricao = enviada.itens.length === 1 ? `PO de ${enviada.itens[0]}` : `PO de ${enviada.itens.length} itens`;
  return (
    <section className={`alert ${pendente ? 'alert--warning' : 'alert--success'} fcl-criadas`} role="status" aria-label="PO enviada">
      <div className="fcl-criadas__corpo">
        <strong>
          {pendente ? 'PO enviada, mas o registro na quinzena não foi concluído.' : `${descricao} enviada a ${resultado.fornecedor}.`}
        </strong>
        <span>
          {pendente
            ? 'O e-mail saiu. Confira o status dos itens antes de enviar outra PO e avise a TI se a Qtd. final não aparecer.'
            : `Para ${resultado.para}${resultado.copia.length > 0 ? `, com ${resultado.copia.length} em cópia` : ''}. ${enviada.itens.length === 1 ? 'A Qtd. final do item foi atualizada.' : 'A Qtd. final de cada item foi atualizada.'}`}
        </span>
        {enviada.itens.length > 1 && (
          <ul className="fcl-criadas__lista">
            {enviada.itens.map((nome) => (
              <li key={nome}>{nome}</li>
            ))}
          </ul>
        )}
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
