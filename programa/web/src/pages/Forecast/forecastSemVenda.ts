import { useCallback, useState } from 'react';
import type { ForecastLinha } from '@/services/forecast';
import { FILTROS } from './forecastPainel';

/**
 * Filtro de exibicao "produtos sem venda ha 6 meses ou mais" (so no front; o motor e o backend nao mudam).
 *
 * Janela de vendas da linha (src/utils/forecastMonths.ts:85-92): `historico` = J..N = base-6 .. base-2,
 * `O` = base-1 (mes anterior) e `P` = mes da data-base (parcial, ate o dia 15). Os valores sao os brutos
 * congelados na quinzena, nao Q/R: marcar mes atipico nao muda a classificacao.
 */

export type ClasseVenda = 'sem-venda' | 'com-venda' | 'indeterminado';

const MESES_DO_HISTORICO = 5;

/**
 * Sem historico completo (backend anterior ao PR 1D-1) ou com valor nao finito nao da para afirmar nada:
 * `indeterminado`. Venda = valor > 0 (devolucao liquida negativa conta como sem venda).
 */
export function classificarVenda(linha: ForecastLinha): ClasseVenda {
  const { historico } = linha;
  if (!Array.isArray(historico) || historico.length < MESES_DO_HISTORICO) return 'indeterminado';
  const meses = [...historico.slice(0, MESES_DO_HISTORICO), linha.O, linha.P];
  if (meses.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'indeterminado';
  return meses.some((v) => v > 0) ? 'com-venda' : 'sem-venda';
}

export function semVendaHa6Meses(linha: ForecastLinha): boolean {
  return classificarVenda(linha) === 'sem-venda';
}

// Mesma regra do chip "Demanda <= 0" (entra no relatorio de compras): reusada por import, sem copiar.
const entraNoRelatorio = FILTROS.find((f) => f.id === 'demanda')!.teste;

/** Sem venda e sem nada que exija acao: nao entra no relatorio de compras e nao esta "em andamento". */
export function ocultavelPorSemVenda(linha: ForecastLinha): boolean {
  return semVendaHa6Meses(linha) && !entraNoRelatorio(linha) && linha.status === 'nao';
}

export function filtrarPorSemVenda(linhas: ForecastLinha[], mostrar: boolean): ForecastLinha[] {
  return mostrar ? linhas : linhas.filter((l) => !ocultavelPorSemVenda(l));
}

export function contarOcultaveis(linhas: readonly ForecastLinha[]): number {
  return linhas.filter(ocultavelPorSemVenda).length;
}

// ---------- preferencia por usuario (localStorage com try/catch + memoria) ----------

const PREFIXO_CHAVE = 'iq-forecast-sem-venda:';
const VALOR_OCULTAR = 'ocultar';

// Quando o localStorage falha (modo privado, site data bloqueado) a escolha vale so na sessao.
const memoria = new Map<number, boolean>();

function chaveDoUsuario(userId: number): string {
  return `${PREFIXO_CHAVE}${userId}`;
}

/** Padrao = mostrar. So `'ocultar'` guardado esconde; ausente, invalido ou storage que lanca = mostrar. */
export function lerMostrarSemVenda(userId: number | undefined): boolean {
  if (userId === undefined) return true;
  try {
    const guardado = localStorage.getItem(chaveDoUsuario(userId));
    if (guardado === VALOR_OCULTAR) return false;
    if (guardado !== null) return true;
  } catch {
    // storage indisponivel: cai para a memoria
  }
  return memoria.get(userId) ?? true;
}

export function gravarMostrarSemVenda(userId: number | undefined, mostrar: boolean): void {
  if (userId === undefined) return;
  try {
    if (mostrar) localStorage.removeItem(chaveDoUsuario(userId));
    else localStorage.setItem(chaveDoUsuario(userId), VALOR_OCULTAR);
    memoria.delete(userId);
  } catch {
    if (mostrar) memoria.delete(userId);
    else memoria.set(userId, false);
  }
}

export function useMostrarSemVenda(userId: number | undefined): [boolean, (v: boolean) => void] {
  const [mostrar, setMostrar] = useState(() => lerMostrarSemVenda(userId));
  const alterar = useCallback(
    (valor: boolean) => {
      gravarMostrarSemVenda(userId, valor);
      setMostrar(valor);
    },
    [userId],
  );
  return [mostrar, alterar];
}
