import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  excluirOcasiao,
  forecastOcasioesErrorMessage,
  forecastOcasioesKeys,
  ocasiaoSumiu,
  type ForecastOcasiao,
} from '@/services/forecastOcasioes';
import { textoAlcance, nomeDoPais } from './forecastOcasioes';
import { executarEmSequencia, resumoEmLote } from './forecastEventosAlvos';

interface Props {
  /** 1 registro, ou os alvos de um grupo ("Excluir todos"). */
  ocasioes: ForecastOcasiao[];
  nome: string;
  /** Sem mensagem = cancelou. */
  onVoltar: (mensagem?: string) => void;
}

/** Confirmacao de exclusao no proprio painel (nao usa dialogo: o painel ja esta dentro de um). */
export default function ForecastOcasiaoExcluir({ ocasioes, nome, onVoltar }: Props) {
  const queryClient = useQueryClient();
  const titulo = useRef<HTMLHeadingElement>(null);
  const n = ocasioes.length;
  const [falhaLote, setFalhaLote] = useState<string | null>(null);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const invalidar = () => queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });

  const excluir = useMutation({
    // 1 registro: lanca em erro (alerta com a mensagem, como sempre). Varios: um DELETE por vez; 404 com corpo = ja
    // nao existia = conta como feito (repetir e idempotente).
    mutationFn: async () => {
      const unico = ocasioes[0];
      if (unico && n === 1) {
        await excluirOcasiao(unico.id);
        return null;
      }
      return executarEmSequencia(ocasioes, (o) => excluirOcasiao(o.id));
    },
    onSuccess: async (res) => {
      await invalidar();
      if (res === null) {
        onVoltar(`Evento ${nome} excluído.`);
        return;
      }
      const falhas = res.filter((r) => r.naoEnviado || (r.erro !== null && !ocasiaoSumiu(r.erro)));
      if (falhas.length === 0) {
        onVoltar(resumoEmLote(nome, 'excluído', res.length, 0, null));
        return;
      }
      const primeira = falhas.find((f) => f.erro !== null);
      setFalhaLote(
        resumoEmLote(
          nome,
          'excluído',
          res.length - falhas.length,
          falhas.length,
          primeira ? forecastOcasioesErrorMessage(primeira.erro, 'excluir') : null,
        ),
      );
    },
    onError: (err) => {
      if (ocasiaoSumiu(err)) void invalidar();
    },
  });
  const pendente = excluir.isPending;

  return (
    <div className="fco-confirmar">
      <h3 className="fcg-titulo" tabIndex={-1} ref={titulo}>
        {n === 1 ? `Excluir o evento ${nome}` : `Excluir o evento ${nome} em ${n} alvos`}
      </h3>
      {n > 1 && (
        <ul className="fcd-dica">
          {ocasioes.map((o) => (
            <li key={o.id}>{textoAlcance(o, nomeDoPais)}</li>
          ))}
        </ul>
      )}
      <p className="fcd-dica">A exclusão é definitiva. Para só deixar de considerar o evento, use Inativar.</p>
      {excluir.isError && (
        <div className="alert alert--error" role="alert">
          {forecastOcasioesErrorMessage(excluir.error, 'excluir')}
        </div>
      )}
      {falhaLote && !pendente && (
        <div className="alert alert--error" role="alert">
          {falhaLote}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={() => onVoltar()} disabled={pendente}>
          Cancelar
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={() => {
            setFalhaLote(null);
            excluir.mutate();
          }}
          disabled={pendente}
          aria-busy={pendente}
        >
          {pendente ? 'Excluindo…' : n === 1 ? 'Excluir evento' : `Excluir em ${n} alvos`}
        </button>
      </div>
    </div>
  );
}
