import { describe, expect, it } from 'vitest';
import { QuoteComparisonService } from '../src/services/QuoteComparisonService';

describe('QuoteComparisonService', () => {
  it('usa os pesos padrao e escolhe a melhor proposta', () => {
    const results = QuoteComparisonService.compareResponses([
      {
        id: 1,
        quoteRequestId: 10,
        supplierId: 100,
        offeredPrice: 100,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 40,
        insuranceCost: 10,
        otherFees: 20,
        importDutyRate: 14,
        ipiRate: 5,
        pisRate: 2.1,
        cofinsRate: 9.65,
        offeredIncoterm: 'EXW',
        paymentTermsDays: 10,
      },
      {
        id: 2,
        quoteRequestId: 10,
        supplierId: 200,
        offeredPrice: 120,
        currency: 'USD',
        exchangeRate: 5.4,
        freightCost: 0,
        insuranceCost: 0,
        otherFees: 10,
        importDutyRate: 10,
        ipiRate: 4,
        pisRate: 2.1,
        cofinsRate: 9.65,
        offeredIncoterm: 'DDP',
        paymentTermsDays: 30,
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results.find((result) => result.isWinner)?.id).toBe(2);
    expect(results[0].priceScore).toBeGreaterThan(0);
    expect(results[0].currency).toBe('USD');
    expect(results[0].importDutyRate).toBe(0.14);
    expect(results[0].ipiRate).toBe(0.05);
    expect(results[0].pisRate).toBe(0.021);
    expect(results[0].cofinsRate).toBe(0.0965);
    expect(results[0].totalLandedCost).toBeGreaterThan(0);
  });

  it('permite alterar o vencedor quando os pesos mudam', () => {
    const results = QuoteComparisonService.compareResponses(
      [
        {
          id: 1,
          quoteRequestId: 10,
          supplierId: 100,
          offeredPrice: 100,
          currency: 'USD',
          exchangeRate: 5.4,
          freightCost: 10,
          insuranceCost: 5,
          otherFees: 5,
          importDutyRate: 4,
          ipiRate: 2,
          pisRate: 2.1,
          cofinsRate: 9.65,
          offeredIncoterm: 'EXW',
          paymentTermsDays: 10,
        },
        {
          id: 2,
          quoteRequestId: 10,
          supplierId: 200,
          offeredPrice: 120,
          currency: 'USD',
          exchangeRate: 5.4,
          freightCost: 60,
          insuranceCost: 10,
          otherFees: 30,
          importDutyRate: 18,
          ipiRate: 8,
          pisRate: 2.1,
          cofinsRate: 9.65,
          offeredIncoterm: 'FOB',
          paymentTermsDays: 30,
        },
      ],
      {
        priceWeight: 80,
        paymentTermsWeight: 10,
        incotermWeight: 10,
      },
    );

    expect(results.find((result) => result.isWinner)?.id).toBe(1);
    expect(results[0].totalScore).not.toBe(results[1].totalScore);
    expect(results[0].totalLandedCost).toBeLessThan(results[1].totalLandedCost);
  });

  it('desempata por menor landed cost quando o score empata (nao first-occurrence)', () => {
    // Pesos só em incoterm: duas propostas com mesmo incoterm => score igual.
    // A tem custo maior, B tem custo menor. Vencedor deve ser B (menor landed cost),
    // mesmo chegando depois na lista — prova que o desempate não é first-occurrence.
    const results = QuoteComparisonService.compareResponses(
      [
        {
          id: 1,
          quoteRequestId: 10,
          supplierId: 100,
          offeredPrice: 100,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 50,
          insuranceCost: 10,
          otherFees: 10,
          importDutyRate: 0,
          ipiRate: 0,
          pisRate: 0,
          cofinsRate: 0,
          offeredIncoterm: 'FOB',
          paymentTermsDays: 10,
        },
        {
          id: 2,
          quoteRequestId: 10,
          supplierId: 200,
          offeredPrice: 80,
          currency: 'BRL',
          exchangeRate: 1,
          freightCost: 10,
          insuranceCost: 5,
          otherFees: 5,
          importDutyRate: 0,
          ipiRate: 0,
          pisRate: 0,
          cofinsRate: 0,
          offeredIncoterm: 'FOB',
          paymentTermsDays: 10,
        },
      ],
      { priceWeight: 0, paymentTermsWeight: 0, incotermWeight: 100 },
    );

    expect(results[0].totalScore).toBe(results[1].totalScore);
    expect(results[0].totalLandedCost).toBeGreaterThan(results[1].totalLandedCost);
    expect(results.find((result) => result.isWinner)?.id).toBe(2);
  });

  it('desempata por menor id quando score e landed cost empatam', () => {
    // Propostas idênticas exceto id e supplierId: desempate cai no menor id.
    const results = QuoteComparisonService.compareResponses([
      {
        id: 5,
        quoteRequestId: 10,
        supplierId: 100,
        offeredPrice: 100,
        currency: 'BRL',
        exchangeRate: 1,
        freightCost: 10,
        insuranceCost: 5,
        otherFees: 5,
        importDutyRate: 0,
        ipiRate: 0,
        pisRate: 0,
        cofinsRate: 0,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
      },
      {
        id: 3,
        quoteRequestId: 10,
        supplierId: 200,
        offeredPrice: 100,
        currency: 'BRL',
        exchangeRate: 1,
        freightCost: 10,
        insuranceCost: 5,
        otherFees: 5,
        importDutyRate: 0,
        ipiRate: 0,
        pisRate: 0,
        cofinsRate: 0,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
      },
    ]);

    expect(results[0].totalScore).toBe(results[1].totalScore);
    expect(results[0].totalLandedCost).toBe(results[1].totalLandedCost);
    expect(results.find((result) => result.isWinner)?.id).toBe(3);
  });
});
