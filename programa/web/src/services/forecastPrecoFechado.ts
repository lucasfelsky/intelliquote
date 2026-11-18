import { api, ApiError } from '@/api/client';
import { messageOf, type Incoterm } from '@/services/quoteResponses';

// Preco fechado do Forecast: valor por kg + moeda, incoterm e validade. Espelha src/routes/ForecastRoutes.ts
// (`GET .../precos-fechados` e `PUT .../products/:id/preco-fechado`), src/services/ForecastPrecoFechadoService.ts e
// src/utils/forecastPrecoFechado.ts. So admin e comprador leem e editam o VALOR; os demais perfis veem so o selo.

export const forecastPrecosKeys = {
  lista: (snapshotId: number) => ['forecast', 'precos-fechados', snapshotId] as const,
};

export const PRECO_MOEDAS = ['USD', 'EUR', 'BRL'] as const;
export type PrecoMoeda = (typeof PRECO_MOEDAS)[number];

/** Teto e casas do preco por kg (a coluna e `Decimal(14,4)`). */
export const PRECO_MAX = 9_999_999_999;

export type EstadoDoPreco = 'ok' | 'sem_valor' | 'vencido';

export interface PrecoFechadoDoItem {
  productId: number;
  estado: EstadoDoPreco;
  valorPorKg: number | null;
  moeda: string | null;
  incoterm: string | null;
  /** AAAA-MM-DD. */
  validoAte: string | null;
}

export interface PrecosFechadosDaQuinzena {
  /** Data de hoje (AAAA-MM-DD, Sao Paulo) em que o backend calculou os estados. */
  hoje: string;
  itens: PrecoFechadoDoItem[];
}

export async function getForecastPrecosFechados(snapshotId: number): Promise<PrecosFechadosDaQuinzena> {
  const r = await api.get<{ data: PrecosFechadosDaQuinzena }>(`/v1/forecast/snapshots/${snapshotId}/precos-fechados`);
  return r.data;
}

export type PrecoFechadoPut =
  | { limpar: true }
  | { valorPorKg: number; moeda: PrecoMoeda; incoterm: Incoterm; validoAte: string };

export async function putForecastPrecoFechado(productId: number, corpo: PrecoFechadoPut): Promise<PrecoFechadoDoItem> {
  const r = await api.put<{ data: PrecoFechadoDoItem }>(`/v1/forecast/products/${productId}/preco-fechado`, corpo);
  return r.data;
}

/** Preco por kg digitado (aceita virgula): > 0, ate `PRECO_MAX` e ate 4 casas decimais (mesma regra do backend). */
export function lerPrecoPorKg(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return { ok: false, erro: 'Informe o preço por kg.' };
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: 'O preço deve ser maior que zero.' };
  if (valor > PRECO_MAX) return { ok: false, erro: 'O preço passa do limite aceito.' };
  if (Math.abs(valor * 10_000 - Math.round(valor * 10_000)) > 1e-6) return { ok: false, erro: 'O preço aceita no máximo 4 casas decimais.' };
  return { ok: true, valor };
}

const SIMBOLO: Record<string, string> = { USD: 'US$', EUR: '€', BRL: 'R$' };

/** "US$ 1,8425": 2 a 4 casas (pt-BR), simbolo da moeda. */
export function moedaBr(valor: number, moeda: string | null): string {
  const simbolo = moeda ? (SIMBOLO[moeda] ?? moeda) : '';
  const numero = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return simbolo ? `${simbolo} ${numero}` : numero;
}

function mensagemDoBackend(err: ApiError): string | null {
  const message = messageOf(err);
  return message && message !== `HTTP ${err.status}` ? message : null;
}

export function forecastPrecoErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode ver nem editar o preço fechado.';
      case 404:
        return 'Item ou quinzena não encontrados (podem ter sido excluídos).';
      case 400:
      case 409:
        return mensagemDoBackend(err) ?? `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      default:
        return `Não foi possível salvar o preço (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo.';
}
