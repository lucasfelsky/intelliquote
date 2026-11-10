import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Icon } from '@/components/icons';
import { InfoPopover } from '@/components/InfoPopover';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { ForecastCotacaoVinculada, ForecastDecisao } from '@/services/forecastDecisoes';
import { useDecisoesDaQuinzena } from './ForecastDecisaoCompra';
import { textoRascunhoDaLinha, useCriarCotacao } from './ForecastCriarCotacao';
import {
  LEGENDA_QTD_FINAL,
  qtdFinalDaLinha,
  rotaDaCotacao,
  rotaDoPedido,
  statusDaLinha,
  temPedido,
  TITULO_COLUNA_QTD_FINAL,
} from './forecastTrackingRegras';

// Qtd. final fixa, status automatico e tracking (cotacao/PO) por linha do relatorio de compras (E7 do relatorio enxuto).
// Tudo e leitura: vale para qualquer perfil que leia o relatorio; so "Cotar"/"Continuar" (ForecastCotar) exigem permissao.

/** Decisao do item na quinzena (`undefined` fora do provedor, enquanto carrega ou sem decisao/vinculo). */
export function useDecisaoDaLinha(item: ForecastItemRelatorio): ForecastDecisao | undefined {
  const decisoes = useDecisoesDaQuinzena();
  const productId = item.productId ?? null;
  return productId !== null ? decisoes?.mapa.get(productId) : undefined;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; children: ReactNode };

/** Link do app; fora de um Router (testes isolados da tabela) vira ancora simples. */
export function LinkInterno({ to, children, ...rest }: LinkProps) {
  const dentroDoRouter = useInRouterContext();
  return dentroDoRouter ? (
    <Link to={to} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

/** "Ver cotação" (sempre que ha cotacao vinculada) e "Ver pedido" (so com a PO enviada). */
export function LinksDaCotacao({ cotacao, nome }: { cotacao: ForecastCotacaoVinculada; nome: string }) {
  return (
    <span className="fcq-links">
      <LinkInterno
        to={rotaDaCotacao(cotacao.id)}
        className="ghost-button ghost-button--sm fcq-botao fcq-link"
        aria-label={`Ver cotação ${cotacao.requestCode} de ${nome}`}
      >
        Ver cotação
      </LinkInterno>
      {temPedido(cotacao) && (
        <LinkInterno
          to={rotaDoPedido(cotacao.id)}
          className="ghost-button ghost-button--sm fcq-botao fcq-link"
          aria-label={`Ver pedido da cotação ${cotacao.requestCode} de ${nome}`}
        >
          Ver pedido
        </LinkInterno>
      )}
    </span>
  );
}

/** Cabecalho da coluna fixa: o nome diferencia da "Qtd. final" calculada (expansor Detalhes e XLSX). */
export function CabecalhoQtdFinal() {
  return (
    <th scope="col" className="fcr-num fcr-final-cab">
      <span className="fcr-final-cab__corpo">
        Qtd. final <span className="fcr-final-cab__sufixo">(sistema)</span>
        <InfoPopover
          label={`${TITULO_COLUNA_QTD_FINAL}: quando é preenchida`}
          tone="info"
          className="fcr-final-cab__info"
          trigger={<Icon name="info" size={14} />}
        >
          <p>
            Campo fixo, só leitura: o IntelliQuote preenche e atualiza. {LEGENDA_QTD_FINAL} O histórico fica salvo.
          </p>
        </InfoPopover>
      </span>
    </th>
  );
}

export function CelulaQtdFinal({ item }: { item: ForecastItemRelatorio }) {
  const final = qtdFinalDaLinha(useDecisaoDaLinha(item));
  // Celula vazia: so o "—"; a explicacao abre num pop-up ao passar o mouse/focar (menos texto comprimido na linha).
  if (!final.preenchida) {
    return (
      <td className="fcr-num fcr-final">
        <InfoPopover
          label={`${TITULO_COLUNA_QTD_FINAL} de ${item.item}: ainda não preenchida`}
          tone="info"
          className="fcr-final__vazio"
          trigger={
            <>
              <Icon name="lock" size={11} />
              {final.texto}
            </>
          }
        >
          <p>{final.dica}</p>
        </InfoPopover>
      </td>
    );
  }
  return (
    <td className="fcr-num fcr-final" title={final.dica}>
      <span className="fcr-final__valor">
        <Icon name="lock" size={11} className="fcr-final__cadeado" />
        {final.texto}
      </span>
      {final.apoio && <span className="fcr-final__apoio">{final.apoio}</span>}
    </td>
  );
}

/** Conteudo da celula Status: rascunho local > status derivado da cotacao > status congelado (texto simples, como antes). */
export function StatusDaLinha({ item }: { item: ForecastItemRelatorio }) {
  const decisao = useDecisaoDaLinha(item);
  const ctx = useCriarCotacao();
  const productId = item.productId ?? null;
  const noRascunho = ctx && productId !== null ? ctx.noRascunho(productId) : undefined;
  const exibido = statusDaLinha(item.status, decisao, noRascunho !== undefined);
  if (exibido.tom === null) return <>{exibido.rotulo}</>;
  return (
    <span className="fcr-status__bloco">
      <span className={`badge badge--${exibido.tom}`}>{exibido.rotulo}</span>
      {exibido.origem === 'rascunho' && ctx && noRascunho && (
        <span className="fcr-fraco fcr-status__apoio">{textoRascunhoDaLinha(ctx.rascunho, noRascunho)}</span>
      )}
      {exibido.origem === 'cotacao' && decisao?.cotacao && (
        <span className="fcr-fraco fcr-status__apoio">{decisao.cotacao.requestCode}</span>
      )}
    </span>
  );
}
