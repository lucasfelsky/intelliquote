import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

// Demanda do comercial (PR 6d): compra pedida pelo comercial por programacao futura de cliente, lancada a mao no Forecast.
// Espelha src/services/ForecastDemandaComercialService.ts e src/validators/forecast.ts (o backend revalida).

export type ForecastDemandaStatus = 'aberta' | 'comprada' | 'cancelada' | 'virou_programacao';
export type ForecastDemandaFechamento = Exclude<ForecastDemandaStatus, 'aberta'>;

/** `GET/POST/PATCH /forecast/commercial-demands`. */
export interface ForecastDemandaComercial {
  id: number;
  productId: number;
  produto: string;
  fonte: string | null;
  produtoAtivo: boolean;
  quantidadeKg: number;
  /** AAAA-MM-DD. */
  necessidade: string;
  motivo: string;
  cliente: string | null;
  solicitacaoId: number | null;
  status: ForecastDemandaStatus;
  notaFechamento: string | null;
  fechadaEm: string | null;
  criadaEm: string;
}

export type ForecastDemandaComercialNova = {
  productId: number;
  quantidadeKg: number;
  necessidade: string;
  motivo: string;
  cliente?: string | null;
  solicitacaoId?: number | null;
};

/** Edicao (so aberta): so os campos enviados mudam. */
export type ForecastDemandaComercialEdicao = Partial<Omit<ForecastDemandaComercialNova, 'productId'>>;

export type ForecastDemandaComercialFechamento = {
  status: ForecastDemandaFechamento;
  /** Obrigatoria (3 a 300 caracteres) para `cancelada`; opcional nos demais. */
  nota?: string | null;
};

export const FORECAST_DEMANDA_KG_MAX = 10_000_000;
export const FORECAST_DEMANDA_MOTIVO_MIN = 3;
export const FORECAST_DEMANDA_MOTIVO_MAX = 300;
export const FORECAST_DEMANDA_CLIENTE_MAX = 200;
export const FORECAST_DEMANDA_NOTA_MIN = 3;
export const FORECAST_DEMANDA_NOTA_MAX = 300;

export const forecastDemandaKeys = {
  produtos: ['forecast', 'demanda-comercial', 'produtos'] as const,
};

export async function listForecastDemandasComerciais(
  filtro: { status?: ForecastDemandaStatus; productId?: number } = {},
): Promise<ForecastDemandaComercial[]> {
  const response = await api.get<{ data: ForecastDemandaComercial[] }>('/v1/forecast/commercial-demands', {
    status: filtro.status,
    productId: filtro.productId,
  });
  return response.data;
}

export async function createForecastDemandaComercial(
  body: ForecastDemandaComercialNova,
): Promise<ForecastDemandaComercial> {
  const response = await api.post<{ data: ForecastDemandaComercial }>('/v1/forecast/commercial-demands', body);
  return response.data;
}

export async function patchForecastDemandaComercial(
  id: number,
  body: ForecastDemandaComercialEdicao | ForecastDemandaComercialFechamento,
): Promise<ForecastDemandaComercial> {
  const response = await api.patch<{ data: ForecastDemandaComercial }>(
    `/v1/forecast/commercial-demands/${id}`,
    body,
  );
  return response.data;
}

/** Produto do cadastro do Forecast para a busca do modal (`GET /forecast/products`, so os campos usados). */
export interface ForecastProdutoParaDemanda {
  id: number;
  name: string;
  isActive: boolean;
  source: { name: string } | null;
  codes: Array<{ code: string }>;
}

export async function listForecastProdutosParaDemanda(): Promise<ForecastProdutoParaDemanda[]> {
  const response = await api.get<{ data: ForecastProdutoParaDemanda[] }>('/v1/forecast/products');
  return response.data.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    source: p.source ? { name: p.source.name } : null,
    codes: (p.codes ?? []).map((c) => ({ code: c.code })),
  }));
}

/** Mensagem em portugues para o usuario; 400/409 repassam a mensagem do backend. */
export function forecastDemandaComercialErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode lançar nem alterar demanda do comercial.';
      case 404:
        return 'Demanda ou produto não encontrado (pode ter sido removido).';
      case 400:
      case 409: {
        const message = messageOf(err);
        return message && message !== `HTTP ${err.status}`
          ? message
          : `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      }
      default:
        return `Não foi possível salvar a demanda do comercial (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}

// ---------- validacao do formulario (espelha o Zod do backend, que revalida) ----------

export type CampoDemanda = 'produto' | 'kg' | 'necessidade' | 'motivo' | 'cliente' | 'solicitacao';

export interface CamposDemandaTexto {
  kg: string;
  necessidade: string;
  motivo: string;
  cliente: string;
  solicitacao: string;
}

/** Quantidade digitada em pt-BR: `1600`, `1.600`, `1600,5`, `1.600,5` ou `1600.5`. Invalida = null. */
export function lerKgBr(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '');
  if (!t) return null;
  let normal = t;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  return Number(normal);
}

/** AAAA-MM-DD existente no calendario. */
export function dataValida(chave: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export interface DemandaValidada {
  erros: Partial<Record<CampoDemanda, string>>;
  /** Preenchido so sem erro. */
  valores: {
    quantidadeKg: number;
    necessidade: string;
    motivo: string;
    cliente: string | null;
    solicitacaoId: number | null;
  } | null;
}

/**
 * Valida os campos do formulario. `minNecessidade` (AAAA-MM-DD, normalmente "hoje") barra data anterior;
 * na edicao so e passado quando a data mudou.
 */
export function validarDemandaComercial(
  campos: CamposDemandaTexto,
  opcoes: { produtoEscolhido: boolean; minNecessidade?: string },
): DemandaValidada {
  const erros: DemandaValidada['erros'] = {};
  if (!opcoes.produtoEscolhido) erros.produto = 'Escolha o produto.';

  const kg = lerKgBr(campos.kg);
  if (campos.kg.trim() === '') erros.kg = 'Informe a quantidade em kg.';
  else if (kg === null) erros.kg = 'Informe a quantidade em kg (ex.: 1.600 ou 1600,5).';
  else if (kg <= 0) erros.kg = 'A quantidade precisa ser maior que zero.';
  else if (kg > FORECAST_DEMANDA_KG_MAX) erros.kg = 'A quantidade aceita no máximo 10.000.000 kg.';
  else if (!/^\d+(\.\d{1,3})?$/.test(String(kg))) erros.kg = 'A quantidade aceita no máximo 3 casas decimais.';

  if (!campos.necessidade) erros.necessidade = 'Informe a data de necessidade.';
  else if (!dataValida(campos.necessidade)) erros.necessidade = 'Informe uma data de necessidade válida.';
  else if (opcoes.minNecessidade && campos.necessidade < opcoes.minNecessidade) {
    erros.necessidade = 'A data de necessidade não pode ser anterior a hoje.';
  }

  const motivo = campos.motivo.trim();
  if (motivo.length < FORECAST_DEMANDA_MOTIVO_MIN) {
    erros.motivo = `Informe o motivo (ao menos ${FORECAST_DEMANDA_MOTIVO_MIN} caracteres).`;
  } else if (motivo.length > FORECAST_DEMANDA_MOTIVO_MAX) {
    erros.motivo = `O motivo aceita no máximo ${FORECAST_DEMANDA_MOTIVO_MAX} caracteres.`;
  }

  const cliente = campos.cliente.trim();
  if (cliente.length > FORECAST_DEMANDA_CLIENTE_MAX) {
    erros.cliente = `O cliente aceita no máximo ${FORECAST_DEMANDA_CLIENTE_MAX} caracteres.`;
  }

  const solicitacao = campos.solicitacao.trim().replace(/^#/, '');
  let solicitacaoId: number | null = null;
  if (solicitacao !== '') {
    solicitacaoId = /^\d+$/.test(solicitacao) ? Number(solicitacao) : NaN;
    if (!Number.isInteger(solicitacaoId) || solicitacaoId <= 0 || solicitacaoId > 2_147_483_647) {
      erros.solicitacao = 'O número da solicitação deve ser um inteiro positivo.';
    }
  }

  if (Object.keys(erros).length > 0 || kg === null) return { erros, valores: null };
  return {
    erros,
    valores: {
      quantidadeKg: kg,
      necessidade: campos.necessidade,
      motivo,
      cliente: cliente === '' ? null : cliente,
      solicitacaoId,
    },
  };
}

/** Nota de fechamento: obrigatoria (3 a 300) para cancelar; opcional nos demais (vazia = sem nota). */
export function validarNotaDeFechamento(
  status: ForecastDemandaFechamento,
  texto: string,
): { erro: string | null; nota: string | null } {
  const nota = texto.trim();
  if (nota === '') {
    return status === 'cancelada'
      ? { erro: 'Informe o motivo do cancelamento.', nota: null }
      : { erro: null, nota: null };
  }
  if (nota.length < FORECAST_DEMANDA_NOTA_MIN) {
    return { erro: `A nota precisa ter ao menos ${FORECAST_DEMANDA_NOTA_MIN} caracteres.`, nota: null };
  }
  if (nota.length > FORECAST_DEMANDA_NOTA_MAX) {
    return { erro: `A nota aceita no máximo ${FORECAST_DEMANDA_NOTA_MAX} caracteres.`, nota: null };
  }
  return { erro: null, nota };
}
