// "Proxima analise" do Forecast (PO.COMP.01): funcoes puras, sem React e sem Date local.
//
// Regra: a analise acontece no 2o dia util do mes e no 2o dia util apos o dia 15 (contagem a partir do dia 16).
// Proxima = a primeira data-candidata >= hoje (hoje conta).
//
// Premissas (confirmar com o Comex):
// - Dia util = segunda a sexta fora da tabela de feriados abaixo.
// - Carnaval (segunda e terca) e quarta-feira de cinzas sao ponto facultativo e contam como dia util (decisao do Lucas, 2026-10-27).
// - Feriados estaduais e municipais ficam de fora.
//
// REVISAR TODO ANO (dezembro): acrescentar o ano seguinte; o Comex confirma a lista.
// Fora dos anos da tabela o calculo devolve null (a tela omite o trecho; nunca chuta uma data).
//
// Nota juridica (so registro; o Comex deve confirmar a lista): por lei federal sao feriados nacionais 1/1, 21/4, 1/5,
// 7/9, 2/11, 15/11 e 25/12 (Lei 662/1949, redacao da Lei 10.607/2002), 12/10 (Lei 6.802/1980) e 20/11 (Lei 14.759/2023).
// Sexta-feira da Paixao e feriado religioso declarado por lei municipal (Lei 9.093/1995), na pratica em todo o pais.
// Carnaval e Corpus Christi sao ponto facultativo no servico publico federal, nao feriado por lei federal. Corpus
// Christi entra na tabela por decisao do Lucas (bancos e despacho aduaneiro param); o Carnaval NAO entra (conta como
// dia util, decisao do Lucas de 2026-10-27).
//
// Datas sao sempre manipuladas pelo texto AAAA-MM-DD; o dia da semana vem de aritmetica em UTC. new Date('AAAA-MM-DD')
// com getDay() local e toISOString() mostram o dia anterior em BRT.

/** Feriados nacionais (e Sexta-feira Santa, Corpus Christi) por ano, em AAAA-MM-DD. Carnaval fica fora: dia util. */
export const FERIADOS_NACIONAIS: Readonly<Record<number, readonly string[]>> = {
  2026: [
    '2026-01-01',
    '2026-04-03',
    '2026-04-21',
    '2026-05-01',
    '2026-06-04',
    '2026-09-07',
    '2026-10-12',
    '2026-11-02',
    '2026-11-15',
    '2026-11-20',
    '2026-12-25',
  ],
  2027: [
    '2027-01-01',
    '2027-03-26',
    '2027-04-21',
    '2027-05-01',
    '2027-05-27',
    '2027-09-07',
    '2027-10-12',
    '2027-11-02',
    '2027-11-15',
    '2027-11-20',
    '2027-12-25',
  ],
};

/** Anos com tabela de feriados; fora deles nenhum calculo e feito. */
export const ANOS_COBERTOS: readonly number[] = Object.keys(FERIADOS_NACIONAIS).map(Number);

const PARTES_HOJE_SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Copia documentada de todayKeyInSaoPaulo (src/utils/supplierDocumentDates.ts): AAAA-MM-DD no horario de Brasilia. */
export function hojeEmSaoPaulo(agora: Date): string {
  const partes = Object.fromEntries(PARTES_HOJE_SP.formatToParts(agora).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function chaveDaData(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** AAAA-MM-DD (data real do calendario) -> [ano, mes, dia]; null se o texto nao for uma data valida. */
function partesValidas(chave: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return [ano, mes, dia];
}

/** true = dia util; false = fim de semana ou feriado; null = data invalida ou ano fora da tabela de feriados. */
export function ehDiaUtil(chave: string): boolean | null {
  const partes = partesValidas(chave);
  if (!partes) return null;
  const [ano, mes, dia] = partes;
  const feriados = FERIADOS_NACIONAIS[ano];
  if (!feriados) return null;
  const diaDaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) return false;
  return !feriados.includes(chave);
}

/** 2o dia util do mes contando a partir do dia `aPartirDoDia` (inclusive), em AAAA-MM-DD; null fora da tabela. */
export function segundoDiaUtil(ano: number, mes: number, aPartirDoDia: number): string | null {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(aPartirDoDia)) return null;
  if (mes < 1 || mes > 12 || aPartirDoDia < 1) return null;
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  let uteis = 0;
  for (let dia = aPartirDoDia; dia <= diasNoMes; dia += 1) {
    const chave = chaveDaData(ano, mes, dia);
    const util = ehDiaUtil(chave);
    if (util === null) return null;
    if (util) uteis += 1;
    if (uteis === 2) return chave;
  }
  return null;
}

/** Datas-candidatas do mes: 2o dia util a partir do dia 1 e a partir do dia 16 ("apos o dia 15"). */
function candidatasDoMes(ano: number, mes: number): [string | null, string | null] {
  return [segundoDiaUtil(ano, mes, 1), segundoDiaUtil(ano, mes, 16)];
}

/**
 * Proxima analise (AAAA-MM-DD) a partir de `hoje` (AAAA-MM-DD; hoje conta). null quando `hoje` e invalido ou quando o
 * calculo precisa de um ano fora da tabela de feriados.
 */
export function proximaAnalise(hoje: string): string | null {
  const partes = partesValidas(hoje);
  if (!partes) return null;
  const [ano, mes] = partes;
  for (const candidata of candidatasDoMes(ano, mes)) {
    if (candidata === null) return null;
    if (candidata >= hoje) return candidata;
  }
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  return candidatasDoMes(proximoAno, proximoMes)[0];
}
