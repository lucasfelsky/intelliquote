import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { FORECAST_MAX_DIVERGENCES } from '../constants/forecast';
import { calcular, conferir, type Divergencia } from '../utils/forecastEngine';
import type { Entradas, Produto, Quinzena } from '../utils/forecastTypes';
import { dateKeyToDbDate, dbDateToKey, todayKeyInSaoPaulo } from '../utils/supplierDocumentDates';
import { HttpError } from '../utils/http';

type Db = Prisma.TransactionClient;

// Produto congelado na quinzena: o do motor + o id do cadastro quando existia na importacao.
export type FrozenProduct = Produto & { productId?: number | null };

export type SnapshotOrigin = 'planilha' | 'dbcorp';

export interface SnapshotFileInfo {
  kind: string;
  fileName: string;
  sha256: string;
  rows: number;
}

interface SnapshotMonths {
  consumo: string[];
  chegada: string[];
  programacao: string[];
}

export interface ForecastConferencia {
  celulas: number;
  batem: number;
  porColuna: Record<string, { celulas: number; batem: number }>;
  totalDivergencias: number;
  divergencias: Divergencia[];
}

// Conferencia motor x valores que o Excel gravou. Compara SEMPRE com a regra da planilha (AG = maior
// entre Q e P, quinzena 2): o Excel nao conhece a regra "1a quinzena" do Comex, entao comparar com ela
// geraria divergencia de AG em toda linha com P > Q que nao e erro do motor.
export function conferenciaDaQuinzena(q: Quinzena, hoje: string): ForecastConferencia {
  const linhas = calcular(q, { hoje, quinzena: 2 });
  const resultado = conferir(q, linhas);
  return {
    celulas: resultado.celulas,
    batem: resultado.batem,
    porColuna: resultado.porColuna,
    totalDivergencias: resultado.divergencias.length,
    divergencias: resultado.divergencias.slice(0, FORECAST_MAX_DIVERGENCES),
  };
}

const LABEL_HALF = /^\d{2}-([12])$/;

export function halfDoRotulo(label: string): 1 | 2 {
  const match = LABEL_HALF.exec(label);
  if (!match) {
    throw new HttpError(400, 'Rotulo da quinzena invalido (use o formato NN-q, ex.: 10-2).');
  }
  return match[1] === '1' ? 1 : 2;
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

export class ForecastSnapshotService {
  // 409 quando ja existe quinzena nao deletada com o mesmo rotulo (o Prisma nao expressa unique parcial).
  static async assertLabelFree(db: Db, label: string): Promise<void> {
    const existing = await db.forecastSnapshot.findFirst({
      where: { label, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new HttpError(409, `Ja existe uma quinzena ${label}.`);
    }
  }

  // Congela a quinzena (origem planilha ou dbcorp). `quinzena.produtos` pode carregar `productId`.
  static async createFromParsed(
    tx: Db,
    quinzena: Quinzena,
    origin: SnapshotOrigin,
    files: SnapshotFileInfo[],
    userId: number | null,
  ) {
    const half = halfDoRotulo(quinzena.id);
    await ForecastSnapshotService.assertLabelFree(tx, quinzena.id);

    const months: SnapshotMonths = {
      consumo: quinzena.mesesConsumo,
      chegada: quinzena.mesesChegada,
      programacao: quinzena.mesesProgramacao,
    };
    return tx.forecastSnapshot.create({
      data: {
        label: quinzena.id,
        baseDate: dateKeyToDbDate(quinzena.dataBase),
        half,
        origin,
        months: asJson(months),
        products: asJson(quinzena.produtos),
        inputs: asJson(quinzena.entradas),
        ...(origin === 'planilha' ? { expected: asJson(quinzena.esperado) } : {}),
        files: asJson(files),
        createdById: userId,
      },
    });
  }

  // Lista sem os Json grandes (products/inputs/expected).
  static async list() {
    return prisma.forecastSnapshot.findMany({
      where: { deletedAt: null },
      orderBy: [{ baseDate: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        label: true,
        baseDate: true,
        half: true,
        origin: true,
        months: true,
        files: true,
        createdById: true,
        createdAt: true,
      },
    });
  }

  // Quinzena calculada pelo motor (+ conferencia com o Excel quando a origem e a planilha).
  static async getCalculated(id: number, hoje?: string) {
    const snapshot = await prisma.forecastSnapshot.findFirst({ where: { id, deletedAt: null } });
    if (!snapshot) {
      throw new HttpError(404, 'Quinzena nao encontrada.');
    }

    const months = snapshot.months as unknown as SnapshotMonths;
    const produtos = snapshot.products as unknown as FrozenProduct[];
    const files = snapshot.files as unknown as SnapshotFileInfo[];
    const quinzena: Quinzena = {
      id: snapshot.label,
      arquivo: files[0]?.fileName ?? '',
      dataBase: dbDateToKey(snapshot.baseDate),
      mesesConsumo: months.consumo,
      mesesChegada: months.chegada,
      mesesProgramacao: months.programacao,
      produtos,
      entradas: snapshot.inputs as unknown as Entradas,
      esperado: (snapshot.expected ?? {}) as unknown as Quinzena['esperado'],
    };

    const hojeKey = hoje ?? todayKeyInSaoPaulo(new Date());
    const half: 1 | 2 = snapshot.half === 1 ? 1 : 2;
    const calculadas = calcular(quinzena, { hoje: hojeKey, quinzena: half });
    const produtoPorLinha = new Map(produtos.map((p) => [p.linha, p]));

    return {
      id: snapshot.id,
      label: snapshot.label,
      baseDate: quinzena.dataBase,
      half: snapshot.half,
      origin: snapshot.origin,
      hoje: hojeKey,
      months,
      files,
      createdAt: snapshot.createdAt,
      linhas: calculadas.map((linha) => {
        const produto = produtoPorLinha.get(linha.linha);
        return {
          ...linha,
          item: produto?.item ?? '',
          codigos: (produto?.codigos ?? []).filter((c) => c !== ''),
          fonte: produto?.fonte ?? '',
          status: produto?.status ?? 'nao',
          analiseForecast: produto?.analiseForecast ?? null,
          productId: produto?.productId ?? null,
        };
      }),
      conferencia: snapshot.expected ? conferenciaDaQuinzena(quinzena, hojeKey) : null,
    };
  }
}
