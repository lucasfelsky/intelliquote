import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { forecastErrorMessage, forecastKeys, getForecastRelatorioCompras } from '@/services/forecast';
import { forecastDecisoesKeys, listForecastDecisoes } from '@/services/forecastDecisoes';
import { forecastEmbalagensKeys, getForecastEmbalagens } from '@/services/forecastEmbalagens';
import {
  forecastGerarCotacaoKeys,
  getCatalogItemParaCotacao,
  listForecastProdutosParaCotacao,
} from '@/services/forecastGerarCotacao';
import {
  codigoParaCotacao,
  descricaoDoForecast,
  lerParamFromForecast,
  MOTIVO_SEM_VINCULO,
  PARAM_FROM_FORECAST,
  quantidadeParaCotacao,
  type OrigemQuantidade,
} from './forecastGerarCotacaoRegras';

// Pre-preenchimento da CotacaoNova a partir de uma linha do relatorio de compras (?fromForecast=<quinzena>-<produto>), isolado
// aqui para a pagina so ligar o hook. Tudo ou nada: com qualquer bloqueio nada e preenchido (nem a descricao). Sem o parametro
// o hook e inerte (nenhuma consulta, nada renderizado).

export interface ItemDoForecast {
  catalogItemId: number;
  commercialName: string;
  marketName: string;
  quantity: number;
  unit: 'KG';
  notes: string;
}

export interface PrefillDoForecast {
  item: ItemDoForecast;
  description: string;
}

export type StatusPrefillForecast = 'inerte' | 'invalido' | 'conflito' | 'carregando' | 'aplicado' | 'bloqueado';

export interface EstadoPrefillForecast {
  status: StatusPrefillForecast;
  /** Texto do banner de sucesso (so em 'aplicado'). */
  banner: string | null;
  /** Aviso (bloqueio ou degradacao); renderizado como alerta. */
  aviso: string | null;
}

const AVISO_LINK_INVALIDO =
  'O link do Forecast é inválido. Siga com uma cotação comum ou gere de novo pelo relatório de compras.';
const AVISO_CONFLITO = 'Este link pedia dois pré-preenchimentos; foi usado só o da Solicitação do comercial.';
const AVISO_QUINZENA_NAO_ENCONTRADA = 'Quinzena não encontrada (pode ter sido excluída).';
const AVISO_VINCULO_ILEGIVEL = 'Não foi possível ler o vínculo com o catálogo.';
const AVISO_CATALOGO_NAO_ENCONTRADO = 'Item do catálogo não encontrado.';
const AVISO_DECISOES_INDISPONIVEIS =
  'Não foi possível carregar a quantidade decidida; foi usada a Qtd. final sugerida. Confira antes de salvar.';

const ORIGEM_ROTULO: Record<OrigemQuantidade, string> = {
  decidida: 'quantidade decidida',
  sugerida: 'Qtd. final sugerida',
};

const INERTE: EstadoPrefillForecast = { status: 'inerte', banner: null, aviso: null };
const CARREGANDO: EstadoPrefillForecast = { status: 'carregando', banner: null, aviso: null };

type Resolucao = { estado: EstadoPrefillForecast; prefill: PrefillDoForecast | null };

const bloqueado = (aviso: string, status: 'bloqueado' | 'invalido' | 'conflito' = 'bloqueado'): Resolucao => ({
  estado: { status, banner: null, aviso },
  prefill: null,
});

const naoEncontrado = (err: unknown) => err instanceof ApiError && err.status === 404;

export function usePrefillDoForecast(
  searchParams: URLSearchParams,
  habilitado: boolean,
  onPrefill: (p: PrefillDoForecast) => void,
): EstadoPrefillForecast {
  const raw = searchParams.get(PARAM_FROM_FORECAST);
  const param = lerParamFromForecast(raw);
  const conflito = raw !== null && searchParams.get('fromCommercialRequest') !== null;
  const valido = param !== null && param !== 'invalido' ? param : null;
  const snapshotId = valido?.snapshotId ?? 0;
  const productId = valido?.productId ?? 0;
  const ativo = valido !== null && !conflito && habilitado;

  const relatorio = useQuery({
    queryKey: forecastKeys.relatorio(snapshotId),
    queryFn: () => getForecastRelatorioCompras(snapshotId),
    enabled: ativo,
  });
  const decisoes = useQuery({
    queryKey: forecastDecisoesKeys.lista(snapshotId),
    queryFn: () => listForecastDecisoes(snapshotId),
    enabled: ativo,
  });
  const produtos = useQuery({
    queryKey: forecastGerarCotacaoKeys.produtos,
    queryFn: listForecastProdutosParaCotacao,
    enabled: ativo,
  });
  const embalagens = useQuery({
    queryKey: forecastEmbalagensKeys.produto(productId),
    queryFn: () => getForecastEmbalagens(productId),
    enabled: ativo,
  });

  // O codigo (e portanto o item do catalogo) so e escolhido com a lista de produtos e a embalagem principal resolvidas.
  const codigos = produtos.data?.find((p) => p.id === productId)?.codes ?? [];
  const principal = embalagens.data?.codigos.find((c) => c.principal)?.codigo ?? null;
  const codigo = produtos.data && !embalagens.isPending ? codigoParaCotacao(codigos, principal) : null;
  const catalogItemId = codigo?.catalogItemId ?? null;
  const catalogo = useQuery({
    queryKey: forecastGerarCotacaoKeys.catalogo(catalogItemId ?? 0),
    queryFn: () => getCatalogItemParaCotacao(catalogItemId as number),
    enabled: ativo && catalogItemId !== null,
  });

  function resolver(): Resolucao {
    if (relatorio.data === undefined && relatorio.isError) {
      return bloqueado(naoEncontrado(relatorio.error) ? AVISO_QUINZENA_NAO_ENCONTRADA : forecastErrorMessage(relatorio.error));
    }
    if (produtos.data === undefined && produtos.isError) return bloqueado(AVISO_VINCULO_ILEGIVEL);
    if (relatorio.data === undefined || produtos.data === undefined || embalagens.isPending || decisoes.isPending) {
      return { estado: CARREGANDO, prefill: null };
    }

    const label = relatorio.data.quinzena.label;
    const linha = relatorio.data.grupos
      .flatMap((g) => g.itens)
      .find((i) => (i.productId ?? null) === productId);
    if (!linha) return bloqueado(`O produto não está mais na lista de compra da quinzena ${label}.`);
    if (!codigo || catalogItemId === null) return bloqueado(MOTIVO_SEM_VINCULO);

    const decisaoSalva = decisoes.data?.find((d) => d.productId === productId);
    const quantidade = quantidadeParaCotacao(decisaoSalva?.quantidadeKg, linha.quantidadeFinal);
    if (!quantidade.ok) return bloqueado(quantidade.motivo);

    if (catalogo.isPending) return { estado: CARREGANDO, prefill: null };
    if (catalogo.data === undefined && catalogo.isError && naoEncontrado(catalogo.error)) {
      return bloqueado(AVISO_CATALOGO_NAO_ENCONTRADO);
    }
    // Falha de leitura que nao seja 404: segue com os nomes do cadastro do Forecast (o backend ainda recusa inativo no 2o POST).
    const nomes = catalogo.data ?? codigo.catalogItem;
    if (catalogo.data && !catalogo.data.isActive) {
      return bloqueado(`O item do catálogo ${catalogo.data.commercialName} está inativo: reative-o em Itens antes de cotar.`);
    }

    const avisos: string[] = [];
    if (decisoes.data === undefined && decisoes.isError) avisos.push(AVISO_DECISOES_INDISPONIVEIS);
    if (embalagens.data === undefined && embalagens.isError) {
      avisos.push(`Não foi possível conferir a embalagem principal; foi usado o 1º código vinculado (${codigo.code}).`);
    }
    const kg = quantidade.quantidade.toLocaleString('pt-BR');
    return {
      estado: {
        status: 'aplicado',
        banner: `Pré-preenchida pelo Forecast (quinzena ${label}): ${linha.item}, ${kg} kg (${ORIGEM_ROTULO[quantidade.origem]}). Revise e escolha os Incoterms.`,
        aviso: avisos.length > 0 ? avisos.join(' ') : null,
      },
      prefill: {
        item: {
          catalogItemId,
          commercialName: nomes?.commercialName ?? `Item #${catalogItemId}`,
          marketName: nomes?.marketName ?? '',
          quantity: quantidade.quantidade,
          unit: 'KG',
          notes: '',
        },
        description: descricaoDoForecast(label),
      },
    };
  }

  let resolucao: Resolucao = { estado: INERTE, prefill: null };
  if (param === 'invalido') resolucao = bloqueado(AVISO_LINK_INVALIDO, 'invalido');
  else if (conflito) resolucao = bloqueado(AVISO_CONFLITO, 'conflito');
  else if (ativo) resolucao = resolver();

  // Aplica UMA vez (refetch/re-render nao reaplica: o ref e a unica trava) e congela o estado aplicado.
  const onPrefillRef = useRef(onPrefill);
  onPrefillRef.current = onPrefill;
  const aplicadoRef = useRef(false);
  const [aplicado, setAplicado] = useState<EstadoPrefillForecast | null>(null);
  useEffect(() => {
    if (resolucao.estado.status !== 'aplicado' || resolucao.prefill === null || aplicadoRef.current) return;
    aplicadoRef.current = true;
    setAplicado((atual) => atual ?? resolucao.estado);
    onPrefillRef.current(resolucao.prefill);
  });

  return aplicado ?? resolucao.estado;
}

export function AvisosDoForecast({ estado }: { estado: EstadoPrefillForecast }) {
  if (estado.status === 'inerte') return null;
  return (
    <>
      {estado.status === 'carregando' && (
        <p className="banner fgc-aviso" role="status">
          Buscando os dados do Forecast…
        </p>
      )}
      {estado.banner && (
        <p className="banner banner--ok fgc-aviso" role="status">
          {estado.banner}
        </p>
      )}
      {estado.aviso && (
        <p className="banner banner--warning fgc-aviso" role="alert">
          {estado.aviso}
        </p>
      )}
    </>
  );
}
