import { memo, useMemo } from 'react';
import type { ForecastDivergencia, ForecastLinha } from '@/services/forecast';
import { descreverDivergencia, GRUPOS, STATUS_ROTULO, type ColunaPainel, type GrupoId } from './forecastPainel';

export type DivergenciasPorCelula = ReadonlyMap<string, ForecastDivergencia>;

export function chaveDaDivergencia(linha: number, coluna: string): string {
  return `${linha}|${coluna}`;
}

interface RowProps {
  linha: ForecastLinha;
  colunas: ColunaPainel[];
  inicios: boolean[];
  selecionada: boolean;
  divergencias: DivergenciasPorCelula;
  onSelect: (linha: number) => void;
}

const Row = memo(function Row({ linha, colunas, inicios, selecionada, divergencias, onSelect }: RowProps) {
  const fonteEStatus = [linha.fonte, STATUS_ROTULO[linha.status]].filter(Boolean).join(' · ');
  return (
    <tr className={selecionada ? 'fc-row fc-row--selecionada' : 'fc-row'}>
      <td className="fc-cell fc-fixa fc-fixa--n">{linha.n ?? ''}</td>
      <td className={`fc-cell fc-fixa fc-fixa--item fc-status--${linha.status}`}>
        <button
          type="button"
          className="fc-item"
          aria-pressed={selecionada}
          title="Ver memória de cálculo"
          onClick={() => onSelect(linha.linha)}
        >
          <span className="fc-item__nome">{linha.item}</span>{' '}
          <span className="fc-item__fonte">{fonteEStatus}</span>
        </button>
      </td>
      {colunas.map((c, i) => {
        const divergencia = c.colunaPlanilha
          ? divergencias.get(chaveDaDivergencia(linha.linha, c.colunaPlanilha))
          : undefined;
        const texto = c.texto(linha);
        const classes = [
          'fc-cell',
          inicios[i] ? 'fc-cell--divisa' : '',
          c.esquerda ? 'fc-cell--esq' : '',
          texto === '-' || texto === '' ? 'fc-cell--vazio' : '',
          /^-\d/.test(texto) ? 'fc-cell--neg' : '',
          divergencia ? 'fc-cell--diverge' : '',
          c.classe?.(linha) ?? '',
        ]
          .filter(Boolean)
          .join(' ');
        const destaque = texto !== '' ? c.destaque?.(linha) : undefined;
        const title = divergencia
          ? descreverDivergencia(divergencia)
          : c.id === 'obs' && texto !== ''
            ? texto
            : c.titulo?.(linha);
        return (
          <td key={c.id} className={classes} title={title}>
            {destaque ? <span className={destaque}>{texto}</span> : texto}
          </td>
        );
      })}
    </tr>
  );
});

interface Props {
  colunas: ColunaPainel[];
  linhas: ForecastLinha[];
  selecionada: number | null;
  divergencias: DivergenciasPorCelula;
  onSelect: (linha: number) => void;
  legenda: string;
}

export default function ForecastGrid({ colunas, linhas, selecionada, divergencias, onSelect, legenda }: Props) {
  // Colunas vizinhas do mesmo grupo viram uma faixa so no cabecalho.
  const faixas = useMemo(() => {
    const lista: Array<{ grupo: GrupoId; span: number }> = [];
    for (const c of colunas) {
      const ultima = lista[lista.length - 1];
      if (ultima && ultima.grupo === c.grupo) ultima.span += 1;
      else lista.push({ grupo: c.grupo, span: 1 });
    }
    return lista;
  }, [colunas]);
  const inicios = useMemo(() => colunas.map((c, i) => i > 0 && colunas[i - 1]?.grupo !== c.grupo), [colunas]);

  return (
    <div className="fc-scroll" tabIndex={0} role="region" aria-label="Grade do Forecast">
      <table className="fc-grid">
        <caption className="sr-only">{legenda}</caption>
        <colgroup>
          <col style={{ width: 44 }} />
          <col style={{ width: 240 }} />
          {colunas.map((c) => (
            <col key={c.id} style={{ width: c.largura }} />
          ))}
        </colgroup>
        <thead>
          <tr className="fc-faixas">
            <th className="fc-fixa fc-fixa--n" scope="col" rowSpan={2}>
              Nº
            </th>
            <th className="fc-fixa fc-fixa--item" scope="col" rowSpan={2}>
              ITENS
            </th>
            {faixas.map((faixa, i) => (
              <th key={i} colSpan={faixa.span} scope="colgroup" className={`fc-faixa fc-faixa--${faixa.grupo}`}>
                {GRUPOS[faixa.grupo]}
              </th>
            ))}
          </tr>
          <tr className="fc-rotulos">
            {colunas.map((c, i) => (
              <th
                key={c.id}
                scope="col"
                className={['fc-rotulo', inicios[i] ? 'fc-cell--divisa' : '', c.esquerda ? 'fc-cell--esq' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td className="fc-vazio" colSpan={colunas.length + 2}>
                Nenhum produto com esses filtros.
              </td>
            </tr>
          ) : (
            linhas.map((linha) => (
              <Row
                key={linha.linha}
                linha={linha}
                colunas={colunas}
                inicios={inicios}
                selecionada={linha.linha === selecionada}
                divergencias={divergencias}
                onSelect={onSelect}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
