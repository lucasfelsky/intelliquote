// Funcoes PURAS dos pendentes de cadastro (PR 3B-2): textos, validacao do formulario "Novo produto" e busca de
// produto existente. Nada aqui usa `Date`, rede ou React.
import type { ForecastFonte } from '@/services/forecastFontes';
import type {
  ForecastPendente,
  ForecastProdutoCadastro,
  ForecastProdutoNovoBody,
} from '@/services/forecastPendentes';

/** Espelha FORECAST_MAX_CODES_PER_PRODUCT (backend revalida). */
export const MAX_CODIGOS_POR_PRODUTO = 7;
export const LEAD_TIME_MAX_DIAS = 999;
const NOME_MAX = 200;
const CODIGO_MAX = 40;
/** Linhas do seletor de produto: o resto fica atras da busca. */
export const MAX_PRODUTOS_LISTADOS = 50;

export function normalizarCodigo(texto: string): string {
  return texto.trim().toUpperCase();
}

/** `1 código` / `2 códigos`. */
export function contagemTexto(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function situacaoTexto(p: Pick<ForecastPendente, 'situacao' | 'produtoInativo'>): string {
  return p.situacao === 'produto_inativo' ? 'Produto inativo' : 'Sem cadastro';
}

/** Explicacao para codigo de produto INATIVO (a reativacao nao existe nesta fase: so mensagem, sem botao). */
export function textoProdutoInativo(nome: string | null | undefined): string {
  return nome
    ? `O produto “${nome}” está inativo no cadastro. Reative o produto para o código voltar ao cálculo.`
    : 'O produto deste código está inativo no cadastro. Reative o produto para o código voltar ao cálculo.';
}

export const TEXTO_REATIVACAO_INDISPONIVEL = 'A reativação de produto ainda não está disponível nesta tela.';

/** Texto fixo do painel da quinzena: quando o codigo passa a entrar no calculo. */
export function textoEntradaNoCalculo(label: string): string {
  return `Esses códigos ficaram FORA do cálculo da quinzena ${label}. Depois de completar o cadastro, eles entram a partir da próxima quinzena importada.`;
}

export const TEXTO_FORA_DO_CALCULO_PREVIA =
  'Ficam FORA do cálculo. Complete o cadastro e pré-visualize de novo para que entrem nesta quinzena.';

export const TEXTO_AVISO_PLANILHA =
  'Inclua o código também na planilha PO.COMP.01: o próximo import da planilha remove os códigos que não estão nela.';

export function soSaldoTexto(soSaldo: { codigos: number; kg: number }, formatarKg: (kg: number) => string): string | null {
  if (soSaldo.codigos <= 0) return null;
  return `Só saldo (não listados): ${contagemTexto(soSaldo.codigos, 'código', 'códigos')} · ${formatarKg(soSaldo.kg)} kg`;
}

type ResultadoGravado = { tipo: 'novo' | 'codigo'; produtoOrigem?: string | null };

/** Aviso so quando o codigo foi para produto da PLANILHA (o proximo import o apaga se ele nao estiver la). */
function avisoDaPlanilha(resultado: ResultadoGravado): string {
  return resultado.tipo === 'codigo' && resultado.produtoOrigem === 'planilha' ? TEXTO_AVISO_PLANILHA : '';
}

/** Mensagem de sucesso depois de gravar (painel da quinzena). */
export function mensagemCadastroGravado(resultado: ResultadoGravado): string {
  return ['Cadastro gravado.', avisoDaPlanilha(resultado)].filter(Boolean).join(' ');
}

export type EstadoPrevia = 'atualizando' | 'atualizada' | 'falhou';

/** Mensagem de sucesso dentro do import: o cadastro gravou e a pre-visualizacao roda de novo. */
export function mensagemCadastroNaPrevia(resultado: ResultadoGravado, estado: EstadoPrevia): string {
  const meio =
    estado === 'atualizando'
      ? 'Atualizando a pré-visualização…'
      : estado === 'atualizada'
        ? 'Pré-visualização atualizada.'
        : 'A pré-visualização não foi atualizada: pré-visualize de novo.';
  return ['Cadastro gravado.', meio, avisoDaPlanilha(resultado)].filter(Boolean).join(' ');
}

// ---------- fontes ----------

export function semLeadTime(fonte: Pick<ForecastFonte, 'leadTimeDays'>): boolean {
  return fonte.leadTimeDays === null || fonte.leadTimeDays === undefined;
}

/** `FONTE · 45 dias` / `FONTE · sem lead time`. */
export function rotuloDaFonte(fonte: Pick<ForecastFonte, 'name' | 'leadTimeDays'>): string {
  return semLeadTime(fonte)
    ? `${fonte.name} · sem lead time`
    : `${fonte.name} · ${contagemTexto(fonte.leadTimeDays as number, 'dia', 'dias')}`;
}

/** Fontes ativas em ordem alfabetica (pt-BR). */
export function fontesAtivas(fontes: readonly ForecastFonte[]): ForecastFonte[] {
  return fontes.filter((f) => f.isActive).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// ---------- novo produto ----------

export interface FormNovoProduto {
  nome: string;
  codigos: string[];
  sourceId: number | null;
  familyId: number | null;
  /** Lead time (dias) digitado quando a fonte escolhida nao tem. */
  leadTimeTexto: string;
}

export type CampoNovoProduto = 'nome' | 'codigos' | 'fonte' | 'familia' | 'leadTime';
export type ErrosNovoProduto = Partial<Record<CampoNovoProduto, string>>;

export type ValidacaoNovoProduto =
  | { ok: true; corpo: ForecastProdutoNovoBody; leadTimeDias: number | null }
  | { ok: false; erros: ErrosNovoProduto };

/** Lead time inteiro 1..999; texto vazio/invalido = null. */
export function lerLeadTime(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,3}$/.test(limpo)) return null;
  const n = Number(limpo);
  return n >= 1 && n <= LEAD_TIME_MAX_DIAS ? n : null;
}

export function nomeNormalizado(nome: string): string {
  return nome.replace(/\s+/g, ' ').trim();
}

/**
 * Valida o formulario como o backend (mensagens iguais). `inativos` = codigo -> nome do produto inativo conhecido
 * (do proprio painel de pendentes): o backend recusaria com 409.
 */
export function validarNovoProduto(
  form: FormNovoProduto,
  fonte: Pick<ForecastFonte, 'leadTimeDays'> | null,
  inativos: Readonly<Record<string, string>> = {},
): ValidacaoNovoProduto {
  const erros: ErrosNovoProduto = {};

  const nome = nomeNormalizado(form.nome);
  if (nome === '') erros.nome = 'Informe o nome do produto.';
  else if (nome.length > NOME_MAX) erros.nome = `O nome aceita no máximo ${NOME_MAX} caracteres.`;

  const codigos = form.codigos.map(normalizarCodigo).filter((c) => c !== '');
  const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i);
  const inativo = codigos.find((c) => c in inativos);
  if (codigos.length === 0) erros.codigos = 'Informe ao menos um código.';
  else if (codigos.length > MAX_CODIGOS_POR_PRODUTO) erros.codigos = `Informe no máximo ${MAX_CODIGOS_POR_PRODUTO} códigos.`;
  else if (codigos.some((c) => c.length > CODIGO_MAX)) erros.codigos = `O código aceita no máximo ${CODIGO_MAX} caracteres.`;
  else if (repetido) erros.codigos = `Código repetido na lista: ${repetido}.`;
  else if (inativo) {
    erros.codigos = `O código ${inativo} pertence ao produto inativo “${inativos[inativo]}”. Reative o produto para o código voltar ao cálculo.`;
  }

  if (form.sourceId === null) erros.fonte = 'Escolha a fonte.';
  if (form.familyId === null) erros.familia = 'Escolha a família.';

  let leadTimeDias: number | null = null;
  if (form.sourceId !== null && fonte && semLeadTime(fonte)) {
    leadTimeDias = lerLeadTime(form.leadTimeTexto);
    if (leadTimeDias === null) erros.leadTime = `Informe o lead time da fonte em dias (1 a ${LEAD_TIME_MAX_DIAS}).`;
  }

  if (Object.keys(erros).length > 0 || form.sourceId === null || form.familyId === null) return { ok: false, erros };
  return {
    ok: true,
    corpo: montarCorpoNovoProduto({ ...form, nome, codigos }),
    leadTimeDias,
  };
}

export function montarCorpoNovoProduto(form: FormNovoProduto): ForecastProdutoNovoBody {
  return {
    nome: nomeNormalizado(form.nome),
    codigos: form.codigos.map(normalizarCodigo).filter((c) => c !== ''),
    sourceId: form.sourceId as number,
    familyId: form.familyId as number,
  };
}

/** Primeiro campo com erro, na ordem em que aparecem no formulario. */
export function primeiroCampoComErro(erros: ErrosNovoProduto): CampoNovoProduto | null {
  const ordem: CampoNovoProduto[] = ['nome', 'codigos', 'fonte', 'leadTime', 'familia'];
  return ordem.find((c) => erros[c]) ?? null;
}

// ---------- produto existente ----------

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Busca local por nome ou codigo (sem acento, sem caixa). Termo vazio = todos. */
export function filtrarProdutos(produtos: readonly ForecastProdutoCadastro[], termo: string): ForecastProdutoCadastro[] {
  const t = semAcento(termo.trim());
  if (t === '') return [...produtos];
  return produtos.filter(
    (p) => semAcento(p.name).includes(t) || p.codes.some((c) => semAcento(c.code).includes(t)),
  );
}

export function produtoCheio(p: Pick<ForecastProdutoCadastro, 'codes'>): boolean {
  return p.codes.length >= MAX_CODIGOS_POR_PRODUTO;
}

/** `3/7 códigos`. */
export function vagasTexto(p: Pick<ForecastProdutoCadastro, 'codes'>): string {
  return `${p.codes.length}/${MAX_CODIGOS_POR_PRODUTO} códigos`;
}
