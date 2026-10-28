import { describe, expect, it } from 'vitest';
import { camposDoModelo, nomeDoPais, validarOcasiao } from './forecastOcasioes';
import { selecaoDoModelo, validarAlvos } from './forecastEventosAlvos';
import {
  ANO_NOVO_CHINES,
  BARCO_DRAGAO,
  MODELOS,
  TABELA_BARCO_DRAGAO_ATE,
  TABELA_LUNAR_ATE,
  anosDoModelo,
  domingoDePascoa,
  preencherComModelo,
  ultimoAnoDaTabela,
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
  });

  it('2028 (bissexto): Pascoa em 16/04, o nome leva o ano e o modelo e movel por fonte', () => {
    const p = preencherComModelo(modelo('segunda-pascoa'), 2028)!;
    expect([p.inicio, p.fim]).toEqual(['2028-04-17', '2028-04-17']);
    expect(p).toMatchObject({ escopo: 'fonte', etapa: 'prontidao', dias: 1, anual: false, movel: true, nome: 'Segunda-feira de Páscoa (Alemanha) 2028' });
  });

  it('o catalogo nao tem mais o Carnaval (Brasil)', () => {
    expect(MODELOS.some((m) => m.id === 'carnaval' || /carnaval/i.test(m.nome))).toBe(false);
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
    expect(p.avisos).toContain('Data móvel: cadastre um evento por ano.');
  });

  it('fora da tabela = null', () => {
    expect(preencherComModelo(modelo('ano-novo-chines'), 2033)).toBeNull();
  });
});

describe('Festival do Barco-Dragao (datas a confirmar pelo usuario)', () => {
  it('tabela e limite', () => {
    expect(BARCO_DRAGAO).toEqual({
      2026: '2026-06-19',
      2027: '2027-06-09',
      2028: '2028-05-28',
      2029: '2029-06-16',
      2030: '2030-06-05',
    });
    expect(TABELA_BARCO_DRAGAO_ATE).toBe(2030);
    expect(ultimoAnoDaTabela(modelo('barco-dragao'))).toBe(2030);
    expect(ultimoAnoDaTabela(modelo('ano-novo-chines'))).toBe(2032);
    expect(ultimoAnoDaTabela(modelo('natal-ano-novo'))).toBeNull();
  });

  it('2027: 1 dia antes a 1 depois, movel, aviso de tabela', () => {
    const p = preencherComModelo(modelo('barco-dragao'), 2027)!;
    expect(p).toMatchObject({
      nome: 'Festival do Barco-Dragão 2027',
      escopo: 'pais',
      pais: 'CN',
      inicio: '2027-06-08',
      fim: '2027-06-10',
      etapa: 'prontidao',
      dias: 3,
      anual: false,
      movel: true,
    });
    expect(p.avisos).toContain('Confirme a data com o Comex ou no calendário oficial. A tabela do Festival do Barco-Dragão cobre até 2030.');
  });

  it('anos oferecidos so ate onde a tabela cobre', () => {
    expect(anosDoModelo(modelo('barco-dragao'), '2029-03-01')).toEqual([2029, 2030]);
    expect(anosDoModelo(modelo('barco-dragao'), '2031-01-01')).toEqual([]);
    expect(preencherComModelo(modelo('barco-dragao'), 2031)).toBeNull();
  });
});

describe('feriados da China', () => {
  it('Dia do Trabalhador: 1 a 5 de maio, anual, 5 dias, aviso de janela', () => {
    const p = preencherComModelo(modelo('dia-trabalhador-cn'), 2026)!;
    expect(p).toMatchObject({ escopo: 'pais', pais: 'CN', inicio: '2026-05-01', fim: '2026-05-05', anual: true, dias: 5 });
    expect(p.avisos).toContain('Janela sugerida: o calendário oficial da China sai a cada ano. Confirme a data.');
  });

  it('Golden Week: 1 a 7 de outubro, anual, aviso de janela', () => {
    const p = preencherComModelo(modelo('golden-week'), 2026)!;
    expect(p).toMatchObject({ nome: 'Golden Week (China)', pais: 'CN', inicio: '2026-10-01', fim: '2026-10-07', anual: true, dias: 7 });
    expect(p.avisos).toContain('Janela sugerida: o calendário oficial da China sai a cada ano. Confirme a data.');
  });
});

describe('feriados alemaes por fonte', () => {
  const ALEMAES = ['unidade-alema', 'sexta-santa', 'segunda-pascoa', 'ascensao', 'segunda-pentecostes'];

  it('escopo fonte, sem pais, com o aviso das fontes alemas', () => {
    for (const id of ALEMAES) {
      const p = preencherComModelo(modelo(id), 2027)!;
      expect(p.escopo, id).toBe('fonte');
      expect(p.pais, id).toBeNull();
      expect(p.avisos, id).toContain(
        'Marque as fontes alemãs que param nesses feriados. O alcance é por fonte, não pelo país inteiro.',
      );
    }
  });

  it('nomes e datas', () => {
    expect(preencherComModelo(modelo('sexta-santa'), 2027)).toMatchObject({
      nome: 'Sexta-feira Santa (Alemanha) 2027',
      inicio: '2027-03-26',
      fim: '2027-03-26',
      anual: false,
      movel: true,
    });
    expect(preencherComModelo(modelo('unidade-alema'), 2026)).toMatchObject({
      nome: 'Dia da Unidade Alemã (3 de outubro)',
      inicio: '2026-10-03',
      fim: '2026-10-03',
      anual: true,
    });
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

  it('modelo sem pais pede um ou mais paises', () => {
    const p = preencherComModelo(modelo('ferias-agosto'), 2026)!;
    expect(p.pais).toBeNull();
    expect(p.avisos).toContain('Escolha um ou mais países.');
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
  it('11 modelos, ids unicos, sem primeiro-maio, nenhum de Diwali, Eid ou Ramada', () => {
    expect(MODELOS).toHaveLength(11);
    expect(MODELOS.some((m) => m.id === 'primeiro-maio')).toBe(false);
    expect(new Set(MODELOS.map((m) => m.id)).size).toBe(MODELOS.length);
    for (const m of MODELOS) expect(`${m.id} ${m.nome}`).not.toMatch(/diwali|eid|ramad/i);
  });

  it('PROPRIEDADE: todo modelo e ano disponivel valida; so falta o alcance nos modelos sem pais e nos por fonte', () => {
    const ctx = { efeitoBloqueado: false, fontesAtivas: new Set<number>(), fonteOriginal: null };
    for (const m of MODELOS) {
      for (const ano of anosDoModelo(m, '2026-10-27')) {
        const p = preencherComModelo(m, ano);
        expect(p, `${m.id} ${ano}`).not.toBeNull();
        const { erros } = validarOcasiao({ ...camposDoModelo(p!), escopo: 'global' }, ctx);
        expect(Object.keys(erros), `${m.id} ${ano}`).toEqual([]);
        const alvos = validarAlvos(selecaoDoModelo(p!), new Map(), nomeDoPais);
        const faltaAlcance = (m.escopo === 'pais' && m.pais === null) || m.escopo === 'fonte';
        expect(Object.keys(alvos.erros), `${m.id} ${ano}`).toEqual(faltaAlcance ? ['escopo'] : []);
      }
    }
  });
});
