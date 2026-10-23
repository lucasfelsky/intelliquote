// Prazo das chegadas estimadas do FUP, por fonte (PR 5A): funcoes PURAS do rascunho da tabela do resumo da importacao
// DBCorp. O rascunho guarda o TEXTO digitado (o usuario pode estar no meio de um numero); so vira corpo da requisicao
// quando todos os campos sao inteiros 0..365.
import type {
  ForecastPrazoEstimativaBody,
  ForecastPrazosEstimativa,
} from '@/services/forecast';

/** Mesmo limite do backend (`FORECAST_DBCORP_PRAZO_ESTIMATIVA_MAX_DIAS`). */
export const PRAZO_MAX_DIAS = 365;

export type CampoPrazo = 'prontidao' | 'etd';

/** Texto dos dois campos de uma fonte, por `sourceId`. */
export type RascunhoPrazos = Record<number, Record<CampoPrazo, string>>;

/** `null` = valido; senao a mensagem (pt-BR) do campo. Aceita so inteiros 0..365, sem sinal, ponto ou virgula. */
export function validarDias(texto: string): string | null {
  const limpo = texto.trim();
  if (limpo === '') return 'Informe os dias.';
  if (!/^\d+$/.test(limpo)) return 'Use um número inteiro de dias, sem sinal nem decimais.';
  if (Number(limpo) > PRAZO_MAX_DIAS) return `No máximo ${PRAZO_MAX_DIAS} dias.`;
  return null;
}

function diasDoTexto(texto: string): number | null {
  return validarDias(texto) === null ? Number(texto.trim()) : null;
}

type FontesDoResumo = Pick<ForecastPrazosEstimativa, 'fontes'>;

/** Primeira abertura da tabela: cada fonte comeca no prazo USADO pelo servidor (valor salvo, senao o padrao). */
export function rascunhoInicial(prazos: FontesDoResumo): RascunhoPrazos {
  const rascunho: RascunhoPrazos = {};
  for (const f of prazos.fontes) {
    rascunho[f.sourceId] = { prontidao: String(f.usado.prontidaoDias), etd: String(f.usado.etdDias) };
  }
  return rascunho;
}

/**
 * Chegou uma pre-visualizacao nova (recalculo ou re-previa apos completar o cadastro): fonte que ja estava no rascunho
 * mantem o texto digitado; fonte nova entra com o prazo usado; fonte que saiu do resumo sai do rascunho.
 */
export function mesclarRascunho(rascunho: RascunhoPrazos | null, prazos: FontesDoResumo): RascunhoPrazos {
  const inicial = rascunhoInicial(prazos);
  if (!rascunho) return inicial;
  const mesclado: RascunhoPrazos = {};
  for (const [chave, novo] of Object.entries(inicial)) {
    const id = Number(chave);
    mesclado[id] = rascunho[id] ?? novo;
  }
  return mesclado;
}

/** Corpo `prazosEstimativa` (todas as fontes da tabela); `null` se algum campo esta invalido. */
export function corpoDosPrazos(
  rascunho: RascunhoPrazos,
  prazos: FontesDoResumo,
): ForecastPrazoEstimativaBody[] | null {
  const corpo: ForecastPrazoEstimativaBody[] = [];
  for (const f of prazos.fontes) {
    const linha = rascunho[f.sourceId];
    const prontidaoDias = linha ? diasDoTexto(linha.prontidao) : null;
    const etdDias = linha ? diasDoTexto(linha.etd) : null;
    if (prontidaoDias === null || etdDias === null) return null;
    corpo.push({ sourceId: f.sourceId, prontidaoDias, etdDias });
  }
  return corpo;
}

/** Ha campo invalido no rascunho? */
export function rascunhoInvalido(rascunho: RascunhoPrazos, prazos: FontesDoResumo): boolean {
  return corpoDosPrazos(rascunho, prazos) === null;
}

/**
 * O rascunho difere do que a pre-visualizacao ATUAL usou? Campo invalido conta como diferente (o confirm segue
 * bloqueado ate corrigir e recalcular).
 */
export function prazosMudaram(rascunho: RascunhoPrazos | null, prazos: FontesDoResumo): boolean {
  if (!rascunho) return false;
  return prazos.fontes.some((f) => {
    const linha = rascunho[f.sourceId];
    if (!linha) return false;
    return (
      diasDoTexto(linha.prontidao) !== f.usado.prontidaoDias || diasDoTexto(linha.etd) !== f.usado.etdDias
    );
  });
}

/** Aviso do numero de padroes que o confirm vai gravar; `null` quando nenhum muda. */
export function textoPadroesAlterados(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? 'Ao confirmar, 1 fonte terá o padrão salvo alterado.'
    : `Ao confirmar, ${n} fontes terão o padrão salvo alterado.`;
}

/** Texto do "padrao salvo" de uma fonte; `—` quando nada foi salvo (usa o padrao). */
export function textoPadraoSalvo(salvo: { prontidaoDias: number | null; etdDias: number | null }): string {
  const partes = [
    salvo.prontidaoDias !== null ? `prontidão ${salvo.prontidaoDias}` : null,
    salvo.etdDias !== null ? `ETD ${salvo.etdDias}` : null,
  ].filter((p): p is string => p !== null);
  return partes.length > 0 ? `${partes.join(' · ')} dias` : '—';
}
