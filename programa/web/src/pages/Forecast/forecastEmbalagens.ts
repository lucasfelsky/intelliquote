// Funcoes puras do modal "Embalagens do item" (sem React).
import type { ForecastEmbalagemEdicao, ForecastEmbalagens, ForecastEmbalagensPatch } from '@/services/forecastEmbalagens';

export const ERRO_QTD_FORMATO = 'Informe a quantidade em kg só com números (ex.: 25 ou 22,68).';
export const ERRO_QTD_POSITIVA = 'A quantidade da embalagem deve ser maior que zero.';
export const ERRO_QTD_MAXIMA = 'A quantidade da embalagem aceita no máximo 1.000.000 kg.';
export const ERRO_QTD_CASAS = 'A quantidade da embalagem aceita no máximo 3 casas decimais.';

const LIMITE_KG = 1_000_000;

export type QuantidadeLida = { ok: true; valor: number | null } | { ok: false; erro: string };

/**
 * Le a quantidade digitada (formato brasileiro): vazio = sem embalagem (`null`). Aceita `25`, `25,5`, `22,68`,
 * `0,5` e `1.000` (ponto so como milhar, em grupos de 3; o decimal e a virgula). Os limites espelham o
 * backend (maior que zero, ate 3 casas, ate 1.000.000 kg); o backend revalida.
 */
export function lerQuantidadeKg(texto: string): QuantidadeLida {
  const limpo = texto.trim();
  if (limpo === '') return { ok: true, valor: null };

  const negativo = limpo.startsWith('-');
  const corpo = negativo ? limpo.slice(1).trim() : limpo;
  const comMilhar = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(corpo);
  const simples = /^\d+(,\d+)?$/.test(corpo);
  if (!comMilhar && !simples) return { ok: false, erro: ERRO_QTD_FORMATO };

  const [inteira, decimal = ''] = corpo.replace(/\./g, '').split(',');
  if (decimal.length > 3) return { ok: false, erro: ERRO_QTD_CASAS };
  const valor = Number(decimal ? `${inteira}.${decimal}` : inteira);
  if (negativo || valor <= 0) return { ok: false, erro: ERRO_QTD_POSITIVA };
  if (valor > LIMITE_KG) return { ok: false, erro: ERRO_QTD_MAXIMA };
  return { ok: true, valor };
}

/** Quantidade para o campo de texto (virgula decimal, sem milhar: o que `lerQuantidadeKg` le de volta). */
export function quantidadeParaCampo(valor: number | null): string {
  return valor === null ? '' : String(valor).replace('.', ',');
}

export interface EmbalagemEditada {
  codigoId: number;
  quantidadeKg: number | null;
  rotulo: string | null;
}

export interface EdicaoDeEmbalagens {
  codigos: EmbalagemEditada[];
  principalCodigoId: number | null;
}

const rotuloOuNulo = (texto: string | null | undefined): string | null => {
  const limpo = (texto ?? '').trim();
  return limpo === '' ? null : limpo;
};

/**
 * Corpo do PATCH so com o que mudou: codigos com quantidade/rotulo diferentes e `principalCodigoId` apenas se
 * a principal mudou. `null` quando nada mudou (o botao Salvar fica desabilitado).
 */
export function montarPatch(original: ForecastEmbalagens, editado: EdicaoDeEmbalagens): ForecastEmbalagensPatch | null {
  const porId = new Map(original.codigos.map((c) => [c.id, c] as const));
  const embalagens: ForecastEmbalagemEdicao[] = [];
  for (const e of editado.codigos) {
    const antes = porId.get(e.codigoId);
    if (!antes) continue;
    const rotulo = rotuloOuNulo(e.rotulo);
    if (e.quantidadeKg !== antes.quantidadeKg || rotulo !== rotuloOuNulo(antes.rotulo)) {
      embalagens.push({ codigoId: e.codigoId, quantidadeKg: e.quantidadeKg, rotulo });
    }
  }
  const principalAntes = original.codigos.find((c) => c.principal)?.id ?? null;
  const principalMudou = editado.principalCodigoId !== principalAntes;
  if (embalagens.length === 0 && !principalMudou) return null;

  const patch: ForecastEmbalagensPatch = {};
  if (embalagens.length > 0) patch.embalagens = embalagens;
  if (principalMudou) patch.principalCodigoId = editado.principalCodigoId;
  return patch;
}

/** Estado inicial da edicao a partir do cadastro lido. */
export function edicaoInicial(original: ForecastEmbalagens): EdicaoDeEmbalagens {
  return {
    codigos: original.codigos.map((c) => ({ codigoId: c.id, quantidadeKg: c.quantidadeKg, rotulo: c.rotulo })),
    principalCodigoId: original.codigos.find((c) => c.principal)?.id ?? null,
  };
}
