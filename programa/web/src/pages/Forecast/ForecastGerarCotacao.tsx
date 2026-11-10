import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons';
import { InfoPopover } from '@/components/InfoPopover';
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
  comTexto: boolean;
}

/** Permissao de criar cotacao do provedor (false fora dele). */
export function usePodeCriarCotacao(): boolean {
  return useContext(ContextoGerarCotacao)?.podeCriar === true;
}

function Botao({ item, productId, ctx, comTexto }: BotaoProps) {
  const idMotivo = useId();
  // Mesma key e fn do ProvedorDecisoesCompra: deduplicado (nenhum GET a mais) e reage na hora quando a decisao e salva.
  const decisoes = useQuery({
    queryKey: forecastDecisoesKeys.lista(ctx.snapshotId),
    queryFn: () => listForecastDecisoes(ctx.snapshotId),
    // O botao agora nasce ao abrir o pop-up Cotar: a lista ja esta no cache (provedor) e nao deve ser buscada de novo.
    refetchOnMount: false,
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
        title={motivo ?? 'Gerar cotação'}
        onClick={() => {
          if (motivo || productId === null) return;
          ctx.navegar(linkGerarCotacao(ctx.snapshotId, productId));
        }}
      >
        {/* Na tabela: so icone (refino visual, etapa 4); texto e motivo seguem no DOM para o leitor de tela e como dica (title).
            No pop-up "Cotar" (comTexto) o rotulo aparece. */}
        <Icon name="file-plus" size={16} />
        <span className={comTexto ? undefined : 'fcr-so-leitor'}>Gerar cotação</span>
      </button>
      {motivo && (
        <span id={idMotivo} className="fgc-motivo fcr-so-leitor">
          {motivo}
        </span>
      )}
      {/* Motivo visivel para quem usa teclado ou toque sem leitor de tela. */}
      {motivo && (
        <InfoPopover label="Por que não dá para gerar a cotação" tone="warning" className="fgc-motivo-chip" trigger={<Icon name="info" size={14} />}>
          {motivo}
        </InfoPopover>
      )}
    </div>
  );
}

interface Props {
  item: ForecastItemRelatorio;
  /** Mostra o rotulo "Gerar cotação" (pop-up Cotar); na tabela so o icone. */
  comTexto?: boolean;
}

export default function ForecastGerarCotacao({ item, comTexto = false }: Props) {
  const ctx = useContext(ContextoGerarCotacao);
  if (!ctx || !ctx.podeCriar) return null;
  return <Botao item={item} productId={item.productId ?? null} ctx={ctx} comTexto={comTexto} />;
}
