import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import {
  excluirForecastSnapshot,
  forecastExcluirErrorMessage,
  forecastKeys,
  type ForecastOrigin,
  type ForecastSnapshotSummary,
} from '@/services/forecast';
import { dataBr } from './forecastPainel';

const ORIGEM_ROTULO: Record<ForecastOrigin, string> = {
  planilha: 'planilha',
  dbcorp: 'relatórios DBCorp',
};

interface Props {
  quinzena: ForecastSnapshotSummary;
  /** Nº de produtos da quinzena, quando o detalhe carregado e o dela; senao `null` (mostra "—"). */
  produtos: number | null;
  onFechar: () => void;
  onExcluida: (id: number, label: string) => void;
}

/** Confirmacao da exclusao: so libera o botao depois de digitar o rotulo da quinzena. Montado so quando aberto. */
export default function ForecastExcluirQuinzenaModal({ quinzena, produtos, onFechar, onExcluida }: Props) {
  const queryClient = useQueryClient();
  const [digitado, setDigitado] = useState('');
  const botaoCancelar = useRef<HTMLButtonElement>(null);
  // Trava sincrona contra duplo envio (o estado do useMutation so muda no render seguinte).
  const enviando = useRef(false);

  const mutation = useMutation({
    mutationFn: () => excluirForecastSnapshot(quinzena.id),
    onSuccess: (resposta) => {
      onExcluida(resposta.id, resposta.label);
    },
    onError: (err) => {
      enviando.current = false;
      // Ja excluida por outra pessoa: a lista precisa refletir isso.
      if (err instanceof ApiError && err.status === 404) {
        void queryClient.invalidateQueries({ queryKey: forecastKeys.snapshots });
      }
    },
  });
  const pendente = mutation.isPending;
  const bate = digitado.trim() === quinzena.label;

  // O `useEffect` do Modal (filho) roda antes e ja chamou `showModal`; o foco inicial seguro e o "Cancelar".
  useEffect(() => {
    botaoCancelar.current?.focus();
  }, []);

  const fechar = () => {
    if (!pendente) onFechar();
  };

  const confirmar = (event: FormEvent) => {
    event.preventDefault();
    if (!bate || pendente || enviando.current) return;
    enviando.current = true;
    mutation.mutate();
  };

  const dbcorp = quinzena.origin === 'dbcorp';

  return (
    <Modal isOpen onClose={fechar} title={`Excluir a quinzena ${quinzena.label}?`}>
      <div className="fcx-excluir">
        <dl className="fcx-dados">
          <div>
            <dt>Rótulo</dt>
            <dd>{quinzena.label}</dd>
          </div>
          <div>
            <dt>Data base</dt>
            <dd>{dataBr(quinzena.baseDate)}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{ORIGEM_ROTULO[quinzena.origin]}</dd>
          </div>
          <div>
            <dt>Produtos</dt>
            <dd>{produtos ?? '—'}</dd>
          </div>
        </dl>
        <p>
          A quinzena sai do seletor, do painel, do relatório de compras e dos pendentes de cadastro, para todos os
          usuários. Não dá para desfazer pela tela.
        </p>
        <p className="fcx-excluir__subtitulo">Continua valendo (a exclusão não desfaz):</p>
        <ul className="fcx-lista">
          {dbcorp ? (
            <>
              <li>o histórico de vendas do mês anterior e os prazos de chegada por fonte gravados na importação;</li>
              <li>o prazo real por fonte passa a usar a quinzena DBCorp anterior, se houver;</li>
            </>
          ) : (
            <li>o cadastro de produtos, códigos e fontes e o histórico de vendas, se a importação os gravou;</li>
          )}
          <li>
            marcas dos produtos (compra sob demanda, meses atípicos), grupos de equivalência e demanda do comercial;
          </li>
          <li>relatórios e XLSX já baixados.</li>
        </ul>
        <p>Depois de excluir, a mesma quinzena pode ser importada de novo.</p>
        <form onSubmit={confirmar} noValidate>
          <label className="field-label" htmlFor="fcx-rotulo">
            Para confirmar, digite <strong>{quinzena.label}</strong>
          </label>
          <input
            id="fcx-rotulo"
            className="input fcx-campo"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={digitado}
            aria-describedby="fcx-rotulo-dica"
            onChange={(e) => setDigitado(e.target.value)}
          />
          <p id="fcx-rotulo-dica" className="fcx-dica">
            Digite o rótulo exatamente como aparece no seletor.
          </p>
          {mutation.isError && (
            <div className="alert alert--error" role="alert">
              {forecastExcluirErrorMessage(mutation.error, quinzena.label)}
            </div>
          )}
          {pendente && <p role="status">Excluindo a quinzena {quinzena.label}…</p>}
          <div className="modal-actions">
            <button ref={botaoCancelar} type="button" className="ghost-button" disabled={pendente} onClick={fechar}>
              Cancelar
            </button>
            <button type="submit" className="danger-button" disabled={!bate || pendente} aria-busy={pendente}>
              Excluir quinzena
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
