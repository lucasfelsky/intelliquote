// Funcoes puras do painel do Forecast (sem React, sem Date local).
// Datas sao sempre manipuladas pelo texto AAAA-MM-DD: new Date(...) / toISOString()
// mostram o dia anterior em BRT.
import type { ForecastDivergencia, ForecastLinha, ForecastMonths, ForecastSnapshotDetail, ForecastStatus } from '@/services/forecast';

// ---------- formatos iguais aos da planilha ----------
const INT_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const KG_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const UMA_CASA_BR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const QUATRO_CASAS_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
const MES_NOME = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Inteiro com milhar pt-BR; nulo ou 0 viram "-" (formato contabil da planilha). */
export function contabil(v: number | null | undefined): string {
  if (v === null || v === undefined || Math.round(v) === 0) return '-';
  return INT_BR.format(Math.round(v));
}

/** 1 casa pt-BR; nulo ou 0 viram "-". */
export function contabil1(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return '-';
  return UMA_CASA_BR.format(v);
}

/** 1 casa com virgula e sem milhar (como a planilha); nulo = #N/D. */
export function d1(v: number | null | undefined): string {
  if (v === null || v === undefined) return '#N/D';
  return v.toFixed(1).replace('.', ',');
}

/** Inteiro para a memoria de calculo (sinal "−" tipografico); nulo = "—". */
export function inteiroBr(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const arredondado = Math.round(v);
  return (arredondado < 0 ? '−' : '') + INT_BR.format(Math.abs(arredondado));
}

/** kg de embalagem: ate 3 casas pt-BR (0,5 / 2,25 / 25), sem arredondar para inteiro; nulo = "—". */
export function kgBr(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return KG_BR.format(v);
}

/** AAAA-MM-DD (ou ISO completo) -> [ano, mes (1-12), dia]; nulo se o texto nao for uma data. */
function partesDaData(data: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** AAAA-MM-DD -> dd/mm/aaaa; nulo = #N/D. */
export function dataBr(data: string | null | undefined): string {
  const partes = data ? partesDaData(data) : null;
  if (!partes) return '#N/D';
  const [ano, mes, dia] = partes;
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
}

/** AAAA-MM-DD -> dd-mmm (19-jan); nulo = #N/D. */
export function dMmm(data: string | null | undefined): string {
  const partes = data ? partesDaData(data) : null;
  if (!partes) return '#N/D';
  const [, mes, dia] = partes;
  return `${String(dia).padStart(2, '0')}-${MES_ABREV[mes - 1] ?? '???'}`;
}

/** Coluna AA (meses de estoque): numero em 1 casa, texto como veio. */
export function textoAA(v: number | string): string {
  return typeof v === 'number' ? d1(v) : v;
}

function indiceDoMes(baseDate: string, deslocamento: number): { ano: number; mes: number } | null {
  const partes = partesDaData(baseDate);
  if (!partes) return null;
  const total = partes[0] * 12 + (partes[1] - 1) + deslocamento;
  return { ano: Math.floor(total / 12), mes: total % 12 };
}

/** 6 rotulos mmm/aaaa a partir do mes da data base (out/2026 ... mar/2027). */
export function mesesDaProjecao(baseDate: string): string[] {
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const alvo = indiceDoMes(baseDate, i);
    return alvo ? `${MES_ABREV[alvo.mes]}/${alvo.ano}` : '—';
  });
}

/** 'AAAA-MM' -> 'mmm/aaaa' (out/2026); invalido = '—'. */
export function mesAbrevDoAnoMes(anoMes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(anoMes);
  const abrev = m ? MES_ABREV[Number(m[2]) - 1] : undefined;
  return m && abrev ? `${abrev}/${m[1]}` : '—';
}

/** Nome do mes (minusculo, por extenso) `deslocamento` meses depois da data base. */
export function nomeDoMes(baseDate: string, deslocamento: number): string {
  const alvo = indiceDoMes(baseDate, deslocamento);
  return alvo ? (MES_NOME[alvo.mes] ?? '') : '';
}

// ---------- colunas (mesma ordem e grupos da aba FORECAST (MACRO)) ----------
export type GrupoId = 'cod' | 'cons' | 'trim' | 'sem' | 'anual' | 'est' | 'cheg' | 'mx' | 'prog' | 'comp';

export const GRUPOS: Record<GrupoId, string> = {
  cod: 'CÓD.',
  cons: 'CONSUMO',
  trim: 'TRIM.',
  sem: 'SEM.',
  anual: 'ANUAL',
  est: 'ESTOQUE',
  cheg: 'CHEGADAS',
  mx: 'MESES X',
  prog: 'PROGRAMAÇÕES',
  comp: 'COMPRAS',
};

export interface ColunaPainel {
  id: string;
  grupo: GrupoId;
  rotulo: string;
  /** Letra da coluna na planilha quando o motor a calcula (liga a celula as divergencias). */
  colunaPlanilha?: string;
  largura: number;
  esquerda?: boolean;
  texto: (linha: ForecastLinha) => string;
  /** Classes extras da celula. */
  classe?: (linha: ForecastLinha) => string;
  /** Classe do destaque (pilula/selo) que envolve o texto da celula. */
  destaque?: (linha: ForecastLinha) => string;
}

type ColunaDefinida = ColunaPainel & { oculta?: boolean };

const LETRAS_CHEGADA = ['V', 'W', 'X', 'Y', 'Z'] as const;
const LETRAS_PROGRAMACAO = ['AC', 'AD', 'AE', 'AF'] as const;

/** P (venda do mes atual) acima da media trimestral Q: mesmo destaque da planilha (P > Q). */
export function vendaAcimaDaMedia(linha: Pick<ForecastLinha, 'P' | 'Q'>): boolean {
  return linha.P > linha.Q;
}

function definirColunas(months: ForecastMonths): ColunaDefinida[] {
  const consumo = (i: number) => months.consumo[i] ?? '';
  const historico = (i: number): ColunaDefinida => ({
    id: `h${i}`,
    grupo: 'cons',
    rotulo: consumo(i),
    largura: 70,
    oculta: i < 3,
    texto: (l) => contabil(l.historico?.[i]),
  });
  return [
    {
      id: 'cod',
      grupo: 'cod',
      rotulo: 'EMB.1–7',
      largura: 240,
      esquerda: true,
      oculta: true,
      texto: (l) => l.codigos.join(' · '),
    },
    historico(0),
    historico(1),
    historico(2),
    historico(3),
    historico(4),
    { id: 'O', grupo: 'cons', rotulo: consumo(5), colunaPlanilha: 'O', largura: 70, texto: (l) => contabil(l.O) },
    {
      id: 'P',
      grupo: 'cons',
      rotulo: consumo(6),
      colunaPlanilha: 'P',
      largura: 90,
      texto: (l) => contabil(l.P),
      classe: (l) => (vendaAcimaDaMedia(l) ? 'fc-cell--acima-media' : ''),
    },
    { id: 'Q', grupo: 'trim', rotulo: 'MED.', colunaPlanilha: 'Q', largura: 76, texto: (l) => d1(l.Q) },
    { id: 'R', grupo: 'sem', rotulo: 'MED.', colunaPlanilha: 'R', largura: 76, texto: (l) => d1(l.R) },
    { id: 'S', grupo: 'anual', rotulo: 'MED.', colunaPlanilha: 'S', largura: 76, texto: (l) => d1(l.S) },
    {
      id: 'T',
      grupo: 'est',
      rotulo: 'SEGURANÇA',
      colunaPlanilha: 'T',
      largura: 92,
      texto: (l) => d1(l.T),
      classe: () => 'fc-cell--seg',
    },
    { id: 'U', grupo: 'est', rotulo: 'TOTAL', colunaPlanilha: 'U', largura: 84, texto: (l) => contabil(l.U) },
    ...LETRAS_CHEGADA.map(
      (letra, i): ColunaDefinida => ({
        id: letra,
        grupo: 'cheg',
        rotulo: months.chegada[i] ?? '',
        colunaPlanilha: letra,
        largura: 70,
        texto: (l) => contabil(l.chegadas[i]),
      }),
    ),
    { id: 'AA', grupo: 'mx', rotulo: 'ESTOQUE', colunaPlanilha: 'AA', largura: 70, texto: (l) => textoAA(l.AA) },
    ...LETRAS_PROGRAMACAO.map(
      (letra, i): ColunaDefinida => ({
        id: letra,
        grupo: 'prog',
        rotulo: months.programacao[i] ?? '',
        colunaPlanilha: letra,
        largura: 70,
        texto: (l) => contabil(l.programacoes[i]),
      }),
    ),
    {
      id: 'AN',
      grupo: 'comp',
      rotulo: 'DEMANDA',
      colunaPlanilha: 'AN',
      largura: 100,
      texto: (l) => (l.AN === null ? '#N/D' : contabil1(l.AN)),
      destaque: (l) => (l.AN !== null && l.AN <= 0 ? 'fc-pill--falta' : ''),
    },
    {
      id: 'analiseForecast',
      grupo: 'comp',
      rotulo: 'ANÁLISE FORECAST',
      largura: 124,
      texto: (l) => contabil1(l.analiseForecast),
      classe: (l) => (l.analiseForecast ? 'fc-cell--forte' : ''),
    },
    { id: 'AP', grupo: 'comp', rotulo: 'CHEG.', largura: 72, texto: (l) => dMmm(l.AP) },
    {
      id: 'precoFixo',
      grupo: 'comp',
      rotulo: 'PREÇO FIXO',
      largura: 96,
      texto: (l) => (l.precoFixo ? 'Fixo' : ''),
      destaque: (l) => (l.precoFixo ? 'fc-selo' : ''),
    },
    { id: 'fonte', grupo: 'comp', rotulo: 'FONTE', largura: 130, esquerda: true, texto: (l) => l.fonte },
    {
      id: 'obs',
      grupo: 'comp',
      rotulo: 'OBS.',
      largura: 300,
      esquerda: true,
      texto: (l) => l.obs ?? '',
      classe: () => 'fc-cell--obs',
    },
  ];
}

/** Colunas do painel na ordem da planilha; as ocultas (EMB.1-7 e 3 meses mais antigos) so com `ocultas`. */
export function colunasDoPainel(months: ForecastMonths, opcoes: { ocultas: boolean }): ColunaPainel[] {
  return definirColunas(months)
    .filter((c) => opcoes.ocultas || !c.oculta)
    .map(({ oculta: _oculta, ...coluna }) => coluna);
}

// ---------- filtros e busca ----------
export type FiltroId = 'todos' | 'demanda' | 'falta' | 'andamento';

export interface FiltroDef {
  id: FiltroId;
  rotulo: (baseDate: string) => string;
  teste: (linha: ForecastLinha) => boolean;
}

export const FILTROS: readonly FiltroDef[] = [
  { id: 'todos', rotulo: () => 'Todos', teste: () => true },
  {
    // Mesma regra do relatorio de compras (backend): sem consumo e demanda = 0 fica fora; sem consumo
    // e demanda < 0 (programacao maior que o estoque) entra.
    id: 'demanda',
    rotulo: () => 'Demanda ≤ 0',
    teste: (l) => l.AN !== null && l.AN <= 0 && (l.Q > 0 || l.AN < 0),
  },
  {
    id: 'falta',
    rotulo: (baseDate) => `Falta até ${nomeDoMes(baseDate, 3)}`,
    teste: (l) => l.Q > 0 && l.projecao.slice(0, 4).some((v) => v < 0),
  },
  { id: 'andamento', rotulo: () => 'Em andamento', teste: (l) => l.status !== 'nao' },
];

export function contarPorFiltro(linhas: readonly ForecastLinha[]): Record<FiltroId, number> {
  const contagem: Record<FiltroId, number> = { todos: 0, demanda: 0, falta: 0, andamento: 0 };
  for (const filtro of FILTROS) {
    contagem[filtro.id] = linhas.filter(filtro.teste).length;
  }
  return contagem;
}

/** Sem acento, sem caixa, sem espacos nas pontas. */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

/** Busca por item, qualquer codigo ou fonte. Termo vazio casa tudo. */
export function casaBusca(linha: ForecastLinha, termo: string): boolean {
  const alvo = normalizarBusca(termo);
  if (alvo === '') return true;
  return (
    normalizarBusca(linha.item).includes(alvo) ||
    normalizarBusca(linha.fonte).includes(alvo) ||
    linha.codigos.some((codigo) => normalizarBusca(codigo).includes(alvo))
  );
}

// ---------- status da compra ----------
export const STATUS_ROTULO: Record<ForecastStatus, string> = {
  nao: 'Cotação não enviada',
  cotando: 'Cotando',
  confirmado: 'Confirmado, aguarda PO',
  po: 'PO enviada',
  preco: 'Só atualização de preço',
};

export const STATUS_ORDEM: readonly ForecastStatus[] = ['nao', 'cotando', 'confirmado', 'po', 'preco'];

// ---------- alertas ----------
/** Mes da projecao vs. media trimestral Q (regra exata da planilha, sem guarda de Q > 0). */
export function alertaProjecao(v: number, q: number): 'falta' | 'atencao' | null {
  if (v < q) return 'falta';
  if (v < 3 * q) return 'atencao';
  return null;
}

export interface Risco {
  tom: 'ok' | 'aviso' | 'erro';
  texto: string;
}

export function risco(linha: Pick<ForecastLinha, 'projecao' | 'AP'>, baseDate: string): Risco {
  const meses = mesesDaProjecao(baseDate);
  const rup = linha.projecao.findIndex((v) => v < 0);
  if (rup < 0) {
    return { tom: 'ok', texto: `Sem falta projetada até ${meses[5] ?? ''}.` };
  }
  const mesDaFalta = meses[rup] ?? '';
  const cheg = linha.AP ? partesDaData(linha.AP) : null;
  const base = partesDaData(baseDate);
  if (!cheg || !base) {
    return {
      tom: 'aviso',
      texto: `Falta em ${mesDaFalta}. Fonte sem lead time: não dá para saber se uma PO nova chega a tempo.`,
    };
  }
  const idxCheg = cheg[0] * 12 + cheg[1] - (base[0] * 12 + base[1]);
  if (rup < idxCheg) {
    return {
      tom: 'erro',
      texto: `Falta em ${mesDaFalta}, antes de uma compra nova chegar (${dataBr(linha.AP)}).`,
    };
  }
  return {
    tom: 'aviso',
    texto: `Falta em ${mesDaFalta}. Uma PO feita hoje chega em ${dataBr(linha.AP)}, a tempo.`,
  };
}

// ---------- selo de conferencia ----------
export interface SeloConferencia {
  tom: 'ok' | 'erro' | 'neutro';
  titulo: string;
  detalhe: string;
  nota?: string;
}

const NUMERO_BR = new Intl.NumberFormat('pt-BR');

export function textoDoSelo(detail: Pick<ForecastSnapshotDetail, 'conferencia' | 'half'>): SeloConferencia {
  const { conferencia, half } = detail;
  if (conferencia === null) {
    return {
      tom: 'neutro',
      titulo: 'Quinzena gerada dos relatórios DBCorp — sem planilha para conferir.',
      detalhe: '',
    };
  }
  const ok = conferencia.batem === conferencia.celulas;
  let detalhe = `${NUMERO_BR.format(conferencia.batem)} de ${NUMERO_BR.format(conferencia.celulas)} células batem`;
  if (!ok) {
    detalhe += ` · ${NUMERO_BR.format(conferencia.totalDivergencias)} divergem`;
    if (conferencia.totalDivergencias > conferencia.divergencias.length) {
      detalhe += ` (as primeiras ${conferencia.divergencias.length} estão marcadas na grade)`;
    }
  }
  if (half === 1) {
    return {
      tom: ok ? 'ok' : 'erro',
      titulo: 'Conferência motor × planilha (regra da planilha, 2ª quinzena)',
      detalhe,
      nota: 'Nesta 1ª quinzena o consumo do mês (AG) usa a média trimestral; a conferência usa a regra da planilha.',
    };
  }
  return {
    tom: ok ? 'ok' : 'erro',
    titulo: ok ? 'Cálculo idêntico ao da planilha' : 'Há diferenças com a planilha',
    detalhe,
  };
}

function valorDeDivergencia(v: number | string | null): string {
  if (v === null || v === '') return '(vazio)';
  return typeof v === 'number' ? QUATRO_CASAS_BR.format(v) : v;
}

export function descreverDivergencia(d: Pick<ForecastDivergencia, 'esperado' | 'calculado'>): string {
  return `Planilha: ${valorDeDivergencia(d.esperado)} · motor: ${valorDeDivergencia(d.calculado)}`;
}

// ---------- memoria de calculo ----------
export type TomValor = 'neg' | 'falta' | 'atencao' | null;

export interface PassoDaMemoria {
  titulo: string;
  coluna: string;
  conta: string;
  resultado: string;
  tom: TomValor;
  /** So no passo "Meses seguintes": cada mes da projecao com o alerta da planilha. */
  meses?: Array<{ rotulo: string; valor: string; tom: TomValor }>;
}

export function passosDaMemoria(linha: ForecastLinha, half: number, baseDate: string): PassoDaMemoria[] {
  const h = linha.historico ?? [];
  const rotulos = mesesDaProjecao(baseDate);
  const somaChegadas = linha.chegadas.reduce((a, b) => a + b, 0);
  const somaProgramacoes = linha.programacoes.reduce((a, b) => a + b, 0);
  const final0 = linha.projecao[0] ?? 0;
  const seguintes = linha.projecao.slice(1, 6);
  const ultimo = linha.projecao[5] ?? 0;
  return [
    {
      titulo: 'Média trimestral',
      coluna: 'col. Q',
      conta: `(${inteiroBr(h[3])} + ${inteiroBr(h[4])} + ${inteiroBr(linha.O)}) ÷ 3`,
      resultado: d1(linha.Q),
      tom: null,
    },
    {
      titulo: 'Consumo do mês atual',
      coluna: 'col. AG',
      conta:
        half === 1
          ? `1ª quinzena: igual à média trimestral (${d1(linha.Q)})`
          : `maior entre a média (${d1(linha.Q)}) e a venda até o dia 15 (${inteiroBr(linha.P)})`,
      resultado: d1(linha.AG),
      tom: null,
    },
    {
      titulo: `Final de ${nomeDoMes(baseDate, 0)}`,
      coluna: 'col. AH',
      conta: `${inteiroBr(linha.U)} estoque + ${inteiroBr(linha.chegadas[0])} chegadas − ${inteiroBr(linha.programacoes[0])} programações − ${d1(linha.AG)}`,
      resultado: inteiroBr(final0),
      tom: alertaProjecao(final0, linha.Q),
    },
    {
      titulo: 'Meses seguintes',
      coluna: 'col. AI–AM',
      conta: 'saldo + chegadas − média − programações',
      resultado: `${inteiroBr(ultimo)} ${rotulos[5] ?? ''}`.trim(),
      tom: alertaProjecao(ultimo, linha.Q),
      meses: seguintes.map((valor, i) => ({
        rotulo: rotulos[i + 1] ?? '',
        valor: inteiroBr(valor),
        tom: alertaProjecao(valor, linha.Q),
      })),
    },
    {
      titulo: 'Segurança',
      coluna: 'col. T',
      conta:
        linha.AQ === null
          ? 'fonte sem lead time cadastrado'
          : `${d1(linha.Q)} ÷ 30 × ${linha.AQ} dias de lead time`,
      resultado: d1(linha.T),
      tom: null,
    },
    {
      titulo: 'Demanda',
      coluna: 'col. AN',
      conta:
        linha.T === null
          ? 'fonte sem lead time: sem segurança, a demanda não é calculada'
          : `${inteiroBr(linha.U)} + ${inteiroBr(somaChegadas)} chegadas − ${d1(linha.T)} segurança − ${d1(linha.Q)} média − ${inteiroBr(somaProgramacoes)} programações`,
      resultado: linha.AN === null ? '#N/D' : contabil1(linha.AN),
      tom: linha.AN !== null && linha.AN < 0 ? 'neg' : null,
    },
  ];
}
