// Forecast preditivo (P1a): relatorio do backtest P1 em texto e JSON. Deterministico e ASCII (console do PowerShell 5.1):
// numeros formatados a mao (virgula decimal, sem formatacao de locale do runtime), chaves do JSON em ordem fixa, round6. Sem --detalhe
// nao sai nenhum id de serie nem nome de fonte (a fonte aparece so como posto: fonte-01..fonte-10, outras, sem-fonte).
import type { CenarioP1, ResultadoBacktestP1 } from './forecastPreditivoBacktestP1';
import { AVISO_P1_IDS, ROTULO_DORMENTE } from './forecastPreditivoConfigP1';
import type { LinhaP1 } from './forecastPreditivoLinhasP1';
import { rotuloSegmento } from './forecastPreditivoSegmentosP1';
import { AVISO_DETALHE, fmt } from './forecastPreditivoRelatorio';
import { AVISO_IDS, round6 } from './forecastPreditivoTipos';

export interface OpcoesRelatorioP1 {
  detalhe: boolean;
  linhasRejeitadas?: number;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${fmt(v * 100, 1)}%`);
const lista = (xs: number[]) => (xs.length === 0 ? '-' : xs.join(','));

const LEGENDA =
  'Criterios: 1 amostra (>= 6 origens e >= 30 pares) | 2 WAPE LT <= 0,90 x planilha | 3 vies (|vies| <= teto e <= |vies planilha| + 2 p.p.) | ' +
  '4 custo <= 0,95 x planilha | 5 vitoria >= 55% | 6 itens A piores (so com --detalhe) | 7 cobertura p10-p90 em [72%, 88%] com >= 30 pares | ' +
  '8 criterios 1-5 em cada metade temporal das origens. M1/M2 = criterios 1-5 que falham em cada metade. Candidato e o maximo: nada e promovido.';

function tabela(cabecalho: string[], linhas: string[][], direita: boolean[]): string[] {
  const larguras = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => l[i].length)));
  const celula = (t: string, i: number) => (direita[i] ? t.padStart(larguras[i]) : t.padEnd(larguras[i]));
  const formatar = (l: string[]) => l.map(celula).join('  ').trimEnd();
  return [formatar(cabecalho), ...linhas.map(formatar)];
}

function textoPromovivel(l: LinhaP1): string {
  return l.promovivel === 'nao' ? `nao (${l.criteriosFalhos.join(',')})` : l.promovivel;
}

function tabelaLinhas(linhas: LinhaP1[], tetoTexto: string): string[] {
  const cab = ['Segmento', 'Metodo', 'n', 'Orig', 'Fallb', 'WAPE LT', 'WAPE rel', 'Vies LT', 'Custo rel', 'Falta', 'Excesso', 'Vitoria', 'Cobert', 'Pinb10', 'Pinb90', 'M1', 'M2', `Falhos teto ${tetoTexto}`, 'Falhos sem teto', 'Promovivel'];
  const dados = linhas.map((l) => [
    rotuloSegmento(l.segmento),
    l.metodo,
    String(l.n),
    String(l.origens),
    String(l.nFallback),
    fmt(l.wapeLT, 3),
    fmt(l.wapeRel, 3),
    fmt(l.viesLT, 3),
    fmt(l.custoRel, 2),
    fmt(l.faltaLT, 1),
    fmt(l.excessoLT, 1),
    l.promovivel === 'referencia' ? '-' : pct(l.vitoria),
    pct(l.cobertura),
    fmt(l.pinball10, 4),
    fmt(l.pinball90, 4),
    lista(l.metade1.criteriosFalhos),
    lista(l.metade2.criteriosFalhos),
    lista(l.criteriosFalhos),
    lista(l.criteriosFalhosSemTeto),
    textoPromovivel(l),
  ]);
  return tabela(cab, dados, [false, false, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false, false]);
}

function blocoCenario(c: CenarioP1, r: ResultadoBacktestP1, o: OpcoesRelatorioP1, tetoTexto: string): string[] {
  const k = c.contagem;
  const par = (rec: Record<string, number>) => Object.entries(rec).map(([nome, n]) => `${nome === 'sem-venda' ? ROTULO_DORMENTE : nome} ${n}`).join(' | ');
  const s = c.contagemSegmentos;
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
    `Avisos: ${[...AVISO_IDS.map((a) => `${a} ${c.avisos[a]}`), ...AVISO_P1_IDS.map((a) => `${a} ${c.avisosP1[a]}`)].join(' | ')}`,
    `Fallback para a planilha Q na amostra (pares): ${par(c.amostra.fallbackPorMetodo)}`,
  ];
  if (c.linhas.length === 0) {
    saida.push('Sem pares (serie, origem) neste cenario: nao ha linhas de metodo.');
    return saida;
  }
  const resumo = c.linhas.filter((l) => l.segmento === 'TOTAL' || l.promovivel === 'candidato' || l.promovivelSemTeto === 'candidato');
  saida.push('', 'Resumo (TOTAL e candidatos):', ...tabelaLinhas(resumo, tetoTexto), '', 'Tabela completa:', ...tabelaLinhas(c.linhas, tetoTexto));
  if (o.detalhe) {
    const piores = c.linhas.filter((l) => l.itensAPiores.length > 0);
    if (piores.length > 0) {
      saida.push('', 'Itens A piores que 1,25 x a planilha (WAPE LT):');
      for (const l of piores) saida.push(`  ${rotuloSegmento(l.segmento)} ${l.metodo}: ${l.itensAPiores.join(', ')}`);
    }
    const metodos = r.opcoes.metodos;
    saida.push(
      '',
      'Por serie (WAPE LT por metodo):',
      ...tabela(
        ['Serie', 'Fonte', 'Meses', 'Origens', 'ABC', 'XYZ', 'SBC', 'LT', 'Regra', 'Avisos', ...metodos],
        c.porSerie.map((x) => [x.id, x.rotuloFonte, String(x.meses), String(x.origens), x.abc, x.xyz, x.sbc, x.classeLt, x.regra, [...x.avisos, ...x.avisosP1].join(',') || '-', ...metodos.map((m) => fmt(x.wapeLT[m] ?? null, 3))]),
        [false, false, true, true, false, false, false, false, false, false, ...metodos.map(() => true)],
      ),
    );
  }
  return saida;
}

export function relatorioTextoP1(r: ResultadoBacktestP1, o: OpcoesRelatorioP1): string {
  const tetoTexto = r.opcoes.tetoVies === null ? 'sem' : pct(r.opcoes.tetoVies);
  const saida: string[] = [`Forecast preditivo - backtest P1   versao ${r.versao}   config ${r.hashConfig.slice(0, 8)}   entrada ${r.hashEntrada.slice(0, 8)}`];
  if (o.detalhe) saida.push(`ATENCAO: ${AVISO_DETALHE}`);
  saida.push(
    `Horizonte ${r.opcoes.horizonte}   cenarios min-treino ${r.cenariosMinTreino.join(', ')} (o primeiro e o principal)   teto de vies ${tetoTexto}   mascara ${r.opcoes.usarMascara ? 'sim' : 'nao'}`,
    `Lead time padrao ${r.opcoes.leadTimePadraoDias} dias   razao falta/excesso ${fmt(r.opcoes.razaoFaltaExcesso, 2)}   linhas rejeitadas ${o.linhasRejeitadas ?? 0}`,
  );
  for (const c of r.cenarios) saida.push(...blocoCenario(c, r, o, tetoTexto));
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

const CHAVES_LINHA = [
  'segmento', 'metodo', 'n', 'origens', 'nFallback', 'wapeH1', 'wapeH3', 'wapeLT', 'wapeRef', 'wapeRel', 'viesLT', 'viesRef', 'maeLT', 'custoLT', 'custoRel',
  'faltaLT', 'excessoLT', 'vitoria', 'cobertura', 'nIntervalo', 'nPoolTotal', 'pinball10', 'pinball90', 'metade1', 'metade2', 'criteriosFalhos', 'promovivel',
  'criteriosFalhosSemTeto', 'promovivelSemTeto',
] as const;

function linhaJson(l: LinhaP1, detalhe: boolean): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const k of CHAVES_LINHA) saida[k] = l[k];
  saida.nItensAPiores = l.itensAPiores.length;
  if (detalhe) saida.itensAPiores = l.itensAPiores;
  return saida;
}

function cenarioJson(c: CenarioP1, detalhe: boolean): Record<string, unknown> {
  const saida: Record<string, unknown> = {
    minTreino: c.minTreino,
    principal: c.principal,
    origens: c.origens,
    origensComObservacao: c.origensComObservacao,
    metades: c.metades,
    contagem: c.contagem,
    contagemSegmentos: c.contagemSegmentos,
    avisos: Object.fromEntries(AVISO_IDS.map((a) => [a, c.avisos[a]])),
    avisosP1: Object.fromEntries(AVISO_P1_IDS.map((a) => [a, c.avisosP1[a]])),
    amostra: c.amostra,
    linhas: c.linhas.map((l) => linhaJson(l, detalhe)),
  };
  if (detalhe) saida.porSerie = c.porSerie;
  return saida;
}

export function relatorioJsonP1(r: ResultadoBacktestP1, o: OpcoesRelatorioP1): string {
  const op = r.opcoes;
  const objeto: Record<string, unknown> = {
    versao: r.versao,
    hashConfig: r.hashConfig,
    hashEntrada: r.hashEntrada,
    opcoes: {
      horizonte: op.horizonte,
      minTreino: op.minTreino,
      metodos: op.metodos,
      leadTimePadraoDias: op.leadTimePadraoDias,
      razaoFaltaExcesso: op.razaoFaltaExcesso,
      usarMascara: op.usarMascara,
      tetoVies: op.tetoVies,
    },
    cenariosMinTreino: r.cenariosMinTreino,
    linhasRejeitadas: o.linhasRejeitadas ?? 0,
    cenarios: r.cenarios.map((c) => cenarioJson(c, o.detalhe)),
  };
  if (o.detalhe) {
    objeto.aviso = AVISO_DETALHE;
    objeto.fontes = r.fontes;
  }
  return JSON.stringify(arredondar(objeto), null, 2) + '\n';
}
