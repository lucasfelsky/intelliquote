// Estado e validacao PURA da secao "Forecast" do formulario do item (e do modal "Vincular ao Forecast").
// Reusa as funcoes puras do "Completar cadastro" (pendentes); nada aqui usa rede, React ou Date.
import type { ForecastFonte } from '@/services/forecastFontes';
import type { ForecastProdutoCadastro } from '@/services/forecastPendentes';
import type { CatalogForecastLink, SituacaoDoCodigo } from '@/services/catalogForecast';
import {
  MAX_CODIGOS_POR_PRODUTO,
  normalizarCodigo,
  primeiroCampoComErro,
  produtoCheio,
  validarNovoProduto,
} from '@/pages/Forecast/forecastPendentes';

export interface FormVinculo {
  modo: 'existente' | 'novo' | null;
  productId: number | null;
  nome: string;
  sourceId: number | null;
  familyId: number | null;
  leadTimeTexto: string;
}

export const VINCULO_VAZIO: FormVinculo = {
  modo: null,
  productId: null,
  nome: '',
  sourceId: null,
  familyId: null,
  leadTimeTexto: '',
};

export const ERRO_ESCOLHA_O_PRODUTO = 'Escolha o produto do Forecast ou crie um produto novo.';

export type ValidacaoVinculo =
  | { ok: true; forecast: CatalogForecastLink | null; leadTimeDias: number | null }
  | { ok: false; erro: string };

interface ContextoVinculo {
  /** Codigo DBCorp do item (como digitado). */
  codigo: string;
  /** Item novo, codigo trocado ou reativacao: o backend recusa codigo livre sem escolha. */
  exigido: boolean;
  /** `null` = ainda nao se sabe (lista de produtos nao carregou): o backend decide. */
  situacao: SituacaoDoCodigo | null;
  /** Fonte escolhida (so no modo `novo`). */
  fonte: Pick<ForecastFonte, 'leadTimeDays'> | null;
  /** Produto escolhido (so no modo `existente`). */
  produto: ForecastProdutoCadastro | null;
}

/**
 * Decide o que mandar no campo `forecast`. Codigo vazio ou que ja esta no Forecast = nada a mandar (null);
 * codigo livre = exige a escolha quando `exigido`, e valida como o backend (mensagens iguais).
 */
export function validarVinculo(form: FormVinculo, ctx: ContextoVinculo): ValidacaoVinculo {
  const codigo = normalizarCodigo(ctx.codigo);
  if (codigo === '') return { ok: true, forecast: null, leadTimeDias: null };
  if (ctx.situacao && ctx.situacao.tipo !== 'livre') return { ok: true, forecast: null, leadTimeDias: null };

  if (form.modo === null) {
    if (ctx.exigido && ctx.situacao) return { ok: false, erro: ERRO_ESCOLHA_O_PRODUTO };
    return { ok: true, forecast: null, leadTimeDias: null };
  }

  if (form.modo === 'existente') {
    if (form.productId === null || !ctx.produto) return { ok: false, erro: 'Escolha o produto do Forecast.' };
    if (produtoCheio(ctx.produto)) {
      return { ok: false, erro: `O produto já tem ${MAX_CODIGOS_POR_PRODUTO} códigos.` };
    }
    return { ok: true, forecast: { modo: 'existente', productId: form.productId }, leadTimeDias: null };
  }

  const validacao = validarNovoProduto(
    { nome: form.nome, codigos: [codigo], sourceId: form.sourceId, familyId: form.familyId, leadTimeTexto: form.leadTimeTexto },
    ctx.fonte,
  );
  if (!validacao.ok) {
    const campo = primeiroCampoComErro(validacao.erros);
    return { ok: false, erro: (campo && validacao.erros[campo]) || ERRO_ESCOLHA_O_PRODUTO };
  }
  const { nome, sourceId, familyId } = validacao.corpo;
  return { ok: true, forecast: { modo: 'novo', nome, sourceId, familyId }, leadTimeDias: validacao.leadTimeDias };
}
