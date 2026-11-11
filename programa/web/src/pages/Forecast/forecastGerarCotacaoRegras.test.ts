import { describe, expect, it } from 'vitest';
import {
  codigoParaCotacao,
  descricaoDoForecast,
  kgInteiroParaCima,
  lerParamFromForecast,
  MOTIVO_ACIMA_LIMITE,
  MOTIVO_NAO_COMPRAR,
  MOTIVO_SEM_QUANTIDADE,
  quantidadeParaCotacao,
} from './forecastGerarCotacaoRegras';

// Dados 100% sinteticos.
describe('lerParamFromForecast', () => {
  it('ausente = null (hook inerte)', () => {
    expect(lerParamFromForecast(null)).toBeNull();
  });

  it('formato <snapshotId>-<productId>', () => {
    expect(lerParamFromForecast('7-42')).toEqual({ snapshotId: 7, productId: 42 });
    expect(lerParamFromForecast('2147483647-2147483647')).toEqual({ snapshotId: 2147483647, productId: 2147483647 });
  });

  it.each(['', 'abc', '7-', '-42', '0-1', '7-0', '7-42-1', ' 7-42', '7-2147483648', '07-42', '7-42 ', '7_42'])(
    'malformado %j = invalido',
    (raw) => {
      expect(lerParamFromForecast(raw)).toBe('invalido');
    },
  );

});

describe('codigoParaCotacao', () => {
  const c = (code: string, position: number, catalogItemId: number | null) => ({ code, position, catalogItemId });

  it('a embalagem principal vinculada vence o 1o vinculado', () => {
    const r = codigoParaCotacao([c('C0001', 1, 10), c('C0002', 2, 11)], 'C0002');
    expect(r?.code).toBe('C0002');
  });

  it('principal SEM vinculo: usa o 1o vinculado por position (entrada fora de ordem)', () => {
    const r = codigoParaCotacao([c('C0003', 3, 12), c('C0002', 2, null), c('C0001', 1, 10)], 'C0002');
    expect(r?.code).toBe('C0001');
  });

  it('sem principal: o 1o vinculado por position', () => {
    expect(codigoParaCotacao([c('C0002', 2, 11), c('C0001', 1, null), c('C0003', 3, 12)], null)?.code).toBe('C0002');
    expect(codigoParaCotacao([c('C0002', 2, 11), c('C0001', 1, 10)], undefined)?.code).toBe('C0001');
  });

  it('principal que nao esta na lista cai no 1o vinculado', () => {
    expect(codigoParaCotacao([c('C0001', 1, 10)], 'C9999')?.code).toBe('C0001');
  });

  it('nenhum vinculado = null', () => {
    expect(codigoParaCotacao([c('C0001', 1, null)], 'C0001')).toBeNull();
    expect(codigoParaCotacao([], null)).toBeNull();
  });

  it('nao reordena a lista recebida', () => {
    const entrada = [c('C0002', 2, 11), c('C0001', 1, 10)];
    codigoParaCotacao(entrada, null);
    expect(entrada.map((x) => x.code)).toEqual(['C0002', 'C0001']);
  });
});

describe('kgInteiroParaCima / quantidadeParaCotacao', () => {
  it('teto em kg inteiro, depois de arredondar a 3 casas', () => {
    expect(kgInteiroParaCima(1234.5)).toBe(1235);
    expect(kgInteiroParaCima(125.0000001)).toBe(125);
    expect(kgInteiroParaCima(125.12345)).toBe(126);
    expect(kgInteiroParaCima(125)).toBe(125);
  });

  it('decisao salva > 0 vale (origem decidida)', () => {
    expect(quantidadeParaCotacao(1234.5, 0)).toEqual({ ok: true, quantidade: 1235, origem: 'decidida' });
    expect(quantidadeParaCotacao(125.0000001, 40)).toEqual({ ok: true, quantidade: 125, origem: 'decidida' });
  });

  it('decisao salva = 0 bloqueia (mesmo com sugerida > 0)', () => {
    expect(quantidadeParaCotacao(0, 500)).toEqual({ ok: false, motivo: MOTIVO_NAO_COMPRAR });
  });

  it('sem decisao: usa a Qtd. final sugerida (origem sugerida)', () => {
    expect(quantidadeParaCotacao(null, 125.12345)).toEqual({ ok: true, quantidade: 126, origem: 'sugerida' });
    expect(quantidadeParaCotacao(undefined, 125)).toEqual({ ok: true, quantidade: 125, origem: 'sugerida' });
  });

  it('sem decisao e sugerida <= 0 ou nao finita: sem quantidade', () => {
    for (const n of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.0004]) {
      expect(quantidadeParaCotacao(null, n)).toEqual({ ok: false, motivo: MOTIVO_SEM_QUANTIDADE });
    }
  });

  it('acima do limite do inteiro do banco', () => {
    expect(quantidadeParaCotacao(2147483647, 0)).toMatchObject({ ok: true, quantidade: 2147483647 });
    expect(quantidadeParaCotacao(2147483648, 0)).toEqual({ ok: false, motivo: MOTIVO_ACIMA_LIMITE });
    expect(quantidadeParaCotacao(null, 3e9)).toEqual({ ok: false, motivo: MOTIVO_ACIMA_LIMITE });
  });
});

describe('descricaoDoForecast', () => {
  it('so o rotulo da quinzena', () => {
    expect(descricaoDoForecast('11-1')).toBe('Forecast 11-1');
  });
});
