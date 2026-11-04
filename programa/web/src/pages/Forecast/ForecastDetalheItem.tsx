import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ForecastLinha } from '@/services/forecast';
import {
  forecastUltimoPrecoErrorMessage,
  forecastUltimoPrecoKeys,
  getForecastUltimoPreco,
  type ForecastUltimoPreco,
  type ForecastUltimoPrecoData,
} from '@/services/forecastUltimoPreco';
import { dataBr } from './forecastPainel';

interface Props {
  linha: ForecastLinha;
  /**
   * Controle do ultimo preco vindo de fora (a pagina do item mostra o resultado num cartao proprio, abaixo da memoria).
   * Ausente = o proprio componente pede e mostra o resultado logo abaixo do botao.
   */
  ultimoPreco?: ControleUltimoPreco;
}

const NUMERO = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// So o selo: o valor do preco fechado nunca sai da API. Backend antigo (sem o campo) = traco.
function textoPrecoFechado(precoFixo: boolean | undefined): string {
  if (precoFixo === undefined) return '—';
  return precoFixo ? 'Sim (o valor não é exibido)' : 'Não';
}

const MOTIVO_VAZIO: Record<string, string> = {
  sem_cotacao_vencedora: 'Nenhuma proposta vencedora em cotação fechada ou com PO enviada para este item.',
  sem_vinculo_catalogo: 'Nenhum código deste produto está vinculado a um item do catálogo.',
};

export interface ControleUltimoPreco {
  /** O usuario ja clicou em "Ver ultimo preco negociado" para ESTE produto. */
  pedido: boolean;
  carregando: boolean;
  consulta: UseQueryResult<ForecastUltimoPrecoData>;
  pedir: () => void;
}

// Ultimo preco negociado: carregado SO apos o clique (nenhum request a cada item aberto na grade). O pedido e do produto:
// trocar de produto volta ao botao, sem repetir o request.
export function useUltimoPreco(productId: number | null): ControleUltimoPreco {
  const [pedidoDe, setPedidoDe] = useState<number | null>(null);
  const pedido = productId !== null && pedidoDe === productId;
  const consulta = useQuery({
    queryKey: forecastUltimoPrecoKeys.produto(productId ?? 0),
    queryFn: () => getForecastUltimoPreco(productId ?? 0),
    enabled: pedido,
  });
  const carregando = pedido && !consulta.isError && consulta.data === undefined;
  return {
    pedido,
    carregando,
    consulta,
    pedir: () => {
      if (productId !== null && !pedido) setPedidoDe(productId);
    },
  };
}

function UltimoPrecoResultado({ preco }: { preco: ForecastUltimoPreco }) {
  const valor = Number(preco.valorUnitario);
  const valorTexto = Number.isFinite(valor) ? NUMERO.format(valor) : preco.valorUnitario;
  return (
    <div className="fcu-preco">
      <p className="fcu-preco__valor">{`${preco.moeda} ${valorTexto} / ${preco.unidade} · ${preco.incoterm}`}</p>
      <p>{`Fornecedor: ${preco.fornecedor}`}</p>
      <p>
        <Link to={`/cotacoes/${preco.cotacao.id}`}>{`Cotação ${preco.cotacao.codigo}`}</Link>
        {preco.fechadaEm && <span className="fcu-preco__data">{` · Fechada em ${dataBr(preco.fechadaEm)}`}</span>}
        {preco.poEnviadaEm && (
          <span className="fcu-preco__data">{` · PO enviada em ${dataBr(preco.poEnviadaEm)}`}</span>
        )}
      </p>
      <p className="fcu-nota">Só propostas diretas de fornecedor (Credit Support não entra).</p>
    </div>
  );
}

function UltimoPrecoVazio({ data }: { data: ForecastUltimoPrecoData }) {
  return <p>{MOTIVO_VAZIO[data.motivo ?? 'sem_cotacao_vencedora'] ?? MOTIVO_VAZIO.sem_cotacao_vencedora}</p>;
}

function UltimoPrecoBotao({ controle }: { controle: ControleUltimoPreco }) {
  return (
    <button
      type="button"
      className="ghost-button fcu-botao"
      aria-disabled={controle.pedido}
      aria-busy={controle.carregando}
      onClick={controle.pedir}
    >
      Ver último preço negociado
    </button>
  );
}

// Estado ATUAL do pedido (carregando, erro com "Tentar de novo", vazio ou o preco). So existe depois do clique.
function UltimoPrecoEstado({ controle }: { controle: ControleUltimoPreco }) {
  const { consulta, carregando } = controle;
  return (
    <div className="fcu-resultado" aria-live="polite">
      {carregando && <p role="status">Buscando o último preço…</p>}
      {consulta.isError && (
        <>
          <div className="alert alert--error" role="alert">
            {forecastUltimoPrecoErrorMessage(consulta.error)}
          </div>
          <button
            type="button"
            className="ghost-button fcu-botao"
            aria-busy={consulta.isFetching}
            onClick={() => void consulta.refetch()}
          >
            Tentar de novo
          </button>
        </>
      )}
      {consulta.data &&
        (consulta.data.ultimoPreco ? (
          <UltimoPrecoResultado preco={consulta.data.ultimoPreco} />
        ) : (
          <UltimoPrecoVazio data={consulta.data} />
        ))}
    </div>
  );
}

/**
 * Cartao inteiro "Detalhe do item · ultimo preco negociado (sob demanda)" (board F2): abaixo da memoria e do cartao lateral,
 * com SO o estado atual. Antes do clique nao existe. Ao surgir, o cartao entra na tela (o botao fica no cartao lateral, acima).
 */
export function ForecastUltimoPrecoCartao({ controle }: { controle: ControleUltimoPreco }) {
  const idTitulo = useId();
  const cartao = useRef<HTMLElement>(null);
  const aberto = controle.pedido;
  useEffect(() => {
    if (aberto) cartao.current?.scrollIntoView?.({ block: 'nearest' });
  }, [aberto]);
  if (!aberto) return null;
  return (
    <section ref={cartao} className="card fcu-cartao" aria-labelledby={idTitulo}>
      <h2 id={idTitulo}>Detalhe do item · último preço negociado (sob demanda)</h2>
      <UltimoPrecoEstado controle={controle} />
    </section>
  );
}

// Detalhe do item na memoria de calculo (PR4): preco fechado (selo), amostra (AY/AZ) e ultimo preco negociado.
// Montar com `key` do produto: trocar de item zera o pedido do ultimo preco.
export default function ForecastDetalheItem({ linha, ultimoPreco }: Props) {
  const idTitulo = useId();
  const proprio = useUltimoPreco(linha.productId);
  const controle = ultimoPreco ?? proprio;
  const precoFechado = textoPrecoFechado(linha.precoFixo);
  return (
    <section className="fcu-detalhe" aria-labelledby={idTitulo}>
      <h3 id={idTitulo}>Detalhe do item</h3>
      <dl className="fcu-lista">
        <div>
          <dt>Preço fechado</dt>
          <dd>{linha.precoFixo === true ? <span className="fcu-selo">{precoFechado}</span> : precoFechado}</dd>
        </div>
        <div>
          <dt>Amostra por pacote (AY)</dt>
          <dd>{linha.qtdAmostra ? <span className="fcu-mono">{linha.qtdAmostra}</span> : '—'}</dd>
        </div>
        <div>
          <dt>Pedir amostra na próxima compra (AZ)</dt>
          <dd>{linha.solicitarAmostra || '—'}</dd>
        </div>
        <div>
          <dt>Último preço negociado</dt>
          <dd>
            {linha.productId == null ? (
              'Sem produto no cadastro: não há cotação para buscar.'
            ) : (
              <>
                <UltimoPrecoBotao controle={controle} />
                {ultimoPreco === undefined && controle.pedido && <UltimoPrecoEstado controle={controle} />}
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
