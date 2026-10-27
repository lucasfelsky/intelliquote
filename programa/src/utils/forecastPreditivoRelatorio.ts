// Forecast preditivo (fase 0): relatorio do backtest em texto e em JSON. Numeros formatados a mao (virgula decimal, sem
// toLocaleString/Intl): a saida nao depende do locale da maquina. Sem --detalhe nao sai nenhum id de serie.
import type { LinhaResultado, ResultadoBacktest } from './forecastPreditivoBacktest';
import { AVISO_IDS, round6 } from './forecastPreditivoTipos';

export interface OpcoesRelatorio {
  detalhe: boolean;
  linhasRejeitadas?: number; // linhas/pontos da entrada rejeitados (contados no cabecalho)
}

export const AVISO_DETALHE = 'ids como vieram na entrada - nao colar em lugar publico';

// null/nao finito -> 'n/a'. Arredonda por Math.round (meio para cima, em modulo).
export function fmt(v: number | null, casas: number): string {
  if (v === null || !Number.isFinite(v)) return 'n/a';
  const escala = Math.pow(10, casas);
  const r = Math.round(Math.abs(v) * escala);
  const inteiro = Math.floor(r / escala);
  const frac = r - inteiro * escala;
  const corpo = casas > 0 ? `${inteiro},${String(frac).padStart(casas, '0')}` : String(inteiro);
  return v < 0 && r !== 0 ? `-${corpo}` : corpo;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${fmt(v * 100, 1)}%`);

const ROTULO_CRITERIOS =
  'Criterios: 1 amostra (>= 6 origens e >= 30 pares) | 2 WAPE LT <= 0,90 x planilha | 3 vies | 4 custo <= 0,95 x planilha | ' +
  '5 vitoria >= 55% | 6 itens A piores (listados) | 7 n/a (sem intervalo na fase 0) | 8 requer 2 rodadas';

function tabela(cabecalho: string[], linhas: string[][], direita: boolean[]): string[] {
  const larguras = cabecalho.map((c, i) => Math.max(c.length, ...linhas.map((l) => l[i].length)));
  const celula = (t: string, i: number) => (direita[i] ? t.padStart(larguras[i]) : t.padEnd(larguras[i]));
  const formatar = (l: string[]) => l.map(celula).join('  ').trimEnd();
  return [formatar(cabecalho), ...linhas.map(formatar)];
}

function textoPromovivel(l: LinhaResultado): string {
  if (l.promovivel === 'nao') return `nao (${l.criteriosFalhos.join(',')})`;
  return l.promovivel;
}

export function relatorioTexto(r: ResultadoBacktest, o: OpcoesRelatorio): string {
  const c = r.contagem;
  const saida: string[] = [
    `Forecast preditivo - backtest   versao ${r.versao}   config ${r.hashConfig.slice(0, 8)}   entrada ${r.hashEntrada.slice(0, 8)}`,
  ];
  if (o.detalhe) saida.push(`ATENCAO: ${AVISO_DETALHE}`);
  saida.push(
    `Series: ${c.series} (com previsao ${c.comPrevisao}, sem venda ${c.semVenda}, historico curto ${c.historicoCurto})   ` +
      `linhas rejeitadas ${o.linhasRejeitadas ?? 0}   origens ${r.origens}   horizonte ${r.opcoes.horizonte}   ` +
      `min-treino ${r.opcoes.minTreino}   mascara ${r.opcoes.usarMascara ? 'sim' : 'nao'}`,
    `Lead time padrao ${r.opcoes.leadTimePadraoDias} dias   razao falta/excesso ${fmt(r.opcoes.razaoFaltaExcesso, 2)}`,
    `Avisos: ${AVISO_IDS.map((a) => `${a} ${r.avisos[a]}`).join(' | ')}`,
    'Cobertura do intervalo: n/a (fase 0 sem intervalo)',
    '',
  );
  const cab = ['Segmento', 'Metodo', 'n', 'Origens', 'WAPE h1', 'WAPE h3', 'WAPE LT', 'Vies LT', 'MAE LT', 'Custo LT', 'Custo rel.', 'Vitoria', 'A piores', 'Promovivel'];
  const linhas = r.linhas.map((l) => [
    l.segmento,
    l.metodo,
    String(l.n),
    String(l.origens),
    fmt(l.wapeH1, 3),
    fmt(l.wapeH3, 3),
    fmt(l.wapeLT, 3),
    fmt(l.viesLT, 3),
    fmt(l.maeLT, 2),
    fmt(l.custoLT, 1),
    fmt(l.custoRel, 2),
    l.promovivel === 'referencia' ? '-' : pct(l.vitoria),
    String(l.itensAPiores.length),
    textoPromovivel(l),
  ]);
  saida.push(...tabela(cab, linhas, [false, false, true, true, true, true, true, true, true, true, true, true, true, false]));
  saida.push('', ROTULO_CRITERIOS);
  if (o.detalhe) {
    const piores = r.linhas.filter((l) => l.itensAPiores.length > 0);
    if (piores.length > 0) {
      saida.push('', 'Itens A piores que 1,25 x a planilha (WAPE LT):');
      for (const l of piores) saida.push(`  ${l.segmento} ${l.metodo}: ${l.itensAPiores.join(', ')}`);
    }
    saida.push('', 'Por serie (WAPE LT por metodo):');
    const metodos = r.opcoes.metodos;
    saida.push(
      ...tabela(
        ['Serie', 'Meses', 'Origens', 'ABC', 'XYZ', 'SBC', 'Avisos', ...metodos],
        r.porSerie.map((s) => [s.id, String(s.meses), String(s.origens), s.abc, s.xyz, s.sbc, s.avisos.join(',') || '-', ...metodos.map((m) => fmt(s.wapeLT[m] ?? null, 3))]),
        [false, true, true, false, false, false, false, ...metodos.map(() => true)],
      ),
    );
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

export function relatorioJson(r: ResultadoBacktest, o: OpcoesRelatorio): string {
  const objeto: Record<string, unknown> = {
    versao: r.versao,
    hashConfig: r.hashConfig,
    hashEntrada: r.hashEntrada,
    opcoes: {
      horizonte: r.opcoes.horizonte,
      minTreino: r.opcoes.minTreino,
      metodos: r.opcoes.metodos,
      leadTimePadraoDias: r.opcoes.leadTimePadraoDias,
      razaoFaltaExcesso: r.opcoes.razaoFaltaExcesso,
      usarMascara: r.opcoes.usarMascara,
    },
    linhasRejeitadas: o.linhasRejeitadas ?? 0,
    origens: r.origens,
    contagem: r.contagem,
    avisos: Object.fromEntries(AVISO_IDS.map((a) => [a, r.avisos[a]])),
    linhas: r.linhas.map((l) => ({
      segmento: l.segmento,
      metodo: l.metodo,
      n: l.n,
      origens: l.origens,
      wapeH1: l.wapeH1,
      wapeH3: l.wapeH3,
      wapeLT: l.wapeLT,
      viesLT: l.viesLT,
      maeLT: l.maeLT,
      custoLT: l.custoLT,
      custoRel: l.custoRel,
      vitoria: l.vitoria,
      criteriosFalhos: l.criteriosFalhos,
      promovivel: l.promovivel,
      nItensAPiores: l.itensAPiores.length,
      ...(o.detalhe ? { itensAPiores: l.itensAPiores } : {}),
    })),
  };
  if (o.detalhe) {
    objeto.aviso = AVISO_DETALHE;
    objeto.porSerie = r.porSerie;
  }
  return JSON.stringify(arredondar(objeto), null, 2) + '\n';
}
