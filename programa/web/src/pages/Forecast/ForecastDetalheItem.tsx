import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

// Ultimo preco negociado: carregado SO apos o clique (nenhum request a cada item aberto na grade).
function UltimoPreco({ productId }: { productId: number }) {
  const [pedido, setPedido] = useState(false);
  const consulta = useQuery({
    queryKey: forecastUltimoPrecoKeys.produto(productId),
    queryFn: () => getForecastUltimoPreco(productId),
    enabled: pedido,
  });
  const carregando = pedido && !consulta.isError && consulta.data === undefined;
  return (
    <>
      <button
        type="button"
        className="ghost-button fcu-botao"
        aria-disabled={pedido}
        aria-busy={carregando}
        onClick={() => {
          if (!pedido) setPedido(true);
        }}
      >
        Ver último preço negociado
      </button>
      {pedido && (
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
      )}
    </>
  );
}

// Detalhe do item na memoria de calculo (PR4): preco fechado (selo), amostra (AY/AZ) e ultimo preco negociado.
// Montar com `key` do produto: trocar de item zera o pedido do ultimo preco.
export default function ForecastDetalheItem({ linha }: Props) {
  const idTitulo = useId();
  return (
    <section className="fcu-detalhe" aria-labelledby={idTitulo}>
      <h3 id={idTitulo}>Detalhe do item</h3>
      <dl className="fcu-lista">
        <div>
          <dt>Preço fechado</dt>
          <dd>{textoPrecoFechado(linha.precoFixo)}</dd>
        </div>
        <div>
          <dt>Amostra por pacote (AY)</dt>
          <dd>{linha.qtdAmostra || '—'}</dd>
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
              <UltimoPreco productId={linha.productId} />
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
