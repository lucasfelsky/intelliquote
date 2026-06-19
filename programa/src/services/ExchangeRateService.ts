import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// API oficial PTAX do Banco Central do Brasil (Olinda OData).
// Documentacao: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao
// Aqui ja filtramos cotacaoCompra (taxa de compra) e escolhemos o boletim mais recente.
const PTAX_BASE_URL = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata';
const REQUEST_TIMEOUT_MS = 8000;

// Moedas que vamos rastrear. Podem ser expandidas sem alterar o servico.
const TRACKED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CNY'] as const;
type TrackedCurrency = (typeof TRACKED_CURRENCIES)[number];

interface PtaxEntry {
  paridadeCompra: number;
  paridadeVenda: number;
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
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

async function fetchPtaxFor(currency: TrackedCurrency, signal: AbortSignal): Promise<PtaxEntry[]> {
  const url =
    `${PTAX_BASE_URL}/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)` +
    `?@moeda='${currency}'&@dataCotacao='${formatDateParam(new Date())}'` +
    `&$format=json&$select=paridadeCompra,paridadeVenda,cotacaoCompra,cotacaoVenda,dataHoraCotacao`;
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

function formatDateParam(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${month}-${day}-${year}`;
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
): Promise<ExchangeRateSnapshot | null> {
  const entries = await fetchPtaxFor(currency, signal);
  // Pegamos o boletim mais recente (ultimo item ja vem ordenado pela API).
  const latest = entries[entries.length - 1];
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
    fetchedAt: new Date(),
    source: 'BCB_PTAX',
  };
}

export class ExchangeRateService {
  /**
   * Atualiza o cache local de taxas a partir do BCB PTAX.
   * Roda no startup e diariamente via cron.
   */
  static async refresh(client: PrismaClient = prisma): Promise<ExchangeRateSnapshot[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const collected: ExchangeRateSnapshot[] = [];
    const errors: Array<{ currency: string; error: string }> = [];

    try {
      for (const currency of TRACKED_CURRENCIES) {
        try {
          const snapshot = await fetchOne(currency, controller.signal);
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
