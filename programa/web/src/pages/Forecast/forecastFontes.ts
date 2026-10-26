// Funcoes PURAS do dialogo "Fontes e lead time" (3C): textos e ordem das linhas. Nada aqui usa `Date`, rede ou React.
import type {
  ForecastPrazoRealEstatistica,
  ForecastPrazoRealFonte,
  ForecastPrazoRealMotivo,
} from '@/services/forecastFontes';

const SEM_DADO = '—';
const MENOS = '−'; // sinal de menos tipografico

const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
const chegadas = (n: number) => `${n} ${n === 1 ? 'chegada' : 'chegadas'}`;

/** `64 dias (mediana 68 · 12 chegadas)`; `poucas chegadas (2)`; `—` sem dado. */
export function textoPrazoReal(e: ForecastPrazoRealEstatistica | null | undefined): string {
  if (!e) return SEM_DADO;
  if (e.poucasChegadas) return `poucas chegadas (${e.chegadas})`;
  return `${dias(e.media)} (mediana ${e.mediana} · ${chegadas(e.chegadas)})`;
}

/** Diferenca entre o prazo real (media) e o lead time cadastrado: `+12 dias`, `−5 dias`, `igual` ou `—`. */
export function diferencaDias(e: ForecastPrazoRealEstatistica | null | undefined, leadTimeDays: number | null): number | null {
  if (!e || e.poucasChegadas || leadTimeDays === null) return null;
  return e.media - leadTimeDays;
}

export function diferencaTexto(e: ForecastPrazoRealEstatistica | null | undefined, leadTimeDays: number | null): string {
  const diferenca = diferencaDias(e, leadTimeDays);
  if (diferenca === null) return SEM_DADO;
  if (diferenca === 0) return 'igual';
  return `${diferenca > 0 ? '+' : MENOS}${dias(Math.abs(diferenca))}`;
}

/** Maior |prazo real (PO -> ETA FINAL) - lead time| primeiro; fonte sem diferenca no fim; empate por nome. */
export function ordenarFontes(fontes: readonly ForecastPrazoRealFonte[]): ForecastPrazoRealFonte[] {
  const chave = (f: ForecastPrazoRealFonte) => {
    const d = diferencaDias(f.real?.po, f.leadTimeDays);
    return d === null ? null : Math.abs(d);
  };
  return [...fontes].sort((a, b) => {
    const ka = chave(a);
    const kb = chave(b);
    if (ka !== kb) {
      if (ka === null) return 1;
      if (kb === null) return -1;
      return kb - ka;
    }
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

export function textoIndisponivel(motivo: ForecastPrazoRealMotivo | null, label: string | null): string {
  if (motivo === 'quinzena_sem_historico') {
    return `A quinzena ${label ?? ''} foi importada antes do prazo real existir. Importe a próxima quinzena pelos relatórios DBCorp para ver o prazo real.`;
  }
  return 'Importe uma quinzena pelos relatórios DBCorp para ver o prazo real.';
}
