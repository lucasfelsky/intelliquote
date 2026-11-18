import { api, ApiError } from '@/api/client';
import { messageOf } from '@/services/quoteResponses';

// PO direta de item de PRECO FECHADO (sem cotacao), pelo Relatorio de compras do Forecast. Espelha
// src/routes/ForecastRoutes.ts (`POST .../po-preco-fechado` e `GET .../po-preco-fechado/destinatarios`) e
// src/services/ForecastPoDiretaService.ts. O backend revalida tudo; o preco nunca viaja daqui (sai do cadastro).

export const forecastPoDiretaKeys = {
  destinatarios: (snapshotId: number, productIds: readonly number[]) =>
    ['forecast', 'po-destinatarios', snapshotId, [...productIds].sort((a, b) => a - b).join(',')] as const,
};

/** Maximo de itens num envio (espelha FORECAST_PO_ITENS_MAX do backend). */
export const PO_ITENS_MAX = 50;

/** Quem recebe a PO (a mesma lista que o envio usa; todos os itens do envio sao do mesmo fornecedor). */
export interface ForecastPoDestinatarios {
  fornecedor: string;
  to: { name: string; email: string };
  contactCc: Array<{ name: string; email: string }>;
  /** Equipe COMEX em copia (so os e-mails). */
  comexCc: string[];
  /** Cc final (contatos + COMEX, sem o To). */
  cc: string[];
}

export async function getForecastPoDestinatarios(snapshotId: number, productIds: readonly number[]): Promise<ForecastPoDestinatarios> {
  const r = await api.get<{ data: ForecastPoDestinatarios }>(
    `/v1/forecast/snapshots/${snapshotId}/po-preco-fechado/destinatarios?productIds=${productIds.join(',')}`,
  );
  return r.data;
}

/**
 * Corpo do envio: o mesmo da PO ao fornecedor + os itens (um e-mail e um PDF para todos; mesmo fornecedor) e a chave de
 * idempotencia (uma por tentativa). Com varios itens a chave fica em ate 50 caracteres (a de cada PO e derivada dela).
 */
export type ForecastPoDiretaCorpo = {
  itens: Array<{ productId: number; quantidadeKg: number }>;
  chaveEnvio: string;
  subject?: string;
  message?: string;
  forwarderInfo?: string;
  forwarderId?: number;
  fileName: string;
  contentBase64: string;
  fileType: 'application/pdf';
  fileSize: number;
};

export interface ForecastPoDiretaItemEnviado {
  productId: number;
  purchaseOrderId: number;
  qtdFinalKg: number | null;
  statusDaDecisao: string | null;
}

export interface ForecastPoDiretaEnviada {
  purchaseOrderId: number;
  purchaseOrderIds: number[];
  /** Um item por PO do envio, na ordem pedida. */
  itens: ForecastPoDiretaItemEnviado[];
  /** `true` quando a mesma chave ja estava enviada: nada foi enviado nem somado de novo. */
  jaEnviada: boolean;
  /** `pendente` = o e-mail saiu, mas o registro de algum item na quinzena falhou (conferir). */
  registro: 'ok' | 'pendente';
  qtdFinalKg: number | null;
  statusDaDecisao: string | null;
  fornecedor: string;
  para: string;
  copia: string[];
}

export async function postForecastPoPrecoFechado(
  snapshotId: number,
  corpo: ForecastPoDiretaCorpo,
): Promise<ForecastPoDiretaEnviada> {
  const r = await api.post<{ data: ForecastPoDiretaEnviada }>(`/v1/forecast/snapshots/${snapshotId}/po-preco-fechado`, corpo);
  return r.data;
}

/** Chave de idempotencia do envio: UUID (ou, sem `crypto.randomUUID`, 32 hex aleatorios). 8 a 64 caracteres seguros. */
export function novaChaveDeEnvio(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Depois de um erro, o proximo envio precisa de chave NOVA quando o servidor respondeu e a PO nao ficou valendo (400, 409 de
 * item/fonte/falha, 502). Sem resposta (rede) ou com 500 ("nao deu para confirmar o envio") a PO pode ter saido: mantem a
 * chave para o servidor reconhecer a repeticao em vez de enviar outra.
 */
export function precisaDeChaveNova(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 400 || err.status === 409 || err.status === 502;
}

function mensagemDoBackend(err: ApiError): string | null {
  const message = messageOf(err);
  return message && message !== `HTTP ${err.status}` ? message : null;
}

export function forecastPoDiretaErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return 'Sua sessão expirou. Entre de novo.';
      case 403:
        return 'Seu perfil não pode enviar Ordem de Compra.';
      case 404:
        return 'Quinzena não encontrada (pode ter sido excluída).';
      case 400:
      case 409:
      case 502:
      case 500:
        return mensagemDoBackend(err) ?? `Pedido recusado pelo servidor (HTTP ${err.status}).`;
      case 413:
        return 'O PDF é grande demais para o envio.';
      default:
        return `Não foi possível enviar a PO (HTTP ${err.status}).`;
    }
  }
  return 'Sem conexão com o servidor. Tente de novo: se a PO já tiver saído, o servidor reconhece a repetição e não envia outra.';
}
