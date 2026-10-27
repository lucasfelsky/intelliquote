import {
  FORECAST_OCASIAO_EFEITOS,
  FORECAST_OCASIAO_ESCOPOS,
  FORECAST_OCASIAO_ETAPAS,
  FORECAST_OCASIAO_ETAPAS_SEQUENCIAIS,
  FORECAST_OCASIAO_PONTO_FIXO_MAX_ITERACOES,
  FORECAST_OCASIAO_RECORRENCIAS,
} from '../constants/forecast';
import { somarDias } from './forecastMonths';
import { isValidDateKey } from './supplierDocumentDates';

// Ocasioes que afetam o lead time (feriado, greve, fechamento de porto, safra). Util PURA: sem Prisma, sem relogio, sem
// excecao por dado ruim. Tudo em date key (YYYY-MM-DD) e aritmetica UTC (nunca conversao ISO de data local). Importada
// pelo relatorio de compras (PR 3) e pelo backtest do preditivo. Nao muta as entradas.

export type EscopoOcasiao = (typeof FORECAST_OCASIAO_ESCOPOS)[number];
export type RecorrenciaOcasiao = (typeof FORECAST_OCASIAO_RECORRENCIAS)[number];
export type EtapaOcasiao = (typeof FORECAST_OCASIAO_ETAPAS)[number];
export type EtapaSequencial = (typeof FORECAST_OCASIAO_ETAPAS_SEQUENCIAIS)[number];
export type EfeitoOcasiao = (typeof FORECAST_OCASIAO_EFEITOS)[number];

export interface OcasiaoLeadTime {
  id: number;
  escopo: EscopoOcasiao;
  countryCode: string | null;
  sourceId: number | null;
  inicio: string;
  fim: string;
  recorrencia: RecorrenciaOcasiao;
  etapa: EtapaOcasiao;
  efeito: EfeitoOcasiao;
  valor: number;
  ativa: boolean;
}

export interface FonteLeadTime {
  id: number;
  countryCode: string | null;
  ativa: boolean;
  leadTimeDays: number | null;
  readinessDays: number | null;
  shippingDays: number | null;
  transitDays: number | null;
  clearanceDays: number | null;
}

export interface Ocorrencia {
  inicio: string;
  fim: string;
}

export interface OcasiaoAplicada {
  id: number;
  etapa: EtapaOcasiao;
  dias: number;
}

export interface LeadTimeAjustado {
  leadTime: number;
  extraDias: number;
  leadTimeAjustado: number;
  componentesAusentes: boolean;
  ocasioes: OcasiaoAplicada[];
}

export interface DataLimiteAjustada {
  extraDias: number;
  leadTimeAjustado: number;
  dataLimiteAjustada: string;
  antesDeHoje: boolean;
  emissaoAvaliada: string;
  chegadaEstimada: string;
  iteracoes: number;
  oscilou: boolean;
  componentesAusentes: boolean;
  ocasioes: OcasiaoAplicada[];
}

const anoDe = (key: string): number => Number(key.slice(0, 4));

const ehBissexto = (ano: number): boolean => (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;

// Data do mes/dia ('MM-DD') no ano `ano`; 29/02 em ano nao bissexto vira 28/02.
function chaveNoAno(ano: number, mesDia: string): string {
  const mesDiaAjustado = mesDia === '02-29' && !ehBissexto(ano) ? '02-28' : mesDia;
  return `${String(ano).padStart(4, '0')}-${mesDiaAjustado}`;
}

// Ocorrencias do periodo que intersectam [de, ate] (inclusivo). `nenhuma` = o proprio periodo; `anual` = o periodo
// repetido em todo ano (o ano de referencia e o do inicio), inclusive os anteriores e os posteriores a ele. Ordenadas
// por inicio. Entrada invalida ou janela invertida = [].
export function ocorrenciasNaJanela(
  o: Pick<OcasiaoLeadTime, 'inicio' | 'fim' | 'recorrencia'>,
  de: string,
  ate: string,
): Ocorrencia[] {
  if (!isValidDateKey(o.inicio) || !isValidDateKey(o.fim) || !isValidDateKey(de) || !isValidDateKey(ate)) {
    return [];
  }
  if (o.fim < o.inicio || ate < de) {
    return [];
  }
  const intersecta = (inicio: string, fim: string) => inicio <= ate && fim >= de;

  if (o.recorrencia !== 'anual') {
    return intersecta(o.inicio, o.fim) ? [{ inicio: o.inicio, fim: o.fim }] : [];
  }

  const viradas = anoDe(o.fim) - anoDe(o.inicio);
  const inicioMesDia = o.inicio.slice(5);
  const fimMesDia = o.fim.slice(5);
  const ocorrencias: Ocorrencia[] = [];
  // O ano anterior ao da janela entra porque uma ocorrencia que cruza a virada do ano pode invadir o comeco dela.
  for (let ano = anoDe(de) - 1; ano <= anoDe(ate); ano += 1) {
    const inicio = chaveNoAno(ano, inicioMesDia);
    const fim = chaveNoAno(ano + viradas, fimMesDia);
    if (intersecta(inicio, fim)) {
      ocorrencias.push({ inicio, fim });
    }
  }
  return ocorrencias;
}

// Fonte inativa nunca e afetada; ocasiao inativa nunca conta. `pais` exige o pais da fonte preenchido.
export function ocasiaoAlcancaFonte(o: OcasiaoLeadTime, fonte: FonteLeadTime): boolean {
  if (!o.ativa || !fonte.ativa) {
    return false;
  }
  if (o.escopo === 'global') {
    return true;
  }
  if (o.escopo === 'pais') {
    return fonte.countryCode !== null && fonte.countryCode === o.countryCode;
  }
  if (o.escopo === 'fonte') {
    return o.sourceId === fonte.id;
  }
  return false;
}

// Ocasioes que alcancam a fonte e tem ao menos uma ocorrencia em [de, ate] (segmentacao do backtest do preditivo).
export function ocasioesNoPeriodo(
  fonte: FonteLeadTime,
  ocasioes: readonly OcasiaoLeadTime[],
  de: string,
  ate: string,
): Array<{ id: number; etapa: EtapaOcasiao; ocorrencias: Ocorrencia[] }> {
  const resultado: Array<{ id: number; etapa: EtapaOcasiao; ocorrencias: Ocorrencia[] }> = [];
  for (const o of [...ocasioes].sort((a, b) => a.id - b.id)) {
    if (!ocasiaoAlcancaFonte(o, fonte)) {
      continue;
    }
    const ocorrencias = ocorrenciasNaJanela(o, de, ate);
    if (ocorrencias.length > 0) {
      resultado.push({ id: o.id, etapa: o.etapa, ocorrencias });
    }
  }
  return resultado;
}

// Dias da ocasiao sobre uma base (a etapa, ou o lead time no `total`). Percentual em aritmetica inteira: valor*100 vira
// inteiro antes de multiplicar, senao 10% de 30 dava 3.0000000000000004 e arredondava para 4.
function efeitoEmDias(o: OcasiaoLeadTime, base: number): number {
  if (o.efeito === 'percentual') {
    return Math.ceil((Math.round(o.valor * 100) * base) / 10000);
  }
  return Math.ceil(o.valor);
}

function diasDaEtapa(fonte: FonteLeadTime, etapa: EtapaSequencial): number | null {
  switch (etapa) {
    case 'prontidao':
      return fonte.readinessDays;
    case 'embarque':
      return fonte.shippingDays;
    case 'transito':
      return fonte.transitDays;
    default:
      return fonte.clearanceDays;
  }
}

// Lead time ajustado para um pedido emitido em `emissao`. Linha do tempo a partir da emissao: prontidao -> embarque ->
// transito -> liberacao (etapa de N dias ocupa [ini, ini+N-1]; N=0 = janela vazia), depois a folga (LT - soma das
// etapas); a chegada e emissao + LT (mesma convencao do motor). Cada etapa e avaliada com o inicio JA empurrado pelas
// ocasioes das etapas anteriores; a ocasiao soma uma vez se alguma ocorrencia intersecta a janela BASE da etapa. `total`
// e avaliado no fim, contra [emissao, emissao + LT + extras das etapas - 1]. Soma sem teto. null = fonte sem lead time.
export function leadTimeAjustado(
  fonte: FonteLeadTime,
  ocasioes: readonly OcasiaoLeadTime[],
  emissao: string,
): LeadTimeAjustado | null {
  const leadTime = fonte.leadTimeDays;
  if (leadTime === null) {
    return null;
  }

  const aplicaveis = ocasioes.filter((o) => ocasiaoAlcancaFonte(o, fonte)).sort((a, b) => a.id - b.id);
  const aplicadas: OcasiaoAplicada[] = [];
  let extraDias = 0;

  // Janela [emissao + deslocamento, + dias - 1]; dias <= 0 = vazia (nao cruza).
  const cruza = (o: OcasiaoLeadTime, deslocamento: number, dias: number): boolean =>
    dias > 0 &&
    ocorrenciasNaJanela(o, somarDias(emissao, deslocamento), somarDias(emissao, deslocamento + dias - 1)).length > 0;
  const aplica = (o: OcasiaoLeadTime, base: number): number => {
    const dias = efeitoEmDias(o, base);
    aplicadas.push({ id: o.id, etapa: o.etapa, dias });
    extraDias += dias;
    return dias;
  };

  const duracoes = FORECAST_OCASIAO_ETAPAS_SEQUENCIAIS.map((etapa) => diasDaEtapa(fonte, etapa));
  const somaEtapas = duracoes.reduce<number>((acc, dias) => acc + (dias ?? 0), 0);
  const componentesAusentes = duracoes.some((dias) => dias === null) || somaEtapas > leadTime;

  if (componentesAusentes) {
    // Sem a linha do tempo confiavel: conservador, toda ocasiao de etapa e avaliada contra o lead time inteiro.
    for (const etapa of FORECAST_OCASIAO_ETAPAS_SEQUENCIAIS) {
      for (const o of aplicaveis) {
        if (o.etapa === etapa && cruza(o, 0, leadTime)) {
          aplica(o, leadTime);
        }
      }
    }
  } else {
    let cursor = 0;
    FORECAST_OCASIAO_ETAPAS_SEQUENCIAIS.forEach((etapa, indice) => {
      const dias = duracoes[indice] ?? 0;
      let extraDaEtapa = 0;
      for (const o of aplicaveis) {
        if (o.etapa === etapa && cruza(o, cursor, dias)) {
          extraDaEtapa += aplica(o, dias);
        }
      }
      cursor += dias + extraDaEtapa;
    });
  }

  const janelaTotal = leadTime + extraDias;
  for (const o of aplicaveis) {
    if (o.etapa === 'total' && cruza(o, 0, janelaTotal)) {
      aplica(o, leadTime);
    }
  }

  return {
    leadTime,
    extraDias,
    leadTimeAjustado: leadTime + extraDias,
    componentesAusentes,
    ocasioes: aplicadas,
  };
}

// Data-limite do pedido com as ocasioes. O lead time ajustado depende da emissao e a emissao depende do lead time
// ajustado: ponto fixo em ate FORECAST_OCASIAO_PONTO_FIXO_MAX_ITERACOES avaliacoes. Emissao nunca antes de `hoje` (a
// avaliacao usa o dia de hoje; `antesDeHoje` avisa que a data-limite ja passou). Se nao estabilizar, `oscilou` e vale o
// MAIOR extra (o mais conservador; o primeiro em empate). null = fonte sem lead time.
export function dataLimiteAjustada(e: {
  fonte: FonteLeadTime;
  ocasioes: readonly OcasiaoLeadTime[];
  ruptura: string;
  hoje: string;
}): DataLimiteAjustada | null {
  const leadTime = e.fonte.leadTimeDays;
  if (leadTime === null) {
    return null;
  }
  const maisTarde = (a: string, b: string) => (a >= b ? a : b);

  const avaliacoes: Array<{ emissao: string; resultado: LeadTimeAjustado }> = [];
  let emissao = maisTarde(somarDias(e.ruptura, -leadTime), e.hoje);
  let estavel = false;
  for (let k = 0; k < FORECAST_OCASIAO_PONTO_FIXO_MAX_ITERACOES; k += 1) {
    const resultado = leadTimeAjustado(e.fonte, e.ocasioes, emissao);
    if (resultado === null) {
      return null;
    }
    avaliacoes.push({ emissao, resultado });
    const proxima = maisTarde(somarDias(e.ruptura, -(leadTime + resultado.extraDias)), e.hoje);
    if (proxima === emissao) {
      estavel = true;
      break;
    }
    emissao = proxima;
  }

  let escolhida = avaliacoes[avaliacoes.length - 1];
  if (!estavel) {
    escolhida = avaliacoes.reduce((melhor, atual) =>
      atual.resultado.extraDias > melhor.resultado.extraDias ? atual : melhor,
    );
  }

  const { extraDias, ocasioes, componentesAusentes } = escolhida.resultado;
  const limite = somarDias(e.ruptura, -(leadTime + extraDias));
  return {
    extraDias,
    leadTimeAjustado: leadTime + extraDias,
    dataLimiteAjustada: limite,
    antesDeHoje: limite < e.hoje,
    emissaoAvaliada: escolhida.emissao,
    chegadaEstimada: somarDias(escolhida.emissao, leadTime + extraDias),
    iteracoes: avaliacoes.length,
    oscilou: !estavel,
    componentesAusentes,
    ocasioes,
  };
}
