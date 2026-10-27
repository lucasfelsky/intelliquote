import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ForecastItemRelatorio } from '@/services/forecast';
import { forecastDecisoesKeys, listForecastDecisoes } from '@/services/forecastDecisoes';
import {
  forecastGerarCotacaoKeys,
  listForecastProdutosParaCotacao,
  type ForecastCodigoParaCotacao,
} from '@/services/forecastGerarCotacao';
import { linkGerarCotacao, motivoDoBotao } from './forecastGerarCotacaoRegras';

// Botao "Gerar cotacao" da linha do relatorio de compras (piloto PR6): leva para /cotacoes/nova com a linha como parametro
// (a CotacaoNova faz o pre-preenchimento). O provedor le o vinculo dos codigos com o catalogo UMA vez (1 GET para o relatorio
// inteiro) e so existe para quem pode criar cotacao. Fora do provedor (ou sem permissao) o botao nao renderiza nada.

interface Contexto {
  snapshotId: number;
  podeCriar: boolean;
  navegar: (destino: string) => void;
  produtos: Map<number, ForecastCodigoParaCotacao[]>;
  carregando: boolean;
  erro: boolean;
}

const ContextoGerarCotacao = createContext<Contexto | null>(null);

interface ProvedorProps {
  snapshotId: number;
  /** admin/comprador (o mesmo predicado de criar cotacao na CotacaoNova); os demais nao veem o botao. */
  podeCriar: boolean;
  children: ReactNode;
}

export function ProvedorGerarCotacao({ snapshotId, podeCriar, children }: ProvedorProps) {
  const navegar = useNavigate();
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
      navegar,
      produtos,
      carregando: consulta.isLoading,
      erro: consulta.isError && consulta.data === undefined,
    }),
    [snapshotId, podeCriar, navegar, produtos, consulta.isLoading, consulta.isError, consulta.data],
  );
  return <ContextoGerarCotacao.Provider value={valor}>{children}</ContextoGerarCotacao.Provider>;
}

interface BotaoProps {
  item: ForecastItemRelatorio;
  productId: number | null;
  ctx: Contexto;
}

function Botao({ item, productId, ctx }: BotaoProps) {
  const idMotivo = useId();
  // Mesma key e fn do ProvedorDecisoesCompra: deduplicado (nenhum GET a mais) e reage na hora quando a decisao e salva.
  const decisoes = useQuery({
    queryKey: forecastDecisoesKeys.lista(ctx.snapshotId),
    queryFn: () => listForecastDecisoes(ctx.snapshotId),
  });
  const decisao = productId === null ? undefined : (decisoes.data ?? []).find((d) => d.productId === productId);
  const motivo = motivoDoBotao({
    productId,
    produtosCarregando: ctx.carregando,
    produtosErro: ctx.erro,
    codes: productId === null ? undefined : ctx.produtos.get(productId),
    decisaoKg: decisao?.quantidadeKg,
    quantidadeFinal: item.quantidadeFinal,
  });
  return (
    <div className="fgc-acao">
      <button
        type="button"
        className="ghost-button ghost-button--sm fgc-botao"
        aria-label={`Gerar cotação de ${item.item}`}
        aria-disabled={motivo ? 'true' : undefined}
        aria-describedby={motivo ? idMotivo : undefined}
        onClick={() => {
          if (motivo || productId === null) return;
          ctx.navegar(linkGerarCotacao(ctx.snapshotId, productId));
        }}
      >
        Gerar cotação
      </button>
      {motivo && (
        <span id={idMotivo} className="fgc-motivo">
          {motivo}
        </span>
      )}
    </div>
  );
}

export default function ForecastGerarCotacao({ item }: { item: ForecastItemRelatorio }) {
  const ctx = useContext(ContextoGerarCotacao);
  if (!ctx || !ctx.podeCriar) return null;
  return <Botao item={item} productId={item.productId ?? null} ctx={ctx} />;
}
