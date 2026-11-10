import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  forecastGerarCotacaoKeys,
  listForecastProdutosParaCotacao,
  type ForecastCodigoParaCotacao,
} from '@/services/forecastGerarCotacao';

// Vinculo dos codigos do Forecast com o catalogo para o "Criar cotacao" do relatorio de compras (piloto PR6, refeito na E6): o
// provedor le o vinculo UMA vez (1 GET para o relatorio inteiro) e so existe para quem pode criar cotacao. O botao antigo
// "Gerar cotacao" (navegava para /cotacoes/nova?fromForecast=...) saiu da tela na E6: o pop-up "Criar cotacao" gera em lote.
// A rota /cotacoes/nova com `fromForecast` segue valida (usePrefillDoForecast); a E8 decide a limpeza.

interface Contexto {
  snapshotId: number;
  podeCriar: boolean;
  produtos: Map<number, ForecastCodigoParaCotacao[]>;
  carregando: boolean;
  erro: boolean;
}

const ContextoGerarCotacao = createContext<Contexto | null>(null);

interface ProvedorProps {
  snapshotId: number;
  /** admin/comprador (o mesmo predicado de criar cotacao na CotacaoNova); os demais nao veem a selecao nem o pop-up. */
  podeCriar: boolean;
  children: ReactNode;
}

export function ProvedorGerarCotacao({ snapshotId, podeCriar, children }: ProvedorProps) {
  const consulta = useQuery({
    queryKey: forecastGerarCotacaoKeys.produtos,
    queryFn: listForecastProdutosParaCotacao,
    enabled: podeCriar,
  });
  const produtos = useMemo(
    () => new Map((consulta.data ?? []).map((p) => [p.id, p.codes] as const)),
    [consulta.data],
  );
  const valor = useMemo<Contexto>(
    () => ({
      snapshotId,
      podeCriar,
      produtos,
      carregando: consulta.isLoading,
      erro: consulta.isError && consulta.data === undefined,
    }),
    [snapshotId, podeCriar, produtos, consulta.isLoading, consulta.isError, consulta.data],
  );
  return <ContextoGerarCotacao.Provider value={valor}>{children}</ContextoGerarCotacao.Provider>;
}

/** Permissao de criar cotacao do provedor (false fora dele). */
export function usePodeCriarCotacao(): boolean {
  return useContext(ContextoGerarCotacao)?.podeCriar === true;
}

export interface VinculosDeCotacao {
  snapshotId: number;
  carregando: boolean;
  erro: boolean;
  /** Codigos do produto no cadastro do Forecast (com o vinculo ao catalogo); `undefined` = produto fora do cadastro. */
  codesDe: (productId: number) => ForecastCodigoParaCotacao[] | undefined;
}

/**
 * Vinculo dos codigos com o catalogo (a mesma consulta unica do provedor) para o pop-up "Criar cotacao" decidir quais
 * itens podem virar cotacao. `null` fora do provedor ou sem permissao de criar.
 */
export function useVinculosDeCotacao(): VinculosDeCotacao | null {
  const ctx = useContext(ContextoGerarCotacao);
  return useMemo(
    () =>
      ctx && ctx.podeCriar
        ? {
            snapshotId: ctx.snapshotId,
            carregando: ctx.carregando,
            erro: ctx.erro,
            codesDe: (productId: number) => ctx.produtos.get(productId),
          }
        : null,
    [ctx],
  );
}
