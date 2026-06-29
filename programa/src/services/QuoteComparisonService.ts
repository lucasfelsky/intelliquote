import { Incoterm } from '@prisma/client';

export interface LandedCostInput {
  offeredPrice: number;
  currency: string;
  exchangeRate: number;
  freightCost: number;
  insuranceCost: number;
  otherFees: number;
  importDutyRate: number;
  ipiRate: number;
  pisRate: number;
  cofinsRate: number;
}

export interface LandedCostSnapshot extends LandedCostInput {
  cifValue: number;
  importDutyAmount: number;
  ipiAmount: number;
  pisCofinsAmount: number;
  totalLandedCost: number;
}

export interface QuoteComparisonInput extends LandedCostInput {
  id: number;
  quoteRequestId: number;
  supplierId: number;
  offeredIncoterm: Incoterm;
  paymentTermsDays: number;
  isWinner?: boolean;
}

export interface QuoteComparisonWeights {
  priceWeight: number;
  paymentTermsWeight: number;
  incotermWeight: number;
}

export interface QuoteComparisonResult
  extends QuoteComparisonInput,
    LandedCostSnapshot {
  priceScore: number;
  paymentTermsScore: number;
  incotermScore: number;
  totalScore: number;
  isWinner: boolean;
}

export class QuoteComparisonService {
  private static readonly DEFAULT_WEIGHTS: QuoteComparisonWeights = {
    priceWeight: 50,
    paymentTermsWeight: 30,
    incotermWeight: 20,
  };

  private static readonly INCOTERM_SCORES: Record<Incoterm, number> = {
    EXW: 1,
    FCA: 2,
    FAS: 2,
    FOB: 3,
    CFR: 3,
    CIF: 4,
    CPT: 3,
    CIP: 4,
    DAP: 4,
    DPU: 4,
    DDP: 5,
  };

  static getDefaultWeights(): QuoteComparisonWeights {
    return { ...QuoteComparisonService.DEFAULT_WEIGHTS };
  }

  static validateResponsesForComparison(
    responses: QuoteComparisonInput[],
  ): string | null {
    const quoteRequestIds = new Set(
      responses.map((response) => response.quoteRequestId),
    );

    if (quoteRequestIds.size > 1) {
      return 'A comparacao so pode usar propostas da mesma cotacao.';
    }

    const missingExchangeRate = responses.find(
      (response) =>
        response.currency.trim().toUpperCase() !== 'BRL' && response.exchangeRate <= 0,
    );

    if (missingExchangeRate) {
      return 'Todas as propostas em moeda estrangeira exigem exchangeRate valido para comparar landed cost em BRL.';
    }

    return null;
  }

  static calculateLandedCost(input: LandedCostInput): LandedCostSnapshot {
    const normalizedCurrency = input.currency.trim().toUpperCase();
    const exchangeRate =
      normalizedCurrency === 'BRL'
        ? input.exchangeRate > 0
          ? input.exchangeRate
          : 1
        : input.exchangeRate;
    const freightCost = QuoteComparisonService.toNonNegativeNumber(input.freightCost);
    const insuranceCost = QuoteComparisonService.toNonNegativeNumber(
      input.insuranceCost,
    );
    const otherFees = QuoteComparisonService.toNonNegativeNumber(input.otherFees);
    const importDutyRate = QuoteComparisonService.normalizeRate(input.importDutyRate);
    const ipiRate = QuoteComparisonService.normalizeRate(input.ipiRate);
    const pisRate = QuoteComparisonService.normalizeRate(input.pisRate);
    const cofinsRate = QuoteComparisonService.normalizeRate(input.cofinsRate);
    const cifValue =
      QuoteComparisonService.toNonNegativeNumber(input.offeredPrice) * exchangeRate +
      freightCost +
      insuranceCost;
    const importDutyAmount = cifValue * importDutyRate;
    const ipiAmount = (cifValue + importDutyAmount) * ipiRate;
    const pisCofinsAmount = cifValue * (pisRate + cofinsRate);
    const totalLandedCost =
      cifValue + importDutyAmount + ipiAmount + pisCofinsAmount + otherFees;

    return {
      offeredPrice: QuoteComparisonService.roundCurrency(input.offeredPrice),
      currency: normalizedCurrency,
      exchangeRate: QuoteComparisonService.roundRate(exchangeRate),
      freightCost: QuoteComparisonService.roundCurrency(freightCost),
      insuranceCost: QuoteComparisonService.roundCurrency(insuranceCost),
      otherFees: QuoteComparisonService.roundCurrency(otherFees),
      importDutyRate: QuoteComparisonService.roundRate(importDutyRate),
      ipiRate: QuoteComparisonService.roundRate(ipiRate),
      pisRate: QuoteComparisonService.roundRate(pisRate),
      cofinsRate: QuoteComparisonService.roundRate(cofinsRate),
      cifValue: QuoteComparisonService.roundCurrency(cifValue),
      importDutyAmount: QuoteComparisonService.roundCurrency(importDutyAmount),
      ipiAmount: QuoteComparisonService.roundCurrency(ipiAmount),
      pisCofinsAmount: QuoteComparisonService.roundCurrency(pisCofinsAmount),
      totalLandedCost: QuoteComparisonService.roundCurrency(totalLandedCost),
    };
  }

  static compareResponses(
    responses: QuoteComparisonInput[],
    weights: QuoteComparisonWeights = QuoteComparisonService.getDefaultWeights(),
  ): QuoteComparisonResult[] {
    if (responses.length === 0) {
      return [];
    }

    const landedCostResults = responses.map((response) => ({
      ...response,
      ...QuoteComparisonService.calculateLandedCost(response),
    }));
    const lowestLandedCost = Math.min(
      ...landedCostResults.map((response) => response.totalLandedCost),
    );
    const highestPaymentTerm = Math.max(
      ...landedCostResults.map((response) => response.paymentTermsDays),
    );

    const rankedResponses = landedCostResults.map((response) => {
      const priceScore =
        response.totalLandedCost === 0
          ? 0
          : (lowestLandedCost / response.totalLandedCost) * weights.priceWeight;
      const paymentTermsScore =
        highestPaymentTerm === 0
          ? 0
          : (response.paymentTermsDays / highestPaymentTerm) * weights.paymentTermsWeight;
      const incotermRiskLevel =
        QuoteComparisonService.INCOTERM_SCORES[response.offeredIncoterm] ?? 1;
      const incotermScore = (incotermRiskLevel / 5) * weights.incotermWeight;
      const totalScore = priceScore + paymentTermsScore + incotermScore;

      return {
        ...response,
        priceScore: Number(priceScore.toFixed(2)),
        paymentTermsScore: Number(paymentTermsScore.toFixed(2)),
        incotermScore: Number(incotermScore.toFixed(2)),
        totalScore: Number(totalScore.toFixed(2)),
        isWinner: false,
      };
    });

    const highestScore = Math.max(
      ...rankedResponses.map((response) => response.totalScore),
    );

    // Critério de desempate determinístico entre propostas com o score máximo.
    // Antes o vencedor era o de menor índice (first-occurrence), o que dependia da
    // ordem de retorno do banco e não era determinístico. Cascata agora:
    //   1. menor totalLandedCost (custo real menor vence o empate do score)
    //   2. maior paymentTermsDays (mais dias para pagar é melhor)
    //   3. maior nível de Incoterm (DDP=5 > EXW=1; repassa mais responsabilidade ao fornecedor)
    //   4. menor id (estabilidade final, ordem de cadastro)
    const winnerId = rankedResponses
      .filter((response) => response.totalScore === highestScore)
      .reduce((best, current) => {
        if (current.totalLandedCost !== best.totalLandedCost) {
          return current.totalLandedCost < best.totalLandedCost ? current : best;
        }
        if (current.paymentTermsDays !== best.paymentTermsDays) {
          return current.paymentTermsDays > best.paymentTermsDays ? current : best;
        }
        const currentIncoterm =
          QuoteComparisonService.INCOTERM_SCORES[current.offeredIncoterm] ?? 1;
        const bestIncoterm =
          QuoteComparisonService.INCOTERM_SCORES[best.offeredIncoterm] ?? 1;
        if (currentIncoterm !== bestIncoterm) {
          return currentIncoterm > bestIncoterm ? current : best;
        }
        return current.id < best.id ? current : best;
      }).id;

    return rankedResponses.map((response) => ({
      ...response,
      isWinner: response.id === winnerId,
    }));
  }

  private static normalizeRate(value: number): number {
    const parsed = QuoteComparisonService.toNonNegativeNumber(value);

    if (parsed === 0) {
      return 0;
    }

    return parsed > 1 ? parsed / 100 : parsed;
  }

  private static toNonNegativeNumber(value: number): number {
    return Number.isFinite(value) && value >= 0 ? Number(value) : 0;
  }

  private static roundCurrency(value: number): number {
    return Number(value.toFixed(2));
  }

  private static roundRate(value: number): number {
    return Number(value.toFixed(6));
  }
}
