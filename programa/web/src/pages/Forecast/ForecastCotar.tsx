import { useId } from 'react';
import { InfoPopover } from '@/components/InfoPopover';
import { Icon } from '@/components/icons';
import type { ForecastItemRelatorio } from '@/services/forecast';
import { useCriarCotacao } from './ForecastCriarCotacao';
import { MOTIVO_FORA_CADASTRO } from './forecastGerarCotacaoRegras';

// Acao da linha do relatorio de compras (E2, refeita na E6): "Cotar" abre o pop-up "Criar cotacao" com este item ja escolhido;
// "Continuar" aparece quando o item esta no rascunho da pessoa. Quem so le (ou fora do provedor) nao ve a acao.

interface Props {
  item: ForecastItemRelatorio;
  /** Fonte do grupo em que o item aparece (o item do relatorio nao carrega a fonte). */
  fonte: string;
}

export default function ForecastCotar({ item, fonte }: Props) {
  const ctx = useCriarCotacao();
  const idMotivo = useId();
  if (!ctx) return null;
  const productId = item.productId ?? null;
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
  return (
    <button
      type="button"
      className="ghost-button ghost-button--sm fcq-botao"
      aria-label={rascunho ? `Continuar cotação de ${item.item}` : `Cotar ${item.item}`}
      aria-haspopup="dialog"
      onClick={(e) => ctx.abrir([{ item, fonte }], e.currentTarget)}
    >
      {rascunho ? 'Continuar' : 'Cotar'}
    </button>
  );
}
