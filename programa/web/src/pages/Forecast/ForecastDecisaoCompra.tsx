import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ForecastItemRelatorio } from '@/services/forecast';
import { forecastDecisoesKeys, listForecastDecisoes, type ForecastDecisao } from '@/services/forecastDecisoes';
import { textoSalvaEm } from './forecastDecisaoCampos';
import { useAviso } from './ForecastAvisos';
import { kgBr } from './forecastPainel';
import { qtdFinalDaLinha, statusDaLinha, TITULO_COLUNA_QTD_FINAL } from './forecastTrackingRegras';

// Decisoes de compra da quinzena (PR3, enxugado na E8): o provedor busca a lista UMA vez (1 GET para todas as tabelas) e a
// tela le dele (resumo no expansor Detalhes, Qtd. final fixa e status automatico). A decisao e gravada pelo pop-up "Criar
// cotacao" (lote); o editor com PUT por linha saiu na E8. Fora do provedor nada e renderizado.

interface Contexto {
  mapa: Map<number, ForecastDecisao>;
  carregando: boolean;
  erro: boolean;
}

const ContextoDecisoes = createContext<Contexto | null>(null);

interface ProvedorProps {
  snapshotId: number;
  children: ReactNode;
}

export function ProvedorDecisoesCompra({ snapshotId, children }: ProvedorProps) {
  const consulta = useQuery({
    queryKey: forecastDecisoesKeys.lista(snapshotId),
    queryFn: () => listForecastDecisoes(snapshotId),
  });
  const mapa = useMemo(() => new Map((consulta.data ?? []).map((d) => [d.productId, d] as const)), [consulta.data]);
  const valor = useMemo<Contexto>(
    () => ({ mapa, carregando: consulta.isLoading, erro: consulta.isError && consulta.data === undefined }),
    [mapa, consulta.isLoading, consulta.isError, consulta.data],
  );
  const noIcone = useAviso(
    'decisoes',
    consulta.isError
      ? {
          tom: 'erro',
          titulo: 'Quantidades decididas indisponíveis',
          texto: 'Não foi possível carregar as quantidades decididas desta quinzena. O relatório segue disponível.',
          acao: { rotulo: 'Tentar de novo', aoClicar: () => void consulta.refetch() },
        }
      : null,
  );
  return (
    <ContextoDecisoes.Provider value={valor}>
      {consulta.isError && !noIcone && (
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

function Leitura({ decisao }: { decisao: ForecastDecisao | undefined }) {
  if (!decisao) return <span className="fdec-estado">Sem decisão</span>;
  // E7: a Qtd. final fixa (preenchida pelo sistema) e a cotacao vinculada entram no resumo da decisao.
  const final = qtdFinalDaLinha(decisao);
  return (
    <div className="fdec-leitura">
      <span className="fdec-valor">{kgBr(decisao.quantidadeKg)} kg</span>
      <span className="fdec-estado">{statusDaLinha(decisao.status, decisao, false).rotulo}</span>
      {final.preenchida && (
        <span className="fdec-estado" title={final.dica}>
          {TITULO_COLUNA_QTD_FINAL}: {final.texto} kg{decisao.cotacao ? ` · ${decisao.cotacao.requestCode}` : ''}
        </span>
      )}
      {decisao.observacao && <span className="fdec-estado">Obs.: {decisao.observacao}</span>}
      <span className="fdec-estado">{textoSalvaEm(decisao.atualizadaEm)}</span>
    </div>
  );
}

/** Decisoes da quinzena (a consulta unica do provedor) para quem so precisa ler: `null` fora do provedor. */
export function useDecisoesDaQuinzena(): { mapa: ReadonlyMap<number, ForecastDecisao>; carregando: boolean; erro: boolean } | null {
  const ctx = useContext(ContextoDecisoes);
  return ctx ? { mapa: ctx.mapa, carregando: ctx.carregando, erro: ctx.erro } : null;
}

/** Resumo somente leitura da decisao (tela e papel); a edicao fica no pop-up "Criar cotação". */
export function ForecastDecisaoLeitura({ item }: { item: ForecastItemRelatorio }) {
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
  return <Leitura decisao={ctx.mapa.get(productId)} />;
}
