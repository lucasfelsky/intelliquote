// Funcoes puras do modal "Embalagens do item" (sem React).
import type { ForecastEmbalagemEdicao, ForecastEmbalagens, ForecastEmbalagensPatch } from '@/services/forecastEmbalagens';

export const ERRO_QTD_FORMATO = 'Informe a quantidade em kg só com números (ex.: 25 ou 22,68).';
export const ERRO_QTD_POSITIVA = 'A quantidade da embalagem deve ser maior que zero.';
export const ERRO_QTD_MAXIMA = 'A quantidade da embalagem aceita no máximo 1.000.000 kg.';
export const ERRO_QTD_CASAS = 'A quantidade da embalagem aceita no máximo 3 casas decimais.';

export const ERRO_PALLET_FORMATO = 'Informe os kg do pallet só com números (ex.: 600 ou 1.200).';
export const ERRO_PALLET_POSITIVO = 'O pallet deve ser maior que zero.';
export const ERRO_PALLET_MAXIMO = 'O pallet aceita no máximo 1.000.000 kg.';
export const ERRO_PALLET_CASAS = 'O pallet aceita no máximo 3 casas decimais.';
export const ERRO_PALLET_SEM_QUANTIDADE = 'O pallet precisa da quantidade da embalagem.';
export const ERRO_PALLET_REPETIDO = 'Tamanho de pallet repetido no mesmo código.';
export const ERRO_PALLET_MUITOS = 'Informe no máximo 5 tamanhos de pallet por código.';

const LIMITE_KG = 1_000_000;
/** Espelha FORECAST_MAX_PALLETS_POR_CODIGO do backend. */
export const MAX_PALLETS_POR_CODIGO = 5;

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

/** Mesmas regras da quantidade (formato brasileiro, ate 3 casas, ate 1.000.000 kg), com as mensagens do pallet. */
export function lerPalletKg(texto: string): QuantidadeLida {
  const lida = lerQuantidadeKg(texto);
  if (lida.ok) return lida;
  const erro =
    lida.erro === ERRO_QTD_POSITIVA
      ? ERRO_PALLET_POSITIVO
      : lida.erro === ERRO_QTD_MAXIMA
        ? ERRO_PALLET_MAXIMO
        : lida.erro === ERRO_QTD_CASAS
          ? ERRO_PALLET_CASAS
          : ERRO_PALLET_FORMATO;
  return { ok: false, erro };
}

export type PalletsLidos = { ok: true; valores: number[] } | { ok: false; erro: string };

/**
 * Le o campo de pallet com um ou mais tamanhos separados por `;` (ex.: `1.000; 1.200`). Vazio = `[]` (sem pallet);
 * parte vazia (`1.000;`) e ignorada; cada parte segue `lerPalletKg`; repetido e mais de 5 tamanhos sao erro.
 * Com um so valor o resultado e o de `lerPalletKg`.
 */
export function lerPalletsKg(texto: string): PalletsLidos {
  const valores: number[] = [];
  for (const parte of texto.split(';')) {
    if (parte.trim() === '') continue;
    const lida = lerPalletKg(parte);
    if (!lida.ok) return lida;
    if (lida.valor !== null) valores.push(lida.valor);
  }
  if (new Set(valores).size !== valores.length) return { ok: false, erro: ERRO_PALLET_REPETIDO };
  if (valores.length > MAX_PALLETS_POR_CODIGO) return { ok: false, erro: ERRO_PALLET_MUITOS };
  return { ok: true, valores };
}

/** Tamanhos de pallet do codigo (1o primeiro); backend antigo sem `palletsKg` cai em `[palletKg]`. */
export function palletsDoCodigo(c: { palletKg?: number | null; palletsKg?: number[] }): number[] {
  return c.palletsKg ?? (c.palletKg != null ? [c.palletKg] : []);
}

/** Lista para o campo de texto (`1.000; 1.200` vira `1000; 1200`, o que `lerPalletsKg` le de volta). */
export function palletsParaCampo(lista: readonly number[]): string {
  return lista.map((v) => quantidadeParaCampo(v)).join('; ');
}

/** Pallet de varios tamanhos: mesma regra do `erroDoPallet` (precisa da quantidade da embalagem). `null` = valido. */
export function erroDosPallets(quantidadeKg: number | null, palletsKg: readonly number[]): string | null {
  return palletsKg.length > 0 ? erroDoPallet(quantidadeKg, palletsKg[0] ?? null) : null;
}

/** Aviso NAO bloqueante por tamanho: com um so tamanho nao multiplo o texto e o de `avisoDoPallet`. */
export function avisoDosPallets(quantidadeKg: number | null, palletsKg: readonly number[]): string | null {
  if (quantidadeKg === null) return null;
  const nao = palletsKg.filter((p) => !palletEMultiplo(p, quantidadeKg));
  if (nao.length === 0) return null;
  if (nao.length === 1) return avisoDoPallet(quantidadeKg, nao[0] ?? null);
  return `Os pallets (${nao.map((p) => `${quantidadeParaCampo(p)} kg`).join('; ')}) não são múltiplos da embalagem (${quantidadeParaCampo(quantidadeKg)} kg): confira com o fornecedor.`;
}

/**
 * Regra entre os dois campos do mesmo codigo (o backend revalida): pallet exige quantidade na embalagem. Nao exige
 * que seja multiplo dela (rodada 5 do Comex: o pallet e uma opcao de compra do cadastro, nao uma regra). `null` = valido.
 */
export function erroDoPallet(quantidadeKg: number | null, palletKg: number | null): string | null {
  if (palletKg === null) return null;
  if (quantidadeKg === null) return ERRO_PALLET_SEM_QUANTIDADE;
  return null;
}

/** Espelha `palletEMultiploDaEmbalagem` do backend: multiplo inteiro (>= 1) da embalagem, tolerancia de 1e-6 kg. */
export function palletEMultiplo(palletKg: number, quantidadeKg: number): boolean {
  if (!(palletKg > 0) || !(quantidadeKg > 0)) return false;
  const vezes = Math.round(palletKg / quantidadeKg);
  return vezes >= 1 && Math.abs(palletKg - vezes * quantidadeKg) <= 1e-6;
}

/**
 * Aviso NAO bloqueante: pallet que nao e multiplo da embalagem. O Salvar continua liberado; so pede para conferir
 * com o fornecedor. `null` = sem aviso (sem pallet, sem quantidade ou multiplo exato).
 */
export function avisoDoPallet(quantidadeKg: number | null, palletKg: number | null): string | null {
  if (palletKg === null || quantidadeKg === null) return null;
  if (palletEMultiplo(palletKg, quantidadeKg)) return null;
  return `O pallet (${quantidadeParaCampo(palletKg)} kg) não é múltiplo da embalagem (${quantidadeParaCampo(quantidadeKg)} kg): confira com o fornecedor.`;
}

/** Quantidade para o campo de texto (virgula decimal, sem milhar: o que `lerQuantidadeKg` le de volta). */
export function quantidadeParaCampo(valor: number | null): string {
  return valor === null ? '' : String(valor).replace('.', ',');
}

export interface EmbalagemEditada {
  codigoId: number;
  quantidadeKg: number | null;
  rotulo: string | null;
  /** kg do pallet; `undefined` = nao informado (mantem o do cadastro). Legado: troca so o 1o tamanho. */
  palletKg?: number | null;
  /** Lista de tamanhos de pallet; `undefined` = nao informado. Vale no lugar de `palletKg`. */
  palletsKg?: number[];
}

export interface EdicaoDeEmbalagens {
  codigos: EmbalagemEditada[];
  principalCodigoId: number | null;
}

const rotuloOuNulo = (texto: string | null | undefined): string | null => {
  const limpo = (texto ?? '').trim();
  return limpo === '' ? null : limpo;
};

type PedidoDePallet = Pick<ForecastEmbalagemEdicao, 'palletKg' | 'palletsKg'>;

// Parte do corpo do PATCH que trata o pallet do codigo, ou null se nada mudou. Com 0 ou 1 tamanho (antes e depois)
// vai `palletKg` como sempre foi (o backend antigo so le esse campo); com 2+ vai `palletsKg`.
function pedidoDePallet(e: EmbalagemEditada, antes: ForecastEmbalagens['codigos'][number]): PedidoDePallet | null {
  if (e.palletsKg !== undefined) {
    const atuais = palletsDoCodigo(antes);
    if (e.palletsKg.length === atuais.length && e.palletsKg.every((v, i) => v === atuais[i])) return null;
    return e.palletsKg.length <= 1 && atuais.length <= 1 ? { palletKg: e.palletsKg[0] ?? null } : { palletsKg: e.palletsKg };
  }
  return e.palletKg !== undefined && e.palletKg !== (antes.palletKg ?? null) ? { palletKg: e.palletKg } : null;
}

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
    const pallet = pedidoDePallet(e, antes);
    if (e.quantidadeKg !== antes.quantidadeKg || rotulo !== rotuloOuNulo(antes.rotulo) || pallet !== null) {
      // O pallet so vai no corpo quando mudou (quantidade apagada tambem apaga o pallet no servidor).
      embalagens.push({ codigoId: e.codigoId, quantidadeKg: e.quantidadeKg, rotulo, ...(pallet ?? {}) });
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
    codigos: original.codigos.map((c) => ({
      codigoId: c.id,
      quantidadeKg: c.quantidadeKg,
      rotulo: c.rotulo,
      palletKg: c.palletKg ?? null,
      // Com 0/1 tamanho a edicao e a de sempre (so palletKg); a lista so entra com 2+ tamanhos.
      ...(palletsDoCodigo(c).length > 1 ? { palletsKg: palletsDoCodigo(c) } : {}),
    })),
    principalCodigoId: original.codigos.find((c) => c.principal)?.id ?? null,
  };
}
