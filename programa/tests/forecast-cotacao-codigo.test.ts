import { describe, expect, it } from 'vitest';
import { codigosPorFonte } from '../src/utils/forecastCotacaoCodigo';

describe('codigosPorFonte', () => {
  it('casa pela chave normalizada da fonte (trim + maiusculas)', () => {
    const { mapa, foraDoLote } = codigosPorFonte([{ fonte: ' eternal ', requestCode: 'CMX-1' }], new Set(['ETERNAL', 'OUTRA']));
    expect([...mapa.entries()]).toEqual([['ETERNAL', 'CMX-1']]);
    expect(foraDoLote).toEqual([]);
  });

  it('sem entrada: mapa vazio e nada fora do lote', () => {
    for (const entrada of [undefined, []]) {
      const { mapa, foraDoLote } = codigosPorFonte(entrada, new Set(['ETERNAL']));
      expect(mapa.size).toBe(0);
      expect(foraDoLote).toEqual([]);
    }
  });

  it('fonte fora do lote vai para foraDoLote e nao entra no mapa', () => {
    const { mapa, foraDoLote } = codigosPorFonte(
      [
        { fonte: 'ETERNAL', requestCode: 'A-1' },
        { fonte: ' Desconhecida ', requestCode: 'B-2' },
      ],
      new Set(['ETERNAL']),
    );
    expect([...mapa.entries()]).toEqual([['ETERNAL', 'A-1']]);
    expect(foraDoLote).toEqual(['Desconhecida']);
  });

  it('fonte sem entrada fica de fora do mapa (segue com o codigo gerado)', () => {
    const { mapa } = codigosPorFonte([{ fonte: 'A', requestCode: 'X-1' }], new Set(['A', 'B']));
    expect(mapa.has('A')).toBe(true);
    expect(mapa.has('B')).toBe(false);
  });
});
