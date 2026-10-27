import { describe, expect, it } from 'vitest';
import {
  calendarioGlobal,
  cortarAte,
  normalizarSeries,
  serieDaQuinzena,
  somarMeses,
  ultimoMes,
} from '../src/utils/forecastPreditivoSerie';
import type { SerieEntrada } from '../src/utils/forecastPreditivoTipos';
import type { Quinzena } from '../src/utils/forecastTypes';
import { serieLacuna, seriesSinteticas } from './helpers/forecastPreditivoSinteticas';

const pontos = (inicio: string, qtds: number[]) => qtds.map((qtd, i) => ({ anoMes: somarMeses(inicio, i), qtd }));
const sintetica = (id: string) => {
  const { series } = normalizarSeries(seriesSinteticas());
  return series.find((s) => s.id === id)!;
};

describe('somarMeses', () => {
  it('atravessa o ano por indice absoluto', () => {
    expect(somarMeses('2024-12', 1)).toBe('2025-01');
    expect(somarMeses('2025-01', -1)).toBe('2024-12');
    expect(somarMeses('2024-01', 24)).toBe('2026-01');
    expect(somarMeses('2026-03', -14)).toBe('2025-01');
    expect(somarMeses('2026-03', 0)).toBe('2026-03');
  });
});

describe('calendarioGlobal', () => {
  it('une os meses validos de todas as series, ordenados e sem repeticao', () => {
    const cal = calendarioGlobal([
      { id: 'a', pontos: [{ anoMes: '2025-03', qtd: 1 }, { anoMes: '2025-01', qtd: 1 }] },
      { id: 'b', pontos: [{ anoMes: '2025-03', qtd: 1 }, { anoMes: '2025-13', qtd: 1 }, { anoMes: '2025-02', qtd: NaN }] },
    ]);
    expect(cal).toEqual(['2025-01', '2025-03']);
  });
});

describe('normalizarSeries', () => {
  it('ordena por id e nao altera a entrada', () => {
    const entrada: SerieEntrada[] = [
      { id: 'b', pontos: pontos('2025-01', [1, 2]) },
      { id: 'a', pontos: pontos('2025-01', [3, 4]) },
    ];
    const copia = JSON.parse(JSON.stringify(entrada));
    const { series, erros } = normalizarSeries(entrada);
    expect(series.map((s) => s.id)).toEqual(['a', 'b']);
    expect(erros).toEqual([]);
    expect(entrada).toEqual(copia);
  });

  it('CONST: 36 meses de 100, sem mascara nem aviso', () => {
    const s = sintetica('CONST');
    expect(s.inicio).toBe('2024-01');
    expect(s.valores).toHaveLength(36);
    expect(s.valores.every((v) => v === 100)).toBe(true);
    expect(s.mascara.some(Boolean)).toBe(false);
    expect(s.avisos).toEqual([]);
    expect(s.meta).toEqual({ fonte: 'F01', familia: 'FAM1', leadTimeDias: 90 });
    expect(ultimoMes(s)).toBe('2026-12');
  });

  it('NOVA: comeca no proprio primeiro mes, sem zeros antes dele', () => {
    const s = sintetica('NOVA');
    expect(s.inicio).toBe('2026-11');
    expect(s.valores).toEqual([50, 70]);
  });

  it('ZERO: linhas explicitas de zero a partir de 2025-01', () => {
    const s = sintetica('ZERO');
    expect(s.inicio).toBe('2025-01');
    expect(s.valores).toHaveLength(24);
    expect(s.valores.every((v) => v === 0)).toBe(true);
  });

  it('mes ausente que existe no calendario global vira venda zero', () => {
    const { series } = normalizarSeries([
      { id: 'a', pontos: pontos('2025-01', [5, 6, 7]) },
      { id: 'b', pontos: [{ anoMes: '2025-01', qtd: 1 }, { anoMes: '2025-03', qtd: 3 }] },
    ]);
    expect(series.find((s) => s.id === 'b')!.valores).toEqual([1, 0, 3]);
  });

  it('serie que acaba antes do fim do calendario ganha zeros ate o fim', () => {
    const { series } = normalizarSeries([
      { id: 'a', pontos: pontos('2025-01', [5, 6, 7]) },
      { id: 'b', pontos: pontos('2025-01', [1]) },
    ]);
    expect(series.find((s) => s.id === 'b')!.valores).toEqual([1, 0, 0]);
  });

  it('lacuna global: usa so o trecho final e avisa', () => {
    const { series } = normalizarSeries(serieLacuna());
    expect(series).toHaveLength(2);
    for (const s of series) {
      expect(s.inicio).toBe('2025-07');
      expect(s.valores).toHaveLength(6);
      expect(s.avisos).toEqual(['lacuna-cortada']);
    }
    expect(series[0].valores).toEqual([28, 29, 30, 31, 32, 33]);
  });

  it('ponto invalido e descartado e o erro nao traz o valor', () => {
    const { series, erros } = normalizarSeries([
      {
        id: 'x',
        pontos: [
          { anoMes: '2025-01', qtd: 5 },
          { anoMes: '2025-1', qtd: 777 },
          { anoMes: '2025-02', qtd: Infinity },
          { anoMes: '2025-02', qtd: 6 },
        ],
      },
    ]);
    expect(series[0].valores).toEqual([5, 6]);
    expect(erros).toEqual(['serie x: ponto invalido', 'serie x: ponto invalido']);
    expect(erros.join(' ')).not.toContain('777');
  });

  it('serie sem nenhum ponto valido sai vazia', () => {
    const { series } = normalizarSeries([
      { id: 'vazia', pontos: [] },
      { id: 'ok', pontos: pontos('2025-01', [1]) },
    ]);
    expect(series[0]).toMatchObject({ id: 'ok', valores: [1] });
    expect(series[1]).toMatchObject({ id: 'vazia', valores: [], mascara: [], avisos: [] });
    expect(normalizarSeries([]).series).toEqual([]);
  });

  it('mes duplicado soma, junta as marcas (OU) e avisa', () => {
    const { series } = normalizarSeries([
      {
        id: 'd',
        pontos: [
          { anoMes: '2025-01', qtd: 10 },
          { anoMes: '2025-01', qtd: 5, atipico: true },
          { anoMes: '2025-02', qtd: 7 },
        ],
      },
    ]);
    expect(series[0].valores).toEqual([15, 7]);
    expect(series[0].mascara).toEqual([true, false]);
    expect(series[0].avisos).toEqual(['mes-duplicado-somado']);
  });

  it('quantidade negativa vira 0 com aviso', () => {
    const { series } = normalizarSeries([{ id: 'n', pontos: pontos('2025-01', [4, -3, 5]) }]);
    expect(series[0].valores).toEqual([4, 0, 5]);
    expect(series[0].avisos).toEqual(['negativo-zerado']);
  });

  it('ATIP: so o mes atipico e mascarado', () => {
    const s = sintetica('ATIP');
    expect(s.valores[34]).toBe(500);
    expect(s.mascara.filter(Boolean)).toHaveLength(1);
    expect(s.mascara[34]).toBe(true);
    expect(s.avisos).toEqual([]);
  });

  it('RUPT: ruptura abaixo do nivel recente e mascarada (e o mascarado sai da media do mes seguinte)', () => {
    const s = sintetica('RUPT');
    expect(s.mascara.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)).toEqual([33, 34]);
  });

  it('ruptura acima do nivel, ou sem mes anterior, nao e mascarada', () => {
    const { series } = normalizarSeries([
      {
        id: 'r',
        pontos: [
          { anoMes: '2025-01', qtd: 0, ruptura: true },
          { anoMes: '2025-02', qtd: 10 },
          { anoMes: '2025-03', qtd: 10 },
          { anoMes: '2025-04', qtd: 50, ruptura: true },
          { anoMes: '2025-05', qtd: 2, ruptura: true },
        ],
      },
    ]);
    expect(series[0].mascara).toEqual([false, false, false, false, true]);
  });

  it('DEGRAU avisa; series estaveis, curtas ou toda zero nao', () => {
    expect(sintetica('DEGRAU').avisos).toEqual(['degrau-nivel']);
    for (const id of ['CONST', 'TEND', 'SAZ', 'INTERM', 'LUMPY', 'RUIDO', 'NOVA', 'ZERO', 'ATIP', 'RUPT']) {
      expect(sintetica(id).avisos).toEqual([]);
    }
    expect(sintetica('DEGRAU').valores[12]).toBe(10000); // o aviso nao altera os valores
  });

  it('meta: lead time fora de 0..3650 ou nao inteiro vira null; vazio vira null', () => {
    const { series } = normalizarSeries([
      { id: 'a', pontos: pontos('2025-01', [1]), leadTimeDias: 4000, fonte: ' ', familia: 'F' },
      { id: 'b', pontos: pontos('2025-01', [1]), leadTimeDias: 12.5 },
      { id: 'c', pontos: pontos('2025-01', [1]), leadTimeDias: 0 },
    ]);
    expect(series[0].meta).toEqual({ fonte: null, familia: 'F', leadTimeDias: null });
    expect(series[1].meta.leadTimeDias).toBeNull();
    expect(series[2].meta.leadTimeDias).toBe(0);
  });
});

describe('cortarAte', () => {
  const s = sintetica('TEND');
  it('devolve o prefixo ate o mes, com mascara e avisos', () => {
    const c = cortarAte(s, '2024-06')!;
    expect(c.valores).toEqual([100, 105, 110, 115, 120, 125]);
    expect(c.mascara).toHaveLength(6);
    expect(c.inicio).toBe('2024-01');
    expect(ultimoMes(c)).toBe('2024-06');
  });
  it('null antes do inicio; serie inteira depois do fim', () => {
    const nova = sintetica('NOVA');
    expect(cortarAte(nova, '2026-10')).toBeNull();
    expect(cortarAte(nova, '2026-11')!.valores).toEqual([50]);
    expect(cortarAte(nova, '2030-01')!.valores).toEqual([50, 70]);
    expect(cortarAte({ ...nova, valores: [], mascara: [], inicio: '' }, '2026-12')).toBeNull();
  });
  it('a mascara cortada e a mesma da serie completa (sem olhar o futuro)', () => {
    const rupt = sintetica('RUPT');
    expect(cortarAte(rupt, '2026-10')!.mascara[33]).toBe(true);
    expect(cortarAte(rupt, '2026-09')!.mascara.some(Boolean)).toBe(false);
  });
});

describe('serieDaQuinzena', () => {
  const quinzena = {
    id: '10-2',
    dataBase: '2026-10-15',
    produtos: [
      { linha: 3, codigos: ['c1', 'C2', '', '', '', '', ''], historico: [1, 2, 3, 4, 5], fonte: 'f1' },
      { linha: 4, codigos: ['C9', '', '', '', '', '', ''], historico: [0, 0, 0, 0, 0], fonte: '' },
    ],
    entradas: {
      vendasMes: [
        { codigo: 'C1', qtd: 10 },
        { codigo: 'c2', qtd: 5 },
        { codigo: 'C1', qtd: 1 },
        { codigo: '', qtd: 99 },
      ],
      leadtime: [
        { fonte: 'F1', total: 81 },
        { fonte: 'F1', total: 7 },
      ],
    },
  } as unknown as Quinzena;

  it('uma serie por produto: J..N do historico e O das vendas do mes por codigo', () => {
    const [a, b] = serieDaQuinzena(quinzena);
    expect(a.id).toBe('linha-3');
    expect(a.pontos.map((p) => p.anoMes)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(a.pontos.map((p) => p.qtd)).toEqual([1, 2, 3, 4, 5, 16]);
    expect(a.fonte).toBe('f1');
    expect(a.leadTimeDias).toBe(81); // primeira linha da fonte, sem diferenciar maiusculas
    expect(b.id).toBe('linha-4');
    expect(b.pontos[5].qtd).toBe(0);
    expect(b.fonte).toBeUndefined();
    expect(b.leadTimeDias).toBeNull();
    expect(a.pontos.some((p) => p.atipico || p.ruptura)).toBe(false);
  });
});
