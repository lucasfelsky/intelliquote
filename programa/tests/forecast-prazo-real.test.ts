import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORECAST_PRAZO_REAL_JANELA_DIAS,
  FORECAST_PRAZO_REAL_MAX_DIAS,
  FORECAST_PRAZO_REAL_MIN_CHEGADAS,
} from '../src/constants/forecast';
import type { DataDaCelula, FupLinha } from '../src/utils/forecastDbcorpRegras';
import { amostrasDePrazo, estatisticaDePrazo, prazoRealPorFonte } from '../src/utils/forecastPrazoReal';
import { somarDias } from '../src/utils/forecastMonths';
import type { AmostraPrazoFup } from '../src/utils/forecastTypes';

// Funcoes puras sobre linhas sinteticas (o repositorio e publico: nenhum dado real).
const BASE = '2033-06-30';

const vazia: DataDaCelula = { tipo: 'vazia' };
const data = (key: string): DataDaCelula => ({ tipo: 'data', key });

let contador = 0;
function linha(over: Partial<FupLinha> = {}): FupLinha {
  contador++;
  return {
    linha: contador + 1,
    status: 'CONCLUÍDO',
    codigo: 'TST0001',
    kg: 100,
    dataPo: vazia,
    prontidao: '',
    etd: vazia,
    eta: vazia,
    etaFinal: vazia,
    ...over,
  };
}

describe('amostrasDePrazo', () => {
  it('constantes do 3C', () => {
    expect(FORECAST_PRAZO_REAL_JANELA_DIAS).toBe(365);
    expect(FORECAST_PRAZO_REAL_MAX_DIAS).toBe(365);
    expect(FORECAST_PRAZO_REAL_MIN_CHEGADAS).toBe(3);
  });

  it('CONCLUIDO com ETA FINAL entra, com os dois intervalos', () => {
    const r = amostrasDePrazo(
      [linha({ dataPo: data('2033-01-01'), etd: data('2033-03-01'), etaFinal: data('2033-04-10') })],
      BASE,
    );
    expect(r).toEqual([{ codigo: 'TST0001', etaFinal: '2033-04-10', poDias: 99, etdDias: 40, prontidaoDias: null }]);
  });

  it('ATRAC. AG. LIBERACAO com ETA FINAL entra (qualquer status e historico)', () => {
    const r = amostrasDePrazo(
      [linha({ status: 'ATRAC. AG. LIBERAÇÃO', dataPo: data('2033-04-01'), etaFinal: data('2033-05-01') })],
      BASE,
    );
    expect(r).toHaveLength(1);
    expect(r[0].poDias).toBe(30);
  });

  it('sem ETA FINAL, ETA FINAL invalida ou depois da base: sai', () => {
    const r = amostrasDePrazo(
      [
        linha({ dataPo: data('2033-01-01'), etaFinal: vazia }),
        linha({ dataPo: data('2033-01-01'), etaFinal: { tipo: 'invalida' } }),
        linha({ dataPo: data('2033-01-01'), etaFinal: data('2033-07-01') }),
      ],
      BASE,
    );
    expect(r).toEqual([]);
  });

  it('ETA FINAL exatamente na base entra', () => {
    const r = amostrasDePrazo([linha({ dataPo: data('2033-06-01'), etaFinal: data(BASE) })], BASE);
    expect(r).toHaveLength(1);
  });

  it('ETA FINAL em base-365 entra e base-366 sai', () => {
    const limite = somarDias(BASE, -365);
    const fora = somarDias(BASE, -366);
    const r = amostrasDePrazo(
      [
        linha({ dataPo: data(somarDias(limite, -10)), etaFinal: data(limite) }),
        linha({ dataPo: data(somarDias(fora, -10)), etaFinal: data(fora) }),
      ],
      BASE,
    );
    expect(r.map((a) => a.etaFinal)).toEqual([limite]);
  });

  it('sem DATA PO: poDias null e etdDias preenchido', () => {
    const r = amostrasDePrazo([linha({ etd: data('2033-03-01'), etaFinal: data('2033-04-10') })], BASE);
    expect(r).toEqual([{ codigo: 'TST0001', etaFinal: '2033-04-10', poDias: null, etdDias: 40, prontidaoDias: null }]);
  });

  describe('DATA PRONTIDAO -> ETA FINAL', () => {
    it('data real (date key) da prontidaoDias; poDias e etdDias seguem iguais', () => {
      const r = amostrasDePrazo(
        [
          linha({
            dataPo: data('2033-01-01'),
            prontidao: '2033-02-20',
            etd: data('2033-03-01'),
            etaFinal: data('2033-04-10'),
          }),
        ],
        BASE,
      );
      expect(r).toEqual([{ codigo: 'TST0001', etaFinal: '2033-04-10', poDias: 99, etdDias: 40, prontidaoDias: 49 }]);
    });

    it('linha so com prontidao entra (poDias e etdDias null)', () => {
      const r = amostrasDePrazo([linha({ prontidao: '2033-03-01', etaFinal: data('2033-04-10') })], BASE);
      expect(r).toEqual([{ codigo: 'TST0001', etaFinal: '2033-04-10', poDias: null, etdDias: null, prontidaoDias: 40 }]);
    });

    it('texto MON DDth com DATA PO usa o ano da DATA PO', () => {
      const r = amostrasDePrazo(
        [linha({ dataPo: data('2033-02-01'), prontidao: 'MAR 5TH', etaFinal: data('2033-04-10') })],
        BASE,
      );
      expect(r[0].prontidaoDias).toBe(36); // 2033-03-05 -> 2033-04-10
    });

    it('sem DATA PO o ano e o mais recente que nao passa da ETA FINAL (virada do ano)', () => {
      const r = amostrasDePrazo(
        [linha({ prontidao: 'DEC 20TH', etaFinal: data('2034-02-10') })],
        '2034-03-01',
      );
      expect(r[0].prontidaoDias).toBe(52); // 2033-12-20 -> 2034-02-10
    });

    it('sem DATA PO e na mesma virada: JAN 5 com chegada em marco usa o proprio ano', () => {
      const r = amostrasDePrazo([linha({ prontidao: 'JAN 5', etaFinal: data('2033-03-01') })], BASE);
      expect(r[0].prontidaoDias).toBe(55); // 2033-01-05 -> 2033-03-01
    });

    it('ETA FINAL anterior a prontidao vira null e a linha sai se nada mais mede', () => {
      expect(amostrasDePrazo([linha({ prontidao: '2033-05-01', etaFinal: data('2033-04-10') })], BASE)).toEqual([]);
      const r = amostrasDePrazo(
        [linha({ prontidao: '2033-05-01', etd: data('2033-03-01'), etaFinal: data('2033-04-10') })],
        BASE,
      );
      expect(r[0].prontidaoDias).toBeNull();
      expect(r[0].etdDias).toBe(40);
    });

    it('prontidao depois do ETD da mesma linha anula so a prontidao', () => {
      const r = amostrasDePrazo(
        [
          linha({
            dataPo: data('2033-01-01'),
            prontidao: '2033-03-20',
            etd: data('2033-03-01'),
            etaFinal: data('2033-04-10'),
          }),
        ],
        BASE,
      );
      expect(r[0]).toMatchObject({ poDias: 99, etdDias: 40, prontidaoDias: null });
    });

    it('prontidao no mesmo dia do ETD vale', () => {
      const r = amostrasDePrazo(
        [linha({ prontidao: '2033-03-01', etd: data('2033-03-01'), etaFinal: data('2033-04-10') })],
        BASE,
      );
      expect(r[0].prontidaoDias).toBe(40);
    });

    it('texto nao reconhecido ou vazio vira null, sem derrubar a linha que mede outra coisa', () => {
      const r = amostrasDePrazo(
        [
          linha({ prontidao: 'ASAP', dataPo: data('2033-01-01'), etaFinal: data('2033-04-10') }),
          linha({ prontidao: '', dataPo: data('2033-01-01'), etaFinal: data('2033-04-10') }),
        ],
        BASE,
      );
      expect(r.map((a) => a.prontidaoDias)).toEqual([null, null]);
      expect(amostrasDePrazo([linha({ prontidao: 'ASAP', etaFinal: data('2033-04-10') })], BASE)).toEqual([]);
    });

    it('intervalo de 366 dias vira null; 365 se mantem', () => {
      const eta = '2033-04-10';
      const r = amostrasDePrazo(
        [
          linha({ prontidao: somarDias(eta, -366), etaFinal: data(eta) }),
          linha({ prontidao: somarDias(eta, -365), etaFinal: data(eta) }),
        ],
        BASE,
      );
      expect(r.map((a) => a.prontidaoDias)).toEqual([365]);
    });
  });

  it('DATA PO depois da ETA FINAL (negativo) vira null', () => {
    const r = amostrasDePrazo(
      [linha({ dataPo: data('2033-05-01'), etd: data('2033-03-01'), etaFinal: data('2033-04-10') })],
      BASE,
    );
    expect(r[0].poDias).toBeNull();
    expect(r[0].etdDias).toBe(40);
  });

  it('intervalo de 366 dias vira null; 365 se mantem', () => {
    const eta = '2033-04-10';
    const r = amostrasDePrazo(
      [linha({ dataPo: data(somarDias(eta, -366)), etd: data(somarDias(eta, -365)), etaFinal: data(eta) })],
      BASE,
    );
    expect(r[0].poDias).toBeNull();
    expect(r[0].etdDias).toBe(365);
  });

  it('os dois intervalos null: linha descartada', () => {
    const r = amostrasDePrazo(
      [
        linha({ etaFinal: data('2033-04-10') }),
        linha({ dataPo: data('2033-05-01'), etd: { tipo: 'invalida' }, etaFinal: data('2033-04-10') }),
      ],
      BASE,
    );
    expect(r).toEqual([]);
  });

  it('sem codigo sai; a ordem das linhas e mantida', () => {
    const r = amostrasDePrazo(
      [
        linha({ codigo: '', dataPo: data('2033-01-01'), etaFinal: data('2033-04-10') }),
        linha({ codigo: 'TST0002', dataPo: data('2033-02-01'), etaFinal: data('2033-04-10') }),
        linha({ codigo: 'TST0001', dataPo: data('2033-03-01'), etaFinal: data('2033-04-10') }),
      ],
      BASE,
    );
    expect(r.map((a) => a.codigo)).toEqual(['TST0002', 'TST0001']);
  });
});

describe('estatisticaDePrazo', () => {
  it('lista vazia -> null', () => {
    expect(estatisticaDePrazo([])).toBeNull();
  });

  it('n impar: mediana e o elemento do meio', () => {
    expect(estatisticaDePrazo([90, 10, 30])).toEqual({
      chegadas: 3,
      media: 43,
      mediana: 30,
      min: 10,
      max: 90,
      poucasChegadas: false,
    });
  });

  it('n par: mediana arredondada', () => {
    const e = estatisticaDePrazo([10, 20, 31, 40]);
    expect(e?.mediana).toBe(26); // (20 + 31) / 2 = 25,5
    expect(e?.media).toBe(25); // 101 / 4 = 25,25
    expect(e?.chegadas).toBe(4);
  });

  it('n=2 marca poucas chegadas; n=3 nao', () => {
    expect(estatisticaDePrazo([10, 20])?.poucasChegadas).toBe(true);
    expect(estatisticaDePrazo([10, 20, 30])?.poucasChegadas).toBe(false);
  });

  it('nao altera o array de entrada', () => {
    const dias = [30, 10, 20];
    estatisticaDePrazo(dias);
    expect(dias).toEqual([30, 10, 20]);
  });
});

describe('prazoRealPorFonte', () => {
  const amostra = (codigo: string, poDias: number | null, etdDias: number | null): AmostraPrazoFup => ({
    codigo,
    etaFinal: '2033-04-10',
    poDias,
    etdDias,
  });

  it('agrupa por fonte do codigo e conta o codigo sem fonte', () => {
    const r = prazoRealPorFonte(
      [amostra('TST0001', 60, 30), amostra('TST0001', 80, 40), amostra('TST0002', 100, 50), amostra('TST0009', 10, 10)],
      new Map([
        ['TST0001', 1],
        ['TST0002', 2],
      ]),
    );
    expect(r.semFonte).toEqual({ chegadas: 1 });
    expect(r.porFonte.get(1)?.po).toMatchObject({ chegadas: 2, media: 70, mediana: 70, min: 60, max: 80 });
    expect(r.porFonte.get(1)?.etd).toMatchObject({ chegadas: 2, media: 35 });
    expect(r.porFonte.get(2)?.po).toMatchObject({ chegadas: 1, media: 100, poucasChegadas: true });
    expect(r.porFonte.has(3)).toBe(false);
  });

  it('prontidao: agrupa por fonte, ignora null e chave ausente (snapshot antigo)', () => {
    const r = prazoRealPorFonte(
      [
        { ...amostra('TST0001', 60, 30), prontidaoDias: 50 },
        { ...amostra('TST0001', 80, 40), prontidaoDias: 70 },
        { ...amostra('TST0001', 80, 40), prontidaoDias: null },
        amostra('TST0001', 90, 45),
        { ...amostra('TST0009', 10, 10), prontidaoDias: 5 },
      ],
      new Map([['TST0001', 1]]),
    );
    expect(r.porFonte.get(1)?.prontidao).toMatchObject({ chegadas: 2, media: 60, mediana: 60, min: 50, max: 70 });
    expect(r.porFonte.get(1)?.po?.chegadas).toBe(4);
  });

  it('prontidao null quando nenhuma amostra da fonte a mede', () => {
    const r = prazoRealPorFonte([amostra('TST0001', 60, 30)], new Map([['TST0001', 1]]));
    expect(r.porFonte.get(1)?.prontidao).toBeNull();
  });

  it('po null quando nenhuma amostra da fonte tem poDias', () => {
    const r = prazoRealPorFonte([amostra('TST0001', null, 30)], new Map([['TST0001', 1]]));
    expect(r.porFonte.get(1)?.po).toBeNull();
    expect(r.porFonte.get(1)?.etd?.chegadas).toBe(1);
  });
});

describe('pureza do util', () => {
  it('forecastPrazoReal.ts nao importa exceljs nem Prisma e nao usa relogio', () => {
    const fonte = readFileSync(resolve(__dirname, '../src/utils/forecastPrazoReal.ts'), 'utf8');
    expect(fonte).not.toMatch(/exceljs|prisma|new Date|toISOString/i);
  });
});
