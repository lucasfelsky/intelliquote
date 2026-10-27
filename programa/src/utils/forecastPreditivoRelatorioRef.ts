// Forecast preditivo (P1b-1): relatorio do backtest da REFERENCIA (--relatorio p1b) em texto e JSON, e a tabela de calibracao em JSON.
// Deterministico e ASCII (console do PowerShell 5.1): numeros formatados a mao (virgula decimal), chaves do JSON em ordem fixa,
// round6. Sem --detalhe nao sai nenhum id de serie nem nome de fonte (a fonte aparece so como posto: fonte-01..fonte-10, outras, sem-fonte).
import type { CenarioRef, ResultadoBacktestRef } from './forecastPreditivoBacktestRef';
import type { CelulaCalibracao, TabelaCalibracao } from './forecastPreditivoCalibracao';
import { PREDITIVO_CONFIG_REF, VARIANTE_IDS } from './forecastPreditivoConfigRef';
import type { LinhaRef } from './forecastPreditivoLinhasRef';
import { AVISO_DETALHE, fmt } from './forecastPreditivoRelatorio';
import { rotuloSegmento } from './forecastPreditivoSegmentosP1';
import { ROTULO_DORMENTE } from './forecastPreditivoConfigP1';
import { round6 } from './forecastPreditivoTipos';

export interface OpcoesRelatorioRef {
  detalhe: boolean;
  linhasRejeitadas?: number;
  rupturaIgnorada?: number;
  atipicoDaEntradaIgnorado?: number;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${fmt(v * 100, 1)}%`);
const lista = (xs: number[]) => (xs.length === 0 ? '-' : xs.join(','));

const LEGENDA =
  'Criterios: 1 amostra (>= 6 origens e >= 30 pares) | 2 WAPE LT <= 0,90 x planilha | 3 vies relativo (|vies| <= |vies planilha Q| + 2 p.p.; sem teto absoluto, salvo --teto-vies) | ' +
  '4 custo no lead time <= 0,95 x planilha | 5 vitoria >= 55% | 6 itens A piores (so com --detalhe, no JSON) | 7 cobertura p10-p90 do lead time em [72%, 88%] com >= 30 pares | ' +
  '8 criterios 1-5 em cada metade temporal das origens. M1/M2 = criterios 1-5 que falham em cada metade. Candidato e o maximo: nada e promovido. ' +
  'Rupt sim = fracao dos pares com realizado no lead time > previsto + qHat/30 x lead time (informativa). C7 = criterio 7 da linha (n/a na planilha Q). ' +
  'Custo por horizonte em KG: 3 x falta + excesso (informativo; o criterio 4 e o do lead time).';

function tabela(cabecalho: string[], linhas: string[][], direita: boolean[]): string[] {
  const larguras = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => l[i].length)));
  const celula = (t: string, i: number) => (direita[i] ? t.padStart(larguras[i]) : t.padEnd(larguras[i]));
  const formatar = (l: string[]) => l.map(celula).join('  ').trimEnd();
  return [formatar(cabecalho), ...linhas.map(formatar)];
}

const textoPromovivel = (l: LinhaRef) => (l.promovivel === 'nao' ? `nao (${l.criteriosFalhos.join(',')})` : l.promovivel);

function tabelaLinhas(linhas: LinhaRef[]): string[] {
  const cab = ['Segmento', 'Variante', 'n', 'Fallb', 'WAPE LT', 'WAPE rel', 'Vies LT', 'Custo rel', 'Falta', 'Excesso', 'Rupt sim', 'Vitoria', 'Cobert LT', 'C7', 'Pinb10', 'Pinb90', 'M1', 'M2', 'Falhos', 'Promovivel'];
  const dados = linhas.map((l) => [
    rotuloSegmento(l.segmento), l.variante, String(l.n), String(l.nFallback), fmt(l.wapeLT, 3), fmt(l.wapeRel, 3), fmt(l.viesLT, 3), fmt(l.custoRel, 2),
    fmt(l.faltaLT, 1), fmt(l.excessoLT, 1), pct(l.rupturaSimulada), l.promovivel === 'referencia' ? '-' : pct(l.vitoria), pct(l.cobertura), l.criterio7,
    fmt(l.pinball10, 4), fmt(l.pinball90, 4), lista(l.metade1.criteriosFalhos), lista(l.metade2.criteriosFalhos), lista(l.criteriosFalhos), textoPromovivel(l),
  ]);
  return tabela(cab, dados, [false, false, true, true, true, true, true, true, true, true, true, true, true, false, true, true, false, false, false, false]);
}

function tabelaHorizonte(c: CenarioRef, H: number): string[] {
  const dados: string[][] = [];
  for (const v of VARIANTE_IDS) {
    const l = c.linhas.find((x) => x.segmento === 'TOTAL' && x.variante === v);
    if (!l) continue;
    for (let h = 1; h <= H; h++) dados.push([v, String(h), fmt(l.wapeH[h - 1], 3), fmt(l.custoH[h - 1], 1), fmt(l.custoRelH[h - 1], 2), pct(l.coberturaH[h - 1])]);
  }
  return tabela(['Variante', 'h', 'WAPE', 'Custo', 'Custo rel', 'Cobert mes'], dados, [false, true, true, true, true, true]);
}

function blocoCenario(c: CenarioRef, r: ResultadoBacktestRef, o: OpcoesRelatorioRef): string[] {
  const k = c.contagem;
  const par = (rec: Record<string, number>) => Object.entries(rec).map(([nome, n]) => `${nome === 'sem-venda' ? ROTULO_DORMENTE : nome} ${n}`).join(' | ');
  const s = c.contagemSegmentos;
  const f = c.correcao;
  const c7 = (v: 'referencia' | 'referencia-corrigida') => `${v} ${pct(c.criterio7[v].cobertura)} (n ${c.criterio7[v].n}) -> ${c.criterio7[v].passa ? 'passa' : 'falha'}`;
  const saida: string[] = [
    '',
    c.principal ? `Cenario principal: min-treino ${c.minTreino}` : `Cenario: min-treino ${c.minTreino}`,
    `Series: ${k.series} (com previsao ${k.comPrevisao}, sem venda ${k.semVenda}, historico curto ${k.historicoCurto})   origens ${c.origens} (com observacao ${c.origensComObservacao})   pares na amostra ${c.amostra.pares}`,
    `Metades das origens: meses ${c.metades.meses1} / ${c.metades.meses2}, ate ${c.metades.ultimoMes1 ?? 'n/a'}`,
    'Series por segmento (ultimo mes):',
    `  ABC    ${par(s.abc)}`,
    `  SBC    ${par(s.sbc)}`,
    `  XYZ    ${par(s.xyz)}`,
    `  LT     ${par(s.lt)}`,
    `  FONTE  ${par(s.fonte)}`,
    `  REGRA  ${par(s.regra)}`,
    `Amostra: pares ${c.amostra.pares}   fallback da referencia ${c.amostra.fallbackReferencia}   residuos excluidos por mascara ${c.amostra.residuosExcluidosMascara}`,
    `Fator aplicado: medio ${fmt(f.fatorMedio, 3)} | min ${fmt(f.fatorMin, 3)} | max ${fmt(f.fatorMax, 3)} | no limite ${f.paresNoLimite} | sem dados ${f.paresSemDados}`,
    `Criterio 7 (TOTAL, cobertura LT p10-p90 em [72%, 88%] com >= 30 pares): ${c7('referencia')} | ${c7('referencia-corrigida')}`,
  ];
  if (c.linhas.length === 0) {
    saida.push('Sem pares (serie, origem) neste cenario: nao ha linhas.');
    return saida;
  }
  saida.push('', 'Tabela (todos os segmentos):', ...tabelaLinhas(c.linhas), '', 'Por horizonte (TOTAL):', ...tabelaHorizonte(c, r.opcoes.horizonte));
  if (o.detalhe) {
    const cab = ['Serie', 'Fonte', 'Regra', ...VARIANTE_IDS.flatMap((v) => [`WAPE LT ${v}`, `Custo LT ${v}`])];
    saida.push(
      '',
      'Por serie (WAPE LT e custo LT em KG por variante):',
      ...tabela(
        cab,
        c.porSerie.map((x) => [x.id, x.rotuloFonte, x.regra, ...VARIANTE_IDS.flatMap((v) => [fmt(x.variantes[v].wapeLT, 3), fmt(x.variantes[v].custoLT, 1)])]),
        cab.map((_, i) => i >= 3),
      ),
    );
  }
  return saida;
}

export function relatorioTextoRef(r: ResultadoBacktestRef, o: OpcoesRelatorioRef): string {
  const op = r.opcoes;
  const p = op.parametrosCorrecao;
  const C = PREDITIVO_CONFIG_REF.correcaoNivel;
  const m = r.marcas;
  const saida: string[] = [`Forecast preditivo - referencia P1b   versao ${r.versao}   config ${r.hashConfig.slice(0, 8)}   entrada ${r.hashEntrada.slice(0, 8)}`];
  if (o.detalhe) saida.push(`ATENCAO: ${AVISO_DETALHE}`);
  saida.push(
    `Horizonte ${op.horizonte}   cenarios min-treino ${r.cenariosMinTreino.join(', ')} (o primeiro e o principal)   historico maximo ${op.historicoMaximo === null ? 'tudo' : op.historicoMaximo}   mascara ${op.usarMascara ? 'sim' : 'nao'}   teto absoluto de vies ${op.tetoVies === null ? 'sem' : pct(op.tetoVies)}`,
    `Lead time padrao ${op.leadTimePadraoDias} dias   razao falta/excesso ${fmt(op.razaoFaltaExcesso, 2)}   linhas rejeitadas ${o.linhasRejeitadas ?? 0}`,
    m === null
      ? 'Marcas: n/a'
      : `Marcas: recebidas ${m.recebidas} | aplicadas ${m.aplicadas} | invalidas ${m.invalidas} | sem serie ${m.semSerie} | fora da serie ${m.foraDaSerie} | duplicadas ${m.duplicadas}   ruptura ignorada ${o.rupturaIgnorada ?? 0} pontos   atipico da entrada ignorado ${o.atipicoDaEntradaIgnorado ?? 0}`,
    `Correcao de nivel (variante referencia-corrigida): k ${fmt(p.k, 0)}, fator ${fmt(p.fatorMin, 2)}-${fmt(p.fatorMax, 2)}, janela ${C.janelaMeses} meses, min ${p.minPares} pares; padrao da previsao: ${C.ativaPorPadrao ? 'ligada' : 'desligada'}`,
  );
  for (const c of r.cenarios) saida.push(...blocoCenario(c, r, o));
  saida.push('', LEGENDA);
  if (o.detalhe) {
    saida.push('', 'Fontes (rotulo -> fonte):');
    for (const f of r.fontes) saida.push(`  ${f.rotulo} -> ${f.fonte}`);
  }
  return saida.join('\n') + '\n';
}

// round6 em todo numero; nao finito vira null. Preserva a ordem das chaves.
function arredondar(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? round6(v) : null;
  if (Array.isArray(v)) return v.map(arredondar);
  if (v !== null && typeof v === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) saida[k] = arredondar(x);
    return saida;
  }
  return v;
}

// Chaves herdadas da P1a (CHAVES_LINHA) sem `metodo`, na mesma ordem.
const CHAVES_LINHA = [
  'n', 'origens', 'nFallback', 'wapeH1', 'wapeH3', 'wapeLT', 'wapeRef', 'wapeRel', 'viesLT', 'viesRef', 'maeLT', 'custoLT', 'custoRel',
  'faltaLT', 'excessoLT', 'vitoria', 'cobertura', 'nIntervalo', 'nPoolTotal', 'pinball10', 'pinball90', 'metade1', 'metade2', 'criteriosFalhos', 'promovivel',
] as const;
const CHAVES_EXTRAS = ['wapeH', 'custoH', 'custoRelH', 'faltaH', 'excessoH', 'coberturaH', 'nIntervaloH', 'rupturaSimulada', 'criterio7'] as const;

function linhaJson(l: LinhaRef, detalhe: boolean): Record<string, unknown> {
  const saida: Record<string, unknown> = { segmento: l.segmento, variante: l.variante };
  for (const k of CHAVES_LINHA) saida[k] = l[k];
  for (const k of CHAVES_EXTRAS) saida[k] = l[k];
  saida.nItensAPiores = l.itensAPiores.length;
  if (detalhe) saida.itensAPiores = l.itensAPiores;
  return saida;
}

function cenarioJson(c: CenarioRef, detalhe: boolean): Record<string, unknown> {
  const saida: Record<string, unknown> = {
    minTreino: c.minTreino,
    principal: c.principal,
    origens: c.origens,
    origensComObservacao: c.origensComObservacao,
    metades: c.metades,
    contagem: c.contagem,
    contagemSegmentos: c.contagemSegmentos,
    amostra: c.amostra,
    correcao: c.correcao,
    criterio7: c.criterio7,
    linhas: c.linhas.map((l) => linhaJson(l, detalhe)),
  };
  if (detalhe) saida.porSerie = c.porSerie;
  return saida;
}

export function relatorioJsonRef(r: ResultadoBacktestRef, o: OpcoesRelatorioRef): string {
  const op = r.opcoes;
  const objeto: Record<string, unknown> = {
    versao: r.versao,
    hashConfig: r.hashConfig,
    hashEntrada: r.hashEntrada,
    opcoes: {
      horizonte: op.horizonte,
      minTreino: op.minTreino,
      leadTimePadraoDias: op.leadTimePadraoDias,
      razaoFaltaExcesso: op.razaoFaltaExcesso,
      usarMascara: op.usarMascara,
      tetoVies: op.tetoVies,
      historicoMaximo: op.historicoMaximo,
      parametrosCorrecao: { k: op.parametrosCorrecao.k, fatorMin: op.parametrosCorrecao.fatorMin, fatorMax: op.parametrosCorrecao.fatorMax, minPares: op.parametrosCorrecao.minPares },
    },
    cenariosMinTreino: r.cenariosMinTreino,
    linhasRejeitadas: o.linhasRejeitadas ?? 0,
    marcas: r.marcas === null ? null : { ...r.marcas, rupturaIgnorada: o.rupturaIgnorada ?? 0, atipicoDaEntradaIgnorado: o.atipicoDaEntradaIgnorado ?? 0 },
    cenarios: r.cenarios.map((c) => cenarioJson(c, o.detalhe)),
  };
  if (o.detalhe) {
    objeto.aviso = AVISO_DETALHE;
    objeto.fontes = r.fontes;
  }
  return JSON.stringify(arredondar(objeto), null, 2) + '\n';
}

// Tabela de calibracao (so agregados) com chaves na ordem do tipo; os numeros ja saem com round6 dos pools.
export function tabelaJson(t: TabelaCalibracao): string {
  const celula = (c: CelulaCalibracao) => ({ celula: c.celula, m: c.m, n: c.n, q10: c.q10, q90: c.q90 });
  const objeto = {
    formato: t.formato,
    versao: t.versao,
    hashConfig: t.hashConfig,
    correcaoNivel: t.correcaoNivel,
    parametros: {
      horizonte: t.parametros.horizonte,
      minTreino: t.parametros.minTreino,
      historicoMaximo: t.parametros.historicoMaximo,
      usarMascara: t.parametros.usarMascara,
      janelaNivelMeses: t.parametros.janelaNivelMeses,
    },
    ultimoMes: t.ultimoMes,
    mensal: t.mensal.map(celula),
    leadTime: t.leadTime.map(celula),
    nivel: { n: t.nivel.n, razao: t.nivel.razao },
  };
  return JSON.stringify(objeto, null, 2) + '\n';
}
