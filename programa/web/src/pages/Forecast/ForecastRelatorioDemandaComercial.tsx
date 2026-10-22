import { useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import type { ForecastDemandaComercialDoRelatorio, ForecastItemDemandaComercial } from '@/services/forecast';
import {
  FORECAST_DEMANDA_NOTA_MAX,
  forecastDemandaComercialErrorMessage,
  patchForecastDemandaComercial,
  validarNotaDeFechamento,
  type ForecastDemandaFechamento,
} from '@/services/forecastDemandaComercial';
import ForecastDemandaComercialModal from './ForecastDemandaComercialModal';
import { dataBr, kgBr } from './forecastPainel';
import {
  APOIO_DEMANDA_COMERCIAL,
  textoAvisoDemanda,
  textoObservacao,
  textoSituacaoDemanda,
  textoSolicitacao,
  tituloDemandaComercial,
} from './forecastRelatorioTextos';

interface Props {
  dados: ForecastDemandaComercialDoRelatorio;
  /** admin/comprador: mostra a coluna de acoes (editar e fechar). */
  podeEditar: boolean;
  /** Data de hoje da quinzena (AAAA-MM-DD). */
  hoje: string;
  /** Aviso de status para a tela (fica fora da secao, que some quando o ultimo pedido fecha). */
  onConcluido: (mensagem: string) => void;
}

const ROTULO_FECHAMENTO: Record<ForecastDemandaFechamento, { botao: string; titulo: string; ok: string; confirmar: string }> = {
  comprada: {
    botao: 'Marcar comprada',
    titulo: 'Marcar como comprada',
    ok: 'Demanda marcada como comprada.',
    confirmar: 'Marcar comprada',
  },
  virou_programacao: {
    botao: 'Virou programação',
    titulo: 'Marcar como "virou programação"',
    ok: 'Demanda marcada como "virou programação".',
    confirmar: 'Virou programação',
  },
  cancelada: {
    botao: 'Cancelar',
    titulo: 'Cancelar demanda',
    ok: 'Demanda cancelada.',
    confirmar: 'Cancelar demanda',
  },
};

const EXPLICACAO: Record<ForecastDemandaFechamento, string> = {
  comprada: 'A compra já foi feita: o pedido sai desta seção e não soma mais ao Forecast.',
  virou_programacao: 'A programação do cliente já entrou nas programações do DBCorp: o pedido sai desta seção para não contar duas vezes.',
  cancelada: 'O pedido não será mais comprado e sai desta seção. Informe o motivo do cancelamento.',
};

interface FecharProps {
  item: ForecastItemDemandaComercial;
  status: ForecastDemandaFechamento;
  onFechar: () => void;
  onFechado: (mensagem: string) => void;
}

function FormularioDeFechamento({ item, status, onFechar, onFechado }: FecharProps) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const rotulos = ROTULO_FECHAMENTO[status];

  const fechar = useMutation({
    mutationFn: (texto: string | null) => patchForecastDemandaComercial(item.id, { status, nota: texto }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'relatorio'] });
      onFechado(rotulos.ok);
      onFechar();
    },
  });

  const aoEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (fechar.isPending) return;
    const validada = validarNotaDeFechamento(status, nota);
    setErro(validada.erro);
    if (validada.erro) return;
    fechar.mutate(validada.nota);
  };

  return (
    <form className="fcd-form" onSubmit={aoEnviar} noValidate>
      <p className="fcd-produto">
        <strong>{item.item}</strong> · {kgBr(item.kg)} kg para {dataBr(item.necessidade)}
      </p>
      <p className="fcd-dica">{EXPLICACAO[status]} Depois de fechado, o pedido não reabre.</p>
      <div className="fcd-campo">
        <label className="field-label" htmlFor={`${baseId}-nota`}>
          {status === 'cancelada' ? 'Motivo do cancelamento' : 'Nota (opcional)'}
        </label>
        <textarea
          id={`${baseId}-nota`}
          className="input fcd-motivo"
          rows={2}
          maxLength={FORECAST_DEMANDA_NOTA_MAX}
          value={nota}
          onChange={(e) => {
            fechar.reset();
            setErro(null);
            setNota(e.target.value);
          }}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${baseId}-nota-erro` : undefined}
          disabled={fechar.isPending}
        />
        {erro && (
          <p className="fcd-erro" id={`${baseId}-nota-erro`}>
            {erro}
          </p>
        )}
      </div>
      {fechar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastDemandaComercialErrorMessage(fechar.error)}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onFechar} disabled={fechar.isPending}>
          Voltar
        </button>
        <button
          type="submit"
          className={status === 'cancelada' ? 'danger-button' : 'primary-button'}
          disabled={fechar.isPending}
          aria-busy={fechar.isPending}
        >
          {fechar.isPending ? 'Salvando…' : rotulos.confirmar}
        </button>
      </div>
    </form>
  );
}

function Situacao({ item }: { item: ForecastItemDemandaComercial }) {
  const aviso = textoAvisoDemanda(item);
  return (
    <div className="fcd-situacao">
      <span className={item.situacao === 'alem-do-horizonte' && item.sugerido > 0 ? 'fcr-forte' : undefined}>
        {textoSituacaoDemanda(item)}
      </span>
      {aviso && <span className="fcd-aviso">{aviso}</span>}
    </div>
  );
}

type Dialogo =
  | { tipo: 'editar'; item: ForecastItemDemandaComercial }
  | { tipo: 'fechar'; item: ForecastItemDemandaComercial; status: ForecastDemandaFechamento };

// Pedidos abertos do comercial (lancados a mao pelo COMEX) para programacoes fora do horizonte do DBCorp. Aparecem aqui
// mesmo quando a analise do Forecast nao aponta falta; o que soma ao Forecast e a coluna Sugerido.
export default function ForecastRelatorioDemandaComercial({ dados, podeEditar, hoje, onConcluido }: Props) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const gatilho = useRef<HTMLElement | null>(null);
  const regiao = useRef<HTMLDivElement>(null);

  const abrir = (evento: { currentTarget: HTMLElement }, novo: Dialogo) => {
    gatilho.current = evento.currentTarget;
    setDialogo(novo);
  };
  // O dialogo e desmontado ao fechar (o foco cairia no BODY): devolve o foco ao botao que o abriu; se o pedido saiu da
  // lista (fechado), o foco vai para a regiao da tabela.
  const fecharDialogo = () => {
    setDialogo(null);
    window.setTimeout(() => {
      const alvo = gatilho.current;
      (alvo && alvo.isConnected ? alvo : regiao.current)?.focus();
    }, 0);
  };

  return (
    <section className="fc-card fcr-grupo fcd-secao" aria-label="Demanda do comercial">
      <div ref={regiao} className="fcr-scroll" role="region" tabIndex={0} aria-label="Pedidos abertos do comercial">
        <table className="fcr-tabela fcr-tabela--compacta fcd-tabela">
          <caption className="fcr-caption">{tituloDemandaComercial(dados.totais.abertas)}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Fonte</th>
              <th scope="col">Necessidade</th>
              <th scope="col" className="fcr-num">
                Pedido (kg)
              </th>
              <th scope="col" className="fcr-num">
                Saldo livre no mês
              </th>
              <th scope="col" className="fcr-num">
                Sugerido
              </th>
              <th scope="col">Motivo</th>
              <th scope="col">Cliente</th>
              <th scope="col">Solicitação</th>
              <th scope="col">Situação</th>
              {podeEditar && (
                <th scope="col" className="fcd-col-acoes">
                  Ações
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((i) => {
              const obs = textoObservacao(i.obs);
              return (
                <tr key={i.id} className="fcr-linha">
                  <th scope="row">
                    <div className="fcr-item">
                      <span className="fcr-item__nome">{i.item}</span>
                      {i.noRelatorio && (
                        <span className="badge badge--info" title="O produto também está na lista de compra desta quinzena.">
                          Também na lista de compra
                        </span>
                      )}
                      {obs && <span className="fcr-item__obs">{obs}</span>}
                    </div>
                  </th>
                  <td className="fcd-fonte" data-rotulo="Fonte">
                    {i.fonte || 'Sem fonte'}
                  </td>
                  <td className="fcd-data" data-rotulo="Necessidade">
                    {dataBr(i.necessidade)}
                  </td>
                  <td className="fcr-num fcd-data" data-rotulo="Pedido (kg)">
                    {kgBr(i.kg)}
                  </td>
                  <td className="fcr-num fcd-data" data-rotulo="Saldo livre no mês">
                    {i.saldoLivre === null ? '—' : kgBr(i.saldoLivre)}
                  </td>
                  <td
                    className={
                      i.situacao === 'alem-do-horizonte' && i.sugerido > 0 ? 'fcr-num fcd-data fcr-forte' : 'fcr-num fcd-data fcr-fraco'
                    }
                    data-rotulo="Sugerido"
                  >
                    {i.situacao === 'alem-do-horizonte' ? kgBr(i.sugerido) : '—'}
                  </td>
                  <td className="fcd-texto" data-rotulo="Motivo">
                    {i.motivo}
                  </td>
                  <td className="fcd-texto fcd-cliente" data-rotulo="Cliente">
                    {i.cliente ?? '—'}
                  </td>
                  <td className="fcd-data" data-rotulo="Solicitação">
                    {textoSolicitacao(i.solicitacaoId)}
                  </td>
                  <td data-rotulo="Situação">
                    <Situacao item={i} />
                  </td>
                  {podeEditar && (
                    <td className="fcd-col-acoes" data-rotulo="Ações">
                      <div className="fcd-acoes" role="group" aria-label={`Ações do pedido de ${i.item}`}>
                        <button
                          type="button"
                          className="ghost-button"
                          aria-haspopup="dialog"
                          aria-label={`Editar o pedido de ${i.item} para ${dataBr(i.necessidade)}`}
                          onClick={(e) => abrir(e, { tipo: 'editar', item: i })}
                        >
                          Editar
                        </button>
                        {(['comprada', 'virou_programacao', 'cancelada'] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="ghost-button"
                            aria-haspopup="dialog"
                            aria-label={`${ROTULO_FECHAMENTO[status].botao}: pedido de ${i.item} para ${dataBr(i.necessidade)}`}
                            onClick={(e) => abrir(e, { tipo: 'fechar', item: i, status })}
                          >
                            {ROTULO_FECHAMENTO[status].botao}
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fcr-sem-consumo__nota">{APOIO_DEMANDA_COMERCIAL}</p>
      {/* Fora da tabela (portal): o CSS .fcr-tabela td/th nao pode vazar para o dialogo. */}
      {dialogo?.tipo === 'editar' &&
        createPortal(
          <ForecastDemandaComercialModal
            hoje={hoje}
            demanda={{
              id: dialogo.item.id,
              productId: dialogo.item.productId,
              item: dialogo.item.item,
              kg: dialogo.item.kg,
              necessidade: dialogo.item.necessidade,
              motivo: dialogo.item.motivo,
              cliente: dialogo.item.cliente,
              solicitacaoId: dialogo.item.solicitacaoId,
            }}
            onFechar={fecharDialogo}
            onSalvo={onConcluido}
          />,
          document.body,
        )}
      {dialogo?.tipo === 'fechar' &&
        createPortal(
          <Modal isOpen onClose={fecharDialogo} title={ROTULO_FECHAMENTO[dialogo.status].titulo}>
            <FormularioDeFechamento
              item={dialogo.item}
              status={dialogo.status}
              onFechar={fecharDialogo}
              onFechado={onConcluido}
            />
          </Modal>,
          document.body,
        )}
    </section>
  );
}
