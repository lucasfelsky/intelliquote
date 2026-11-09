import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORECAST_PRAZO_REAL_JANELA_DIAS,
  FORECAST_PRAZO_SUGESTAO_DIFERENCA_MIN_DIAS,
  FORECAST_PRAZO_SUGESTAO_DISPERSAO_ALTA_DIAS,
  FORECAST_PRAZO_SUGESTAO_JANELA_DIAS,
  FORECAST_PRAZO_SUGESTAO_MIN_AMOSTRAS,
  FORECAST_PRAZO_SUGESTAO_PERCENTIL,
} from '../src/constants/forecast';
import {
  PRAZO_CHEGADA_PADRAO,
  resumirPrazosEstimativa,
  type FontePrazoInfo,
  type MudancaDePrazo,
} from '../src/utils/forecastDbcorpRegras';
import { somarDias } from '../src/utils/forecastMonths';
import {
  anexarSugestoes,
  contarFontesComSugestao,
  contarMudancasIguaisASugestao,
  percentilDePrazo,
  sugerirPrazosChegada,
  type ResumoPrazosComSugestao,
  type SugestaoPrazoDaFonte,
} from '../src/utils/forecastPrazoReal';
import type { AmostraPrazoFup } from '../src/utils/forecastTypes';

// Funcoes puras sobre amostras sinteticas (o repositorio e publico: nenhum dado real). Fontes FIC-FONTE-n.
const BASE = '2033-06-30';
const ETA = '2033-04-10';

const fonte = (sourceId: number, salvo: Partial<FontePrazoInfo['salvo']> = {}): FontePrazoInfo => ({
  sourceId,
  nome: `FIC-FONTE-${sourceId}`,
  salvo: { prontidaoDias: null, etdDias: null, ...salvo },
});

const amostra = (
  codigo: string,
  prontidaoDias: number | null,
  etdDias: number | null,
  etaFinal = ETA,
): AmostraPrazoFup => ({ codigo, etaFinal, poDias: null, etdDias, prontidaoDias });

const repetir = <T>(n: number, fn: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => fn(i));

const mapa = (...pares: Array<[string, number]>) => new Map(pares);

function sugerir(
  amostras: AmostraPrazoFup[],
  fontes: FontePrazoInfo[] = [fonte(1)],
  fonteDoCodigo: ReadonlyMap<string, number> = mapa(['FIC0001', 1]),
  config?: Parameters<typeof sugerirPrazosChegada>[0]['config'],
) {
  return sugerirPrazosChegada({ amostras, fonteDoCodigo, fontes, padrao: PRAZO_CHEGADA_PADRAO, baseDate: BASE, config });
}

const prontidaoDe = (amostras: AmostraPrazoFup[], fontes?: FontePrazoInfo[], config?: Parameters<typeof sugerir>[3]) =>
  sugerir(amostras, fontes, undefined, config).get(1)?.prontidao;

describe('constantes da sugestao', () => {
  it('percentil 0.75, minimo 10, diferenca 5, janela 365 (<= janela do prazo real)', () => {
    expect(FORECAST_PRAZO_SUGESTAO_PERCENTIL).toBe(0.75);
    expect(FORECAST_PRAZO_SUGESTAO_MIN_AMOSTRAS).toBe(10);
    expect(FORECAST_PRAZO_SUGESTAO_DIFERENCA_MIN_DIAS).toBe(5);
    expect(FORECAST_PRAZO_SUGESTAO_JANELA_DIAS).toBe(365);
    expect(FORECAST_PRAZO_SUGESTAO_JANELA_DIAS).toBeLessThanOrEqual(FORECAST_PRAZO_REAL_JANELA_DIAS);
    expect(FORECAST_PRAZO_SUGESTAO_DISPERSAO_ALTA_DIAS).toBe(30);
  });
});

describe('percentilDePrazo (nearest-rank)', () => {
  it('lista vazia = null', () => {
    expect(percentilDePrazo([], 0.75)).toBeNull();
  });

  it('n par e n impar', () => {
    expect(percentilDePrazo([40, 10, 30, 20], 0.75)).toBe(30); // ceil(3) = 3
    expect(percentilDePrazo([50, 10, 30, 20, 40], 0.75)).toBe(40); // ceil(3,75) = 4
    expect(percentilDePrazo([7], 0.75)).toBe(7);
  });

  it('limites e erro de ponto flutuante', () => {
    const dez = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentilDePrazo(dez, 0.7)).toBe(7); // 0.7 * 10 = 7.000000000000001 nao pode virar o 8o
    expect(percentilDePrazo(dez, 1)).toBe(10);
    expect(percentilDePrazo(dez, 0)).toBe(1);
    expect(percentilDePrazo(dez, 0.5)).toBe(5);
  });

  it('nao altera a entrada', () => {
    const dias = [30, 10, 20];
    percentilDePrazo(dias, 0.75);
    expect(dias).toEqual([30, 10, 20]);
  });
});

describe('sugerirPrazosChegada - minimo de amostras e valor sugerido', () => {
  it('9 chegadas = poucas_amostras, sem dias; 10 = sugerida', () => {
    const nove = prontidaoDe(repetir(9, () => amostra('FIC0001', 61, null)));
    expect(nove).toMatchObject({ situacao: 'poucas_amostras', dias: null, minAmostras: 10 });
    expect(nove?.evidencia.amostras).toBe(9);
    const dez = prontidaoDe(repetir(10, () => amostra('FIC0001', 61, null)));
    expect(dez).toMatchObject({ situacao: 'sugerida', dias: 61 });
  });

  it('o valor sugerido e o P75, nao a mediana nem a media', () => {
    // 79 chegadas: 39 x 50, 20 x 61, 20 x 70 -> mediana 61 (40a), P75 70 (60a).
    const dias = [...repetir(39, () => 50), ...repetir(20, () => 61), ...repetir(20, () => 70)];
    const campo = prontidaoDe(dias.map((d) => amostra('FIC0001', d, null)));
    expect(campo).toMatchObject({ situacao: 'sugerida', dias: 70, atual: 35 });
    expect(campo?.evidencia).toMatchObject({
      amostras: 79,
      mediana: 61,
      percentil: 75,
      valorPercentil: 70,
      min: 50,
      max: 70,
      dispersaoAlta: false,
    });
  });

  it('outlier nao puxa o valor (media seria 19)', () => {
    const campo = prontidaoDe([...repetir(9, () => 10), 100].map((d) => amostra('FIC0001', d, null)));
    expect(campo?.dias).toBe(10);
    expect(campo?.evidencia.mediana).toBe(10);
    expect(campo?.evidencia.max).toBe(100);
  });

  it('config.percentil = 0.5 troca o valor para a mediana (constante trocavel)', () => {
    const dias = [...repetir(39, () => 50), ...repetir(20, () => 61), ...repetir(20, () => 70)];
    const campo = prontidaoDe(
      dias.map((d) => amostra('FIC0001', d, null)),
      undefined,
      { percentil: 0.5 },
    );
    expect(campo).toMatchObject({ situacao: 'sugerida', dias: 61 });
    expect(campo?.evidencia.percentil).toBe(50);
  });

  it('ETD mede por campo independente da prontidao', () => {
    const sugestao = sugerir(repetir(112, () => amostra('FIC0001', null, 41))).get(1);
    expect(sugestao?.prontidao).toBeNull();
    expect(sugestao?.etd).toMatchObject({ situacao: 'sugerida', dias: 41, atual: 35 });
    expect(sugestao?.etd?.evidencia.amostras).toBe(112);
  });

  it('chegada com prontidaoDias ausente (snapshot antigo) nao conta para a prontidao', () => {
    const antigas = repetir(12, () => ({ codigo: 'FIC0001', etaFinal: ETA, poDias: null, etdDias: 41 }));
    const sugestao = sugerir(antigas).get(1);
    expect(sugestao?.prontidao).toBeNull();
    expect(sugestao?.etd?.situacao).toBe('sugerida');
  });
});

describe('sugerirPrazosChegada - dispersao (a sugestao continua aparecendo)', () => {
  // 20 chegadas: 14 x 66, 6 x 122 -> mediana 66, P75 (15a) 122.
  const dispersas = [...repetir(14, () => 66), ...repetir(6, () => 122)].map((d) => amostra('FIC0001', d, null));

  it('P75 muito acima da mediana: marca dispersaoAlta e mantem a sugestao', () => {
    const campo = prontidaoDe(dispersas);
    expect(campo).toMatchObject({ situacao: 'sugerida', dias: 122 });
    expect(campo?.evidencia).toMatchObject({ mediana: 66, valorPercentil: 122, min: 66, max: 122, dispersaoAlta: true });
  });

  it('o limite e inclusivo', () => {
    expect(prontidaoDe(dispersas, undefined, { dispersaoAltaDias: 56 })?.evidencia.dispersaoAlta).toBe(true);
    expect(prontidaoDe(dispersas, undefined, { dispersaoAltaDias: 57 })?.evidencia.dispersaoAlta).toBe(false);
  });
});

describe('sugerirPrazosChegada - diferenca contra o prazo atual (salvo ?? padrao)', () => {
  const todas = (d: number) => repetir(20, () => amostra('FIC0001', d, null));

  it('|61 - 35| = 26: sugerida', () => {
    expect(prontidaoDe(todas(61))).toMatchObject({ situacao: 'sugerida', dias: 61, atual: 35 });
  });

  it('valor 38 contra o padrao 35: diferenca_pequena, com o valor calculado', () => {
    expect(prontidaoDe(todas(38))).toMatchObject({ situacao: 'diferenca_pequena', dias: 38, atual: 35 });
  });

  it('o limite e 5 dias: 40 sugere, 39 nao', () => {
    expect(prontidaoDe(todas(40))?.situacao).toBe('sugerida');
    expect(prontidaoDe(todas(39))?.situacao).toBe('diferenca_pequena');
    expect(prontidaoDe(todas(30))?.situacao).toBe('sugerida');
    expect(prontidaoDe(todas(31))?.situacao).toBe('diferenca_pequena');
  });

  it('compara com o salvo da fonte, nao com o 35 fixo', () => {
    const salvo61 = [fonte(1, { prontidaoDias: 61 })];
    expect(prontidaoDe(todas(61), salvo61)).toMatchObject({ situacao: 'diferenca_pequena', dias: 61, atual: 61 });
    const salvo30 = [fonte(1, { prontidaoDias: 30 })];
    expect(prontidaoDe(todas(38), salvo30)).toMatchObject({ situacao: 'sugerida', atual: 30 });
  });

  it('o prazo atual de cada campo e independente', () => {
    const f = [fonte(1, { etdDias: 41 })];
    const sugestao = sugerir(
      repetir(12, () => amostra('FIC0001', 61, 41)),
      f,
    ).get(1);
    expect(sugestao?.prontidao).toMatchObject({ situacao: 'sugerida', atual: 35 });
    expect(sugestao?.etd).toMatchObject({ situacao: 'diferenca_pequena', atual: 41 });
  });
});

describe('sugerirPrazosChegada - fonte pelo codigo', () => {
  const amostras = repetir(12, () => amostra('FIC0001', 61, null));

  it('o mesmo codigo em mapas diferentes cai em fontes diferentes', () => {
    const fontes = [fonte(1), fonte(2)];
    const naUm = sugerir(amostras, fontes, mapa(['FIC0001', 1]));
    const naDois = sugerir(amostras, fontes, mapa(['FIC0001', 2]));
    expect([...naUm.keys()]).toEqual([1]);
    expect([...naDois.keys()]).toEqual([2]);
  });

  it('codigo ausente do mapa nao entra em nenhuma fonte', () => {
    expect(sugerir(amostras, [fonte(1)], mapa(['FIC0002', 1])).size).toBe(0);
  });

  it('fonte inativa (fora de `fontes`) nao aparece', () => {
    expect(sugerir(amostras, [fonte(2)], mapa(['FIC0001', 1])).size).toBe(0);
  });

  it('varios codigos da mesma fonte somam na mesma amostra', () => {
    const mistas = [
      ...repetir(6, () => amostra('FIC0001', 61, null)),
      ...repetir(6, () => amostra('FIC0002', 61, null)),
    ];
    const campo = sugerir(mistas, [fonte(1)], mapa(['FIC0001', 1], ['FIC0002', 1])).get(1)?.prontidao;
    expect(campo).toMatchObject({ situacao: 'sugerida', dias: 61 });
    expect(campo?.evidencia.amostras).toBe(12);
  });

  it('fonte sem nenhuma chegada medida nao entra no resultado', () => {
    expect(sugerir([], [fonte(1)]).size).toBe(0);
  });

  it('o util nao conhece exportador nem fornecedor (so o codigo liga a linha a fonte)', () => {
    const fonteDoUtil = readFileSync(resolve(__dirname, '../src/utils/forecastPrazoReal.ts'), 'utf8');
    expect(fonteDoUtil).not.toMatch(/exportador|fornecedor/i);
  });
});

describe('sugerirPrazosChegada - janela e periodo', () => {
  it('ETA FINAL fora da janela (ou depois da base) nao conta; base-365 conta e base-366 nao', () => {
    const limite = somarDias(BASE, -365);
    const amostras = [
      ...repetir(10, () => amostra('FIC0001', 61, null, limite)),
      amostra('FIC0001', 200, null, somarDias(BASE, -366)),
      amostra('FIC0001', 200, null, somarDias(BASE, 1)),
    ];
    const campo = prontidaoDe(amostras);
    expect(campo?.evidencia.amostras).toBe(10);
    expect(campo?.evidencia.max).toBe(61);
  });

  it('config.janelaDias estreita a janela', () => {
    const amostras = [
      ...repetir(10, () => amostra('FIC0001', 61, null, somarDias(BASE, -10))),
      ...repetir(10, () => amostra('FIC0001', 90, null, somarDias(BASE, -100))),
    ];
    expect(prontidaoDe(amostras)?.evidencia.amostras).toBe(20);
    expect(prontidaoDe(amostras, undefined, { janelaDias: 30 })?.evidencia.amostras).toBe(10);
  });

  it('de / ate = menor e maior ETA FINAL das amostras', () => {
    const amostras = [
      amostra('FIC0001', 61, null, '2033-05-20'),
      amostra('FIC0001', 61, null, '2033-03-02'),
      amostra('FIC0001', 61, null, '2033-06-01'),
    ];
    const campo = prontidaoDe(amostras);
    expect(campo?.evidencia).toMatchObject({ de: '2033-03-02', ate: '2033-06-01', amostras: 3 });
  });
});

describe('anexarSugestoes e contagens', () => {
  const resumo = () =>
    resumirPrazosEstimativa({
      padrao: PRAZO_CHEGADA_PADRAO,
      fontes: [fonte(1), fonte(2)],
      porFonte: new Map(),
      estimadasPorFonte: [
        { fonteId: 1, prontidao: { linhas: 2, kg: 20 }, etd: { linhas: 1, kg: 10 } },
        { fonteId: 2, prontidao: { linhas: 1, kg: 5 }, etd: { linhas: 0, kg: 0 } },
      ],
      padroesAlterados: 0,
    });

  const sugestoes = () => sugerir(
    [
      ...repetir(12, () => amostra('FIC0001', 61, 41)),
    ],
    [fonte(1), fonte(2)],
  );

  it('poe a sugestao na fonte e null na que nao tem; nao muta a entrada', () => {
    const original = resumo();
    const copia = JSON.parse(JSON.stringify(original));
    const r = anexarSugestoes(original, sugestoes());
    expect(original).toEqual(copia);
    expect('sugestao' in original.fontes[0]).toBe(false);
    const porId = new Map(r.fontes.map((f) => [f.sourceId, f.sugestao]));
    expect(porId.get(1)?.prontidao?.dias).toBe(61);
    expect(porId.get(2)).toBeNull();
    expect(r.padrao).toEqual(original.padrao);
    expect(r.semFonte).toEqual(original.semFonte);
  });

  it('contarFontesComSugestao conta so as linhas com algum campo sugerido', () => {
    expect(contarFontesComSugestao(anexarSugestoes(resumo(), sugestoes()))).toBe(1);
    expect(contarFontesComSugestao(anexarSugestoes(resumo(), new Map()))).toBe(0);
    const pequena = sugerir(repetir(12, () => amostra('FIC0001', 36, 36)));
    expect(contarFontesComSugestao(anexarSugestoes(resumo(), pequena))).toBe(0);
  });

  describe('contarMudancasIguaisASugestao', () => {
    const com: ResumoPrazosComSugestao = anexarSugestoes(resumo(), sugestoes());
    const m = (extra: Partial<MudancaDePrazo>): MudancaDePrazo => ({ sourceId: 1, ...extra });

    it('sim: todo campo alterado igual ao valor sugerido', () => {
      expect(contarMudancasIguaisASugestao([m({ arrivalFromReadinessDays: 61 })], com)).toBe(1);
      expect(contarMudancasIguaisASugestao([m({ arrivalFromReadinessDays: 61, arrivalFromEtdDays: 41 })], com)).toBe(1);
    });

    it('nao: valor diferente do sugerido', () => {
      expect(contarMudancasIguaisASugestao([m({ arrivalFromReadinessDays: 60 })], com)).toBe(0);
    });

    it('parcial: um campo igual e outro diferente nao conta', () => {
      expect(contarMudancasIguaisASugestao([m({ arrivalFromReadinessDays: 61, arrivalFromEtdDays: 40 })], com)).toBe(0);
    });

    it('fonte sem sugestao, campo sem sugestao sugerida ou mudanca vazia nao contam', () => {
      expect(contarMudancasIguaisASugestao([m({ sourceId: 2, arrivalFromReadinessDays: 61 })], com)).toBe(0);
      expect(contarMudancasIguaisASugestao([m({ sourceId: 9, arrivalFromReadinessDays: 61 })], com)).toBe(0);
      expect(contarMudancasIguaisASugestao([m({})], com)).toBe(0);
      const semSugerida: SugestaoPrazoDaFonte = {
        prontidao: sugerir(repetir(12, () => amostra('FIC0001', 36, null))).get(1)!.prontidao,
        etd: null,
      };
      const resumoPequena: ResumoPrazosComSugestao = {
        ...com,
        fontes: com.fontes.map((f) => (f.sourceId === 1 ? { ...f, sugestao: semSugerida } : f)),
      };
      expect(contarMudancasIguaisASugestao([m({ arrivalFromReadinessDays: 36 })], resumoPequena)).toBe(0);
    });

    it('soma varias fontes', () => {
      const duas = anexarSugestoes(
        resumo(),
        sugerir(
          [...repetir(12, () => amostra('FIC0001', 61, null)), ...repetir(12, () => amostra('FIC0002', 80, null))],
          [fonte(1), fonte(2)],
          mapa(['FIC0001', 1], ['FIC0002', 2]),
        ),
      );
      expect(
        contarMudancasIguaisASugestao(
          [m({ arrivalFromReadinessDays: 61 }), { sourceId: 2, arrivalFromReadinessDays: 80 }, { sourceId: 2, arrivalFromEtdDays: 80 }],
          duas,
        ),
      ).toBe(2);
    });
  });
});
