// Coluna ANALISE FORECAST do painel com a quantidade decidida pelo comprador (ForecastPurchaseDecision).
// Funcoes puras, sem React.
//
// Regra (a mesma da coluna AO do XLSX MACRO no backend, ForecastSnapshotService): linha com productId e decisao no
// mapa mostra a quantidade decidida; sem decisao, o analiseForecast congelado na importacao (como antes).
//
// O ponto de status usa o status DA DECISAO; a barra lateral do ITENS continua com o status congelado da quinzena.
// Os dois podem divergir (intencional: a decisao e mais nova que a importacao).
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import type { ForecastLinha } from '@/services/forecast';
import { contabil1, kgBr, STATUS_ROTULO, type ColunaPainel } from './forecastPainel';

export const ID_COLUNA_ANALISE = 'analiseForecast';

const DIA_MES_SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
});

/** Decidir 0 e "decidiu nao comprar": mostra 0,0 (o vazio do congelado e "-"). */
export function textoDaDecisao(kg: number): string {
  return kg === 0 ? '0,0' : contabil1(kg);
}

/** dd/mm no fuso de Sao Paulo a partir de um ISO; texto que nao e data = ''. */
export function dataCurtaEmSaoPaulo(iso: string): string {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return '';
  const partes = Object.fromEntries(DIA_MES_SP.formatToParts(instante).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}`;
}

/** Dica (title) e texto acessivel da celula decidida. A observacao so entra quando existe. */
export function dicaDaDecisao(d: ForecastDecisao): string {
  const data = dataCurtaEmSaoPaulo(d.atualizadaEm);
  const partes = [`Qtd. decidida pelo comprador: ${kgBr(d.quantidadeKg)} kg`, STATUS_ROTULO[d.status]];
  if (data) partes.push(`decidida em ${data}`);
  if (d.observacao) partes.push(`Obs.: ${d.observacao}`);
  return partes.join(' · ');
}

function decisaoDaLinha(linha: ForecastLinha, mapa: ReadonlyMap<number, ForecastDecisao>): ForecastDecisao | undefined {
  return linha.productId === null || linha.productId === undefined ? undefined : mapa.get(linha.productId);
}

/**
 * Devolve as colunas com SOMENTE a ANALISE FORECAST trocada (as demais mantem a mesma referencia). `mapa` null (sem
 * dados de decisao) devolve o proprio array.
 */
export function colunasComDecisoes(
  colunas: ColunaPainel[],
  mapa: ReadonlyMap<number, ForecastDecisao> | null,
): ColunaPainel[] {
  if (mapa === null) return colunas;
  return colunas.map((c) => {
    if (c.id !== ID_COLUNA_ANALISE) return c;
    return {
      ...c,
      texto: (l) => {
        const d = decisaoDaLinha(l, mapa);
        return d ? textoDaDecisao(d.quantidadeKg) : c.texto(l);
      },
      classe: (l) => (decisaoDaLinha(l, mapa) ? 'fc-cell--forte' : (c.classe?.(l) ?? '')),
      destaque: (l) => {
        const d = decisaoDaLinha(l, mapa);
        return d ? `fcad-decidida fcad-decidida--${d.status}` : (c.destaque?.(l) ?? '');
      },
      titulo: (l) => {
        const d = decisaoDaLinha(l, mapa);
        return d ? dicaDaDecisao(d) : c.titulo?.(l);
      },
      textoAcessivel: (l) => {
        const d = decisaoDaLinha(l, mapa);
        return d ? ` — ${dicaDaDecisao(d)}` : undefined;
      },
    };
  });
}
