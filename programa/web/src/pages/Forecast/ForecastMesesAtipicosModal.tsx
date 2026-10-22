import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import type { ForecastLinha } from '@/services/forecast';
import {
  FORECAST_MESES_ATIPICOS_MOTIVO_MAX,
  FORECAST_MESES_ATIPICOS_MOTIVO_MIN,
  forecastMesesAtipicosErrorMessage,
  putForecastMesesAtipicos,
  type ForecastMesesAtipicosPut,
} from '@/services/forecastMesesAtipicos';
import { inteiroBr, mesAbrevDoAnoMes, mesesDaJanelaDeVendas } from './forecastPainel';

interface Props {
  productId: number;
  baseDate: string;
  linha: ForecastLinha;
  onFechar: () => void;
}

interface Estado {
  marcado: boolean;
  motivo: string;
}

// Venda de cada um dos 7 meses da janela, na ordem dos indices do motor (J..N, O, P).
function vendasDaJanela(linha: ForecastLinha): Array<number | null> {
  const historico = linha.historico ?? [];
  return [0, 1, 2, 3, 4].map((i) => historico[i] ?? null).concat([linha.O, linha.P]);
}

const SEM_MARCA: Estado = { marcado: false, motivo: '' };

function estadoInicial(linha: ForecastLinha, janela: string[]): Estado[] {
  const marcas = new Map((linha.mesesForaDaMedia ?? []).map((m) => [m.anoMes, m.motivo]));
  return janela.map((anoMes) => ({ marcado: marcas.has(anoMes), motivo: marcas.get(anoMes) ?? '' }));
}

function Formulario({ productId, baseDate, linha, onFechar }: Props) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const janela = mesesDaJanelaDeVendas(baseDate);
  const vendas = vendasDaJanela(linha);
  const inicial = estadoInicial(linha, janela);
  const [estados, setEstados] = useState<Estado[]>(inicial);

  const gravar = useMutation({
    mutationFn: (corpo: ForecastMesesAtipicosPut) => putForecastMesesAtipicos(productId, corpo),
    onSuccess: () => {
      // A marca e do cadastro ATUAL: muda a linha da quinzena aberta e o relatorio de todas as quinzenas.
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'snapshot'] });
      void queryClient.invalidateQueries({ queryKey: ['forecast', 'relatorio'] });
      onFechar();
    },
  });

  const erros = estados.map((e) =>
    e.marcado && e.motivo.trim().length < FORECAST_MESES_ATIPICOS_MOTIVO_MIN
      ? `Informe o motivo (ao menos ${FORECAST_MESES_ATIPICOS_MOTIVO_MIN} caracteres).`
      : null,
  );
  const alterado = estados.some((e, i) => {
    const antes = inicial[i] ?? SEM_MARCA;
    return e.marcado !== antes.marcado || (e.marcado && e.motivo.trim() !== antes.motivo.trim());
  });
  const temErro = erros.some((e) => e !== null);
  const trimestreTodo = [3, 4, 5].every((i) => (estados[i] ?? SEM_MARCA).marcado);
  const mesAtualMarcado = (estados[6] ?? SEM_MARCA).marcado;
  const pendente = gravar.isPending;
  const podeSalvar = alterado && !temErro && !pendente;

  const atualizar = (i: number, parcial: Partial<Estado>) => {
    gravar.reset();
    setEstados((lista) => lista.map((e, j) => (j === i ? { ...e, ...parcial } : e)));
  };

  return (
    <form
      className="fce-form"
      noValidate
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!podeSalvar) return;
        gravar.mutate({
          meses: estados.flatMap((e, i) => {
            const anoMes = janela[i];
            return e.marcado && anoMes !== undefined ? [{ anoMes, motivo: e.motivo.trim() }] : [];
          }),
          janela,
        });
      }}
    >
      <p className="fce-regra">
        O mês marcado sai das médias trimestral e semestral: a média usa só os meses restantes. A média anual não muda.
        Vale para todas as quinzenas cuja janela de vendas contém o mês. A conferência com a planilha continua pela
        regra original.
      </p>
      <div className="fce-scroll" role="region" tabIndex={0} aria-label="Meses da quinzena">
        <table className="fce-tabela fca-tabela">
          <caption className="sr-only">Meses de venda da quinzena e marcação de venda atípica</caption>
          <thead>
            <tr>
              <th scope="col">Mês</th>
              <th scope="col" className="fce-num">
                Venda (kg)
              </th>
              <th scope="col">Venda atípica</th>
              <th scope="col">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {janela.map((anoMes, i) => {
              const erroId = `${baseId}-erro-${i}`;
              const rotulo = mesAbrevDoAnoMes(anoMes);
              const venda = vendas[i] ?? null;
              const estado = estados[i] ?? SEM_MARCA;
              const erro = erros[i] ?? null;
              return (
                <tr key={anoMes} className={estado.marcado ? 'fca-linha--marcada' : undefined}>
                  <th scope="row">
                    {rotulo}
                    {i === 6 && <span className="fca-atual"> · mês atual, até o dia 15</span>}
                  </th>
                  <td className="fce-num">{venda === null ? '—' : inteiroBr(venda)}</td>
                  <td>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={estado.marcado}
                        disabled={pendente}
                        onChange={(e) => atualizar(i, { marcado: e.target.checked })}
                      />
                      <span className="sr-only">Venda atípica em {rotulo}</span>
                      <span aria-hidden="true">Atípico</span>
                    </label>
                  </td>
                  <td>
                    <input
                      className="input fce-input-rotulo fca-motivo"
                      autoComplete="off"
                      maxLength={FORECAST_MESES_ATIPICOS_MOTIVO_MAX}
                      value={estado.motivo}
                      disabled={pendente || !estado.marcado}
                      aria-label={`Motivo da venda atípica em ${rotulo}`}
                      aria-invalid={erro !== null}
                      aria-describedby={erro !== null ? erroId : undefined}
                      onChange={(e) => atualizar(i, { motivo: e.target.value })}
                    />
                    {erro !== null && (
                      <p className="fce-erro" id={erroId}>
                        {erro}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {trimestreTodo && (
        <p className="fce-dica" role="status">
          Os 3 meses da média trimestral estão marcados: sem mês válido, a média trimestral usa os 3 meses, como a
          planilha.
        </p>
      )}
      {mesAtualMarcado && (
        <p className="fce-dica">
          Mês atual marcado: o consumo do mês (AG) fica igual à média trimestral, sem a venda parcial.
        </p>
      )}
      {gravar.isError && (
        <div className="alert alert--error" role="alert">
          {forecastMesesAtipicosErrorMessage(gravar.error)}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onFechar}>
          Cancelar
        </button>
        <button type="submit" className="primary-button" disabled={!podeSalvar} aria-busy={pendente}>
          {pendente ? 'Salvando…' : 'Salvar meses atípicos'}
        </button>
      </div>
    </form>
  );
}

export default function ForecastMesesAtipicosModal(props: Props) {
  return (
    <Modal isOpen onClose={props.onFechar} title={`Meses fora da média · ${props.linha.item}`} size="wide">
      <Formulario {...props} />
    </Modal>
  );
}
