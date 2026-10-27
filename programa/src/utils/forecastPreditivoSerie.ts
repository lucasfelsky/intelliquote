// Forecast preditivo (fase 0): serie mensal normalizada. Calendario global, lacuna, mascara de atipico/ruptura, avisos.
// Aritmetica de mes por indice absoluto (ano * 12 + mes - 1): sem Date, sem fuso.
import { mesesHistorico } from './forecastMonths';
import type { Quinzena } from './forecastTypes';
import { PREDITIVO_CONFIG as C, ordenarAvisos } from './forecastPreditivoTipos';
import type { AnoMes, AvisoId, PontoMensal, SerieEntrada, SerieNormalizada } from './forecastPreditivoTipos';

const RE_ANO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export const anoMesValido = (v: unknown): v is AnoMes => typeof v === 'string' && RE_ANO_MES.test(v);

export const indiceMes = (a: AnoMes): number => Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)) - 1;

export function somarMeses(a: AnoMes, n: number): AnoMes {
  const abs = indiceMes(a) + n;
  const ano = Math.floor(abs / 12);
  const mes = abs - ano * 12 + 1;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
}

const pontoValido = (p: PontoMensal): boolean =>
  !!p && anoMesValido(p.anoMes) && typeof p.qtd === 'number' && Number.isFinite(p.qtd);

// Meses (validos) presentes em ALGUMA serie, ordenados.
export function calendarioGlobal(entradas: SerieEntrada[]): AnoMes[] {
  const meses = new Set<AnoMes>();
  for (const e of entradas) for (const p of e.pontos) if (pontoValido(p)) meses.add(p.anoMes);
  return [...meses].sort();
}

const media = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

// Mascara causal: atipico sempre; ruptura so quando a venda ficou abaixo da media dos ate 3 meses anteriores nao mascarados.
function calcularMascara(valores: number[], atipico: boolean[], ruptura: boolean[]): boolean[] {
  const mascara: boolean[] = [];
  for (let i = 0; i < valores.length; i++) {
    let m = atipico[i];
    if (!m && ruptura[i]) {
      const anteriores: number[] = [];
      for (let j = i - 1; j >= 0 && anteriores.length < 3; j--) if (!mascara[j]) anteriores.push(valores[j]);
      if (anteriores.length > 0 && valores[i] < media(anteriores)) m = true;
    }
    mascara.push(m);
  }
  return mascara;
}

// Degrau de nivel (ex.: troca de unidade): medias das duas metades dos meses validos, razao maior/menor > degrauRazao.
function temDegrau(valores: number[], mascara: boolean[]): boolean {
  const validos = valores.filter((_, i) => !mascara[i]);
  if (validos.length < 4) return false;
  const h = Math.floor(validos.length / 2);
  const a = media(validos.slice(0, h));
  const b = media(validos.slice(h));
  if (!(a > 0 && b > 0)) return false;
  return Math.max(a, b) / Math.min(a, b) > C.degrauRazao;
}

interface Acumulado {
  qtd: number;
  atipico: boolean;
  ruptura: boolean;
}

function normalizarUma(
  e: SerieEntrada,
  calendario: ReadonlySet<AnoMes>,
  fim: AnoMes,
  erros: string[],
): SerieNormalizada {
  const avisos = new Set<AvisoId>();
  const leadTime = e.leadTimeDias;
  const meta = {
    fonte: e.fonte && e.fonte.trim() !== '' ? e.fonte : null,
    familia: e.familia && e.familia.trim() !== '' ? e.familia : null,
    leadTimeDias:
      typeof leadTime === 'number' && Number.isInteger(leadTime) && leadTime >= 0 && leadTime <= 3650 ? leadTime : null,
  };
  const porMes = new Map<AnoMes, Acumulado>();
  for (const p of e.pontos) {
    if (!pontoValido(p)) {
      erros.push(`serie ${e.id}: ponto invalido`);
      continue;
    }
    const atual = porMes.get(p.anoMes);
    if (atual) {
      atual.qtd += p.qtd;
      atual.atipico = atual.atipico || p.atipico === true;
      atual.ruptura = atual.ruptura || p.ruptura === true;
      avisos.add('mes-duplicado-somado');
    } else {
      porMes.set(p.anoMes, { qtd: p.qtd, atipico: p.atipico === true, ruptura: p.ruptura === true });
    }
  }
  if (porMes.size === 0) return { id: e.id, inicio: '', valores: [], mascara: [], meta, avisos: [] };

  const primeiro = [...porMes.keys()].sort()[0];
  const total = indiceMes(fim) - indiceMes(primeiro) + 1;
  let inicio = primeiro;
  let valores: number[] = [];
  let atipico: boolean[] = [];
  let ruptura: boolean[] = [];
  let negativo = false;
  for (let k = 0; k < total; k++) {
    const mes = somarMeses(primeiro, k);
    const acc = porMes.get(mes);
    if (acc) {
      if (acc.qtd < 0) negativo = true;
      valores.push(acc.qtd < 0 ? 0 : acc.qtd);
      atipico.push(acc.atipico);
      ruptura.push(acc.ruptura);
    } else if (calendario.has(mes)) {
      valores.push(0); // mes importado sem linha desta serie = venda zero
      atipico.push(false);
      ruptura.push(false);
    } else {
      // lacuna: mes que nenhuma serie tem. So vale o trecho contiguo final.
      valores = [];
      atipico = [];
      ruptura = [];
      negativo = false;
      inicio = somarMeses(primeiro, k + 1);
      avisos.add('lacuna-cortada');
    }
  }
  if (negativo) avisos.add('negativo-zerado');
  const mascara = calcularMascara(valores, atipico, ruptura);
  if (temDegrau(valores, mascara)) avisos.add('degrau-nivel');
  return { id: e.id, inicio, valores, mascara, meta, avisos: ordenarAvisos(avisos) };
}

export function normalizarSeries(entradas: SerieEntrada[]): { series: SerieNormalizada[]; erros: string[] } {
  const calendario = calendarioGlobal(entradas);
  const conjunto = new Set(calendario);
  const fim = calendario.length > 0 ? calendario[calendario.length - 1] : '';
  const erros: string[] = [];
  const ordenadas = [...entradas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const series = ordenadas.map((e) => normalizarUma(e, conjunto, fim, erros));
  return { series, erros };
}

// Ultimo mes da serie (ou '' se vazia).
export const ultimoMes = (s: SerieNormalizada): AnoMes =>
  s.valores.length === 0 ? '' : somarMeses(s.inicio, s.valores.length - 1);

// Prefixo da serie ate `ultimo` (inclusive), com a mesma mascara e os mesmos avisos. null se `ultimo` < inicio.
export function cortarAte(s: SerieNormalizada, ultimo: AnoMes): SerieNormalizada | null {
  if (s.valores.length === 0) return null;
  const n = indiceMes(ultimo) - indiceMes(s.inicio) + 1;
  if (n <= 0) return null;
  const k = Math.min(n, s.valores.length);
  return { ...s, valores: s.valores.slice(0, k), mascara: s.mascara.slice(0, k) };
}

const chave = (codigo: string) => codigo.toUpperCase();

// Uma serie por produto da quinzena (J..N = historico, O = vendas do mes anterior por codigo). Sem mascara.
export function serieDaQuinzena(q: Quinzena): SerieEntrada[] {
  const { historico, anterior } = mesesHistorico(q.dataBase);
  const vendasMes = new Map<string, number>();
  for (const { codigo, qtd } of q.entradas.vendasMes) {
    if (!codigo) continue;
    vendasMes.set(chave(codigo), (vendasMes.get(chave(codigo)) ?? 0) + qtd);
  }
  const leadtime = new Map<string, number | null>();
  for (const l of q.entradas.leadtime) {
    const k = l.fonte.toUpperCase();
    if (l.fonte && !leadtime.has(k)) leadtime.set(k, l.total ?? null);
  }
  return q.produtos.map((p) => {
    const o = p.codigos.reduce((t, c) => (c ? t + (vendasMes.get(chave(c)) ?? 0) : t), 0);
    const pontos: PontoMensal[] = historico.map((anoMes, i) => ({ anoMes, qtd: p.historico[i] ?? 0 }));
    pontos.push({ anoMes: anterior, qtd: o });
    return {
      id: 'linha-' + p.linha,
      pontos,
      fonte: p.fonte || undefined,
      leadTimeDias: p.fonte ? leadtime.get(p.fonte.toUpperCase()) ?? null : null,
    };
  });
}
