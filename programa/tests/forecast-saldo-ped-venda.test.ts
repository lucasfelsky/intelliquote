import { describe, expect, it } from 'vitest';
import { coletorSaldoPedVenda } from '../src/utils/forecastSaldoPedVenda';

// Dados 100% sinteticos (repositorio publico): codigos TST..., quantidades inventadas.

describe('coletorSaldoPedVenda', () => {
  it('soma por codigo normalizado (trim + maiusculas)', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', 10);
    c.adicionar(' tst0001 ', 5);
    c.adicionar('TST0002', 3);
    expect(c.linhas()).toEqual([
      { codigo: 'TST0001', qtd: 15 },
      { codigo: 'TST0002', qtd: 3 },
    ]);
  });

  it('arredonda a soma em 6 casas (0.1 + 0.2 = 0.3)', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', 0.1);
    c.adicionar('TST0001', 0.2);
    expect(c.linhas()).toEqual([{ codigo: 'TST0001', qtd: 0.3 }]);
  });

  it('guarda so qtd > 0 e ordena por codigo com comparacao simples', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0003', 1);
    c.adicionar('TST0002', 0);
    c.adicionar('TST0001', 2);
    c.adicionar('TST00010', 4);
    expect(c.linhas().map((l) => l.codigo)).toEqual(['TST0001', 'TST00010', 'TST0003']);
  });

  it('vazio vale 0 e nao descarta nada', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', null);
    c.adicionar('TST0001', '   ');
    c.adicionar('TST0001', 7);
    expect(c.linhas()).toEqual([{ codigo: 'TST0001', qtd: 7 }]);
  });

  it('descarta em silencio negativo, nao finito, texto e data', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('TST0001', 4);
    c.adicionar('TST0001', -2);
    c.adicionar('TST0001', Number.NaN);
    c.adicionar('TST0001', Number.POSITIVE_INFINITY);
    c.adicionar('TST0001', Number.NEGATIVE_INFINITY);
    c.adicionar('TST0001', 'abc');
    c.adicionar('TST0001', '12');
    c.adicionar('TST0001', '2026-10-15');
    expect(c.linhas()).toEqual([{ codigo: 'TST0001', qtd: 4 }]);
  });

  it('codigo vazio nao entra', () => {
    const c = coletorSaldoPedVenda();
    c.adicionar('   ', 9);
    expect(c.linhas()).toEqual([]);
  });

  it('sem nada (ou so zeros/invalidos) devolve []', () => {
    const c = coletorSaldoPedVenda();
    expect(c.linhas()).toEqual([]);
    c.adicionar('TST0001', 0);
    c.adicionar('TST0002', -1);
    c.adicionar('TST0003', 'x');
    expect(c.linhas()).toEqual([]);
  });
});
