import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { Icon } from '@/components/icons';
import {
  deleteForecastRascunho,
  forecastCandidatosErrorMessage,
  forecastCotacaoLoteKeys,
  forecastLoteErrorMessage,
  forecastRascunhoErrorMessage,
  getForecastCandidatos,
  getForecastRascunho,
  postForecastCotacoes,
  putForecastRascunho,
  type ForecastCandidato,
  type ForecastCotacoesCriadas,
  type ForecastRascunho,
} from '@/services/forecastCotacaoLote';
import {
  cotacaoAbertaDaDecisao,
  FORECAST_DECISAO_OBSERVACAO_MAX,
  forecastDecisoesKeys,
  type ForecastDecisao,
} from '@/services/forecastDecisoes';
import { useDecisoesDaQuinzena } from './ForecastDecisaoCompra';
import { useVinculosDeCotacao } from './ForecastGerarCotacao';
import {
  agruparPorFonte,
  avisoDeArredondamento,
  chaveDaFonte,
  comValoresDoRascunho,
  itemDaLista,
  itemDeCandidato,
  itemIndisponivel,
  motivoDeBloqueio,
  paraItemDoLote,
  paraItemDoRascunho,
  textoBotaoGerar,
  textoResumoCotacoes,
  textoUsarSugerida,
  validarObservacao,
  validarQuantidadeACotar,
  etiquetaDoCandidato,
  etiquetaDaUrgencia,
  MAX_ITENS_DO_LOTE,
  type ContextoDeBloqueio,
  type ItemDaCotacao,
  type ItemSelecionado,
} from './forecastCriarCotacaoRegras';
import { kgBr } from './forecastPainel';

// Pop-up "Criar cotacao" (E6 do relatorio enxuto): itens escolhidos agrupados por fonte (uma cotacao por fonte), quantidade a
// cotar e observacao por item, convite "incluir?" com os demais itens da mesma fonte (lista de compra e candidatos da E3),
// "Adicionar outro item", rascunho com autosave (E5) e "Gerar cotacoes" (E4a). Depois de gerar, o provedor mostra o aviso com
// os links; o pop-up so guarda o que a pessoa digitou ate a gravacao dar certo.

/** Espera sem digitar antes de gravar o rascunho (a API nao pode ser martelada a cada tecla). */
export const RASCUNHO_DEBOUNCE_MS = 1200;
const RASCUNHO_ITENS_MAX = 200;
const BUSCA_LIMITE = 8;

interface PopupProps {
  snapshotId: number;
  quinzena: string;
  diasCritico: number;
  itensDaLista: ItemSelecionado[];
  preselecionados: ItemSelecionado[];
  onFechar: () => void;
  onGerado: (criadas: ForecastCotacoesCriadas) => void;
}

interface Inicial {
  /** `'erro'` = nao deu para ler o rascunho (sem base para a concorrencia: nada e gravado). */
  rascunho: ForecastRascunho | null | 'erro';
  candidatos: ForecastCandidato[];
}

/** Item que o convite e a busca oferecem: ja sabe montar o item da cotacao. */
interface Opcao {
  productId: number;
  nome: string;
  codigos: string[];
  fonte: string;
  etiqueta: string;
  demandaKg: number | null;
  sugeridaKg: number | null;
  montar: () => ItemDaCotacao;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function montarItens(
  preselecionados: readonly ItemSelecionado[],
  rascunho: ForecastRascunho | null,
  candidatos: ReadonlyMap<number, ForecastCandidato>,
  lista: ReadonlyMap<number, ItemSelecionado>,
  decisoes: ReadonlyMap<number, ForecastDecisao>,
  diasCritico: number,
): ItemDaCotacao[] {
  const vistos = new Set<number>();
  const saida: ItemDaCotacao[] = [];
  for (const r of rascunho?.itens ?? []) {
    if (vistos.has(r.productId)) continue;
    vistos.add(r.productId);
    const sel = lista.get(r.productId);
    const cand = candidatos.get(r.productId);
    const decisao = decisoes.get(r.productId);
    const base = sel ? itemDaLista(sel, decisao, diasCritico) : cand ? itemDeCandidato(cand, decisao) : null;
    saida.push(base ? comValoresDoRascunho(base, r) : itemIndisponivel(r));
  }
  for (const sel of preselecionados) {
    const id = sel.item.productId;
    if (id === null || id === undefined || vistos.has(id)) continue;
    const item = itemDaLista(sel, decisoes.get(id), diasCritico);
    if (!item) continue;
    vistos.add(id);
    saida.push(item);
  }
  return saida;
}

const horaDe = (d: Date) =>
  d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

// ---------- casca: espera o rascunho e as decisoes antes de montar o corpo (nunca volta a esperar) ----------

export default function PopupCriarCotacao(props: PopupProps) {
  const { snapshotId, quinzena, itensDaLista, onFechar } = props;
  const decisoes = useDecisoesDaQuinzena();
  const rascunho = useQuery({
    queryKey: forecastCotacaoLoteKeys.rascunho(snapshotId),
    queryFn: () => getForecastRascunho(snapshotId),
    // O rascunho pode ter mudado em outra aba: le de novo ao abrir (o corpo so monta com a resposta fresca).
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  const listaPorId = useMemo(
    () => new Map(itensDaLista.flatMap((s) => (s.item.productId == null ? [] : [[s.item.productId, s] as const]))),
    [itensDaLista],
  );
  const precisaTodos = (rascunho.data?.itens ?? []).some((i) => !listaPorId.has(i.productId));
  const todos = useQuery({
    queryKey: forecastCotacaoLoteKeys.candidatos(snapshotId, null),
    queryFn: () => getForecastCandidatos(snapshotId, null),
    enabled: precisaTodos,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [inicial, setInicial] = useState<Inicial | null>(null);
  useEffect(() => {
    if (inicial || rascunho.isFetching) return;
    if (!rascunho.isSuccess && !rascunho.isError) return;
    if (decisoes?.carregando) return;
    if (precisaTodos && !todos.isSuccess && !todos.isError) return;
    setInicial({
      rascunho: rascunho.isSuccess ? rascunho.data : 'erro',
      candidatos: todos.data?.fontes.flatMap((f) => f.itens) ?? [],
    });
  }, [inicial, rascunho.isFetching, rascunho.isSuccess, rascunho.isError, rascunho.data, decisoes?.carregando, precisaTodos, todos.isSuccess, todos.isError, todos.data]);

  // O X, o Esc e o clique no fundo passam pelo "fechar" do corpo (grava o que estiver pendente antes de sair).
  const fecharDoCorpo = useRef<(() => void) | null>(null);
  const fechar = useCallback(() => (fecharDoCorpo.current ?? onFechar)(), [onFechar]);
  const registrarFechar = useCallback((fn: (() => void) | null) => {
    fecharDoCorpo.current = fn;
  }, []);

  return (
    <Modal
      isOpen
      onClose={fechar}
      title="Criar cotação"
      subtitle={`Quinzena ${quinzena} · uma cotação por fonte`}
      size="wide"
      className="fc-portal"
    >
      {inicial ? (
        <CorpoDoPopup {...props} inicial={inicial} registrarFechar={registrarFechar} />
      ) : (
        <div className="fcl-espera" role="status">
          <Spinner />
          <span>Carregando o rascunho…</span>
        </div>
      )}
    </Modal>
  );
}

// ---------- corpo ----------

type EstadoRascunho = 'ocioso' | 'pendente' | 'salvando' | 'salvo' | 'erro';

function CorpoDoPopup({
  snapshotId,
  diasCritico,
  itensDaLista,
  preselecionados,
  onFechar,
  onGerado,
  inicial,
  registrarFechar,
}: PopupProps & { inicial: Inicial; registrarFechar: (fn: (() => void) | null) => void }) {
  const qc = useQueryClient();
  const vinculos = useVinculosDeCotacao();
  const decisoesCtx = useDecisoesDaQuinzena();
  const mapaDecisoes = useMemo<ReadonlyMap<number, ForecastDecisao>>(() => decisoesCtx?.mapa ?? new Map(), [decisoesCtx?.mapa]);
  const leuDecisoes = decisoesCtx !== null && !decisoesCtx.erro && !decisoesCtx.carregando;
  const listaPorId = useMemo(
    () => new Map(itensDaLista.flatMap((s) => (s.item.productId == null ? [] : [[s.item.productId, s] as const]))),
    [itensDaLista],
  );
  const baseOk = inicial.rascunho !== 'erro';

  const [itens, setItens] = useState<ItemDaCotacao[]>(() =>
    montarItens(
      preselecionados,
      inicial.rascunho === 'erro' ? null : inicial.rascunho,
      new Map(inicial.candidatos.map((c) => [c.productId, c] as const)),
      listaPorId,
      mapaDecisoes,
      diasCritico,
    ),
  );
  const [versao, setVersao] = useState(0);
  const [estado, setEstado] = useState<EstadoRascunho>('ocioso');
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const [erroRascunho, setErroRascunho] = useState('');
  const [conflito, setConflito] = useState<{ atual: ForecastRascunho | null } | null>(null);
  const [temRascunho, setTemRascunho] = useState(inicial.rascunho !== 'erro' && inicial.rascunho !== null);
  const [convite, setConvite] = useState<ReadonlySet<number>>(() => new Set());
  const [dispensados, setDispensados] = useState<ReadonlySet<string>>(() => new Set());
  const [busca, setBusca] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState('');

  const itensRef = useRef(itens);
  itensRef.current = itens;
  const atualizadoEmRef = useRef<string | null>(
    inicial.rascunho === 'erro' || inicial.rascunho === null ? null : inicial.rascunho.atualizadoEm,
  );
  const emVooRef = useRef<Promise<void> | null>(null);
  const pendenteRef = useRef(false);
  const sujoRef = useRef(false);
  const gerouRef = useRef(false);
  const conflitoRef = useRef(false);
  conflitoRef.current = conflito !== null;
  const idErroGerar = useId();

  const chaveRascunho = forecastCotacaoLoteKeys.rascunho(snapshotId);

  // ---- itens ----
  const mudar = useCallback((fn: (antes: ItemDaCotacao[]) => ItemDaCotacao[]) => {
    setItens(fn);
    setVersao((v) => v + 1);
    sujoRef.current = true;
    setErroGerar('');
  }, []);
  const editar = (productId: number, parte: Partial<ItemDaCotacao>) =>
    mudar((a) => a.map((i) => (i.productId === productId ? { ...i, ...parte } : i)));
  const tirar = (productId: number) => {
    mudar((a) => a.filter((i) => i.productId !== productId));
    setConvite((c) => {
      const novo = new Set(c);
      novo.delete(productId);
      return novo;
    });
  };
  const adicionar = (o: Opcao, viaConvite = false) => {
    mudar((a) => (a.some((i) => i.productId === o.productId) ? a : [...a, o.montar()]));
    if (viaConvite) setConvite((c) => new Set(c).add(o.productId));
  };

  // ---- rascunho (E5): grava em silencio, serializado, com o atualizadoEm do que foi lido ----
  const salvar = useCallback(async (): Promise<void> => {
    if (!baseOk || gerouRef.current || conflitoRef.current) return;
    if (emVooRef.current) {
      pendenteRef.current = true;
      return emVooRef.current;
    }
    const rodar = async () => {
      setEstado('salvando');
      setErroRascunho('');
      try {
        do {
          pendenteRef.current = false;
          sujoRef.current = false;
          const r = await putForecastRascunho(snapshotId, {
            itens: itensRef.current.slice(0, RASCUNHO_ITENS_MAX).map(paraItemDoRascunho),
            atualizadoEm: atualizadoEmRef.current,
          });
          atualizadoEmRef.current = r.rascunho?.atualizadoEm ?? null;
          qc.setQueryData(chaveRascunho, r.rascunho);
          setTemRascunho(r.rascunho !== null);
        } while (pendenteRef.current);
        setEstado('salvo');
        setSalvoEm(new Date());
      } catch (err) {
        sujoRef.current = true;
        if (err instanceof ApiError && err.status === 409) {
          // Outra aba/sessao gravou antes: le a versao atual e deixa a pessoa escolher (nada e sobrescrito sem ela).
          try {
            const atual = await getForecastRascunho(snapshotId);
            qc.setQueryData(chaveRascunho, atual);
            setConflito({ atual });
            setEstado('ocioso');
          } catch (erroLeitura) {
            setEstado('erro');
            setErroRascunho(forecastRascunhoErrorMessage(erroLeitura));
          }
        } else {
          setEstado('erro');
          setErroRascunho(forecastRascunhoErrorMessage(err));
        }
      } finally {
        emVooRef.current = null;
      }
    };
    emVooRef.current = rodar();
    return emVooRef.current;
  }, [baseOk, snapshotId, qc, chaveRascunho]);
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;

  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (versao === 0 || !baseOk || conflito) return;
    setEstado('pendente');
    timerRef.current = window.setTimeout(() => void salvarRef.current(), RASCUNHO_DEBOUNCE_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [versao, baseOk, conflito]);

  const gravarPendente = useCallback(() => {
    window.clearTimeout(timerRef.current);
    if (sujoRef.current && baseOk && !gerouRef.current && !conflitoRef.current) void salvarRef.current();
  }, [baseOk]);

  const fechar = useCallback(() => {
    gravarPendente();
    onFechar();
  }, [gravarPendente, onFechar]);
  useEffect(() => {
    registrarFechar(fechar);
    return () => registrarFechar(null);
  }, [fechar, registrarFechar]);
  // Saiu por outro caminho (troca de tela): nao perde o que ficou dentro do debounce.
  useEffect(() => gravarPendente, [gravarPendente]);

  const descartar = async () => {
    window.clearTimeout(timerRef.current);
    await emVooRef.current;
    try {
      await deleteForecastRascunho(snapshotId);
    } catch (err) {
      setEstado('erro');
      setErroRascunho(forecastRascunhoErrorMessage(err));
      return;
    }
    gerouRef.current = true;
    atualizadoEmRef.current = null;
    qc.setQueryData(chaveRascunho, null);
    onFechar();
  };

  const usarRascunhoSalvo = async () => {
    if (!conflito) return;
    const atual = conflito.atual;
    let candidatos: ForecastCandidato[] = [];
    if ((atual?.itens ?? []).some((i) => !listaPorId.has(i.productId))) {
      try {
        const todos = await qc.fetchQuery({
          queryKey: forecastCotacaoLoteKeys.candidatos(snapshotId, null),
          queryFn: () => getForecastCandidatos(snapshotId, null),
          staleTime: 60_000,
        });
        candidatos = todos.fontes.flatMap((f) => f.itens);
      } catch {
        candidatos = [];
      }
    }
    atualizadoEmRef.current = atual?.atualizadoEm ?? null;
    setItens(montarItens([], atual, new Map(candidatos.map((c) => [c.productId, c] as const)), listaPorId, mapaDecisoes, diasCritico));
    setConvite(new Set());
    sujoRef.current = false;
    setTemRascunho(atual !== null);
    setConflito(null);
    setEstado('salvo');
  };
  const manterMeusItens = () => {
    if (!conflito) return;
    atualizadoEmRef.current = conflito.atual?.atualizadoEm ?? null;
    conflitoRef.current = false;
    setConflito(null);
    void salvarRef.current();
  };

  // ---- vinculo, bloqueios e validacao ----
  const bloqueio = useMemo<ContextoDeBloqueio>(
    () => ({
      produtosCarregando: vinculos?.carregando ?? false,
      produtosErro: vinculos?.erro ?? false,
      codesDe: (id) => vinculos?.codesDe(id),
      cotacaoAbertaDe: (id) => cotacaoAbertaDaDecisao(mapaDecisoes.get(id))?.requestCode ?? null,
    }),
    [vinculos, mapaDecisoes],
  );
  const grupos = useMemo(() => agruparPorFonte(itens), [itens]);
  const analise = useMemo(
    () =>
      itens.map((item) => {
        const motivo = motivoDeBloqueio(item, bloqueio);
        const qtd = validarQuantidadeACotar(item.kg);
        const erroObs = validarObservacao(item.obs);
        return { item, motivo, qtd, erroObs, ok: motivo === null && qtd.kg !== null && !erroObs };
      }),
    [itens, bloqueio],
  );
  const analiseDe = (id: number) => analise.find((a) => a.item.productId === id);
  const nValidos = analise.filter((a) => a.ok).length;
  const nProblemas = analise.length - nValidos;
  const totalKg = analise.reduce((t, a) => t + (a.ok && a.qtd.kg !== null ? Math.ceil(Math.round(a.qtd.kg * 1000) / 1000) : 0), 0);
  const gruposValidos = grupos.filter((g) => g.chave !== '');
  const podeGerar = !gerando && itens.length > 0 && nProblemas === 0 && itens.length <= MAX_ITENS_DO_LOTE;

  // ---- convite e busca (candidatos da E3) ----
  const fontesDoLote = useMemo(() => gruposValidos.map((g) => g.fonte), [gruposValidos]);
  const consultas = useQueries({
    queries: fontesDoLote.map((fonte) => ({
      queryKey: forecastCotacaoLoteKeys.candidatos(snapshotId, fonte),
      queryFn: () => getForecastCandidatos(snapshotId, fonte),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });
  const buscaAtiva = busca.trim() !== '';
  const todos = useQuery({
    queryKey: forecastCotacaoLoteKeys.candidatos(snapshotId, null),
    queryFn: () => getForecastCandidatos(snapshotId, null),
    enabled: buscaAtiva,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const opcaoDaLista = useCallback(
    (sel: ItemSelecionado): Opcao | null => {
      const id = sel.item.productId;
      if (id === null || id === undefined) return null;
      return {
        productId: id,
        nome: sel.item.item,
        codigos: sel.item.codigos,
        fonte: sel.fonte,
        etiqueta: etiquetaDaUrgencia(sel.item.urgencia, diasCritico),
        demandaKg: null,
        sugeridaKg: sel.item.quantidadeFinal,
        montar: () => itemDaLista(sel, mapaDecisoes.get(id), diasCritico) as ItemDaCotacao,
      };
    },
    [diasCritico, mapaDecisoes],
  );
  const opcaoDoCandidato = useCallback(
    (c: ForecastCandidato): Opcao => ({
      productId: c.productId,
      nome: c.item,
      codigos: c.codigos,
      fonte: c.fonte,
      etiqueta: etiquetaDoCandidato(c),
      demandaKg: c.demandaKg,
      sugeridaKg: c.quantidadeSugeridaKg,
      montar: () => itemDeCandidato(c, mapaDecisoes.get(c.productId)),
    }),
    [mapaDecisoes],
  );
  const opcoesDaLista = useMemo(
    () => itensDaLista.map(opcaoDaLista).filter((o): o is Opcao => o !== null),
    [itensDaLista, opcaoDaLista],
  );

  const noLote = useMemo(() => new Set(itens.map((i) => i.productId)), [itens]);
  const livre = (o: Opcao) => !bloqueio.cotacaoAbertaDe(o.productId);

  // Universo de itens que se pode oferecer: lista de compra + candidatos ja carregados (por fonte e, na busca, todos).
  const universo = useMemo(() => {
    const porId = new Map<number, Opcao>();
    for (const o of opcoesDaLista) porId.set(o.productId, o);
    const candidatos = [
      ...consultas.flatMap((q) => q.data?.fontes.flatMap((f) => f.itens) ?? []),
      ...(buscaAtiva ? (todos.data?.fontes.flatMap((f) => f.itens) ?? []) : []),
    ];
    for (const c of candidatos) if (!porId.has(c.productId)) porId.set(c.productId, opcaoDoCandidato(c));
    return [...porId.values()].filter(livre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opcoesDaLista, consultas, todos.data, buscaAtiva, opcaoDoCandidato, bloqueio]);

  const convidaveisDe = (chave: string) =>
    universo.filter((o) => chaveDaFonte(o.fonte) === chave && (!noLote.has(o.productId) || convite.has(o.productId)));

  // ---- gerar (E4a) ----
  const gerar = async () => {
    if (!podeGerar) return;
    window.clearTimeout(timerRef.current);
    gerouRef.current = true;
    setGerando(true);
    setErroGerar('');
    await emVooRef.current;
    try {
      const corpo = {
        itens: analise.map((a) =>
          paraItemDoLote(a.item, a.qtd.kg as number, mapaDecisoes.get(a.item.productId), leuDecisoes),
        ),
      };
      const criadas = await postForecastCotacoes(snapshotId, corpo);
      try {
        await deleteForecastRascunho(snapshotId);
      } catch {
        // O rascunho some na proxima gravacao/descarte; as cotacoes ja foram criadas.
      }
      atualizadoEmRef.current = null;
      qc.setQueryData(chaveRascunho, null);
      void qc.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
      void qc.invalidateQueries({ queryKey: ['forecast', 'candidatos', snapshotId] });
      onGerado(criadas);
    } catch (err) {
      // Nada foi criado (lote atomico): a pessoa segue com o que digitou, e o rascunho volta a ser gravado.
      gerouRef.current = false;
      setGerando(false);
      setErroGerar(forecastLoteErrorMessage(err));
      if (err instanceof ApiError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
      }
    }
  };

  const statusRascunho = (() => {
    if (!baseOk) return 'Rascunho indisponível: não foi possível ler o rascunho desta quinzena. Você ainda pode gerar as cotações.';
    if (estado === 'pendente') return 'Alterações a salvar…';
    if (estado === 'salvando') return 'Salvando o rascunho…';
    if (estado === 'erro') return erroRascunho;
    if (estado === 'salvo' && salvoEm) return `Rascunho salvo às ${horaDe(salvoEm)}.`;
    return temRascunho ? 'Há um rascunho salvo desta quinzena.' : '';
  })();

  return (
    <div className="fcl-popup" aria-busy={gerando}>
      {conflito && (
        <div className="alert alert--warning fcl-conflito" role="alert">
          <span>
            O rascunho desta cotação foi alterado em outra aba ou sessão. Escolha qual versão seguir: a gravação automática está
            parada.
          </span>
          <span className="fcl-conflito__acoes">
            <button type="button" className="ghost-button fcl-btn-sm" onClick={() => void usarRascunhoSalvo()}>
              Usar o rascunho salvo
            </button>
            <button type="button" className="ghost-button fcl-btn-sm" onClick={manterMeusItens}>
              Manter o que digitei
            </button>
          </span>
        </div>
      )}

      <section aria-label="Itens das cotações" className="fcl-secao">
        <div className="fcl-secao__cab">
          <h3>Itens das cotações</h3>
          <span className="badge badge--muted">
            {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          </span>
        </div>
        <p className="fcl-dica">
          A quantidade a cotar começa na decisão salva ou na Qtd. final calculada; ajuste se precisar. Itens de fontes diferentes
          viram cotações separadas.
        </p>
        {itens.length === 0 ? (
          <p className="fcl-vazio">Nenhum item na cotação. Inclua um abaixo ou feche e marque itens na tabela.</p>
        ) : (
          grupos.map((g) => (
            <div key={g.chave || 'sem-fonte'} className="fcl-grupo" role="group" aria-label={`Itens da fonte ${g.fonte}`}>
              <div className="fcl-grupo__cab">
                <h4>{g.fonte}</h4>
                <span className="badge badge--muted">
                  {g.itens.length} {g.itens.length === 1 ? 'item' : 'itens'}
                </span>
                <span className="fcl-dica">{g.chave === '' ? 'não vira cotação: tire os itens' : 'vira uma cotação'}</span>
              </div>
              <ul className="fcl-itens">
                {g.itens.map((i) => {
                  const a = analiseDe(i.productId);
                  const usar = textoUsarSugerida(i);
                  const aviso = a ? avisoDeArredondamento(a.qtd.kg) : undefined;
                  const idMsg = `fcl-msg-${i.productId}`;
                  return (
                    <li key={i.productId} className={a?.motivo ? 'fcl-item fcl-item--bloqueado' : 'fcl-item'}>
                      <div className="fcl-item__nome">
                        <strong>{i.nome}</strong>
                        {i.codigos.length > 0 && <span className="fcl-codigos">{i.codigos.join(' · ')}</span>}
                        {i.origem === 'candidato' && !i.indisponivel && <span className="badge badge--info">Fora da lista de compra</span>}
                        {i.etiqueta && <span className="badge badge--muted">{i.etiqueta}</span>}
                      </div>
                      <div className="fcl-item__sug">
                        <span className="fcl-rotulo">Sugerida (kg)</span>
                        <span className="fcl-mono">{i.sugeridaKg !== null ? kgBr(i.sugeridaKg) : '—'}</span>
                      </div>
                      <div className="fcl-item__qtd">
                        <span className="fcl-rotulo">A cotar (kg)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input fcl-kg"
                          aria-label={`Quantidade a cotar de ${i.nome}`}
                          aria-invalid={a && !a.motivo && a.qtd.erro ? true : undefined}
                          aria-describedby={idMsg}
                          value={i.kg}
                          disabled={gerando}
                          onChange={(e) => editar(i.productId, { kg: e.target.value, dicaKg: undefined })}
                        />
                        {usar !== null && (
                          <button
                            type="button"
                            className="fcl-link"
                            aria-label={`Usar sugerida de ${i.nome}`}
                            disabled={gerando}
                            onClick={() => editar(i.productId, { kg: usar, dicaKg: undefined })}
                          >
                            Usar sugerida
                          </button>
                        )}
                      </div>
                      <div className="fcl-item__obs">
                        <span className="fcl-rotulo">Obs.</span>
                        <input
                          type="text"
                          className="input fcl-obs"
                          placeholder="Obs. (opcional)"
                          aria-label={`Observação de ${i.nome}`}
                          maxLength={FORECAST_DECISAO_OBSERVACAO_MAX}
                          value={i.obs}
                          disabled={gerando}
                          onChange={(e) => editar(i.productId, { obs: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        className="ghost-button ghost-button--sm fcl-item__tirar"
                        aria-label={`Tirar ${i.nome} da cotação`}
                        title="Tirar da cotação"
                        disabled={gerando}
                        onClick={() => tirar(i.productId)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                      <div id={idMsg} className="fcl-item__msg">
                        {a?.motivo ? (
                          <span className="fcl-bloqueio">{a.motivo}</span>
                        ) : (
                          <>
                            {a?.qtd.erro && <span className="fcl-erro">{a.qtd.erro}</span>}
                            {a?.erroObs && <span className="fcl-erro">{a.erroObs}</span>}
                            {i.dicaKg && <span className="fcl-dica">{i.dicaKg}</span>}
                            {aviso && <span className="fcl-dica">{aviso}</span>}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {gruposValidos.map((g, idx) => (
        <ConviteDaFonte
          key={g.chave}
          fonte={g.fonte}
          opcoes={convidaveisDe(g.chave)}
          estado={consultas[idx]?.isLoading ? 'carregando' : consultas[idx]?.isError ? 'erro' : 'ok'}
          erro={consultas[idx]?.error}
          aoTentarDeNovo={() => void consultas[idx]?.refetch()}
          noLote={noLote}
          dispensado={dispensados.has(g.chave)}
          aoDispensar={() => setDispensados((d) => new Set(d).add(g.chave))}
          aoIncluir={(o) => adicionar(o, true)}
          aoTirar={tirar}
          desabilitado={gerando}
        />
      ))}

      <BuscaDeItem
        busca={busca}
        aoBuscar={setBusca}
        universo={universo.filter((o) => !noLote.has(o.productId))}
        fontesDoLote={new Set(gruposValidos.map((g) => g.chave))}
        carregando={buscaAtiva && todos.isLoading}
        erro={buscaAtiva && todos.isError ? todos.error : null}
        aoAdicionar={(o) => adicionar(o)}
        desabilitado={gerando}
      />

      <div className="fcl-rodape">
        <div className="fcl-rodape__resumo">
          <strong className="fcl-mono">
            {itens.length} {itens.length === 1 ? 'item' : 'itens'} · {kgBr(totalKg)} kg
          </strong>
          <span className="fcl-rodape__cotacoes" aria-live="polite">
            {textoResumoCotacoes(grupos)}
          </span>
          <span className="fcl-dica">
            O status de cada item muda sozinho: Cotação criada ao gerar; Cotando ao enviar aos fornecedores; Confirmado e PO
            enviada ao fechar com o fornecedor. A Qtd. final é preenchida ao enviar a cotação.
          </span>
          {statusRascunho && (
            <span className={estado === 'erro' || !baseOk ? 'fcl-erro' : 'fcl-dica'} role="status">
              {statusRascunho}
              {estado === 'salvo' && ' Só vira cotação quando você gerar; fica na linha como “Rascunho”.'}
            </span>
          )}
          {erroGerar && (
            <p id={idErroGerar} className="alert alert--error fcl-erro-gerar" role="alert">
              {erroGerar}
            </p>
          )}
          {!podeGerar && itens.length > 0 && nProblemas > 0 && (
            <span className="fcl-dica">
              {nProblemas} {nProblemas === 1 ? 'item precisa' : 'itens precisam'} de ajuste (quantidade ou bloqueio) antes de gerar.
            </span>
          )}
          {itens.length > MAX_ITENS_DO_LOTE && (
            <span className="fcl-erro">O lote aceita no máximo {MAX_ITENS_DO_LOTE} itens.</span>
          )}
        </div>
        <div className="fcl-rodape__acoes">
          {temRascunho && baseOk && (
            <button type="button" className="ghost-button" disabled={gerando} onClick={() => void descartar()}>
              Descartar rascunho
            </button>
          )}
          <button type="button" className="ghost-button" onClick={fechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={gerando || !baseOk || itens.length === 0 || conflito !== null}
            onClick={() => {
              window.clearTimeout(timerRef.current);
              void salvar();
            }}
          >
            Salvar rascunho
          </button>
          <button
            type="button"
            className="primary-button fcl-gerar"
            disabled={!podeGerar}
            aria-describedby={erroGerar ? idErroGerar : undefined}
            onClick={() => void gerar()}
          >
            <Icon name="file-plus" size={16} />
            {gerando ? 'Gerando…' : textoBotaoGerar(gruposValidos.length)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- convite "incluir?" ----------

interface ConviteProps {
  fonte: string;
  opcoes: Opcao[];
  estado: 'carregando' | 'erro' | 'ok';
  erro: unknown;
  aoTentarDeNovo: () => void;
  noLote: ReadonlySet<number>;
  dispensado: boolean;
  aoDispensar: () => void;
  aoIncluir: (o: Opcao) => void;
  aoTirar: (productId: number) => void;
  desabilitado: boolean;
}

function ConviteDaFonte({ fonte, opcoes, estado, erro, aoTentarDeNovo, noLote, dispensado, aoDispensar, aoIncluir, aoTirar, desabilitado }: ConviteProps) {
  if (dispensado) return null;
  if (estado === 'carregando') {
    return (
      <section className="fcl-convite" aria-label={`Outros itens da fonte ${fonte}`} aria-busy="true">
        <p className="fcl-dica" role="status">
          Procurando outros itens da fonte {fonte} com demanda…
        </p>
      </section>
    );
  }
  const pendentes = opcoes.filter((o) => !noLote.has(o.productId));
  if (estado === 'erro' && opcoes.length === 0) {
    return (
      <section className="fcl-convite" aria-label={`Outros itens da fonte ${fonte}`}>
        <p className="fcl-dica">
          {forecastCandidatosErrorMessage(erro)}{' '}
          <button type="button" className="fcl-link" onClick={aoTentarDeNovo}>
            Tentar de novo
          </button>
        </p>
      </section>
    );
  }
  if (opcoes.length === 0) return null;
  return (
    <section className="fcl-convite" aria-label={`Outros itens da fonte ${fonte}`}>
      <div className="fcl-convite__cab">
        <Icon name="info" size={18} />
        <div className="fcl-convite__texto">
          <strong>
            {pendentes.length > 0
              ? `Há ${pendentes.length} ${pendentes.length === 1 ? 'item' : 'itens'} da ${fonte} com demanda nesta quinzena que não ${pendentes.length === 1 ? 'está' : 'estão'} na cotação.`
              : `Todos os itens da ${fonte} com demanda estão na cotação.`}
          </strong>
          <span className="fcl-dica">
            Quer incluir? Eles aparecem aqui porque têm demanda no Forecast, mesmo que o cálculo não aponte falta.
          </span>
        </div>
        <div className="fcl-convite__acoes">
          {pendentes.length > 0 && (
            <button
              type="button"
              className="primary-button fcl-btn-sm"
              disabled={desabilitado}
              onClick={() => pendentes.forEach(aoIncluir)}
            >
              Incluir {pendentes.length === 1 ? 'o item' : `os ${pendentes.length}`}
            </button>
          )}
          <button type="button" className="ghost-button fcl-btn-sm" onClick={aoDispensar}>
            Agora não
          </button>
        </div>
      </div>
      <ul className="fcl-convite__lista">
        {opcoes.map((o) => {
          const marcado = noLote.has(o.productId);
          return (
            <li key={o.productId} className="fcl-convite__linha">
              <input
                type="checkbox"
                aria-label={`Incluir ${o.nome}`}
                checked={marcado}
                disabled={desabilitado}
                onChange={() => (marcado ? aoTirar(o.productId) : aoIncluir(o))}
              />
              <div className="fcl-convite__nome">
                <strong>{o.nome}</strong>
                <span className="fcl-codigos">{o.codigos.join(' · ')}</span>
              </div>
              <div className="fcl-convite__tags">
                <span className="badge badge--muted">{o.etiqueta}</span>
                {o.demandaKg !== null && (
                  <span className="badge badge--muted" title="Consumo previsto nos 6 meses da projeção.">
                    Demanda {kgBr(o.demandaKg)} kg
                  </span>
                )}
              </div>
              <div className="fcl-convite__sug">
                <span className="fcl-mono">{o.sugeridaKg !== null && o.sugeridaKg > 0 ? kgBr(o.sugeridaKg) : '—'}</span>
                <span className="fcl-rotulo">sugerida</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- adicionar outro item ----------

interface BuscaProps {
  busca: string;
  aoBuscar: (texto: string) => void;
  universo: Opcao[];
  fontesDoLote: ReadonlySet<string>;
  carregando: boolean;
  erro: unknown;
  aoAdicionar: (o: Opcao) => void;
  desabilitado: boolean;
}

function BuscaDeItem({ busca, aoBuscar, universo, fontesDoLote, carregando, erro, aoAdicionar, desabilitado }: BuscaProps) {
  const idBusca = useId();
  const termo = semAcento(busca.trim());
  const filtrados = universo.filter(
    (o) => termo === '' || semAcento(`${o.nome} ${o.codigos.join(' ')} ${o.fonte}`).includes(termo),
  );
  const daMesmaFonte = filtrados.filter((o) => fontesDoLote.has(chaveDaFonte(o.fonte))).slice(0, BUSCA_LIMITE);
  // Sem texto so aparece a mesma fonte (destaque); outras fontes entram quando a pessoa procura.
  const deOutras = termo === '' ? [] : filtrados.filter((o) => !fontesDoLote.has(chaveDaFonte(o.fonte))).slice(0, BUSCA_LIMITE);
  return (
    <section className="fcl-secao" aria-label="Adicionar outro item">
      <div className="fcl-secao__cab">
        <h3>Adicionar outro item</h3>
        <span className="fcl-dica">Os da mesma fonte aparecem primeiro e em destaque.</span>
      </div>
      <label className="fcl-busca" htmlFor={idBusca}>
        <Icon name="search" size={16} />
        <input
          id={idBusca}
          type="search"
          className="fcl-busca__campo"
          placeholder="Item, código ou fonte"
          aria-label="Buscar item para adicionar"
          value={busca}
          onChange={(e) => aoBuscar(e.target.value)}
        />
      </label>
      {carregando && (
        <p className="fcl-dica" role="status">
          Procurando…
        </p>
      )}
      {erro !== null && erro !== undefined && erro !== false && <p className="fcl-dica">{forecastCandidatosErrorMessage(erro)}</p>}
      {daMesmaFonte.length > 0 && (
        <div className="fcl-resultados" role="group" aria-label="Mesma fonte">
          <h4 className="fcl-resultados__titulo">Mesma fonte · com demanda</h4>
          <ul>
            {daMesmaFonte.map((o) => (
              <ResultadoDaBusca key={o.productId} o={o} destaque aoAdicionar={aoAdicionar} desabilitado={desabilitado} />
            ))}
          </ul>
        </div>
      )}
      {deOutras.length > 0 && (
        <div className="fcl-resultados" role="group" aria-label="Outras fontes">
          <h4 className="fcl-resultados__titulo">Outras fontes</h4>
          <ul>
            {deOutras.map((o) => (
              <ResultadoDaBusca key={o.productId} o={o} aoAdicionar={aoAdicionar} desabilitado={desabilitado} />
            ))}
          </ul>
        </div>
      )}
      {termo !== '' && !carregando && daMesmaFonte.length === 0 && deOutras.length === 0 && (
        <p className="fcl-dica" role="status">
          Nenhum item com demanda encontrado para “{busca.trim()}”.
        </p>
      )}
    </section>
  );
}

function ResultadoDaBusca({
  o,
  destaque = false,
  aoAdicionar,
  desabilitado,
}: {
  o: Opcao;
  destaque?: boolean;
  aoAdicionar: (o: Opcao) => void;
  desabilitado: boolean;
}) {
  return (
    <li className={destaque ? 'fcl-resultado fcl-resultado--destaque' : 'fcl-resultado'}>
      <div className="fcl-convite__nome">
        <strong>{o.nome}</strong>
        <span className="fcl-codigos">{o.codigos.join(' · ')}</span>
      </div>
      <div className="fcl-convite__tags">
        {!destaque && <span className="badge badge--muted">{o.fonte}</span>}
        <span className="badge badge--muted">{o.etiqueta}</span>
        {o.sugeridaKg !== null && o.sugeridaKg > 0 && <span className="fcl-mono">{kgBr(o.sugeridaKg)} kg</span>}
        {!destaque && <span className="fcl-dica">cria mais uma cotação</span>}
      </div>
      <button
        type="button"
        className="ghost-button fcl-btn-sm"
        aria-label={`Adicionar ${o.nome} à cotação`}
        disabled={desabilitado}
        onClick={() => aoAdicionar(o)}
      >
        Adicionar
      </button>
    </li>
  );
}
