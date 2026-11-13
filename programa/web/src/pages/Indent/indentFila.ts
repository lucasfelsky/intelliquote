import { ApiError } from '@/api/client';
import type { IndentRuleMode } from '@/services/indent';
import type { IndentRequestStatus } from '@/services/indentRequests';

// Apoio das telas de Solicitacoes do IQ Indent (mock viewSolicitacoes/slaCell/stOf). O calculo de "Na fila ha" e feito no
// BACKEND (dias uteis em Sao Paulo); aqui so o rotulo e a cor.

export interface FilaRotulo {
  texto: string;
  /** Classe do badge global (`badge badge--muted|--warning|--danger`). */
  classe: string;
}

/** `null` = status fora da fila (Respondida/Convertida/Perdida): a tela mostra "—". */
export function filaRotulo(dias: number | null): FilaRotulo | null {
  if (dias === null) return null;
  const base = dias === 0 ? 'hoje' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  if (dias > 2) return { texto: `${base} · atrasada`, classe: 'badge badge--danger' };
  if (dias === 2) return { texto: `${base} · no limite`, classe: 'badge badge--warning' };
  return { texto: base, classe: 'badge badge--muted' };
}

/** "chegou hoje à fila" | "na fila há N dia(s)" (subtitulo do detalhe). */
export function filaFrase(dias: number | null): string | null {
  if (dias === null) return null;
  return dias === 0 ? 'chegou hoje à fila' : `na fila há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

const STATUS: Record<IndentRequestStatus, { rotulo: string; classe: string }> = {
  NOVA: { rotulo: 'Nova', classe: 'badge badge--dot badge--info' },
  COTACAO: { rotulo: 'Em cotação', classe: 'badge badge--dot badge--warning' },
  RESPONDIDA: { rotulo: 'Respondida', classe: 'badge badge--dot badge--success' },
  CONVERTIDA: { rotulo: 'Convertida', classe: 'badge badge--dot badge--success' },
  PERDIDA: { rotulo: 'Perdida', classe: 'badge badge--dot badge--muted' },
};

/** Status exibido: "Cliente pendente" (derivado de clientId nulo) sobrepoe NOVA. */
export function statusRotulo(status: IndentRequestStatus, clientePendente: boolean): { rotulo: string; classe: string } {
  if (clientePendente) return { rotulo: 'Cliente pendente', classe: 'badge badge--dot badge--warning' };
  return STATUS[status];
}

/** "Só aprovados" | "Bloqueios" | null (sem restricao). */
export function rotuloRegra(modo: IndentRuleMode): string | null {
  if (modo === 'APROVADOS') return 'Só aprovados';
  if (modo === 'BLOQUEIO') return 'Bloqueios';
  return null;
}

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `dd/mm hh:mm` no fuso de Sao Paulo (nunca o do navegador). */
export function formatarDataHora(valor: Date | string | null | undefined): string {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  const partes = dataHora.formatToParts(data);
  const pega = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  const hora = pega('hour') === '24' ? '00' : pega('hour');
  return `${pega('day')}/${pega('month')} ${hora}:${pega('minute')}`;
}

/** Numero no padrao pt-BR (25000 -> "25.000"; 1,5 -> "1,5"). */
export function formatarKg(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/**
 * Quantidade digitada em pt-BR: "25.000" = 25000, "1,5" = 1,5, "1.234,56" = 1234,56, "25000" = 25000.
 * `null` quando o texto nao e um numero. Sem heuristica de unidade (nada de "< 1000 vira tonelada").
 */
export function parseQuantidadePtBr(texto: string): number | null {
  const limpo = texto.trim().replace(/\s+/g, '');
  if (limpo === '') return null;

  let normal: string;
  if (limpo.includes(',')) {
    // Com virgula decimal, o ponto so pode ser separador de milhar.
    if (!/^\d{1,3}(\.\d{3})*,\d+$|^\d+,\d+$/.test(limpo)) return null;
    normal = limpo.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    normal = limpo.replace(/\./g, '');
  } else if (/^\d+(\.\d+)?$/.test(limpo)) {
    normal = limpo;
  } else {
    return null;
  }

  const numero = Number(normal);
  return Number.isFinite(numero) ? numero : null;
}

/** Primeira palavra do nome (mock: `f.nome.split(' ')[0]`), usada no toast "... com o número NNN/AA: A, B". */
export function primeiraPalavra(nome: string): string {
  return nome.split(' ')[0] ?? nome;
}

/** Mensagem do backend (corpo com `message`) quando houver; senao a do erro. Mesmo formato dos demais erros inline do Indent. */
export function mensagemDoErro(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | null;
    if (body && typeof body.message === 'string') return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Erro desconhecido.';
}
