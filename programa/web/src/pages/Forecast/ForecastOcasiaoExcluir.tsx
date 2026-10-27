import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  excluirOcasiao,
  forecastOcasioesErrorMessage,
  forecastOcasioesKeys,
  ocasiaoSumiu,
  type ForecastOcasiao,
} from '@/services/forecastOcasioes';

interface Props {
  ocasiao: ForecastOcasiao;
  /** Sem mensagem = cancelou. */
  onVoltar: (mensagem?: string) => void;
}

/** Confirmacao de exclusao no proprio painel (nao usa dialogo: o painel ja esta dentro de um). */
export default function ForecastOcasiaoExcluir({ ocasiao, onVoltar }: Props) {
  const queryClient = useQueryClient();
  const titulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const excluir = useMutation({
    mutationFn: () => excluirOcasiao(ocasiao.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
      onVoltar(`Ocasião ${ocasiao.name} excluída.`);
    },
    onError: (err) => {
      if (ocasiaoSumiu(err)) void queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });
    },
  });
  const pendente = excluir.isPending;

  return (
    <div className="fco-confirmar">
      <h3 className="fcg-titulo" tabIndex={-1} ref={titulo}>
        Excluir a ocasião {ocasiao.name}
      </h3>
      <p className="fcd-dica">A exclusão é definitiva. Para só deixar de considerar a ocasião, use Inativar.</p>
      {excluir.isError && (
        <div className="alert alert--error" role="alert">
          {forecastOcasioesErrorMessage(excluir.error, 'excluir')}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={() => onVoltar()} disabled={pendente}>
          Cancelar
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={() => excluir.mutate()}
          disabled={pendente}
          aria-busy={pendente}
        >
          {pendente ? 'Excluindo…' : 'Excluir ocasião'}
        </button>
      </div>
    </div>
  );
}
