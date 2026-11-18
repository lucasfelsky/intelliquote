import { useId } from 'react';
import { InfoPopover } from '@/components/InfoPopover';
import { Icon } from '@/components/icons';
import type { ForecastItemRelatorio } from '@/services/forecast';
import { useCriarCotacao } from './ForecastCriarCotacao';
import { useDecisoesDaQuinzena } from './ForecastDecisaoCompra';
import { LinksDaCotacao } from './ForecastTrackingLinha';
import { MOTIVO_FORA_CADASTRO } from './forecastGerarCotacaoRegras';

// Acao da linha do relatorio de compras (E2, refeita na E6, tracking na E7): "Cotar" abre o pop-up "Criar cotacao" com este item
// ja escolhido; "Continuar" aparece quando o item esta no rascunho da pessoa; com cotacao vinculada a linha mostra "Ver cotacao"
// (e "Ver pedido" com a PO enviada), links que qualquer perfil de leitura ve. Quem so le nunca ve "Cotar"/"Continuar".
// Item de PRECO FECHADO (selo congelado na quinzena) ganha tambem "Enviar PO": a PO vai ao fornecedor da fonte sem cotacao (modal
// proprio, ver ForecastPoDiretaModal). Fica disponivel mesmo com PO ja enviada: a segunda PO soma na Qtd. final.

interface Props {
  item: ForecastItemRelatorio;
  /** Fonte do grupo em que o item aparece (o item do relatorio nao carrega a fonte). */
  fonte: string;
}

export default function ForecastCotar({ item, fonte }: Props) {
  const ctx = useCriarCotacao();
  const decisoes = useDecisoesDaQuinzena();
  const idMotivo = useId();
  const productId = item.productId ?? null;
  const cotacao = productId !== null ? (decisoes?.mapa.get(productId)?.cotacao ?? null) : null;
  const links = cotacao ? <LinksDaCotacao cotacao={cotacao} nome={item.item} /> : null;
  if (!ctx) return links;
  if (productId === null) {
    // Itens sem produto no cadastro nao entram na cotacao: o motivo fica visivel (balao) e para o leitor de tela.
    return (
      <span className="fcq-acao">
        <button
          type="button"
          className="ghost-button ghost-button--sm fcq-botao"
          aria-label={`Cotar ${item.item}`}
          aria-disabled="true"
          aria-describedby={idMotivo}
          title={MOTIVO_FORA_CADASTRO}
        >
          Cotar
        </button>
        <span id={idMotivo} className="fcr-so-leitor">
          {MOTIVO_FORA_CADASTRO}
        </span>
        <InfoPopover label="Por que não dá para cotar" tone="warning" className="fgc-motivo-chip" trigger={<Icon name="info" size={14} />}>
          {MOTIVO_FORA_CADASTRO}
        </InfoPopover>
      </span>
    );
  }
  const rascunho = ctx.noRascunho(productId) !== undefined;
  // Cotacao vinculada (aberta ou fechada) sem rascunho novo: so o tracking (decisao do E7: o backend recusa cotar de novo enquanto ela
  // esta aberta; depois de fechada, recotar o item e pela selecao + barra).
  // Item de preco fechado: a acao segue o estado do preco no cadastro (so quem edita consulta). Sem a lista de precos (carregando ou
  // falhou) mantem "Enviar PO": o backend valida de novo e o modal mostra o motivo.
  const estadoDoPreco = item.precoFixo === true ? ctx.precoFechado(productId)?.estado : undefined;
  const botaoPo =
    item.precoFixo === true ? (
      estadoDoPreco === 'sem_valor' || estadoDoPreco === 'vencido' ? (
        <button
          type="button"
          className="ghost-button ghost-button--sm fcq-botao"
          aria-label={`${estadoDoPreco === 'vencido' ? 'Atualizar preço' : 'Definir preço'} de ${item.item}`}
          aria-haspopup="dialog"
          title={estadoDoPreco === 'vencido' ? 'O preço fechado venceu: atualize para enviar a PO' : 'Cadastre o preço fechado para enviar a PO'}
          onClick={(e) => ctx.abrirPreco(item, e.currentTarget)}
        >
          {estadoDoPreco === 'vencido' ? 'Atualizar preço' : 'Definir preço'}
        </button>
      ) : (
        <button
          type="button"
          className="ghost-button ghost-button--sm fcq-botao"
          aria-label={`Enviar PO de ${item.item}`}
          aria-haspopup="dialog"
          title="Item de preço fechado: envia a Ordem de Compra ao fornecedor da fonte, sem cotação"
          onClick={(e) => ctx.abrirPoDireta([item], e.currentTarget)}
        >
          Enviar PO
        </button>
      )
    ) : null;
  if (cotacao && !rascunho) {
    return botaoPo ? (
      <span className="fcq-acao fcq-acao--pilha">
        {botaoPo}
        {links}
      </span>
    ) : (
      links
    );
  }
  return (
    <span className="fcq-acao fcq-acao--pilha">
      {botaoPo}
      <button
        type="button"
        className="ghost-button ghost-button--sm fcq-botao"
        aria-label={rascunho ? `Continuar cotação de ${item.item}` : `Cotar ${item.item}`}
        aria-haspopup="dialog"
        onClick={(e) => ctx.abrir([{ item, fonte }], e.currentTarget)}
      >
        {rascunho ? 'Continuar' : 'Cotar'}
      </button>
      {links}
    </span>
  );
}
