import { dataValida } from '@/services/forecastDemandaComercial';
import {
  FORECAST_OCASIAO_DIAS_MAX,
  FORECAST_OCASIAO_DURACAO_MAX_DIAS,
  FORECAST_OCASIAO_NOME_MAX,
  FORECAST_OCASIAO_OBS_MAX,
  type ForecastOcasiao,
  type ForecastOcasiaoEdicao,
  type ForecastOcasiaoEscopo,
  type ForecastOcasiaoEtapa,
  type ForecastOcasiaoNova,
  type ForecastOcasiaoOcorrencia,
} from '@/services/forecastOcasioes';
import { dataBr } from './forecastPainel';
import type { PreenchimentoModelo } from './forecastOcasioesModelos';

// Logica pura das ocasioes que afetam o lead time (sem React, sem rede). Datas por texto AAAA-MM-DD; a aritmetica
// usa so Date.UTC + getUTC* (nunca o fuso local) e o relogio entra por argumento.

// ---------- rotulos ----------

export const ROTULO_ETAPA: Readonly<Record<ForecastOcasiaoEtapa, string>> = {
  total: 'Lead time inteiro',
  prontidao: 'Prontidão',
  embarque: 'Embarque',
  transito: 'Trânsito',
  liberacao: 'Liberação',
};
export const ETAPAS_EM_ORDEM: readonly ForecastOcasiaoEtapa[] = ['total', 'prontidao', 'embarque', 'transito', 'liberacao'];

export const ROTULO_ESCOPO: Readonly<Record<ForecastOcasiaoEscopo, string>> = {
  global: 'Todas as fontes',
  pais: 'Um país',
  fonte: 'Uma fonte',
};

export type SituacaoOcasiao = 'ativa' | 'passada' | 'inativa';
export const ROTULO_SITUACAO: Readonly<Record<SituacaoOcasiao, string>> = {
  ativa: 'Ativa',
  passada: 'Passada',
  inativa: 'Inativa',
};

export const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

// ---------- paises ----------

export const PAISES_COMUNS = ['CN', 'IN', 'DE', 'US', 'IT', 'ES', 'FR', 'NL', 'BE', 'JP', 'KR', 'MX'] as const;

const SEM_PAIS = '—';

function criarNomes(fallback: 'code' | 'none'): Intl.DisplayNames | null {
  try {
    return typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames('pt-BR', { type: 'region', fallback })
      : null;
  } catch {
    return null;
  }
}
const NOMES = criarNomes('code');
const NOMES_ESTRITO = criarNomes('none');

/** Nome do pais em portugues, sem o codigo (cai no proprio codigo quando o navegador nao conhece). */
export function nomeSimplesDoPais(codigo: string): string {
  try {
    return NOMES?.of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

/** `China (CN)`; `—` sem pais. */
export function nomeDoPais(codigo: string | null | undefined): string {
  if (!codigo) return SEM_PAIS;
  const nome = nomeSimplesDoPais(codigo);
  return nome === codigo ? codigo : `${nome} (${codigo})`;
}

/** O navegador conhece o codigo ISO-2? (`XX` nao). Sem `Intl.DisplayNames` nao ha como conferir: aceita. */
export function paisReconhecido(codigo: string): boolean {
  if (!NOMES_ESTRITO) return true;
  try {
    return NOMES_ESTRITO.of(codigo) !== undefined;
  } catch {
    return false;
  }
}

export function lerCodigoPais(texto: string): { codigo: string } | { erro: string } {
  const codigo = texto.trim().toUpperCase();
  if (codigo === '') return { erro: 'Informe o país da ocasião.' };
  if (!/^[A-Z]{2}$/.test(codigo)) {
    return { erro: 'O código do país deve ter 2 letras (ISO 3166-1 alfa-2, ex.: CN).' };
  }
  if (!paisReconhecido(codigo)) return { erro: 'Código de país não reconhecido. Confira o código ISO de 2 letras.' };
  return { codigo };
}

export interface OpcaoPais {
  codigo: string;
  nome: string;
}

/** Paises comuns + os ja usados nas fontes/ocasioes, sem repetir, por nome. */
export function opcoesDePais(usados: Iterable<string>): OpcaoPais[] {
  const codigos = new Set<string>(PAISES_COMUNS);
  for (const c of usados) if (c) codigos.add(c);
  return [...codigos]
    .map((codigo) => ({ codigo, nome: nomeSimplesDoPais(codigo) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo));
}

/** Pais de cada fonte, juntado no web a partir de `GET /forecast/sources`. `null` = resposta que nao e lista. */
export function paisPorFonte(lista: unknown): Map<number, string | null> | null {
  if (!Array.isArray(lista)) return null;
  const mapa = new Map<number, string | null>();
  for (const item of lista as Array<{ id?: unknown; countryCode?: unknown }>) {
    if (item && typeof item.id === 'number') {
      mapa.set(item.id, typeof item.countryCode === 'string' && item.countryCode !== '' ? item.countryCode : null);
    }
  }
  return mapa;
}

export function contarSemPais(ids: readonly number[], mapa: ReadonlyMap<number, string | null>): number {
  return ids.filter((id) => !mapa.get(id)).length;
}

export function textoFontesSemPais(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? '1 fonte sem país: ocasiões por país não a alcançam.'
    : `${n} fontes sem país: ocasiões por país não as alcançam.`;
}

// ---------- datas ----------

/** Unica porta para o relogio: quem chama passa a Date. Data LOCAL (nunca em UTC: vira o dia anterior no fuso do Brasil). */
export function chaveDataLocal(agora: Date): string {
  const ano = String(agora.getFullYear()).padStart(4, '0');
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

const MS_DIA = 86_400_000;

function utcDe(chave: string): number {
  return Date.UTC(Number(chave.slice(0, 4)), Number(chave.slice(5, 7)) - 1, Number(chave.slice(8, 10)));
}

export function somarDias(chave: string, n: number): string {
  const d = new Date(utcDe(chave) + n * MS_DIA);
  const ano = String(d.getUTCFullYear()).padStart(4, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(d.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** `ate - de` em dias inteiros (negativo se `ate` vem antes). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((utcDe(ate) - utcDe(de)) / MS_DIA);
}

export function anoDe(chave: string): number {
  return Number(chave.slice(0, 4));
}

/** Dias 0..120 inteiros (so digitos). */
export function lerDiasOcasiao(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= FORECAST_OCASIAO_DIAS_MAX ? n : null;
}

// ---------- formulario ----------

export type CampoOcasiao = 'nome' | 'escopo' | 'pais' | 'fonte' | 'inicio' | 'fim' | 'dias' | 'observacao';
export const ORDEM_CAMPOS_OCASIAO: readonly CampoOcasiao[] = [
  'nome',
  'escopo',
  'pais',
  'fonte',
  'inicio',
  'fim',
  'dias',
  'observacao',
];

export interface CamposOcasiao {
  nome: string;
  escopo: ForecastOcasiaoEscopo;
  pais: string;
  /** Id da fonte como texto, ou ''. */
  fonte: string;
  inicio: string;
  fim: string;
  anual: boolean;
  etapa: ForecastOcasiaoEtapa;
  dias: string;
  observacao: string;
}

export const CAMPOS_VAZIOS: CamposOcasiao = {
  nome: '',
  escopo: 'global',
  pais: '',
  fonte: '',
  inicio: '',
  fim: '',
  anual: false,
  etapa: 'total',
  dias: '',
  observacao: '',
};

export function camposDaOcasiao(o: ForecastOcasiao): CamposOcasiao {
  return {
    nome: o.name,
    escopo: o.scopeType,
    pais: o.countryCode ?? '',
    fonte: o.sourceId === null ? '' : String(o.sourceId),
    inicio: o.startDate,
    fim: o.endDate,
    anual: o.recurrence === 'anual',
    etapa: o.component,
    dias: o.effectKind === 'dias' ? String(o.effectValue) : '',
    observacao: o.notes ?? '',
  };
}

export function camposDoModelo(p: PreenchimentoModelo): CamposOcasiao {
  return {
    ...CAMPOS_VAZIOS,
    nome: p.nome,
    escopo: p.escopo,
    pais: p.pais ?? '',
    inicio: p.inicio,
    fim: p.fim,
    anual: p.anual,
    etapa: p.etapa,
    dias: String(p.dias),
  };
}

export interface ValoresOcasiao {
  nome: string;
  escopo: ForecastOcasiaoEscopo;
  pais: string | null;
  fonteId: number | null;
  inicio: string;
  fim: string;
  anual: boolean;
  etapa: ForecastOcasiaoEtapa;
  /** `null` quando o efeito esta bloqueado (ocasiao em percentual: a tela nao edita). */
  dias: number | null;
  observacao: string | null;
}

export interface ContextoValidacao {
  efeitoBloqueado: boolean;
  fontesAtivas: ReadonlySet<number>;
  /** Fonte da ocasiao em edicao (continua valida mesmo inativa, desde que nao seja trocada). */
  fonteOriginal: number | null;
  /** Alcance e pais da ocasiao em edicao: o que nao mudou nao e reconferido (o backend ja aceitou). */
  escopoOriginal?: ForecastOcasiaoEscopo | null;
  paisOriginal?: string | null;
}

export interface OcasiaoValidada {
  erros: Partial<Record<CampoOcasiao, string>>;
  /** Preenchido so sem erro. */
  valores: ValoresOcasiao | null;
}

export function validarOcasiao(campos: CamposOcasiao, ctx: ContextoValidacao): OcasiaoValidada {
  const erros: OcasiaoValidada['erros'] = {};

  const nome = campos.nome.trim();
  if (nome === '') erros.nome = 'Informe o nome da ocasião.';
  else if (nome.length > FORECAST_OCASIAO_NOME_MAX) {
    erros.nome = `O nome aceita no máximo ${FORECAST_OCASIAO_NOME_MAX} caracteres.`;
  }

  let pais: string | null = null;
  if (campos.escopo === 'pais') {
    const digitado = campos.pais.trim().toUpperCase();
    if (ctx.escopoOriginal === 'pais' && ctx.paisOriginal && digitado === ctx.paisOriginal) {
      pais = ctx.paisOriginal;
    } else {
      const lido = lerCodigoPais(campos.pais);
      if ('erro' in lido) erros.pais = lido.erro;
      else pais = lido.codigo;
    }
  }

  let fonteId: number | null = null;
  if (campos.escopo === 'fonte') {
    const fonteRemovidaIntacta =
      ctx.escopoOriginal === 'fonte' && ctx.fonteOriginal === null && campos.fonte.trim() === '';
    if (fonteRemovidaIntacta) fonteId = null;
    else if (campos.fonte.trim() === '') erros.fonte = 'Informe a fonte da ocasião.';
    else {
      fonteId = Number(campos.fonte);
      if (!ctx.fontesAtivas.has(fonteId) && fonteId !== ctx.fonteOriginal) {
        erros.fonte = 'Fonte não encontrada ou inativa.';
      }
    }
  }

  const inicioOk = campos.inicio !== '' && dataValida(campos.inicio);
  const fimOk = campos.fim !== '' && dataValida(campos.fim);
  if (!inicioOk) erros.inicio = 'Informe a data de início.';
  if (!fimOk) erros.fim = 'Informe a data de fim.';
  if (inicioOk && fimOk) {
    if (campos.fim < campos.inicio) erros.fim = 'O fim não pode ser anterior ao início.';
    else if (diasEntre(campos.inicio, campos.fim) + 1 > FORECAST_OCASIAO_DURACAO_MAX_DIAS) {
      erros.fim = `O período aceita no máximo ${FORECAST_OCASIAO_DURACAO_MAX_DIAS} dias.`;
    }
  }

  let dias: number | null = null;
  if (!ctx.efeitoBloqueado) {
    dias = lerDiasOcasiao(campos.dias);
    if (dias === null) erros.dias = `Informe os dias como inteiro de 0 a ${FORECAST_OCASIAO_DIAS_MAX}.`;
  }

  const observacao = campos.observacao.trim();
  if (observacao.length > FORECAST_OCASIAO_OBS_MAX) {
    erros.observacao = `A observação aceita no máximo ${FORECAST_OCASIAO_OBS_MAX} caracteres.`;
  }

  if (Object.keys(erros).length > 0) return { erros, valores: null };
  return {
    erros,
    valores: {
      nome,
      escopo: campos.escopo,
      pais,
      fonteId,
      inicio: campos.inicio,
      fim: campos.fim,
      anual: campos.anual,
      etapa: campos.etapa,
      dias,
      observacao: observacao === '' ? null : observacao,
    },
  };
}

export function montarCorpoNovo(v: ValoresOcasiao): ForecastOcasiaoNova {
  return {
    name: v.nome,
    scopeType: v.escopo,
    countryCode: v.escopo === 'pais' ? v.pais : null,
    sourceId: v.escopo === 'fonte' ? v.fonteId : null,
    startDate: v.inicio,
    endDate: v.fim,
    recurrence: v.anual ? 'anual' : 'nenhuma',
    component: v.etapa,
    effectKind: 'dias',
    effectValue: v.dias ?? 0,
    notes: v.observacao,
  };
}

/**
 * So os blocos alterados (o PATCH do backend e em blocos atomicos: escopo, periodo e efeito). Nao reenviar o escopo
 * evita o 400 de "fonte inativa" quando so o nome de uma ocasiao de fonte inativada muda. Percentual nunca e enviado.
 * Nada mudou = `null`.
 */
export function montarEdicao(original: ForecastOcasiao, v: ValoresOcasiao): ForecastOcasiaoEdicao | null {
  const corpo = montarCorpoNovo(v);
  const edicao: ForecastOcasiaoEdicao = {};
  if (corpo.name !== original.name) edicao.name = corpo.name;
  if (
    corpo.scopeType !== original.scopeType ||
    corpo.countryCode !== original.countryCode ||
    corpo.sourceId !== original.sourceId
  ) {
    edicao.scopeType = corpo.scopeType;
    edicao.countryCode = corpo.countryCode;
    edicao.sourceId = corpo.sourceId;
  }
  if (corpo.startDate !== original.startDate || corpo.endDate !== original.endDate) {
    edicao.startDate = corpo.startDate;
    edicao.endDate = corpo.endDate;
  }
  if (corpo.recurrence !== original.recurrence) edicao.recurrence = corpo.recurrence;
  if (corpo.component !== original.component) edicao.component = corpo.component;
  if (original.effectKind === 'dias' && v.dias !== null && v.dias !== original.effectValue) {
    edicao.effectKind = 'dias';
    edicao.effectValue = v.dias;
  }
  if (corpo.notes !== (original.notes ?? null)) edicao.notes = corpo.notes;
  return Object.keys(edicao).length === 0 ? null : edicao;
}

// ---------- situacao, filtros e ordem ----------

export function situacaoDaOcasiao(o: ForecastOcasiao, hoje: string): SituacaoOcasiao {
  if (!o.isActive) return 'inativa';
  if (o.recurrence === 'nenhuma' && o.endDate < hoje) return 'passada';
  return 'ativa';
}

export interface FiltrosOcasioes {
  situacao: SituacaoOcasiao | 'todas';
  escopo: 'todos' | ForecastOcasiaoEscopo;
  pais: string;
  /** Id da fonte como texto, ou ''. */
  fonte: string;
  ano: 'todos' | number;
}

export const FILTROS_PADRAO: FiltrosOcasioes = { situacao: 'ativa', escopo: 'todos', pais: '', fonte: '', ano: 'todos' };

export function filtrarOcasioes(lista: readonly ForecastOcasiao[], f: FiltrosOcasioes, hoje: string): ForecastOcasiao[] {
  return lista.filter((o) => {
    if (f.situacao !== 'todas' && situacaoDaOcasiao(o, hoje) !== f.situacao) return false;
    if (f.escopo !== 'todos' && o.scopeType !== f.escopo) return false;
    if (f.pais !== '' && !(o.scopeType === 'pais' && o.countryCode === f.pais)) return false;
    if (f.fonte !== '' && !(o.scopeType === 'fonte' && o.sourceId === Number(f.fonte))) return false;
    if (f.ano !== 'todos') {
      const ano = String(f.ano).padStart(4, '0');
      // Texto contra texto; nao e expansao de recorrencia (a anual vale em qualquer ano).
      const noAno = o.startDate <= `${ano}-12-31` && o.endDate >= `${ano}-01-01`;
      if (o.recurrence !== 'anual' && !noAno) return false;
    }
    return true;
  });
}

/** Ano anterior, o corrente e os 2 seguintes. */
export function anosDoFiltro(hoje: string): number[] {
  const ano = anoDe(hoje);
  return [ano - 1, ano, ano + 1, ano + 2];
}

export function ordenarOcasioes(lista: readonly ForecastOcasiao[]): ForecastOcasiao[] {
  return [...lista].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'pt-BR') || a.id - b.id,
  );
}

// ---------- textos de linha ----------

const ddmm = (chave: string): string => `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;

export function textoPeriodo(o: Pick<ForecastOcasiao, 'startDate' | 'endDate' | 'recurrence'>): string {
  if (o.recurrence === 'anual') {
    return o.startDate === o.endDate
      ? `${ddmm(o.startDate)}, todo ano`
      : `${ddmm(o.startDate)} a ${ddmm(o.endDate)}, todo ano`;
  }
  return o.startDate === o.endDate ? dataBr(o.startDate) : `${dataBr(o.startDate)} a ${dataBr(o.endDate)}`;
}

const NUMERO_BR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function textoEfeito(o: Pick<ForecastOcasiao, 'effectKind' | 'effectValue'>): string {
  if (o.effectKind === 'percentual') return `+${NUMERO_BR.format(o.effectValue)}% da etapa`;
  return o.effectValue === 1 ? '+1 dia' : `+${o.effectValue} dias`;
}

export function textoAlcance(
  o: Pick<ForecastOcasiao, 'scopeType' | 'countryCode' | 'source'>,
  nomeDoPaisFn: (codigo: string | null | undefined) => string,
): string {
  if (o.scopeType === 'global') return 'Todas as fontes';
  if (o.scopeType === 'pais') return `País: ${nomeDoPaisFn(o.countryCode)}`;
  if (!o.source) return 'Fonte removida';
  return `Fonte: ${o.source.name}${o.source.isActive ? '' : ' (inativa)'}`;
}

// ---------- linha do tempo ----------

function diasDoAno(ano: number): number {
  return diasEntre(`${String(ano).padStart(4, '0')}-01-01`, `${String(ano + 1).padStart(4, '0')}-01-01`);
}

/** `grid-template-columns` com 1 coluna por mes, proporcional aos dias (fev = 29 em bissexto). */
export function colunasDosMeses(ano: number): string {
  return Array.from({ length: 12 }, (_, m) => `${new Date(Date.UTC(ano, m + 1, 0)).getUTCDate()}fr`).join(' ');
}

const arredondar2 = (n: number): number => Math.round(n * 100) / 100;

/** Posicao e largura (% do ano) da ocorrencia recortada em 01/01..31/12 de `ano`; fora do ano = `null`. */
export function segmentoNoAno(
  oc: ForecastOcasiaoOcorrencia,
  ano: number,
): { esquerdaPct: number; larguraPct: number } | null {
  const a = String(ano).padStart(4, '0');
  const primeiro = `${a}-01-01`;
  const inicio = oc.inicio > primeiro ? oc.inicio : primeiro;
  const ultimo = `${a}-12-31`;
  const fim = oc.fim < ultimo ? oc.fim : ultimo;
  if (inicio > fim) return null;
  const total = diasDoAno(ano);
  return {
    esquerdaPct: arredondar2((diasEntre(primeiro, inicio) / total) * 100),
    larguraPct: arredondar2(((diasEntre(inicio, fim) + 1) / total) * 100),
  };
}

/** Meio do dia de hoje, em % do ano; outro ano = `null`. */
export function posicaoDeHoje(hoje: string, ano: number): number | null {
  if (anoDe(hoje) !== ano) return null;
  const primeiro = `${String(ano).padStart(4, '0')}-01-01`;
  return arredondar2(((diasEntre(primeiro, hoje) + 0.5) / diasDoAno(ano)) * 100);
}
