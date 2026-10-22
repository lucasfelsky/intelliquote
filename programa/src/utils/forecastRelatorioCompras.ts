// Relatorio de compras do Forecast (PR 2A): funcoes PURAS sobre a quinzena JA calculada pelo motor.
// Sem banco, sem HTTP e sem parser de origem; o campo `origin` so e repassado para exibicao.
//
// Regra de ruptura (estimativa mensal-linear; trocar a regra = mexer so em `dataDeRuptura`):
//  - `projecao[i]` = saldo no FIM do mes base+i (i = 0..5). Consumo do mes: AG no mes base, Q nos demais.
//  - Disponivel antes do consumo do mes: D_i = projecao[i] + consumo_i (identidade do motor; chegadas e
//    programacoes do mes ficam implicitas).
//  - Mes da ruptura = primeiro i com projecao[i] < 0. Nenhum negativo nos 6 meses -> sem ruptura.
//  - Periodo do mes: no mes base vai da data-base ao ultimo dia do mes; nos demais, do dia 1 ao ultimo dia.
//  - Dia estimado: se D_i <= 0 ou consumo_i <= 0 -> inicio do periodo; senao inicio + floor(dias * D_i /
//    consumo_i) (consumo linear dentro do periodo), sempre dentro do mes.
// Data-limite do pedido = ruptura - lead time (AQ, dias corridos, sem folga). Vencida = data-limite < hoje.
//
// Encaixe de novas fontes de dados: qualquer provedor de entradas (planilha, DBCorp, futuro gateway) so
// precisa produzir a quinzena normalizada; este modulo consome o resultado do motor. Um provedor de
// embalagens so precisa devolver `EmbalagemCadastrada[]`.
import { somarDias, yearMonthsDaJanela } from './forecastMonths';
import { isValidDateKey } from './supplierDocumentDates';

export interface LinhaParaRelatorio {
  linha: number;
  n?: number | null;
  item: string;
  codigos: string[];
  fonte: string;
  status: string;
  Q: number;
  AG: number;
  AN: number | null;
  AQ: number | null;
  projecao: number[];
  chegadas: number[];
  programacoes: number[];
  naoFraciona?: boolean;
}

export interface QuinzenaParaRelatorio {
  id: number;
  label: string;
  baseDate: string;
  half: number;
  origin: string;
  hoje: string;
  linhas: LinhaParaRelatorio[];
}

export interface EmbalagemCadastrada {
  codigo: string;
  quantidade: number;
  rotulo?: string | null;
  principal?: boolean;
}

export interface RupturaEstimada {
  indiceMes: number;
  anoMes: string;
  data: string;
  jaNaDataBase: boolean;
}

export interface EmbalagemDoItem {
  codigo: string;
  quantidade: number;
  rotulo: string | null;
}

export interface EscolhaDeEmbalagem {
  usada: EmbalagemDoItem | null;
  cadastradas: EmbalagemDoItem[];
  multiplas: boolean;
}

export interface ItemRelatorioCompras {
  linha: number;
  n: number | null;
  item: string;
  codigos: string[];
  status: string;
  demanda: number;
  quantidadeSugerida: number;
  embalagem: EscolhaDeEmbalagem;
  quantidadeEmbalagens: number | null;
  quantidadeFinal: number;
  naoFraciona: boolean;
  ruptura: RupturaEstimada | null;
  dataLimite: string | null;
  vencida: boolean;
  leadTimeDias: number;
  emAndamento: {
    chegadas: Array<{ anoMes: string; quantidade: number }>;
    programacoes: Array<{ anoMes: string; quantidade: number }>;
  };
}

export interface GrupoRelatorioCompras {
  fonte: string;
  leadTimeDias: number;
  dataLimiteMaisUrgente: string | null;
  vencidas: number;
  itens: ItemRelatorioCompras[];
}

export interface RelatorioCompras {
  quinzena: { id: number; label: string; baseDate: string; half: number; origin: string; hoje: string };
  totais: { itens: number; fontes: number; vencidas: number; semEmbalagem: number; multiplasEmbalagens: number };
  fora: { semLeadTime: number; semConsumoSemFalta: number };
  grupos: GrupoRelatorioCompras[];
}

// Varias embalagens no item: usa a marcada como principal; sem principal, a de menor posicao (EMB.1 -> EMB.7).
export const REGRA_EMBALAGEM = 'principal-depois-menor-posicao' as const;

// Tolerancia numerica do arredondamento (evita 2,0000000000005 virar 3 embalagens).
const EPS = 1e-9;

const pad2 = (n: number) => String(n).padStart(2, '0');

const semMenosZero = (n: number) => (n === 0 ? 0 : n);

// Item com demanda a comprar: lead time conhecido, demanda <= 0 e (consumo > 0 ou falta real).
// Fora: sem lead time (AN nulo) e sem consumo com demanda = 0. Sem consumo com demanda < 0 entra.
export function entraNoRelatorio(l: Pick<LinhaParaRelatorio, 'AN' | 'Q'>): boolean {
  return l.AN !== null && l.AN <= 0 && (l.Q > 0 || l.AN < 0);
}

export function dataDeRuptura(
  l: Pick<LinhaParaRelatorio, 'projecao' | 'Q' | 'AG'>,
  baseDate: string,
): RupturaEstimada | null {
  const indice = l.projecao.findIndex((p) => p < 0);
  if (indice < 0) {
    return null;
  }
  const anoMes = yearMonthsDaJanela(baseDate, 6)[indice];
  if (!anoMes) {
    return null;
  }
  const ano = Number(anoMes.slice(0, 4));
  const mes = Number(anoMes.slice(5, 7));
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diaInicio = indice === 0 ? Number(baseDate.slice(8, 10)) : 1;
  const inicio = `${anoMes}-${pad2(diaInicio)}`;
  const dias = ultimoDia - diaInicio + 1;
  const consumo = indice === 0 ? l.AG : l.Q;
  const disponivel = l.projecao[indice] + consumo;

  if (disponivel <= 0 || consumo <= 0) {
    return { indiceMes: indice, anoMes, data: inicio, jaNaDataBase: indice === 0 };
  }
  const deslocamento = Math.min(dias - 1, Math.floor((dias * disponivel) / consumo + EPS));
  return { indiceMes: indice, anoMes, data: somarDias(inicio, deslocamento), jaNaDataBase: false };
}

export function dataLimiteDoPedido(ruptura: string, leadTimeDias: number): string {
  return somarDias(ruptura, -leadTimeDias);
}

export function escolherEmbalagem(codigos: string[], embalagens: EmbalagemCadastrada[]): EscolhaDeEmbalagem {
  const validas = new Map<string, EmbalagemCadastrada>();
  for (const e of embalagens) {
    if (!Number.isFinite(e.quantidade) || e.quantidade <= 0) continue;
    const chave = e.codigo.toUpperCase();
    if (!validas.has(chave)) validas.set(chave, e);
  }

  const cadastradas: EmbalagemDoItem[] = [];
  let principal: EmbalagemDoItem | null = null;
  const vistos = new Set<string>();
  for (const codigo of codigos) {
    const chave = codigo.toUpperCase();
    const emb = validas.get(chave);
    if (!codigo || !emb || vistos.has(chave)) continue;
    vistos.add(chave);
    const dado: EmbalagemDoItem = { codigo, quantidade: emb.quantidade, rotulo: emb.rotulo ?? null };
    cadastradas.push(dado);
    if (principal === null && emb.principal === true) principal = dado;
  }

  return {
    usada: principal ?? cadastradas[0] ?? null,
    cadastradas,
    multiplas: cadastradas.length > 1,
  };
}

export function arredondarPorEmbalagem(
  quantidade: number,
  porEmbalagem: number,
): { embalagens: number; quantidade: number } {
  if (!Number.isFinite(porEmbalagem) || porEmbalagem <= 0) {
    throw new Error('Quantidade por embalagem invalida.');
  }
  const embalagens = Math.max(0, Math.ceil(quantidade / porEmbalagem - EPS));
  return { embalagens: semMenosZero(embalagens), quantidade: semMenosZero(embalagens * porEmbalagem) };
}

function mesesComValor(valores: number[], anoMes: string[]): Array<{ anoMes: string; quantidade: number }> {
  const saida: Array<{ anoMes: string; quantidade: number }> = [];
  valores.forEach((quantidade, i) => {
    if (quantidade > 0 && anoMes[i]) saida.push({ anoMes: anoMes[i], quantidade });
  });
  return saida;
}

const compararTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

// Datas (YYYY-MM-DD) comparam como texto; nulo vai por ultimo.
function compararDataNulaPorUltimo(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function compararItens(a: ItemRelatorioCompras, b: ItemRelatorioCompras): number {
  return (
    compararDataNulaPorUltimo(a.dataLimite, b.dataLimite) ||
    compararDataNulaPorUltimo(a.ruptura?.data ?? null, b.ruptura?.data ?? null) ||
    compararTexto(a.item, b.item) ||
    a.linha - b.linha
  );
}

export function montarRelatorioCompras(
  q: QuinzenaParaRelatorio,
  embalagens: EmbalagemCadastrada[],
): RelatorioCompras {
  if (!isValidDateKey(q.baseDate)) {
    throw new Error(`Data base invalida: ${String(q.baseDate)}`);
  }
  if (!isValidDateKey(q.hoje)) {
    throw new Error(`Data invalida: ${String(q.hoje)}`);
  }
  const meses = yearMonthsDaJanela(q.baseDate, 6);

  let semLeadTime = 0;
  let semConsumoSemFalta = 0;
  const porFonte = new Map<string, { fonte: string; leadTimeDias: number; itens: ItemRelatorioCompras[] }>();

  for (const l of q.linhas) {
    if (l.AN === null) {
      semLeadTime += 1;
      continue;
    }
    if (!entraNoRelatorio(l)) {
      if (l.AN <= 0) semConsumoSemFalta += 1;
      continue;
    }

    const leadTimeDias = l.AQ ?? 0;
    const quantidadeSugerida = semMenosZero(Math.abs(l.AN));
    const embalagem = escolherEmbalagem(l.codigos, embalagens);
    const arredondado = embalagem.usada
      ? arredondarPorEmbalagem(quantidadeSugerida, embalagem.usada.quantidade)
      : null;
    const ruptura = dataDeRuptura(l, q.baseDate);
    const dataLimite = ruptura ? dataLimiteDoPedido(ruptura.data, leadTimeDias) : null;

    const item: ItemRelatorioCompras = {
      linha: l.linha,
      n: l.n ?? null,
      item: l.item,
      codigos: l.codigos,
      status: l.status,
      demanda: semMenosZero(l.AN),
      quantidadeSugerida,
      embalagem,
      quantidadeEmbalagens: arredondado ? arredondado.embalagens : null,
      quantidadeFinal: arredondado ? arredondado.quantidade : quantidadeSugerida,
      naoFraciona: l.naoFraciona === true,
      ruptura,
      dataLimite,
      vencida: dataLimite !== null && dataLimite < q.hoje,
      leadTimeDias,
      emAndamento: {
        chegadas: mesesComValor(l.chegadas.slice(0, 5), meses),
        programacoes: mesesComValor(l.programacoes.slice(0, 4), meses),
      },
    };

    const chave = l.fonte.trim().toUpperCase();
    const grupo = porFonte.get(chave);
    if (grupo) {
      grupo.itens.push(item);
    } else {
      porFonte.set(chave, { fonte: l.fonte.trim(), leadTimeDias, itens: [item] });
    }
  }

  const grupos: GrupoRelatorioCompras[] = [...porFonte.values()].map((g) => {
    const itens = [...g.itens].sort(compararItens);
    return {
      fonte: g.fonte,
      leadTimeDias: g.leadTimeDias,
      dataLimiteMaisUrgente: itens[0]?.dataLimite ?? null,
      vencidas: itens.filter((i) => i.vencida).length,
      itens,
    };
  });
  grupos.sort(
    (a, b) =>
      compararDataNulaPorUltimo(a.dataLimiteMaisUrgente, b.dataLimiteMaisUrgente) ||
      compararTexto(a.fonte, b.fonte),
  );

  const todos = grupos.flatMap((g) => g.itens);
  return {
    quinzena: {
      id: q.id,
      label: q.label,
      baseDate: q.baseDate,
      half: q.half,
      origin: q.origin,
      hoje: q.hoje,
    },
    totais: {
      itens: todos.length,
      fontes: grupos.length,
      vencidas: todos.filter((i) => i.vencida).length,
      semEmbalagem: todos.filter((i) => i.embalagem.usada === null).length,
      multiplasEmbalagens: todos.filter((i) => i.embalagem.multiplas).length,
    },
    fora: { semLeadTime, semConsumoSemFalta },
    grupos,
  };
}
