import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ForecastItemRelatorio, ForecastStatus } from '@/services/forecast';
import {
  FORECAST_DECISAO_OBSERVACAO_MAX,
  forecastDecisaoErrorMessage,
  forecastDecisoesKeys,
  listForecastDecisoes,
  putForecastDecisao,
  type ForecastDecisao,
  type ForecastDecisaoGravada,
  type ForecastDecisaoPut,
} from '@/services/forecastDecisoes';
import { ApiError } from '@/api/client';
import { kgParaCampo, sugeridaParaCampo, textoSalvaEm, validarDecisao } from './forecastDecisaoCampos';
import { kgBr, STATUS_ORDEM, STATUS_ROTULO } from './forecastPainel';

// Coluna "Qtd. decidida (kg)" do relatorio de compras (PR3): o comprador registra a quantidade que decidiu comprar por
// item da lista, quinzena a quinzena. O provedor busca a lista da quinzena UMA vez (1 GET para todas as tabelas); a celula
// de cada linha le dele e grava por PUT. Fora do provedor a celula nao renderiza nada.

interface Contexto {
  snapshotId: number;
  podeEditar: boolean;
  mapa: Map<number, ForecastDecisao>;
  carregando: boolean;
  erro: boolean;
}

const ContextoDecisoes = createContext<Contexto | null>(null);

interface ProvedorProps {
  snapshotId: number;
  /** admin/comprador editam; os demais so leem. */
  podeEditar: boolean;
  children: ReactNode;
}

export function ProvedorDecisoesCompra({ snapshotId, podeEditar, children }: ProvedorProps) {
  const consulta = useQuery({
    queryKey: forecastDecisoesKeys.lista(snapshotId),
    queryFn: () => listForecastDecisoes(snapshotId),
  });
  const mapa = useMemo(() => new Map((consulta.data ?? []).map((d) => [d.productId, d] as const)), [consulta.data]);
  const valor = useMemo<Contexto>(
    () => ({ snapshotId, podeEditar, mapa, carregando: consulta.isLoading, erro: consulta.isError && consulta.data === undefined }),
    [snapshotId, podeEditar, mapa, consulta.isLoading, consulta.isError, consulta.data],
  );
  return (
    <ContextoDecisoes.Provider value={valor}>
      {consulta.isError && (
        <div className="alert alert--error fdec-alerta" role="alert">
          <span>Não foi possível carregar as quantidades decididas desta quinzena. O relatório segue disponível.</span>
          <button type="button" className="ghost-button ghost-button--sm" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}
      {children}
    </ContextoDecisoes.Provider>
  );
}

// Lista nova com a decisao devolvida pelo PUT no lugar do item (ou sem ele, quando apagada).
function aplicarGravacao(lista: ForecastDecisao[] | undefined, productId: number, r: ForecastDecisaoGravada) {
  const resto = (lista ?? []).filter((d) => d.productId !== productId);
  return r.decisao ? [...resto, r.decisao].sort((a, b) => a.productId - b.productId) : resto;
}

function Leitura({ decisao }: { decisao: ForecastDecisao | undefined }) {
  if (!decisao) return <span className="fdec-estado">Sem decisão</span>;
  return (
    <div className="fdec-leitura">
      <span className="fdec-valor">{kgBr(decisao.quantidadeKg)} kg</span>
      <span className="fdec-estado">{STATUS_ROTULO[decisao.status] ?? decisao.status}</span>
      {decisao.observacao && <span className="fdec-estado">Obs.: {decisao.observacao}</span>}
      <span className="fdec-estado">{textoSalvaEm(decisao.atualizadaEm)}</span>
    </div>
  );
}

interface EditorProps {
  item: ForecastItemRelatorio;
  productId: number;
  decisao: ForecastDecisao | undefined;
  snapshotId: number;
}

function Editor({ item, productId, decisao, snapshotId }: EditorProps) {
  const queryClient = useQueryClient();
  const [kg, setKg] = useState(decisao ? kgParaCampo(decisao.quantidadeKg) : '');
  const [status, setStatus] = useState<ForecastStatus>(decisao?.status ?? item.status);
  const [observacao, setObservacao] = useState(decisao?.observacao ?? '');
  const [erroLocal, setErroLocal] = useState('');
  const [salvoAgora, setSalvoAgora] = useState(false);
  const [ultimoCorpo, setUltimoCorpo] = useState<ForecastDecisaoPut | null>(null);

  const gravar = useMutation({
    mutationFn: (corpo: ForecastDecisaoPut) => putForecastDecisao(snapshotId, productId, corpo),
    onSuccess: (r) => {
      queryClient.setQueryData<ForecastDecisao[]>(forecastDecisoesKeys.lista(snapshotId), (lista) =>
        aplicarGravacao(lista, productId, r),
      );
      if (r.decisao) {
        setKg(kgParaCampo(r.decisao.quantidadeKg));
        setStatus(r.decisao.status);
        setObservacao(r.decisao.observacao ?? '');
      } else {
        setKg('');
        setStatus(item.status);
        setObservacao('');
      }
      setSalvoAgora(true);
    },
    onError: (err) => {
      // Outra pessoa gravou antes: recarrega a lista para a tela refletir a decisao dela.
      if (err instanceof ApiError && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
      }
    },
  });

  const editou = () => {
    setSalvoAgora(false);
    setErroLocal('');
    gravar.reset();
  };

  const validado = validarDecisao({ kg, observacao });
  const campoVazio = kg.trim() === '';
  const apagar = campoVazio && decisao !== undefined;
  const mudou = decisao
    ? campoVazio ||
      validado.valores?.quantidadeKg !== decisao.quantidadeKg ||
      status !== decisao.status ||
      (validado.valores?.observacao ?? null) !== decisao.observacao
    : !campoVazio;
  const salvando = gravar.isPending;

  const enviar = (corpo: ForecastDecisaoPut) => {
    setUltimoCorpo(corpo);
    setSalvoAgora(false);
    gravar.mutate(corpo);
  };

  const salvar = () => {
    if (!validado.valores) {
      setErroLocal(validado.erros.kg ?? validado.erros.observacao ?? 'Confira os campos.');
      return;
    }
    setErroLocal('');
    const { quantidadeKg, observacao: obs } = validado.valores;
    enviar(quantidadeKg === null ? { quantidadeKg: null } : { quantidadeKg, status, observacao: obs });
  };

  const nome = item.item;
  return (
    <div className="fdec-editor" aria-busy={salvando}>
      <div className="fdec-linha">
        <input
          type="text"
          inputMode="decimal"
          className="input fdec-kg"
          aria-label={`Qtd. decidida (kg) de ${nome}`}
          aria-invalid={erroLocal !== '' || undefined}
          value={kg}
          disabled={salvando}
          onChange={(e) => {
            setKg(e.target.value);
            editou();
          }}
        />
        <button
          type="button"
          className="ghost-button ghost-button--sm fdec-acoes"
          aria-label={`Usar sugerida de ${nome}`}
          disabled={salvando}
          onClick={() => {
            setKg(sugeridaParaCampo(item.quantidadeFinal));
            editou();
          }}
        >
          Usar sugerida
        </button>
      </div>
      <select
        className="select fdec-status"
        aria-label={`Status da decisão de ${nome}`}
        value={status}
        disabled={salvando}
        onChange={(e) => {
          setStatus(e.target.value as ForecastStatus);
          editou();
        }}
      >
        {STATUS_ORDEM.map((s) => (
          <option key={s} value={s}>
            {STATUS_ROTULO[s]}
          </option>
        ))}
      </select>
      <input
        type="text"
        className="input fdec-obs"
        placeholder="Obs."
        aria-label={`Obs. da decisão de ${nome}`}
        maxLength={FORECAST_DECISAO_OBSERVACAO_MAX}
        value={observacao}
        disabled={salvando}
        onChange={(e) => {
          setObservacao(e.target.value);
          editou();
        }}
      />
      <div className="fdec-linha fdec-acoes">
        <button
          type="button"
          className="primary-button fdec-salvar"
          aria-label={`${apagar ? 'Apagar decisão' : 'Salvar decisão'} de ${nome}`}
          disabled={salvando || !mudou}
          onClick={salvar}
        >
          {salvando ? 'Salvando…' : apagar ? 'Apagar decisão' : 'Salvar'}
        </button>
      </div>
      {erroLocal && (
        <p className="fdec-erro" role="alert">
          {erroLocal}
        </p>
      )}
      {gravar.isError && (
        <p className="fdec-erro" role="alert">
          {forecastDecisaoErrorMessage(gravar.error)}{' '}
          <button
            type="button"
            className="ghost-button ghost-button--sm"
            onClick={() => ultimoCorpo && enviar(ultimoCorpo)}
          >
            Tentar de novo
          </button>
        </p>
      )}
      {salvoAgora ? (
        <span className="fdec-estado" role="status">
          {decisao ? textoSalvaEm(decisao.atualizadaEm) : 'Decisão apagada'}
        </span>
      ) : decisao ? (
        <span className="fdec-estado">{textoSalvaEm(decisao.atualizadaEm)}</span>
      ) : (
        !gravar.isError && <span className="fdec-estado">Sem decisão</span>
      )}
    </div>
  );
}

export default function ForecastDecisaoCompra({ item }: { item: ForecastItemRelatorio }) {
  const ctx = useContext(ContextoDecisoes);
  if (!ctx) return null;
  const productId = item.productId ?? null;
  if (productId === null) {
    return (
      <span className="fdec-estado" title="Item fora do cadastro do Forecast: não recebe quantidade decidida.">
        Sem cadastro
      </span>
    );
  }
  if (ctx.erro) return <span className="fdec-estado">Indisponível</span>;
  if (ctx.carregando) return <span className="fdec-estado">Carregando…</span>;
  const decisao = ctx.mapa.get(productId);
  if (!ctx.podeEditar) return <Leitura decisao={decisao} />;
  return <Editor item={item} productId={productId} decisao={decisao} snapshotId={ctx.snapshotId} />;
}
