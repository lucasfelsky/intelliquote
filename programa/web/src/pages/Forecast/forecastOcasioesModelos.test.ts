import { describe, expect, it } from 'vitest';
import { camposDoModelo, validarOcasiao } from './forecastOcasioes';
import {
  ANO_NOVO_CHINES,
  MODELOS,
  TABELA_LUNAR_ATE,
  anosDoModelo,
  domingoDePascoa,
  preencherComModelo,
  type ModeloOcasiao,
} from './forecastOcasioesModelos';

const modelo = (id: string): ModeloOcasiao => {
  const m = MODELOS.find((x) => x.id === id);
  if (!m) throw new Error(`modelo ${id} nao existe`);
  return m;
};

describe('domingoDePascoa', () => {
  it('datas conhecidas', () => {
    const esperadas: Record<number, string> = {
      2000: '2000-04-23',
      2019: '2019-04-21',
      2024: '2024-03-31',
      2025: '2025-04-20',
      2026: '2026-04-05',
      2027: '2027-03-28',
      2028: '2028-04-16',
      2029: '2029-04-01',
      2030: '2030-04-21',
      2031: '2031-04-13',
      2032: '2032-03-28',
    };
    for (const [ano, data] of Object.entries(esperadas)) expect(domingoDePascoa(Number(ano))).toBe(data);
  });
});

describe('modelos baseados na Pascoa (2027)', () => {
  it('feriados derivados', () => {
    const janela = (id: string) => {
      const p = preencherComModelo(modelo(id), 2027)!;
      return [p.inicio, p.fim];
    };
    expect(janela('sexta-santa')).toEqual(['2027-03-26', '2027-03-26']);
    expect(janela('segunda-pascoa')).toEqual(['2027-03-29', '2027-03-29']);
    expect(janela('ascensao')).toEqual(['2027-05-06', '2027-05-06']);
    expect(janela('segunda-pentecostes')).toEqual(['2027-05-17', '2027-05-17']);
    expect(janela('carnaval')).toEqual(['2027-02-08', '2027-02-10']);
  });

  it('Carnaval 2028 (bissexto)', () => {
    const p = preencherComModelo(modelo('carnaval'), 2028)!;
    expect([p.inicio, p.fim]).toEqual(['2028-02-28', '2028-03-01']);
  });

  it('Carnaval e global, na liberacao, e o nome leva o ano', () => {
    const p = preencherComModelo(modelo('carnaval'), 2027)!;
    expect(p).toMatchObject({ escopo: 'global', etapa: 'liberacao', dias: 2, anual: false, movel: true, nome: 'Carnaval (Brasil) 2027' });
  });
});

describe('Ano Novo chines', () => {
  it('tabela lunar e limite', () => {
    expect(ANO_NOVO_CHINES).toEqual({
      2026: '2026-02-17',
      2027: '2027-02-06',
      2028: '2028-01-26',
      2029: '2029-02-13',
      2030: '2030-02-03',
      2031: '2031-01-23',
      2032: '2032-02-11',
    });
    expect(TABELA_LUNAR_ATE).toBe(2032);
  });

  it('2027: janela de 7 dias antes a 14 depois', () => {
    const p = preencherComModelo(modelo('ano-novo-chines'), 2027)!;
    expect(p).toMatchObject({
      nome: 'Ano Novo chinês 2027',
      escopo: 'pais',
      pais: 'CN',
      inicio: '2027-01-30',
      fim: '2027-02-20',
      etapa: 'prontidao',
      dias: 14,
      anual: false,
      movel: true,
    });
    expect(p.avisos).toContain('Confirme a data no calendário oficial. A tabela do Ano Novo chinês cobre até 2032.');
    expect(p.avisos).toContain('Data móvel: cadastre uma ocasião por ano.');
  });

  it('fora da tabela = null', () => {
    expect(preencherComModelo(modelo('ano-novo-chines'), 2033)).toBeNull();
  });
});

describe('modelos fixos', () => {
  it('Natal e Ano Novo 2026 cruza a virada e repete todo ano', () => {
    const p = preencherComModelo(modelo('natal-ano-novo'), 2026)!;
    expect(p).toMatchObject({
      nome: 'Natal e Ano Novo',
      escopo: 'global',
      inicio: '2026-12-20',
      fim: '2027-01-05',
      anual: true,
      movel: false,
      etapa: 'embarque',
      dias: 7,
    });
  });

  it('Golden Week avisa que e aproximada; modelo sem pais pede o pais', () => {
    expect(preencherComModelo(modelo('golden-week'), 2026)!.avisos).toContain(
      'Datas aproximadas: o calendário oficial da China sai a cada ano. Confirme a data.',
    );
    const p = preencherComModelo(modelo('primeiro-maio'), 2026)!;
    expect(p.pais).toBeNull();
    expect(p.avisos).toContain('Escolha o país.');
    expect(p.avisos[0]).toBe(
      'Os dias e a janela são sugestões: ajuste ao que a fonte costuma informar. Nada é gravado até você salvar.',
    );
  });
});

describe('anosDoModelo', () => {
  it('ano de hoje ate +2; lunar so ate onde a tabela cobre', () => {
    expect(anosDoModelo(modelo('natal-ano-novo'), '2026-10-27')).toEqual([2026, 2027, 2028]);
    expect(anosDoModelo(modelo('ano-novo-chines'), '2026-10-27')).toEqual([2026, 2027, 2028]);
    expect(anosDoModelo(modelo('ano-novo-chines'), '2031-03-01')).toEqual([2031, 2032]);
    expect(anosDoModelo(modelo('ano-novo-chines'), '2033-01-10')).toEqual([]);
  });
});

describe('catalogo', () => {
  it('11 modelos, ids unicos, nenhum de Diwali, Eid ou Ramada', () => {
    expect(MODELOS).toHaveLength(11);
    expect(new Set(MODELOS.map((m) => m.id)).size).toBe(MODELOS.length);
    for (const m of MODELOS) expect(`${m.id} ${m.nome}`).not.toMatch(/diwali|eid|ramad/i);
  });

  it('PROPRIEDADE: todo modelo e ano disponivel valida; so falta o pais nos modelos sem pais', () => {
    const ctx = { efeitoBloqueado: false, fontesAtivas: new Set<number>(), fonteOriginal: null };
    for (const m of MODELOS) {
      for (const ano of anosDoModelo(m, '2026-10-27')) {
        const p = preencherComModelo(m, ano);
        expect(p, `${m.id} ${ano}`).not.toBeNull();
        const { erros } = validarOcasiao(camposDoModelo(p!), ctx);
        const chaves = Object.keys(erros);
        if (m.escopo === 'pais' && m.pais === null) expect(chaves, `${m.id} ${ano}`).toEqual(['pais']);
        else expect(chaves, `${m.id} ${ano}`).toEqual([]);
      }
    }
  });
});
