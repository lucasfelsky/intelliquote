import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ForecastDivergencia, ForecastLinha } from '@/services/forecast';
import { descreverDivergencia, GRUPOS, motivoSemSugestao, seloPendenteTexto, STATUS_ROTULO, type ColunaPainel, type GrupoId } from './forecastPainel';
import { Icon } from '@/components/icons';
import { semVendaHa6Meses } from './forecastSemVenda';

export type DivergenciasPorCelula = ReadonlyMap<string, ForecastDivergencia>;

export function chaveDaDivergencia(linha: number, coluna: string): string {
  return `${linha}|${coluna}`;
}

interface RowProps {
  linha: ForecastLinha;
  colunas: ColunaPainel[];
  inicios: boolean[];
  divergencias: DivergenciasPorCelula;
  /** Query string (com `?`) do destino do item: quinzena, filtro, busca e colunas ocultas. */
  buscaDoItem: string;
}

const Row = memo(function Row({ linha, colunas, inicios, divergencias, buscaDoItem }: RowProps) {
  // FZ4: linha sem cadastro nao tem produto/fonte: "Cotacao nao enviada" sugeriria uma acao impossivel, entao o status some (o selo explica).
  const fonteEStatus = [linha.fonte, linha.pendenteCadastro ? '' : STATUS_ROTULO[linha.status]].filter(Boolean).join(' · ');
  const semVenda = semVendaHa6Meses(linha);
  return (
    <tr className="fc-row">
      <td className="fc-cell fc-fixa fc-fixa--n">{linha.n ?? ''}</td>
      <td className={`fc-cell fc-fixa fc-fixa--item fc-status--${linha.status}`}>
        <Link
          className="fc-item"
          to={{ pathname: `/forecast/item/${linha.linha}`, search: buscaDoItem }}
          title="Ver memória de cálculo"
        >
          <span className="fc-item__nome">{linha.item}</span>{' '}
          <span className="fc-item__fonte">
            {linha.pendenteCadastro && (
              <>
                <span className={`fcpc-selo fcpc-selo--${linha.pendenteCadastro}`} title={motivoSemSugestao(linha.pendenteCadastro)}>
                  {seloPendenteTexto(linha.pendenteCadastro)}
                </span>{' '}
              </>
            )}
            {semVenda && (
              <span className="fcsv-selo" title="Sem venda há 6 meses ou mais">
                <Icon name="clock" size={12} />
                <span className="sr-only">sem venda ≥6 meses</span>
              </span>
            )}
            {semVenda && ' '}
            {fonteEStatus}
          </span>
        </Link>
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
        const acessivel = c.textoAcessivel?.(linha);
        const proprio = c.celula?.(linha, { texto, destaque });
        return (
          <td key={c.id} className={classes} title={title}>
            {proprio ?? (destaque ? <span className={destaque}>{texto}</span> : texto)}
            {acessivel && <span className="sr-only">{acessivel}</span>}
          </td>
        );
      })}
    </tr>
  );
});

interface Props {
  colunas: ColunaPainel[];
  linhas: ForecastLinha[];
  divergencias: DivergenciasPorCelula;
  buscaDoItem: string;
  legenda: string;
  mensagemVazia?: string;
}

export default function ForecastGrid({
  colunas,
  linhas,
  divergencias,
  buscaDoItem,
  legenda,
  mensagemVazia = 'Nenhum produto com esses filtros.',
}: Props) {
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
                className={[
                  'fc-rotulo',
                  // Rotulos em tom de atencao (mock v68): grupo ESTOQUE e a coluna do mes atual.
                  c.grupo === 'est' || c.rotulo.includes('(ATUAL)') ? 'fc-rotulo--atencao' : '',
                  inicios[i] ? 'fc-cell--divisa' : '',
                  c.esquerda ? 'fc-cell--esq' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {c.rotulo}
                {c.rotuloExtra}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td className="fc-vazio" colSpan={colunas.length + 2}>
                {mensagemVazia}
              </td>
            </tr>
          ) : (
            linhas.map((linha) => (
              <Row
                key={linha.linha}
                linha={linha}
                colunas={colunas}
                inicios={inicios}
                divergencias={divergencias}
                buscaDoItem={buscaDoItem}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
