import { FORECAST_DECISAO_KG_MAX, FORECAST_DECISAO_OBSERVACAO_MAX } from '@/services/forecastDecisoes';
import { lerKgBr } from '@/services/forecastDemandaComercial';

// Helpers puros da coluna "Qtd. decidida (kg)" do relatorio de compras (PR3).

const PARTES_DATA_SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO (UTC, do backend) -> `salva em dd/mm hh:mm` no horario de Brasilia. Data invalida = vazio. */
export function textoSalvaEm(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const partes = Object.fromEntries(PARTES_DATA_SP.formatToParts(data).map((p) => [p.type, p.value]));
  const hora = partes.hour === '24' ? '00' : partes.hour;
  return `salva em ${partes.day}/${partes.month} ${hora}:${partes.minute}`;
}

/** Numero -> texto do campo: virgula decimal, ate 3 casas, sem separador de milhar (1234,5). */
export function kgParaCampo(n: number): string {
  return n.toFixed(3).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',');
}

/** "Usar sugerida": a Qtd. final do relatorio arredondada a 3 casas (o backend aceita ate 3). */
export function sugeridaParaCampo(quantidadeFinal: number): string {
  return kgParaCampo(Math.round(quantidadeFinal * 1000) / 1000);
}

export interface DecisaoValidada {
  erros: { kg?: string; observacao?: string };
  /** Preenchido so sem erro. `quantidadeKg: null` = campo vazio (apagar a decisao). */
  valores: { quantidadeKg: number | null; observacao: string | null } | null;
}

/** Valida os campos da linha (espelha o Zod do backend, que revalida). Campo vazio e valido: apaga a decisao. */
export function validarDecisao(campos: { kg: string; observacao: string }): DecisaoValidada {
  const erros: DecisaoValidada['erros'] = {};
  const texto = campos.kg.trim();
  let quantidadeKg: number | null = null;
  if (texto !== '') {
    const kg = lerKgBr(texto);
    if (texto.startsWith('-')) erros.kg = 'A quantidade não pode ser negativa.';
    else if (kg === null) erros.kg = 'Informe a quantidade em kg (ex.: 1.600 ou 1600,5).';
    else if (kg > FORECAST_DECISAO_KG_MAX) erros.kg = 'A quantidade aceita no máximo 10.000.000 kg.';
    else if (!/^\d+(\.\d{1,3})?$/.test(String(kg))) erros.kg = 'A quantidade aceita no máximo 3 casas decimais.';
    else quantidadeKg = kg;
  }
  const observacao = campos.observacao.trim();
  if (observacao.length > FORECAST_DECISAO_OBSERVACAO_MAX) {
    erros.observacao = `A observação aceita no máximo ${FORECAST_DECISAO_OBSERVACAO_MAX} caracteres.`;
  }
  if (erros.kg || erros.observacao) return { erros, valores: null };
  return { erros, valores: { quantidadeKg, observacao: observacao === '' ? null : observacao } };
}
