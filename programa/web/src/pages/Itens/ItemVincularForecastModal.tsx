import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Modal } from '@/components/Modal';
import {
  TEXTO_ENTRA_NO_CALCULO,
  vincularItemAoForecast,
  type CatalogForecastLink,
  type CatalogForecastVinculo,
} from '@/services/catalogForecast';
import { forecastFontesKeys, patchForecastSourceLeadTime } from '@/services/forecastFontes';
import { forecastPendentesErrorMessage } from '@/services/forecastPendentes';
import ItemForecastVinculo, { useDadosDoVinculo } from './ItemForecastVinculo';
import { VINCULO_VAZIO, validarVinculo, type FormVinculo } from './itemForecastVinculoForm';

export interface ItemParaVincular {
  id: number;
  commercialName: string;
  dbcorpCode: string | null;
  familyId: number | null;
}

interface Props {
  item: ItemParaVincular;
  /** `vincular` = item ativo ja existente; `reativar` = reativa o item JUNTO com o vinculo (PUT isActive: true). */
  modo: 'vincular' | 'reativar';
  onFechar: () => void;
  onConcluido: (mensagem: string) => void;
}

/** Texto de sucesso quando o codigo foi ligado ao Forecast. */
export function mensagemVinculado(vinculo: Pick<CatalogForecastVinculo, 'situacao' | 'produto'> | undefined | null): string {
  if (!vinculo || (vinculo.situacao !== 'adicionado' && vinculo.situacao !== 'produto_novo')) return '';
  return `Vinculado ao produto ${vinculo.produto.nome}. ${TEXTO_ENTRA_NO_CALCULO}`;
}

/** Dialogo "Vincular ao Forecast" (painel "Catalogo sem Forecast" e reativacao de item). Admin e comprador. */
export default function ItemVincularForecastModal({ item, modo, onFechar, onConcluido }: Props) {
  const queryClient = useQueryClient();
  const [vinculo, setVinculo] = useState<FormVinculo>(VINCULO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const leadTimeGravado = useRef(false);
  const codigo = item.dbcorpCode ?? '';
  const { situacao, produto, fonte } = useDadosDoVinculo(codigo, vinculo);

  const gravar = useMutation({
    gcTime: 0,
    mutationFn: async (entrada: { forecast: CatalogForecastLink | null; leadTimeDias: number | null }) => {
      leadTimeGravado.current = false;
      // O lead time pertence a FONTE: grava antes (o backend recusa fonte sem lead time).
      if (entrada.forecast?.modo === 'novo' && entrada.leadTimeDias !== null) {
        await patchForecastSourceLeadTime(entrada.forecast.sourceId, entrada.leadTimeDias);
        leadTimeGravado.current = true;
        await queryClient.invalidateQueries({ queryKey: forecastFontesKeys.todas });
      }
      if (modo === 'vincular') {
        if (!entrada.forecast) throw new Error('Escolha o produto do Forecast ou crie um produto novo.');
        return { forecastVinculo: await vincularItemAoForecast(item.id, entrada.forecast) };
      }
      return api.put<{ forecastVinculo?: CatalogForecastVinculo | null }>(`/v1/catalog-items/${item.id}`, {
        isActive: true,
        ...(entrada.forecast ? { forecast: entrada.forecast } : {}),
      });
    },
    onSuccess: (resposta) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog-items'] });
      void queryClient.invalidateQueries({ queryKey: ['forecast'] });
      const base = modo === 'reativar' ? 'Item reativado.' : 'Item vinculado ao Forecast.';
      const vinculado = mensagemVinculado(resposta?.forecastVinculo);
      onConcluido(vinculado ? `${modo === 'reativar' ? 'Item reativado. ' : ''}${vinculado}` : base);
    },
    onError: (err) => {
      const mensagem = forecastPendentesErrorMessage(err);
      setErro(
        leadTimeGravado.current
          ? `O lead time da fonte foi gravado, mas o item não foi atualizado. ${mensagem}`
          : mensagem,
      );
    },
  });

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (gravar.isPending) return;
    setErro(null);
    const validacao = validarVinculo(vinculo, { codigo, exigido: true, situacao, fonte, produto });
    if (!validacao.ok) {
      setErro(validacao.erro);
      return;
    }
    gravar.mutate({ forecast: validacao.forecast, leadTimeDias: validacao.leadTimeDias });
  }

  // Esc, fundo e X ficam ignorados durante a gravacao: a mensagem de falha parcial precisa de um dialogo montado.
  const fechar = () => {
    if (!gravar.isPending) onFechar();
  };

  return (
    <Modal isOpen onClose={fechar} title={modo === 'reativar' ? 'Reativar item e vincular ao Forecast' : 'Vincular ao Forecast'} size="wide">
      <form className="fcc-modal" onSubmit={aoEnviar} noValidate>
        <p className="fcc-codigo-pendente">
          Item: <strong>{item.commercialName}</strong> · código DBCorp <strong>{codigo}</strong>
        </p>
        <ItemForecastVinculo
          codigo={codigo}
          exigido
          familiaDoItem={item.familyId}
          nomeSugerido={item.commercialName}
          valor={vinculo}
          onChange={setVinculo}
          erro={erro}
          desabilitado={gravar.isPending}
        />
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={fechar} disabled={gravar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={gravar.isPending} aria-busy={gravar.isPending}>
            {gravar.isPending ? 'Gravando…' : modo === 'reativar' ? 'Reativar e vincular' : 'Vincular ao Forecast'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
