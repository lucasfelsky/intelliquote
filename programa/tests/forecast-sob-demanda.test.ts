import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import {
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { Quinzena } from '../src/utils/forecastTypes';

// Repo PUBLICO: so dados sinteticos (PRODUTO 001, FONTE 001, C0001...) e a fixture anonimizada. Caso C da validacao
// do Comex (item que so se compra com a programacao do cliente) com numeros inventados.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const BASE = '2026-10-15';
const HOJE = '2026-10-20';

function linha(parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item'>): LinhaParaRelatorio {
  return {
    productId: parcial.linha,
    codigos: ['C0001'],
    fonte: 'FONTE 001',
    status: 'nao',
    Q: 100,
    AG: 100,
    U: 300,
    AN: -800,
    AQ: 60,
    projecao: [100, -100, -200, -300, -400, -500],
    chegadas: [0, 0, 0, 0, 0],
    programacoes: [0, 800, 0, 0],
    ...parcial,
  };
}

const quinzena = (linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio => ({
  id: 1,
  label: '10-2',
  baseDate: BASE,
  half: 2,
  origin: 'planilha',
  hoje: HOJE,
  linhas,
});

const marca = (...pares: Array<[number, string | null]>) =>
  new Map(pares.map(([id, motivo]) => [id, { motivo }] as const));

const nomesDaLista = (r: ReturnType<typeof montarRelatorioCompras>) =>
  r.grupos.flatMap((g) => g.itens).map((i) => i.item);

describe('compra sob demanda (caso C)', () => {
  it('PRODUTO 001 marcado sai da lista de compra com o motivo; PRODUTO 002 igual e nao marcado continua', () => {
    // T = Q / 30 * AQ = 200; AN = 300 - 200 - 100 - 800 = -800 (entraria com 800 kg).
    const linhas = [linha({ linha: 1, item: 'PRODUTO 001' }), linha({ linha: 2, item: 'PRODUTO 002' })];
    const antes = montarRelatorioCompras(quinzena(linhas), []);
    expect(nomesDaLista(antes)).toEqual(expect.arrayContaining(['PRODUTO 001', 'PRODUTO 002']));
    expect(antes.totais.itens).toBe(2);

    const r = montarRelatorioCompras(quinzena(linhas), [], { sobDemanda: marca([1, 'MOTIVO SINTETICO']) });
    expect(r.totais.itens).toBe(1);
    expect(nomesDaLista(r)).toEqual(['PRODUTO 002']);
    expect(r.fora.sobDemanda).toBe(1);
    expect(r.sobDemanda.itens).toHaveLength(1);
    expect(r.sobDemanda.itens[0]).toMatchObject({
      linha: 1,
      productId: 1,
      item: 'PRODUTO 001',
      fonte: 'FONTE 001',
      motivo: 'MOTIVO SINTETICO',
      demanda: -800,
      quantidadeSugerida: 800,
      estoque: 300,
      programado: 800,
      programacaoDescoberta: 500,
      programacoes: [{ anoMes: '2026-11', quantidade: 800 }],
      chegadas: [],
    });
  });

  it('sem programacao (AN -100): sai da lista e a programacao descoberta e 0', () => {
    const l = linha({ linha: 1, item: 'PRODUTO 001', AN: -100, programacoes: [0, 0, 0, 0] });
    const r = montarRelatorioCompras(quinzena([l]), [], { sobDemanda: marca([1, null]) });
    expect(r.totais.itens).toBe(0);
    expect(r.grupos).toEqual([]);
    expect(r.sobDemanda.itens[0].programacaoDescoberta).toBe(0);
    expect(Object.is(r.sobDemanda.itens[0].programacaoDescoberta, 0)).toBe(true);
    expect(r.sobDemanda.itens[0].motivo).toBeNull();
    expect(r.fora.sobDemanda).toBe(1);
  });

  it('chegadas e estoque abatem a programacao; nunca fica negativa', () => {
    const l = linha({ linha: 1, item: 'PRODUTO 001', chegadas: [0, 0, 0, 0, 600], programacoes: [0, 800, 0, 0] });
    const r = montarRelatorioCompras(quinzena([l]), [], { sobDemanda: marca([1, null]) });
    expect(r.sobDemanda.itens[0].programacaoDescoberta).toBe(0); // 800 - 300 - 600 < 0
    expect(r.sobDemanda.itens[0].chegadas).toEqual([{ anoMes: '2027-02', quantidade: 600 }]);
    const parcial = linha({ linha: 1, item: 'PRODUTO 001', chegadas: [0, 0, 0, 0, 100], programacoes: [0, 800, 0, 0] });
    const r2 = montarRelatorioCompras(quinzena([parcial]), [], { sobDemanda: marca([1, null]) });
    expect(r2.sobDemanda.itens[0].programacaoDescoberta).toBe(400); // 800 - 300 - 100
  });

  it('ordem da secao: programacao descoberta maior primeiro, depois fonte, item e linha', () => {
    const linhas = [
      linha({ linha: 1, item: 'PRODUTO B', programacoes: [0, 400, 0, 0] }), // descoberta 100
      linha({ linha: 2, item: 'PRODUTO A', programacoes: [0, 400, 0, 0] }), // 100
      linha({ linha: 3, item: 'PRODUTO C', programacoes: [0, 900, 0, 0] }), // 600
      linha({ linha: 4, item: 'PRODUTO D', fonte: 'FONTE 000', programacoes: [0, 400, 0, 0] }), // 100
    ];
    const r = montarRelatorioCompras(quinzena(linhas), [], {
      sobDemanda: marca([1, null], [2, null], [3, null], [4, null]),
    });
    expect(r.sobDemanda.itens.map((i) => i.item)).toEqual(['PRODUTO C', 'PRODUTO D', 'PRODUTO A', 'PRODUTO B']);
  });

  it('linha marcada que nao entraria na lista nao muda (AN positivo) e nao vira item da secao', () => {
    const ok = linha({ linha: 1, item: 'PRODUTO 001', AN: 500, programacoes: [0, 0, 0, 0] });
    const sem = montarRelatorioCompras(quinzena([ok]), []);
    const com = montarRelatorioCompras(quinzena([ok]), [], { sobDemanda: marca([1, 'MOTIVO SINTETICO']) });
    expect(com).toEqual(sem);
    expect(com.fora.sobDemanda).toBe(0);
  });

  it('sem consumo: continua na secao de atencao e ganha so o selo sobDemanda', () => {
    const semConsumo = linha({
      linha: 1,
      item: 'PRODUTO 001',
      Q: 0,
      AG: 0,
      AN: 200,
      U: 200,
      projecao: [200, 200, 200, 200, 200, 200],
      programacoes: [0, 0, 0, 0],
    });
    const outro = { ...semConsumo, linha: 2, productId: 2, item: 'PRODUTO 002' };
    const r = montarRelatorioCompras(quinzena([semConsumo, outro]), [], { sobDemanda: marca([1, null]) });
    expect(r.semConsumo.itens.map((i) => [i.item, i.sobDemanda])).toEqual([
      ['PRODUTO 001', true],
      ['PRODUTO 002', false],
    ]);
    expect(r.sobDemanda.itens).toEqual([]);
    expect(r.fora.sobDemanda).toBe(0);
  });

  it('item fora do cadastro (productId nulo ou ausente) nunca e tratado como sob demanda', () => {
    const l = linha({ linha: 1, item: 'PRODUTO 001', productId: null });
    const r = montarRelatorioCompras(quinzena([l]), [], { sobDemanda: marca([1, null]) });
    expect(r.totais.itens).toBe(1);
    expect(r.sobDemanda.itens).toEqual([]);
  });

  it('observacao da quinzena acompanha o item para a secao', () => {
    const l = linha({ linha: 1, item: 'PRODUTO 001', obs: '  OBS SINTETICA  ' });
    const r = montarRelatorioCompras(quinzena([l]), [], { sobDemanda: marca([1, null]) });
    expect(r.sobDemanda.itens[0].obs).toBe('OBS SINTETICA');
  });

  it('fixture anonimizada: sem a opcao (ou com mapa vazio) o relatorio e igual ao de antes e a secao vem vazia', () => {
    const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
    const linhas: LinhaParaRelatorio[] = calcular(fixture, { hoje: HOJE, quinzena: 2 }).map((c) => {
      const p = produtoPorLinha.get(c.linha)!;
      return {
        ...c,
        n: p.n,
        productId: c.linha,
        item: p.item,
        codigos: p.codigos.filter((x) => x !== ''),
        fonte: p.fonte,
        status: p.status,
      };
    });
    const q = { ...quinzena(linhas), id: 7, label: fixture.id, baseDate: fixture.dataBase };
    const base = montarRelatorioCompras(q, []);
    expect(montarRelatorioCompras(q, [], {})).toEqual(base);
    expect(montarRelatorioCompras(q, [], { sobDemanda: new Map() })).toEqual(base);
    expect(base.sobDemanda).toEqual({ itens: [] });
    expect(base.fora.sobDemanda).toBe(0);
    expect(base.semConsumo.itens.every((i) => i.sobDemanda === false)).toBe(true);

    // Marcando um item da lista: sai dela, o resto fica igual e o total cai 1.
    const alvo = base.grupos.flatMap((g) => g.itens)[0];
    const marcado = montarRelatorioCompras(q, [], { sobDemanda: marca([alvo.productId!, 'MOTIVO SINTETICO']) });
    expect(marcado.totais.itens).toBe(base.totais.itens - 1);
    expect(marcado.sobDemanda.itens.map((i) => i.linha)).toEqual([alvo.linha]);
    expect(marcado.fora.sobDemanda).toBe(1);
    const restantes = base.grupos.flatMap((g) => g.itens).filter((i) => i.linha !== alvo.linha);
    expect(marcado.grupos.flatMap((g) => g.itens).map((i) => i.linha).sort((a, b) => a - b)).toEqual(
      restantes.map((i) => i.linha).sort((a, b) => a - b),
    );
  });
});
