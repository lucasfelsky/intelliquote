import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// API oficial PTAX do Banco Central do Brasil (Olinda OData).
// Documentacao: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao
// Consultamos uma janela de dias (CotacaoMoedaPeriodo) e escolhemos o boletim de
// Fechamento mais recente; cotacaoCompra eh a taxa de compra.
const PTAX_BASE_URL = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata';
const REQUEST_TIMEOUT_MS = 8000;
// Janela de busca (dias corridos para tras, a partir de hoje em BRT). Cobre fim de
// semana e feriados prolongados: segunda de manha pega o Fechamento de sexta.
const LOOKBACK_DAYS = 7;
const PTAX_TIME_ZONE = 'America/Sao_Paulo';

// Moedas que vamos rastrear. Podem ser expandidas sem alterar o servico.
// Somente moedas existentes na PTAX (CNY nao existe no BCB e nao eh rastreada).
const TRACKED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF'] as const;
type TrackedCurrency = (typeof TRACKED_CURRENCIES)[number];

interface PtaxEntry {
  paridadeCompra: number;
  paridadeVenda: number;
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim?: string;
}

interface PtaxResponse {
  value: PtaxEntry[];
}

function parseBcbDate(value: string): Date {
  // Formato esperado: "2026-06-18 10:06:09.849819"
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    throw new Error(`Data PTAX em formato inesperado: ${value}`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

// Data civil de Brasilia (yyyy-MM-dd) de um instante, independente do TZ do processo.
function brtDateKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PTAX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// "yyyy-MM-dd" -> "MM-dd-yyyy" (formato dos parametros do OData do BCB).
function toBcbDateParam(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return `${month}-${day}-${year}`;
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

async function fetchPtaxFor(
  currency: TrackedCurrency,
  signal: AbortSignal,
  now: Date,
): Promise<PtaxEntry[]> {
  const today = brtDateKey(now);
  const start = shiftDateKey(today, -LOOKBACK_DAYS);
  const url =
    `${PTAX_BASE_URL}/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@moeda='${currency}'&@dataInicial='${toBcbDateParam(start)}'&@dataFinalCotacao='${toBcbDateParam(today)}'` +
    `&$format=json&$select=paridadeCompra,paridadeVenda,cotacaoCompra,cotacaoVenda,dataHoraCotacao,tipoBoletim`;
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'IntelliQuote-Backend/1.0' },
  });
  if (!response.ok) {
    throw new Error(`BCB PTAX respondeu HTTP ${response.status} para ${currency}.`);
  }
  const payload = (await response.json()) as PtaxResponse;
  if (!Array.isArray(payload?.value) || payload.value.length === 0) {
    throw new Error(`BCB PTAX retornou payload vazio para ${currency}.`);
  }
  return payload.value;
}

// Escolhe o boletim de Fechamento mais recente da janela. Sem nenhum Fechamento,
// cai no ultimo boletim (com aviso). Ordena localmente por dataHoraCotacao
// ("yyyy-MM-dd HH:mm:ss...") para nao depender da ordem da resposta.
function pickBulletin(currency: TrackedCurrency, entries: PtaxEntry[]): PtaxEntry | null {
  const sorted = [...entries].sort((a, b) => a.dataHoraCotacao.localeCompare(b.dataHoraCotacao));
  const closings = sorted.filter((entry) => entry.tipoBoletim?.trim().toLowerCase() === 'fechamento');
  if (closings.length > 0) return closings[closings.length - 1];
  const latest = sorted[sorted.length - 1] ?? null;
  if (latest) {
    logger.warn(
      { currency, tipoBoletim: latest.tipoBoletim ?? null, dataHoraCotacao: latest.dataHoraCotacao },
      'Nenhum boletim de Fechamento PTAX na janela; usando o ultimo boletim disponivel.',
    );
  }
  return latest;
}

export interface ExchangeRateSnapshot {
  currency: string;
  rateToBrl: number;
  referenceDate: string; // ISO yyyy-MM-dd (PTAX)
  fetchedAt: Date;
  source: string;
}

async function fetchOne(
  currency: TrackedCurrency,
  signal: AbortSignal,
  now: Date,
): Promise<ExchangeRateSnapshot | null> {
  const entries = await fetchPtaxFor(currency, signal, now);
  const latest = pickBulletin(currency, entries);
  if (!latest) return null;
  const rateToBrl = Number(latest.cotacaoCompra);
  if (!Number.isFinite(rateToBrl) || rateToBrl <= 0) {
    throw new Error(`Taxa PTAX invalida para ${currency}: ${latest.cotacaoCompra}`);
  }
  const referenceDate = parseBcbDate(latest.dataHoraCotacao);
  return {
    currency,
    rateToBrl,
    referenceDate: referenceDate.toISOString().slice(0, 10),
    fetchedAt: now,
    source: 'BCB_PTAX',
  };
}

export class ExchangeRateService {
  /**
   * Atualiza o cache local de taxas a partir do BCB PTAX.
   * Disparado pelo Cloud Scheduler (POST /api/internal/jobs/exchange-rates) e,
   * fora de producao, no boot. Grava o Fechamento mais recente da janela.
   */
  static async refresh(
    client: PrismaClient = prisma,
    now: Date = new Date(),
  ): Promise<ExchangeRateSnapshot[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const collected: ExchangeRateSnapshot[] = [];
    const errors: Array<{ currency: string; error: string }> = [];

    try {
      for (const currency of TRACKED_CURRENCIES) {
        try {
          const snapshot = await fetchOne(currency, controller.signal, now);
          if (!snapshot) continue;
          collected.push(snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ currency, error: message });
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (collected.length === 0) {
      logger.warn(
        { errors },
        'Nenhuma taxa PTAX foi obtida do BCB; cache anterior sera mantido.',
      );
      return [];
    }

    await client.$transaction(
      collected.map((snapshot) => {
        const referenceDate = new Date(`${snapshot.referenceDate}T00:00:00.000Z`);
        return client.exchangeRate.upsert({
          where: {
            currency_referenceDate: {
              currency: snapshot.currency,
              referenceDate,
            },
          },
          create: {
            currency: snapshot.currency,
            rateToBrl: new Prisma.Decimal(snapshot.rateToBrl),
            referenceDate,
            source: snapshot.source,
            fetchedAt: snapshot.fetchedAt,
          },
          update: {
            rateToBrl: new Prisma.Decimal(snapshot.rateToBrl),
            source: snapshot.source,
            fetchedAt: snapshot.fetchedAt,
          },
        });
      }),
    );

    if (errors.length > 0) {
      logger.warn(
        { collected: collected.map((c) => c.currency), errors },
        'Algumas series PTAX falharam ao atualizar.',
      );
    } else {
      logger.info(
        { currencies: collected.map((c) => `${c.currency}=${c.rateToBrl.toFixed(4)}`) },
        'Taxas PTAX atualizadas a partir do BCB.',
      );
    }

    return collected;
  }

  /**
   * Retorna a taxa mais recente disponivel para uma moeda.
   * Retorna null se nao houver cache (sinaliza que o caller deve pedir ao fornecedor).
   */
  static async getRateToBrl(
    currency: string,
    client: PrismaClient = prisma,
  ): Promise<ExchangeRateSnapshot | null> {
    const normalized = currency.toUpperCase();
    if (normalized === 'BRL') {
      return {
        currency: 'BRL',
        rateToBrl: 1,
        referenceDate: new Date().toISOString().slice(0, 10),
        fetchedAt: new Date(),
        source: 'CONSTANT',
      };
    }
    const row = await client.exchangeRate.findFirst({
      where: { currency: normalized },
      orderBy: { referenceDate: 'desc' },
    });
    if (!row) return null;
    const rate = Number(row.rateToBrl);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return {
      currency: row.currency,
      rateToBrl: rate,
      referenceDate: row.referenceDate.toISOString().slice(0, 10),
      fetchedAt: row.fetchedAt,
      source: row.source,
    };
  }

  static async listLatest(client: PrismaClient = prisma): Promise<ExchangeRateSnapshot[]> {
    const rows = await client.exchangeRate.findMany({
      orderBy: [{ currency: 'asc' }, { referenceDate: 'desc' }],
    });
    // Mantem apenas a referencia mais recente por moeda.
    const latestByCurrency = new Map<string, ExchangeRateSnapshot>();
    for (const row of rows) {
      if (latestByCurrency.has(row.currency)) continue;
      latestByCurrency.set(row.currency, {
        currency: row.currency,
        rateToBrl: Number(row.rateToBrl),
        referenceDate: row.referenceDate.toISOString().slice(0, 10),
        fetchedAt: row.fetchedAt,
        source: row.source,
      });
    }
    return Array.from(latestByCurrency.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency),
    );
  }
}
