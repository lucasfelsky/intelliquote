// Forecast preditivo (P1b-1): mascara de meses atipicos por MARCAS (espelho de ForecastAtypicalMonth: produto x yearMonth).
// A referencia so usa marcas reais (D8): as flags `atipico`/`ruptura` dos pontos de entrada sao ignoradas (contadas). A
// mascara e causal: o mes m so entra no treino de origens >= m (cortarAte corta a mascara junto). Funcao pura; a entrada nunca e mutada.
import { anoMesValido, calendarioGlobal, indiceMes, normalizarSeries } from './forecastPreditivoSerie';
import type { AnoMes, PontoMensal, SerieEntrada, SerieNormalizada } from './forecastPreditivoTipos';

export type MarcasPorSerie = ReadonlyMap<string, readonly AnoMes[]>; // serieId (produto) -> yearMonth marcados

export interface ContagemMarcas {
  recebidas: number;
  aplicadas: number;
  invalidas: number;
  semSerie: number;
  foraDaSerie: number;
  duplicadas: number;
}

export interface SeriesRef {
  series: SerieNormalizada[];
  erros: string[];
  marcas: ContagemMarcas;
  rupturaIgnorada: number;
  atipicoDaEntradaIgnorado: number;
}

const porTexto = (a: unknown, b: unknown): number => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const pontoOk = (p: PontoMensal): boolean => !!p && anoMesValido(p.anoMes) && typeof p.qtd === 'number' && Number.isFinite(p.qtd);

export function prepararSeriesRef(entradas: readonly SerieEntrada[], marcas: MarcasPorSerie, usarMascara: boolean): SeriesRef {
  let rupturaIgnorada = 0;
  let atipicoDaEntradaIgnorado = 0;
  // 1. copia SEM atipico/ruptura nos pontos (ponto nulo ou torto segue para o normalizarSeries, que o rejeita e conta)
  const copias: SerieEntrada[] = entradas.map((e) => ({
    ...e,
    pontos: e.pontos.map((p) => {
      if (!p || typeof p !== 'object') return p;
      if (p.ruptura === true) rupturaIgnorada++;
      if (p.atipico === true) atipicoDaEntradaIgnorado++;
      return { anoMes: p.anoMes, qtd: p.qtd };
    }),
  }));
  const contagem: ContagemMarcas = { recebidas: 0, aplicadas: 0, invalidas: 0, semSerie: 0, foraDaSerie: 0, duplicadas: 0 };
  for (const lista of marcas.values()) contagem.recebidas += lista.length;

  // 2-4. marcas (so com mascara ligada)
  if (usarMascara && marcas.size > 0) {
    const calendario = calendarioGlobal(copias);
    const noCalendario = new Set(calendario);
    const ultimoCalendario = calendario.length > 0 ? calendario[calendario.length - 1] : '';
    const porId = new Map<string, SerieEntrada[]>();
    for (const c of copias) porId.set(c.id, [...(porId.get(c.id) ?? []), c]);
    for (const id of [...marcas.keys()].sort(porTexto)) {
      const copiasDaSerie = porId.get(id);
      let primeiro = '';
      if (copiasDaSerie) {
        for (const c of copiasDaSerie) for (const p of c.pontos) if (pontoOk(p) && (primeiro === '' || p.anoMes < primeiro)) primeiro = p.anoMes;
      }
      const vistos = new Set<string>();
      for (const mes of [...marcas.get(id)!].sort(porTexto)) {
        if (!anoMesValido(mes)) {
          contagem.invalidas++;
          continue;
        }
        if (!copiasDaSerie) {
          contagem.semSerie++;
          continue;
        }
        if (vistos.has(mes)) {
          contagem.duplicadas++;
          continue;
        }
        vistos.add(mes);
        // nunca cria mes no calendario global (taparia uma lacuna): fora de [1o mes da serie, ultimo mes do calendario] = fora
        if (!noCalendario.has(mes) || primeiro === '' || indiceMes(mes) < indiceMes(primeiro) || indiceMes(mes) > indiceMes(ultimoCalendario)) {
          contagem.foraDaSerie++;
          continue;
        }
        contagem.aplicadas++;
        for (const c of copiasDaSerie) {
          let achou = false;
          c.pontos = c.pontos.map((p) => {
            if (p && p.anoMes === mes && pontoOk(p)) {
              achou = true;
              return { ...p, atipico: true };
            }
            return p;
          });
          if (!achou && c === copiasDaSerie[0]) c.pontos.push({ anoMes: mes, qtd: 0, atipico: true });
        }
      }
    }
  }

  // 5. normaliza (com so `atipico`, a mascara = marcas)
  const { series, erros } = normalizarSeries(copias);
  return { series, erros, marcas: contagem, rupturaIgnorada, atipicoDaEntradaIgnorado };
}

// CLI: pontos com atipico=true da entrada viram marcas (a coluna `atipico` do CSV faz o papel de ForecastAtypicalMonth).
export function marcasDaEntrada(entradas: readonly SerieEntrada[]): MarcasPorSerie {
  const mapa = new Map<string, AnoMes[]>();
  for (const e of entradas) {
    for (const p of e.pontos) {
      if (!p || typeof p !== 'object' || p.atipico !== true) continue;
      const lista = mapa.get(e.id);
      if (lista) lista.push(p.anoMes);
      else mapa.set(e.id, [p.anoMes]);
    }
  }
  return mapa;
}
