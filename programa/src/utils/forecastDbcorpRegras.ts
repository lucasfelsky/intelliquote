// Regras do FUP (chegadas) da quinzena DBCorp: funcoes PURAS sobre linhas ja normalizadas, sem exceljs e
// sem Prisma. O .xlsx vira `FupLinha[]` em `parseFup` (forecastDbcorp.ts); o gateway DBCorp futuro monta o
// mesmo `FupLinha[]` a partir do Postgres D-1 e chama `aplicarRegrasFup` igual.
//
// Regra F3 (decidida pelo Lucas em 2026-10-22; revoga a parte da D2 que incluia as atracadas e usava
// ETA FINAL como data): `ATRAC. AG. LIBERAÇÃO` e linhas com `ETA FINAL` preenchida ficam FORA; chegada =
// ETA (CHEGADA), senao ETD + N dias, senao DATA PRONTIDAO + N dias (as duas ultimas marcadas ESTIMADA). N = prazo da
// FONTE do codigo (PR 5A: digitado no resumo da importacao > padrao salvo na fonte > 35).
import {
  FORECAST_DBCORP_ETA_POR_ETD_DIAS,
  FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS,
  FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL,
  FORECAST_DBCORP_FUP_REGRA,
  FORECAST_DBCORP_FUP_STATUS_EXCLUIDOS,
  FORECAST_DBCORP_FUP_STATUS_IGNORADO,
  FORECAST_DBCORP_JANELA_CHEGADA_MESES,
  FORECAST_DBCORP_MAX_DETALHES,
} from '../constants/forecast';
import { rotuloDoYearMonth, somarDias, yearMonthsDaJanela } from './forecastMonths';
import type { Bruto } from './forecastXlsx';
import { isValidDateKey } from './supplierDocumentDates';
import type { Lancamento, LancamentoMensal } from './forecastTypes';

// --- Helpers compartilhados com forecastDbcorp.ts ---------------------------------------------------

export interface ResumoRelatorio {
  lidas: number; // linhas de dados nao vazias
  usadas: number;
  ignoradas: Record<string, number>; // motivo -> linhas
  total: number; // soma das quantidades das linhas usadas
  avisos: string[];
  erros: string[];
}

export interface LinhasKg {
  linhas: number;
  kg: number;
}

export type DataDaCelula =
  | { tipo: 'vazia' }
  | { tipo: 'data'; key: string }
  | { tipo: 'invalida' };

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const fmtKg = (n: number) => Math.round(n).toLocaleString('pt-BR');

export const plural = (n: number, singular: string, pluralForm: string) => (n === 1 ? singular : pluralForm);

// NFD sem acento, espacos colapsados, trim, maiusculas (deposito, empresa, status).
export function normalizeDbcorpText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Data de uma celula: o exceljs entrega Date (lida como date key UTC por valor()); texto
// dd/mm/aaaa e aceito; vazio ou so espacos = vazia; qualquer outro texto/numero = invalida.
export function dateKeyDaCelula(bruto: Bruto): DataDaCelula {
  if (bruto === null) return { tipo: 'vazia' };
  if (typeof bruto === 'number') return { tipo: 'invalida' };
  const texto = bruto.trim();
  if (texto === '') return { tipo: 'vazia' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return isValidDateKey(texto) ? { tipo: 'data', key: texto } : { tipo: 'invalida' };
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (br) {
    const key = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    return isValidDateKey(key) ? { tipo: 'data', key } : { tipo: 'invalida' };
  }
  return { tipo: 'invalida' };
}

export class Acumulador {
  lidas = 0;
  usadas = 0;
  total = 0;
  ignoradas: Record<string, number> = {};

  ignorar(motivo: string): void {
    this.lidas++;
    this.ignoradas[motivo] = (this.ignoradas[motivo] ?? 0) + 1;
  }

  usar(qtd: number): void {
    this.lidas++;
    this.usadas++;
    this.total += qtd;
  }

  resumo(avisos: string[], erros: string[]): ResumoRelatorio {
    return {
      lidas: this.lidas,
      usadas: this.usadas,
      ignoradas: this.ignoradas,
      total: round6(this.total),
      avisos,
      erros,
    };
  }
}

// Soma por chave -> lista ordenada por kg decrescente (empate: nome).
export function ordenarPorKg<T extends { kg: number }>(items: T[], nome: (item: T) => string): T[] {
  return items.sort((a, b) => b.kg - a.kg || nome(a).localeCompare(nome(b)));
}

// --- DATA PRONTIDAO ('MON DDth') --------------------------------------------------------------------

export type Prontidao = { tipo: 'vazia' } | { tipo: 'data'; key: string } | { tipo: 'nao_reconhecida' };

// Mes pelas 3 primeiras letras, ingles e portugues (SEPTEMBER, JULY e SEPT caem pelas 3 letras).
const MESES_PRONTIDAO: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  FEV: 2,
  MAR: 3,
  APR: 4,
  ABR: 4,
  MAY: 5,
  MAI: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  AGO: 8,
  SEP: 9,
  SET: 9,
  OCT: 10,
  OUT: 10,
  NOV: 11,
  DEC: 12,
  DEZ: 12,
};

const PADRAO_PRONTIDAO = /^([A-Z]{3})[A-Z]*\.?\s*-?\s*(\d{1,2})\s*(?:ST|ND|RD|TH)?\b/;

const pad2 = (n: number) => String(n).padStart(2, '0');

// Interpreta o texto da DATA PRONTIDAO. Aceita date key / dd/mm/aaaa (celula de data, ou campo de data
// real do gateway) e o texto sem ano 'MON DDth' (ex.: 'SEP 30TH', 'Sep 3rd', 'OCT - 15TH', 'out 1').
// O ano e inferido: referencia = dataPo (se valida) senao baseDate; se o mes da prontidao for mais de 1
// mes antes do mes da referencia, virou o ano. Qualquer outro texto ('ASAP', 'WITH PO 123-45') =
// nao_reconhecida.
export function parseProntidao(texto: string, dataPo: string | null, baseDate: string): Prontidao {
  const normalizado = normalizeDbcorpText(texto);
  if (normalizado === '') return { tipo: 'vazia' };

  const data = dateKeyDaCelula(normalizado);
  if (data.tipo === 'data') return data;

  const m = PADRAO_PRONTIDAO.exec(normalizado);
  if (!m) return { tipo: 'nao_reconhecida' };
  const mes = MESES_PRONTIDAO[m[1]];
  if (mes === undefined) return { tipo: 'nao_reconhecida' };
  const dia = Number(m[2]);

  const referencia = dataPo !== null && isValidDateKey(dataPo) ? dataPo : baseDate;
  if (!isValidDateKey(referencia)) return { tipo: 'nao_reconhecida' };
  let ano = Number(referencia.slice(0, 4));
  const mesReferencia = Number(referencia.slice(5, 7));
  if (mes < mesReferencia - 1) ano += 1;

  const key = `${ano}-${pad2(mes)}-${pad2(dia)}`;
  return isValidDateKey(key) ? { tipo: 'data', key } : { tipo: 'nao_reconhecida' };
}

// --- Regra F3 ---------------------------------------------------------------------------------------

export interface FupLinha {
  linha: number; // numero da linha na planilha (ou id no gateway), para o detalhe
  status: string; // cru
  codigo: string; // normalizado; '' = sem codigo
  kg: number | null; // null = nao numerico
  dataPo: DataDaCelula;
  prontidao: string; // texto cru ou date key; '' = vazia
  etd: DataDaCelula;
  eta: DataDaCelula;
  etaFinal: DataDaCelula;
}

export type ChegadaFup = LancamentoMensal & { estimada?: 'etd' | 'prontidao' };

// --- Prazo das chegadas estimadas, por fonte (PR 5A) -------------------------------------------------

// Dias de DATA PRONTIDAO / ETD ate a chegada.
export interface PrazoChegada {
  prontidaoDias: number;
  etdDias: number;
}

export interface PrazosChegadaFup {
  padrao: PrazoChegada; // fonte sem prazo proprio e codigo sem fonte
  fonteDoCodigo: ReadonlyMap<string, number>; // codigo (normalizado) -> id da fonte do produto ativo
  porFonte: ReadonlyMap<number, PrazoChegada>; // id da fonte -> prazo ja resolvido
}

export const PRAZO_CHEGADA_PADRAO: PrazoChegada = {
  prontidaoDias: FORECAST_DBCORP_ETA_POR_PRONTIDAO_DIAS,
  etdDias: FORECAST_DBCORP_ETA_POR_ETD_DIAS,
};

// Sem fontes: todo codigo usa o padrao (35/35), igual a regra F3 original.
export const PRAZOS_CHEGADA_PADRAO: PrazosChegadaFup = {
  padrao: PRAZO_CHEGADA_PADRAO,
  fonteDoCodigo: new Map(),
  porFonte: new Map(),
};

export interface PrazoSalvoDaFonte {
  sourceId: number;
  prontidaoDias: number | null;
  etdDias: number | null;
}

export interface PrazoEditado {
  sourceId: number;
  prontidaoDias: number;
  etdDias: number;
}

// Precedencia por fonte e por coluna: valor digitado > padrao salvo na fonte > padrao (35).
export function resolverPrazosChegada(args: {
  padrao: PrazoChegada;
  salvos: readonly PrazoSalvoDaFonte[];
  editados: readonly PrazoEditado[];
}): Map<number, PrazoChegada> {
  const editados = new Map(args.editados.map((e) => [e.sourceId, e]));
  const salvos = new Map(args.salvos.map((s) => [s.sourceId, s]));
  const resolvido = new Map<number, PrazoChegada>();
  for (const id of new Set([...salvos.keys(), ...editados.keys()])) {
    const salvo = salvos.get(id);
    const editado = editados.get(id);
    resolvido.set(id, {
      prontidaoDias: editado?.prontidaoDias ?? salvo?.prontidaoDias ?? args.padrao.prontidaoDias,
      etdDias: editado?.etdDias ?? salvo?.etdDias ?? args.padrao.etdDias,
    });
  }
  return resolvido;
}

export interface EstimadasDaFonte {
  fonteId: number | null; // null = codigo sem produto ativo ou produto sem fonte
  // Linhas que DEPENDEM do prazo (sem ETA, com ETD / DATA PRONTIDAO valida), antes da janela: o conjunto nao muda
  // ao editar os dias.
  prontidao: LinhasKg;
  etd: LinhasKg;
}

export interface FontePrazoInfo {
  sourceId: number;
  nome: string;
  salvo: { prontidaoDias: number | null; etdDias: number | null };
}

export interface ResumoPrazosEstimativa {
  padrao: PrazoChegada;
  fontes: Array<{
    sourceId: number;
    nome: string;
    salvo: { prontidaoDias: number | null; etdDias: number | null };
    usado: PrazoChegada;
    prontidao: LinhasKg;
    etd: LinhasKg;
  }>;
  semFonte: { prontidao: LinhasKg; etd: LinhasKg };
  // Fontes do corpo cujo prazo usado difere do padrao salvo (ou 35): serao gravadas no confirm.
  padroesAlterados: number;
}

export interface MudancaDePrazo {
  sourceId: number;
  arrivalFromReadinessDays?: number;
  arrivalFromEtdDays?: number;
}

// Fontes (entre as pedidas) cujo prazo usado difere do que a proxima importacao abriria (salvo ?? padrao): so a
// coluna que mudou entra.
export function mudancasDePrazo(args: {
  padrao: PrazoChegada;
  fontes: readonly FontePrazoInfo[];
  porFonte: ReadonlyMap<number, PrazoChegada>;
  sourceIds: readonly number[];
}): MudancaDePrazo[] {
  const pedidas = new Set(args.sourceIds);
  const mudancas: MudancaDePrazo[] = [];
  for (const fonte of args.fontes) {
    if (!pedidas.has(fonte.sourceId)) continue;
    const usado = args.porFonte.get(fonte.sourceId);
    if (!usado) continue;
    const mudanca: MudancaDePrazo = { sourceId: fonte.sourceId };
    if (usado.prontidaoDias !== (fonte.salvo.prontidaoDias ?? args.padrao.prontidaoDias)) {
      mudanca.arrivalFromReadinessDays = usado.prontidaoDias;
    }
    if (usado.etdDias !== (fonte.salvo.etdDias ?? args.padrao.etdDias)) {
      mudanca.arrivalFromEtdDays = usado.etdDias;
    }
    if (mudanca.arrivalFromReadinessDays !== undefined || mudanca.arrivalFromEtdDays !== undefined) {
      mudancas.push(mudanca);
    }
  }
  return mudancas;
}

// Tabela do resumo: so fontes com pelo menos uma linha estimada; ordem kg decrescente (empate: nome).
export function resumirPrazosEstimativa(args: {
  padrao: PrazoChegada;
  fontes: readonly FontePrazoInfo[];
  porFonte: ReadonlyMap<number, PrazoChegada>;
  estimadasPorFonte: readonly EstimadasDaFonte[];
  padroesAlterados: number;
}): ResumoPrazosEstimativa {
  const zero = (): LinhasKg => ({ linhas: 0, kg: 0 });
  const juntar = (alvo: LinhasKg, v: LinhasKg) => {
    alvo.linhas += v.linhas;
    alvo.kg += v.kg;
  };
  const conhecidas = new Map(args.fontes.map((f) => [f.sourceId, f]));
  const semFonte = { prontidao: zero(), etd: zero() };
  const fontes: ResumoPrazosEstimativa['fontes'] = [];
  for (const e of args.estimadasPorFonte) {
    const fonte = e.fonteId === null ? undefined : conhecidas.get(e.fonteId);
    if (!fonte) {
      juntar(semFonte.prontidao, e.prontidao);
      juntar(semFonte.etd, e.etd);
      continue;
    }
    fontes.push({
      sourceId: fonte.sourceId,
      nome: fonte.nome,
      salvo: fonte.salvo,
      usado: args.porFonte.get(fonte.sourceId) ?? args.padrao,
      prontidao: { linhas: e.prontidao.linhas, kg: round6(e.prontidao.kg) },
      etd: { linhas: e.etd.linhas, kg: round6(e.etd.kg) },
    });
  }
  fontes.sort((a, b) => b.prontidao.kg + b.etd.kg - (a.prontidao.kg + a.etd.kg) || a.nome.localeCompare(b.nome));
  return {
    padrao: args.padrao,
    fontes,
    semFonte: {
      prontidao: { linhas: semFonte.prontidao.linhas, kg: round6(semFonte.prontidao.kg) },
      etd: { linhas: semFonte.etd.linhas, kg: round6(semFonte.etd.kg) },
    },
    padroesAlterados: args.padroesAlterados,
  };
}

type PorStatusKg = Array<{ status: string; linhas: number; kg: number }>;

export interface ResultadoRegrasFup extends Omit<ResumoRelatorio, 'erros'> {
  linhas: ChegadaFup[];
  porStatus: Array<{ status: string; incluido: boolean; linhas: number; kg: number }>;
  estimadasPorEtd: LinhasKg;
  estimadasPorProntidao: LinhasKg;
  estimadasPorFonte: EstimadasDaFonte[];
  vencidasNoMesBase: LinhasKg;
  // Linhas nao concluidas sem ETA (CHEGADA), ETD (EMBARQUE) nem DATA PRONTIDAO: ficam DE FORA.
  semData: LinhasKg & { porStatus: PorStatusKg };
  depoisDaJanela: LinhasKg;
  excluidas: {
    atracadas: LinhasKg;
    etaFinalPreenchida: LinhasKg & { porStatus: PorStatusKg; depoisDaDataBase: LinhasKg };
  };
  prontidaoNaoReconhecida: LinhasKg & {
    detalhes: Array<{ linha: number; status: string; codigo: string; kg: number; texto: string }>;
    omitidos: number;
  };
  regra: {
    id: string;
    etaPorEtdDias: number;
    etaPorProntidaoDias: number;
    excluiEtaFinal: boolean;
    statusExcluidos: string[];
    // So quando chamada com prazos por fonte (5A): os dias acima passam a ser o padrao; cada fonte pode ter o seu.
    prazoPorFonte?: true;
  };
}

const STATUS_CONCLUIDO = normalizeDbcorpText(FORECAST_DBCORP_FUP_STATUS_IGNORADO);
const STATUS_EXCLUIDOS = new Set(FORECAST_DBCORP_FUP_STATUS_EXCLUIDOS.map(normalizeDbcorpText));
const TEXTO_DETALHE_MAX = 80;

export function aplicarRegrasFup(
  linhasFup: readonly FupLinha[],
  baseDate: string,
  prazos: PrazosChegadaFup = PRAZOS_CHEGADA_PADRAO,
): ResultadoRegrasFup {
  const zero = (): LinhasKg => ({ linhas: 0, kg: 0 });
  const somar = (alvo: LinhasKg, kg: number) => {
    alvo.linhas++;
    alvo.kg += kg;
  };
  const somarStatus = (
    mapa: Map<string, { status: string; linhas: number; kg: number }>,
    status: string,
    kg: number,
  ) => {
    const e = mapa.get(status) ?? { status, linhas: 0, kg: 0 };
    e.linhas++;
    e.kg += kg;
    mapa.set(status, e);
  };

  const janela = yearMonthsDaJanela(baseDate, FORECAST_DBCORP_JANELA_CHEGADA_MESES);
  const primeiro = janela[0];
  const ultimo = janela[janela.length - 1];
  const acc = new Acumulador();
  const linhas: ChegadaFup[] = [];
  const status = new Map<string, { status: string; incluido: boolean; linhas: number; kg: number }>();
  const semDataPorStatus = new Map<string, { status: string; linhas: number; kg: number }>();
  const etaFinalPorStatus = new Map<string, { status: string; linhas: number; kg: number }>();
  const estimadasEtd = zero();
  const estimadasProntidao = zero();
  const estimadasPorFonte = new Map<number | null, EstimadasDaFonte>();
  const estimarDaFonte = (fonteId: number | null, tipo: 'etd' | 'prontidao', kg: number) => {
    const e = estimadasPorFonte.get(fonteId) ?? { fonteId, prontidao: zero(), etd: zero() };
    somar(e[tipo], kg);
    estimadasPorFonte.set(fonteId, e);
  };
  const vencidas = zero();
  const semData = zero();
  const depois = zero();
  const atracadas = zero();
  const etaFinalExcluida = zero();
  const etaFinalDepoisDaBase = zero();
  const naoReconhecida = zero();
  const detalhes: ResultadoRegrasFup['prontidaoNaoReconhecida']['detalhes'] = [];
  let omitidos = 0;
  let datasInvalidas = 0;

  const dataValida = (d: DataDaCelula): string | null => {
    if (d.tipo === 'invalida') datasInvalidas++;
    return d.tipo === 'data' ? d.key : null;
  };

  for (const l of linhasFup) {
    // 1. sem codigo / kg nao numerico
    if (!l.codigo) {
      acc.ignorar('sem codigo');
      continue;
    }
    if (l.kg === null || !Number.isFinite(l.kg)) {
      acc.ignorar('quantidade nao numerica');
      continue;
    }
    const kg = l.kg;
    const nomeStatus = normalizeDbcorpText(l.status) || '(sem status)';
    const concluido = nomeStatus === STATUS_CONCLUIDO;
    const atracada = STATUS_EXCLUIDOS.has(nomeStatus);
    const entry = status.get(nomeStatus) ?? {
      status: nomeStatus,
      incluido: !concluido && !atracada,
      linhas: 0,
      kg: 0,
    };
    entry.linhas++;
    entry.kg += kg;
    status.set(nomeStatus, entry);

    // 2. concluido
    if (concluido) {
      acc.ignorar('status concluido');
      continue;
    }
    // 3. atracada aguardando liberacao
    if (atracada) {
      somar(atracadas, kg);
      acc.ignorar('atracada aguardando liberacao');
      continue;
    }

    // 4. ETA FINAL preenchida = ja chegou
    const etaFinal = dataValida(l.etaFinal);
    if (etaFinal !== null && FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL) {
      somar(etaFinalExcluida, kg);
      somarStatus(etaFinalPorStatus, nomeStatus, kg);
      if (etaFinal > baseDate) somar(etaFinalDepoisDaBase, kg);
      acc.ignorar('eta final preenchida');
      continue;
    }

    // 5. ETA (CHEGADA); 6. ETD + N; 7. DATA PRONTIDAO + N
    let chegada: string | null = null;
    let estimada: 'etd' | 'prontidao' | null = null;
    if (etaFinal !== null) chegada = etaFinal; // so com FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL = false
    if (chegada === null) chegada = dataValida(l.eta);
    if (chegada === null) {
      const etd = dataValida(l.etd);
      if (etd !== null) {
        const fonteId = prazos.fonteDoCodigo.get(l.codigo) ?? null;
        const dias = (fonteId === null ? undefined : prazos.porFonte.get(fonteId)) ?? prazos.padrao;
        chegada = somarDias(etd, dias.etdDias);
        estimada = 'etd';
        estimarDaFonte(fonteId, 'etd', kg);
      }
    }
    if (chegada === null) {
      const dataPo = l.dataPo.tipo === 'data' ? l.dataPo.key : null;
      const prontidao = parseProntidao(l.prontidao, dataPo, baseDate);
      if (prontidao.tipo === 'data') {
        const fonteId = prazos.fonteDoCodigo.get(l.codigo) ?? null;
        const dias = (fonteId === null ? undefined : prazos.porFonte.get(fonteId)) ?? prazos.padrao;
        chegada = somarDias(prontidao.key, dias.prontidaoDias);
        estimada = 'prontidao';
        estimarDaFonte(fonteId, 'prontidao', kg);
      } else if (prontidao.tipo === 'nao_reconhecida') {
        somar(naoReconhecida, kg);
        if (detalhes.length < FORECAST_DBCORP_MAX_DETALHES) {
          detalhes.push({
            linha: l.linha,
            status: nomeStatus,
            codigo: l.codigo,
            kg: round6(kg),
            texto: l.prontidao.trim().slice(0, TEXTO_DETALHE_MAX),
          });
        } else {
          omitidos++;
        }
        acc.ignorar('prontidao nao reconhecida');
        continue;
      }
    }
    if (chegada === null) {
      somar(semData, kg);
      somarStatus(semDataPorStatus, nomeStatus, kg);
      acc.ignorar('sem data');
      continue;
    }

    // 8. janela
    const yearMonth = chegada.slice(0, 7);
    if (yearMonth > ultimo) {
      somar(depois, kg);
      acc.ignorar('depois da janela');
      continue;
    }
    const vencida = yearMonth < primeiro;
    if (vencida) somar(vencidas, kg);
    if (estimada === 'etd') somar(estimadasEtd, kg);
    if (estimada === 'prontidao') somar(estimadasProntidao, kg);
    const chegadaFup: ChegadaFup = {
      codigo: l.codigo,
      qtd: kg,
      mes: rotuloDoYearMonth(vencida ? primeiro : yearMonth),
    };
    if (estimada !== null) chegadaFup.estimada = estimada;
    linhas.push(chegadaFup);
    acc.usar(kg);
  }

  const arredondar = (v: LinhasKg): LinhasKg => ({ linhas: v.linhas, kg: round6(v.kg) });
  const listaPorStatus = (mapa: Map<string, { status: string; linhas: number; kg: number }>): PorStatusKg =>
    ordenarPorKg(
      [...mapa.values()].map((s) => ({ ...s, kg: round6(s.kg) })),
      (s) => s.status,
    );
  const semDataStatus = listaPorStatus(semDataPorStatus);
  const etaFinalStatus = listaPorStatus(etaFinalPorStatus);
  const detalheDeStatus = (lista: PorStatusKg) =>
    lista.map((s) => `${s.status}: ${s.linhas} (${fmtKg(s.kg)} kg)`).join('; ');
  const n = (v: LinhasKg) => `${v.linhas} ${plural(v.linhas, 'linha', 'linhas')} (${fmtKg(v.kg)} kg)`;
  const statusExcluidos = [...FORECAST_DBCORP_FUP_STATUS_EXCLUIDOS] as string[];
  // Fontes com linha estimada cujo prazo difere do padrao (o aviso so cita "prazo da fonte" quando ha alguma).
  const comPrazoProprio = (tipo: 'etd' | 'prontidao') =>
    [...estimadasPorFonte.values()].filter((e) => {
      if (e.fonteId === null || e[tipo].linhas === 0) return false;
      const dias = prazos.porFonte.get(e.fonteId);
      if (!dias) return false;
      return tipo === 'etd' ? dias.etdDias !== prazos.padrao.etdDias : dias.prontidaoDias !== prazos.padrao.prontidaoDias;
    }).length;
  const sufixoDoPrazo = (tipo: 'etd' | 'prontidao') => {
    const padrao = tipo === 'etd' ? prazos.padrao.etdDias : prazos.padrao.prontidaoDias;
    const proprios = comPrazoProprio(tipo);
    if (proprios === 0) return `${padrao} dias`;
    return `prazo da fonte (padrão ${padrao} dias; ${proprios} ${plural(proprios, 'fonte com prazo próprio', 'fontes com prazo próprio')})`;
  };

  const avisos: string[] = [];
  if (atracadas.linhas > 0) {
    avisos.push(
      `FUP (regra ${FORECAST_DBCORP_FUP_REGRA}): ${n(atracadas)} com status ${statusExcluidos.join(', ')} ficaram de fora das chegadas (carga atracada; o estoque já pode contê-la).`,
    );
  }
  if (etaFinalExcluida.linhas > 0) {
    const depoisDaBase =
      etaFinalDepoisDaBase.linhas > 0
        ? ` Atenção: ${etaFinalDepoisDaBase.linhas} com ETA FINAL depois da data base.`
        : '';
    avisos.push(
      `FUP (regra ${FORECAST_DBCORP_FUP_REGRA}): ${n(etaFinalExcluida)} com ETA FINAL preenchida ficaram de fora das chegadas (já chegaram). Por status - ${detalheDeStatus(etaFinalStatus)}.${depoisDaBase}`,
    );
  }
  if (estimadasProntidao.linhas > 0) {
    avisos.push(
      `FUP: ${n(estimadasProntidao)} sem ETA (CHEGADA) nem ETD (EMBARQUE) usaram DATA PRONTIDÃO + ${sufixoDoPrazo('prontidao')} (ESTIMADA).`,
    );
  }
  if (estimadasEtd.linhas > 0) {
    avisos.push(
      `FUP: ${n(estimadasEtd)} sem ETA (CHEGADA) usaram ETD (EMBARQUE) + ${sufixoDoPrazo('etd')} (ESTIMADA).`,
    );
  }
  if (naoReconhecida.linhas > 0) {
    avisos.push(
      `FUP: ${n(naoReconhecida)} com DATA PRONTIDÃO não reconhecida ficaram de fora das chegadas - confira na pré-visualização.`,
    );
  }
  if (semData.linhas > 0) {
    avisos.push(
      `FUP: ${n(semData)} sem ETA (CHEGADA), ETD (EMBARQUE) nem DATA PRONTIDÃO ficaram de fora das chegadas. Por status - ${detalheDeStatus(semDataStatus)}.`,
    );
  }
  if (vencidas.linhas > 0) {
    avisos.push(
      `FUP: ${n(vencidas)} com chegada anterior ao mes base entraram no mes base (${rotuloDoYearMonth(primeiro)}).`,
    );
  }
  if (depois.linhas > 0) {
    avisos.push(
      `FUP: ${n(depois)} com chegada depois da janela de ${FORECAST_DBCORP_JANELA_CHEGADA_MESES} meses foram ignoradas.`,
    );
  }
  if (datasInvalidas > 0) {
    avisos.push(
      `FUP: ${datasInvalidas} ${plural(datasInvalidas, 'celula', 'celulas')} de data com texto invalido foram ignoradas.`,
    );
  }

  const porStatus = [...status.values()]
    .map((s) => ({ ...s, kg: round6(s.kg) }))
    .sort((a, b) => Number(b.incluido) - Number(a.incluido) || b.kg - a.kg || a.status.localeCompare(b.status));
  const { erros, ...resumo } = acc.resumo(avisos, []);
  void erros;
  return {
    ...resumo,
    linhas,
    porStatus,
    estimadasPorEtd: arredondar(estimadasEtd),
    estimadasPorProntidao: arredondar(estimadasProntidao),
    estimadasPorFonte: [...estimadasPorFonte.values()].map((e) => ({
      fonteId: e.fonteId,
      prontidao: arredondar(e.prontidao),
      etd: arredondar(e.etd),
    })),
    vencidasNoMesBase: arredondar(vencidas),
    semData: { ...arredondar(semData), porStatus: semDataStatus },
    depoisDaJanela: arredondar(depois),
    excluidas: {
      atracadas: arredondar(atracadas),
      etaFinalPreenchida: {
        ...arredondar(etaFinalExcluida),
        porStatus: etaFinalStatus,
        depoisDaDataBase: arredondar(etaFinalDepoisDaBase),
      },
    },
    prontidaoNaoReconhecida: { ...arredondar(naoReconhecida), detalhes, omitidos },
    regra: {
      id: FORECAST_DBCORP_FUP_REGRA,
      etaPorEtdDias: prazos.padrao.etdDias,
      etaPorProntidaoDias: prazos.padrao.prontidaoDias,
      excluiEtaFinal: FORECAST_DBCORP_FUP_EXCLUI_ETA_FINAL,
      statusExcluidos,
      ...(prazos === PRAZOS_CHEGADA_PADRAO ? {} : { prazoPorFonte: true as const }),
    },
  };
}

// Compra em aberto do FUP por codigo (regra dos pendentes de cadastro, 5C): TODA linha com codigo e kg numerico cujo
// status nao e CONCLUIDO. Diferente de `aplicarRegrasFup`, nao olha datas: entram tambem as atracadas, as com ETA FINAL
// preenchida, sem data, com DATA PRONTIDAO nao reconhecida e depois da janela (continuam sendo compra em aberto).
export function comprasEmAbertoDoFup(linhas: readonly FupLinha[]): Lancamento[] {
  const porCodigo = new Map<string, number>();
  for (const l of linhas) {
    if (!l.codigo || l.kg === null || !Number.isFinite(l.kg)) continue;
    if (normalizeDbcorpText(l.status) === STATUS_CONCLUIDO) continue;
    porCodigo.set(l.codigo, (porCodigo.get(l.codigo) ?? 0) + l.kg);
  }
  return [...porCodigo].map(([codigo, qtd]) => ({ codigo, qtd: round6(qtd) }));
}
