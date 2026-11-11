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
  if (cotacao && !rascunho) return links;
  return (
    <span className="fcq-acao fcq-acao--pilha">
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
