import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  alterarOcasiao,
  criarOcasiao,
  forecastOcasioesKeys,
  ocasiaoSumiu,
  type ForecastOcasiaoEdicao,
} from '@/services/forecastOcasioes';
import { criarEmSequencia, resumoDoSalvamento, type ItemAlvo, type ResultadoAlvo } from './forecastEventosAlvos';

export type EnvioEvento =
  | { tipo: 'nova'; itens: ItemAlvo[]; nome: string }
  | { tipo: 'edicao'; id: number; corpo: ForecastOcasiaoEdicao; nome: string };

/**
 * Grava o evento: edicao (1 PATCH), novo com 1 alvo (1 POST que LANCA em erro, como sempre) ou novo com varios alvos
 * (1 POST por alvo, em sequencia, sem rollback; nao lanca: devolve o resultado de cada alvo).
 * `onVoltar` = tudo certo (volta a lista com o aviso); `aoFicar` = ha falha ou nada foi criado (fica no formulario).
 */
export function useGravarEvento(onVoltar: (mensagem?: string) => void, aoFicar: (r: ResultadoAlvo[]) => void) {
  const queryClient = useQueryClient();
  const invalidar = () => queryClient.invalidateQueries({ queryKey: forecastOcasioesKeys.todas });

  return useMutation({
    mutationFn: async (envio: EnvioEvento): Promise<ResultadoAlvo[] | null> => {
      if (envio.tipo === 'edicao') {
        await alterarOcasiao(envio.id, envio.corpo);
        return null;
      }
      const unico = envio.itens[0];
      if (unico && envio.itens.length === 1) {
        await criarOcasiao(unico.corpo);
        return null;
      }
      return criarEmSequencia(envio.itens, criarOcasiao);
    },
    onSuccess: async (resultados, envio) => {
      if (resultados === null) {
        await invalidar();
        onVoltar(envio.tipo === 'nova' ? `Evento ${envio.nome} cadastrado.` : `Evento ${envio.nome} atualizado.`);
        return;
      }
      const criou = resultados.some((r) => r.status === 'criado');
      if (criou) await invalidar();
      const falhou = resultados.some((r) => r.status === 'erro' || r.status === 'nao-enviado');
      if (criou && !falhou) onVoltar(resumoDoSalvamento(envio.nome, resultados));
      else aoFicar(resultados);
    },
    onError: (err) => {
      if (ocasiaoSumiu(err)) void invalidar();
    },
  });
}
