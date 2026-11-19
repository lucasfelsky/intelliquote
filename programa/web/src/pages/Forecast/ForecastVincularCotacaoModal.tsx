import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { forecastDecisoesKeys, type ForecastCotacaoVinculada } from '@/services/forecastDecisoes';
import {
  deleteVinculoCotacao,
  forecastVincularCotacaoKeys,
  forecastVinculoErrorMessage,
  getCotacoesAbertasParaVinculo,
  putVinculoCotacao,
  type CotacaoAbertaParaVinculo,
} from '@/services/forecastVincularCotacao';
import { kgBr } from './forecastPainel';

// "Vincular cotacao" do Relatorio de compras (PR2): liga uma cotacao ABERTA que ja existe (e contem o produto, em qualquer
// embalagem) ao item da quinzena, sem criar outra. Com cotacao aberta ja ligada, o mesmo modal TROCA (a antiga deixa de estar
// ligada) ou DESVINCULA. So itens em KG entram no Forecast: a cotacao com item em outra unidade aparece desabilitada com o
// motivo. O estado nasce a cada abertura; este modal so e montado aberto (a lista usa react-query aqui dentro).

interface Props {
  snapshotId: number;
  productId: number;
  nomeItem: string;
  /** Cotacao aberta hoje ligada ao item (habilita Trocar/Desvincular); nula = ainda nao ha vinculo aberto. */
  cotacaoAtual: ForecastCotacaoVinculada | null;
  onFechar: () => void;
}

type Pedido = { tipo: 'vincular' | 'trocar'; quoteRequestId: number } | { tipo: 'desvincular' };

const ROTULO_STATUS: Record<CotacaoAbertaParaVinculo['statusCotacao'], string> = { criada: 'Criada', enviada: 'Enviada' };

function dataDaLista(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

export default function ForecastVincularCotacaoModal({ snapshotId, productId, nomeItem, cotacaoAtual, onFechar }: Props) {
  const qc = useQueryClient();
  const idBase = useId();
  const atualAberta =
    cotacaoAtual && (cotacaoAtual.statusCotacao === 'criada' || cotacaoAtual.statusCotacao === 'enviada') ? cotacaoAtual : null;
  const [escolhida, setEscolhida] = useState<number | null>(null);
  const [confirmandoDesvinculo, setConfirmandoDesvinculo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: forecastVincularCotacaoKeys.abertas(snapshotId, productId),
    queryFn: () => getCotacoesAbertasParaVinculo(snapshotId, productId),
  });

  const gravar = useMutation({
    mutationFn: async (pedido: Pedido) => {
      if (pedido.tipo === 'desvincular') return deleteVinculoCotacao(snapshotId, productId);
      return putVinculoCotacao(snapshotId, productId, {
        quoteRequestId: pedido.quoteRequestId,
        ...(pedido.tipo === 'trocar' ? { substituir: true } : {}),
      });
    },
    onSuccess: (_resultado, pedido) => {
      void qc.invalidateQueries({ queryKey: forecastDecisoesKeys.lista(snapshotId) });
      void qc.invalidateQueries({ queryKey: ['forecast', 'candidatos', snapshotId] });
      void qc.invalidateQueries({ queryKey: forecastVincularCotacaoKeys.abertas(snapshotId, productId) });
      void qc.invalidateQueries({ queryKey: ['quote-requests'] });
      // A cotacao nova e a antiga mudam de vinculo: o detalhe de cada uma precisa recarregar.
      const afetadas = [pedido.tipo === 'desvincular' ? null : pedido.quoteRequestId, atualAberta?.id ?? null];
      for (const id of new Set(afetadas)) {
        if (id !== null) void qc.invalidateQueries({ queryKey: ['quote-request', id] });
      }
      onFechar();
    },
    onError: (err) => setErro(forecastVinculoErrorMessage(err)),
  });

  const cotacoes = lista.data?.cotacoes ?? [];
  const escolhidaData = cotacoes.find((c) => c.id === escolhida) ?? null;
  const trocando = atualAberta !== null;
  const ocupado = gravar.isPending;

  const executar = (pedido: Pedido) => {
    setErro(null);
    gravar.mutate(pedido);
  };

  return (
    <Modal isOpen restoreFocus size="wide" title="Vincular cotação" subtitle={nomeItem} onClose={ocupado ? () => undefined : onFechar}>
      <div className="fcl-popup">
        {atualAberta && (
          <p className="fcl-dica">
            Este item está na cotação aberta <span className="fcl-mono">{atualAberta.requestCode}</span>. Escolha outra para trocar
            ou desvincule.
          </p>
        )}

        {lista.isLoading ? (
          <div className="fcl-espera" role="status">
            <Spinner />
            <span>Carregando as cotações abertas…</span>
          </div>
        ) : lista.isError ? (
          <p role="alert" className="alert alert--error">
            {forecastVinculoErrorMessage(lista.error)}
          </p>
        ) : cotacoes.length === 0 ? (
          <p className="fcl-dica">Nenhuma cotação aberta contém este produto.</p>
        ) : (
          <div role="radiogroup" aria-label="Cotações abertas deste produto" className="fcl-resultados">
            {cotacoes.map((c) => {
              const inputId = `${idBase}-q${c.id}`;
              const motivoId = `${inputId}-motivo`;
              const jaVinculada = c.vinculadaAEsteItem;
              const desabilitada = !c.podeVincular;
              const itens = c.itens.map((i) => `${kgBr(i.quantity)} ${i.unit}`).join(' + ');
              return (
                <div key={c.id} className="fcl-resultado">
                  <input
                    id={inputId}
                    type="radio"
                    name={`${idBase}-cotacao`}
                    value={c.id}
                    checked={escolhida === c.id}
                    disabled={desabilitada || ocupado}
                    aria-describedby={c.motivo ? motivoId : undefined}
                    onChange={() => {
                      setEscolhida(c.id);
                      setErro(null);
                    }}
                  />
                  <div className="fcl-convite__nome">
                    <label htmlFor={inputId}>
                      <span className="fcl-mono">{c.requestCode}</span>
                    </label>
                    <p className="fcl-dica">
                      <span className="fcl-rotulo">Fornecedores</span>{' '}
                      {c.fornecedores.length > 0 ? c.fornecedores.join(', ') : 'Sem fornecedor ainda'}
                      {' · '}
                      {dataDaLista(c.listedAt)}
                      {' · '}
                      {itens}
                    </p>
                    {c.motivo && (
                      <p id={motivoId} className="fcl-dica">
                        {c.motivo}
                      </p>
                    )}
                  </div>
                  <div className="fcl-convite__tags">
                    <span className="badge badge--muted">{ROTULO_STATUS[c.statusCotacao]}</span>
                    {jaVinculada && <span className="badge badge--muted">Vinculada a este item</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {trocando && escolhidaData && (
          <p className="fcl-dica" role="status">
            A cotação <span className="fcl-mono">{atualAberta.requestCode}</span> deixa de estar ligada a este item.
          </p>
        )}

        {confirmandoDesvinculo && atualAberta && (
          <p className="fcl-dica" role="status">
            O status volta a Cotação não enviada e a Qtd. final é apagada se veio de{' '}
            <span className="fcl-mono">{atualAberta.requestCode}</span>.
          </p>
        )}

        {erro && (
          <p role="alert" className="alert alert--error">
            {erro}
          </p>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="ghost-button" disabled={ocupado} onClick={onFechar}>
          Cancelar
        </button>
        {atualAberta &&
          (confirmandoDesvinculo ? (
            <>
              <button type="button" className="ghost-button" disabled={ocupado} onClick={() => setConfirmandoDesvinculo(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={ocupado}
                aria-busy={ocupado}
                onClick={() => executar({ tipo: 'desvincular' })}
              >
                {ocupado ? 'Desvinculando…' : 'Confirmar desvinculação'}
              </button>
            </>
          ) : (
            <button type="button" className="ghost-button" disabled={ocupado} onClick={() => setConfirmandoDesvinculo(true)}>
              Desvincular
            </button>
          ))}
        {!confirmandoDesvinculo && (
          <button
            type="button"
            className="primary-button"
            disabled={escolhida === null || ocupado}
            aria-busy={ocupado}
            onClick={() => escolhida !== null && executar({ tipo: trocando ? 'trocar' : 'vincular', quoteRequestId: escolhida })}
          >
            {ocupado ? (trocando ? 'Trocando…' : 'Vinculando…') : trocando ? 'Trocar' : 'Vincular'}
          </button>
        )}
      </div>
    </Modal>
  );
}
