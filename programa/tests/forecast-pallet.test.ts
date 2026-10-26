import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import {
  arredondarParaCadaEmbalagem,
  escolherEmbalagem,
  montarRelatorioCompras,
  opcoesDePallet,
  palletEMultiploDaEmbalagem,
  type EmbalagemCadastrada,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import { FORECAST_MAX_PALLETS_POR_CODIGO } from '../src/constants/forecast';
import { colunasDePallet, palletsDesejados, palletsDoCadastro } from '../src/utils/forecastPallets';
import {
  celulasDoItem,
  COLUNAS_RELATORIO_XLSX,
  linhasDePallet,
  textoPallet,
} from '../src/utils/forecastRelatorioComprasXlsx';
import type { Quinzena } from '../src/utils/forecastTypes';

// Repo PUBLICO: so dados sinteticos (PRODUTO 001, C0001...) e a fixture anonimizada. Caso D da validacao do Comex
// (compra por pallet fechado) com numeros inventados.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const BASE = '2026-10-15';
const HOJE = '2026-10-20';

function linha(parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item'>): LinhaParaRelatorio {
  return {
    codigos: ['C0001'],
    fonte: 'FONTE 001',
    status: 'nao',
    Q: 60,
    AG: 60,
    U: 0,
    AN: -1400,
    AQ: 30,
    projecao: [40, -20, -80, -140, -200, -260],
    chegadas: [0, 0, 0, 0, 0],
    programacoes: [0, 0, 0, 0],
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

const item = (r: ReturnType<typeof montarRelatorioCompras>, nome = 'PRODUTO 001') =>
  r.grupos.flatMap((g) => g.itens).find((i) => i.item === nome)!;

describe('opcoesDePallet', () => {
  it('abaixo = piso e acima = teto da quantidade em pallets (caso D: 1.400 kg, pallet de 600 kg)', () => {
    expect(opcoesDePallet(1400, 600)).toEqual({
      kgPorPallet: 600,
      abaixo: { pallets: 2, kg: 1200 },
      acima: { pallets: 3, kg: 1800 },
    });
  });

  it('multiplo exato: abaixo e acima coincidem', () => {
    const p = opcoesDePallet(1200, 600);
    expect(p.abaixo).toEqual({ pallets: 2, kg: 1200 });
    expect(p.acima).toEqual({ pallets: 2, kg: 1200 });
  });

  it('menos de 1 pallet: nada abaixo, 1 pallet acima', () => {
    const p = opcoesDePallet(500, 600);
    expect(p.abaixo).toEqual({ pallets: 0, kg: 0 });
    expect(Object.is(p.abaixo.kg, 0)).toBe(true);
    expect(p.acima).toEqual({ pallets: 1, kg: 600 });
  });

  it('tolerancia numerica: 1.200,0000000001 kg continua exato; kg fracionado sem ruido de ponto flutuante', () => {
    expect(opcoesDePallet(1200.0000000001, 600).acima.pallets).toBe(2);
    expect(opcoesDePallet(1199.9999999999, 600).abaixo.pallets).toBe(2);
    expect(opcoesDePallet(1, 0.1)).toEqual({
      kgPorPallet: 0.1,
      abaixo: { pallets: 10, kg: 1 },
      acima: { pallets: 10, kg: 1 },
    });
    expect(opcoesDePallet(1.3, 0.1).acima).toEqual({ pallets: 13, kg: 1.3 });
  });

  it('pallet invalido lanca', () => {
    expect(() => opcoesDePallet(100, 0)).toThrow('Quantidade por pallet invalida.');
    expect(() => opcoesDePallet(100, -5)).toThrow();
    expect(() => opcoesDePallet(100, Number.NaN)).toThrow();
  });
});

describe('palletEMultiploDaEmbalagem', () => {
  it('multiplo inteiro (>= 1 embalagem) com tolerancia de 1e-6 kg', () => {
    expect(palletEMultiploDaEmbalagem(600, 25)).toBe(true);
    expect(palletEMultiploDaEmbalagem(25, 25)).toBe(true);
    expect(palletEMultiploDaEmbalagem(3.125, 0.125)).toBe(true);
    expect(palletEMultiploDaEmbalagem(2.1, 0.7)).toBe(true); // 3 x 0,7 em ponto flutuante
    expect(palletEMultiploDaEmbalagem(610, 25)).toBe(false);
    expect(palletEMultiploDaEmbalagem(12.5, 25)).toBe(false); // menor que a embalagem
    expect(palletEMultiploDaEmbalagem(600.001, 25)).toBe(false);
    expect(palletEMultiploDaEmbalagem(600, 0)).toBe(false);
    expect(palletEMultiploDaEmbalagem(0, 25)).toBe(false);
  });
});

describe('textoPallet (XLSX; a tela tem a copia exata)', () => {
  it('abaixo e acima', () => {
    expect(textoPallet(opcoesDePallet(1400, 600))).toBe(
      'Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)',
    );
  });
  it('exato, so acima e singular', () => {
    expect(textoPallet(opcoesDePallet(1200, 600))).toBe('Pallet de 600 kg: 2 pallets = 1.200 kg (exato)');
    expect(textoPallet(opcoesDePallet(500, 600))).toBe('Pallet de 600 kg: 1 pallet = 600 kg (acima)');
    expect(textoPallet(opcoesDePallet(700, 600))).toBe(
      'Pallet de 600 kg: 1 pallet = 600 kg (abaixo) · 2 pallets = 1.200 kg (acima)',
    );
  });
  it('kg com casas e milhar pt-BR', () => {
    expect(textoPallet(opcoesDePallet(3000, 1250.5))).toBe(
      'Pallet de 1.250,5 kg: 2 pallets = 2.501 kg (abaixo) · 3 pallets = 3.751,5 kg (acima)',
    );
  });
});

describe('relatorio de compras com pallet (PR 6e, caso D)', () => {
  const emb = (palletKg?: number | null): EmbalagemCadastrada[] => [{ codigo: 'C0001', quantidade: 25, palletKg }];

  it('1.400 kg: embalagem 56 x 25 = 1.400; pallet 2 = 1.200 (abaixo) e 3 = 1.800 (acima); a Qtd. final nao muda', () => {
    const r = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: -1400 })]), emb(600));
    const i = item(r);
    expect(i.quantidadeSugerida).toBe(1400);
    expect(i.quantidadeEmbalagens).toBe(56);
    expect(i.quantidadeFinal).toBe(1400);
    expect(i.porEmbalagem).toHaveLength(1);
    expect(i.porEmbalagem[0]).toEqual({
      codigo: 'C0001',
      quantidade: 25,
      rotulo: null,
      embalagens: 56,
      quantidadeFinal: 1400,
      destaque: true,
      pallet: { kgPorPallet: 600, abaixo: { pallets: 2, kg: 1200 }, acima: { pallets: 3, kg: 1800 } },
    });
    expect(r.totais.comPallet).toBe(1);
  });

  it('a base e a quantidade SUGERIDA, nao a Qtd. final arredondada pela embalagem', () => {
    // 1.190 kg sugeridos -> 48 x 25 = 1.200 kg (Qtd. final); abaixo = 1 pallet (600), acima = 2 pallets (1.200).
    const r = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: -1190 })]), emb(600));
    const i = item(r);
    expect(i.quantidadeFinal).toBe(1200);
    expect(i.porEmbalagem[0].pallet?.abaixo).toEqual({ pallets: 1, kg: 600 });
    expect(i.porEmbalagem[0].pallet?.acima).toEqual({ pallets: 2, kg: 1200 });
  });

  it('variantes: multiplo exato e menos de 1 pallet', () => {
    const exato = item(montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: -1200 })]), emb(600)));
    expect(exato.porEmbalagem[0].pallet?.abaixo.pallets).toBe(2);
    expect(exato.porEmbalagem[0].pallet?.acima.pallets).toBe(2);
    const pouco = item(montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: -500 })]), emb(600)));
    expect(pouco.porEmbalagem[0].pallet?.abaixo).toEqual({ pallets: 0, kg: 0 });
    expect(pouco.porEmbalagem[0].pallet?.acima).toEqual({ pallets: 1, kg: 600 });
  });

  it('sem pallet (ausente, nulo ou invalido): pallet nulo, formato do item igual ao de antes e comPallet 0', () => {
    const base = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001' })]), emb());
    for (const palletKg of [null, 0, -3, Number.NaN]) {
      const r = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001' })]), emb(palletKg));
      expect(r).toEqual(base);
    }
    expect(item(base).porEmbalagem[0].pallet).toBeNull();
    expect(base.totais.comPallet).toBe(0);
    // O objeto da embalagem usada continua sem a chave palletKg (JSON identico ao de antes do 6e).
    expect(item(base).embalagem.usada).toEqual({ codigo: 'C0001', quantidade: 25, rotulo: null });
  });

  it('2 codigos (25 kg com pallet 600 e 1.000 kg sem pallet): pallet so na 1a opcao', () => {
    const r = montarRelatorioCompras(
      quinzena([linha({ linha: 1, item: 'PRODUTO 001', codigos: ['C0001', 'C0002'], AN: -1400 })]),
      [
        { codigo: 'C0001', quantidade: 25, palletKg: 600 },
        { codigo: 'C0002', quantidade: 1000 },
      ],
    );
    const i = item(r);
    expect(i.porEmbalagem.map((o) => [o.codigo, o.destaque, o.pallet !== null])).toEqual([
      ['C0001', true, true],
      ['C0002', false, false],
    ]);
    expect(i.quantidadeFinal).toBe(1400); // C0001 e a usada
    expect(r.totais.comPallet).toBe(1);
  });

  it('pallet na embalagem nao principal tambem aparece (cada opcao do 5B)', () => {
    const escolha = escolherEmbalagem(['C0001', 'C0002'], [
      { codigo: 'C0001', quantidade: 25 },
      { codigo: 'C0002', quantidade: 1000, principal: true, palletKg: 2000 },
    ]);
    const opcoes = arredondarParaCadaEmbalagem(1400, escolha);
    expect(opcoes.map((o) => o.pallet)).toEqual([
      null,
      { kgPorPallet: 2000, abaixo: { pallets: 0, kg: 0 }, acima: { pallets: 1, kg: 2000 } },
    ]);
  });

  it('nada a comprar (AN = 0 com consumo): sem pallet, nada de "0 pallets (exato)"', () => {
    const r = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: 0, Q: 10 })]), emb(600));
    expect(item(r).quantidadeSugerida).toBe(0);
    expect(item(r).porEmbalagem[0].pallet).toBeNull();
    expect(r.totais.comPallet).toBe(0);
  });

  it('item sem embalagem cadastrada: sem opcoes e sem pallet', () => {
    const r = montarRelatorioCompras(quinzena([linha({ linha: 1, item: 'PRODUTO 001', codigos: ['C0009'] })]), emb(600));
    expect(item(r).porEmbalagem).toEqual([]);
    expect(r.totais.comPallet).toBe(0);
  });

  it('fixture anonimizada sem pallet: nenhuma opcao com pallet, comPallet 0 e o relatorio igual ao de antes', () => {
    const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
    const linhas: LinhaParaRelatorio[] = calcular(fixture, { hoje: HOJE, quinzena: 2 }).map((c) => {
      const p = produtoPorLinha.get(c.linha)!;
      return { ...c, n: p.n, item: p.item, codigos: p.codigos.filter((x) => x !== ''), fonte: p.fonte, status: p.status };
    });
    const q = { ...quinzena(linhas), id: 7, label: fixture.id, baseDate: fixture.dataBase };
    const cadastro = (palletKg?: null) =>
      linhas.flatMap((l) => l.codigos.map((codigo) => ({ codigo, quantidade: 25, ...(palletKg === null ? { palletKg } : {}) })));
    const r = montarRelatorioCompras(q, cadastro());
    const opcoes = r.grupos.flatMap((g) => g.itens).flatMap((i) => i.porEmbalagem);
    expect(opcoes.length).toBeGreaterThan(0);
    expect(opcoes.every((o) => o.pallet === null)).toBe(true);
    expect(r.totais.comPallet).toBe(0);
    expect(montarRelatorioCompras(q, cadastro(null))).toEqual(r);
  });
});

describe('forecastPallets (tamanhos de pallet por codigo)', () => {
  it('palletsDoCadastro: 1o + extras na ordem, sem nulos, invalidos nem repetidos', () => {
    expect(palletsDoCadastro(1000, [1200, 1500])).toEqual([1000, 1200, 1500]);
    expect(palletsDoCadastro(null, [])).toEqual([]);
    expect(palletsDoCadastro(600, [])).toEqual([600]);
    expect(palletsDoCadastro(1000, [0, -5, Number.NaN, 1000, 1200, 1200])).toEqual([1000, 1200]);
    expect(palletsDoCadastro(null, [1200])).toEqual([1200]);
  });

  it('colunasDePallet: 1o tamanho na coluna antiga, o resto no array; vazio = nulo + []', () => {
    expect(colunasDePallet([1000, 1200, 1500])).toEqual({ packagingPalletKg: 1000, packagingPalletExtraKg: [1200, 1500] });
    expect(colunasDePallet([600])).toEqual({ packagingPalletKg: 600, packagingPalletExtraKg: [] });
    expect(colunasDePallet([])).toEqual({ packagingPalletKg: null, packagingPalletExtraKg: [] });
  });

  it('palletsDesejados: ausente mantem; palletsKg substitui; legado troca so o 1o; null apaga tudo', () => {
    const atual = [1000, 1200, 1500];
    expect(palletsDesejados(atual, undefined)).toEqual(atual);
    expect(palletsDesejados(atual, {})).toEqual(atual);
    expect(palletsDesejados(atual, { palletsKg: [800, 900] })).toEqual([800, 900]);
    expect(palletsDesejados(atual, { palletsKg: [] })).toEqual([]);
    expect(palletsDesejados(atual, { palletKg: 900 })).toEqual([900, 1200, 1500]);
    expect(palletsDesejados(atual, { palletKg: 1200 })).toEqual([1200, 1500]);
    expect(palletsDesejados(atual, { palletKg: null })).toEqual([]);
    expect(palletsDesejados([], { palletKg: 600 })).toEqual([600]);
    expect(palletsDesejados([], { palletKg: null })).toEqual([]);
  });

  it('o limite de tamanhos por codigo e 5', () => {
    expect(FORECAST_MAX_PALLETS_POR_CODIGO).toBe(5);
  });
});

describe('varios tamanhos de pallet no relatorio e no XLSX (Etapa B)', () => {
  const dois = (): EmbalagemCadastrada[] => [{ codigo: 'C0001', quantidade: 25, palletKg: 1000, palletsKg: [1000, 1200] }];
  const colunaDe = (nome: (typeof COLUNAS_RELATORIO_XLSX)[number]) => COLUNAS_RELATORIO_XLSX.indexOf(nome);

  it('escolherEmbalagem: palletKg e o 1o; os demais vao em outrosPalletsKg (so com 2+)', () => {
    const escolha = escolherEmbalagem(['C0001'], dois());
    expect(escolha.usada).toEqual({ codigo: 'C0001', quantidade: 25, rotulo: null, palletKg: 1000, outrosPalletsKg: [1200] });
    // Lista de 1 e palletKg legado: o objeto e o de antes (sem a chave nova).
    const um = escolherEmbalagem(['C0001'], [{ codigo: 'C0001', quantidade: 25, palletsKg: [600] }]);
    const legado = escolherEmbalagem(['C0001'], [{ codigo: 'C0001', quantidade: 25, palletKg: 600 }]);
    expect(um).toEqual(legado);
    expect(um.usada).toEqual({ codigo: 'C0001', quantidade: 25, rotulo: null, palletKg: 600 });
    expect(um.usada).not.toHaveProperty('outrosPalletsKg');
    // palletsKg vazio = sem pallet, mesmo com palletKg antigo no cadastro.
    expect(escolherEmbalagem(['C0001'], [{ codigo: 'C0001', quantidade: 25, palletKg: 600, palletsKg: [] }]).usada).toEqual({
      codigo: 'C0001',
      quantidade: 25,
      rotulo: null,
    });
  });

  it('arredondarParaCadaEmbalagem com 1.000 e 1.200 kg: pallet = 1.000 e outrosPallets = [1.200]', () => {
    const [opcao] = arredondarParaCadaEmbalagem(1400, escolherEmbalagem(['C0001'], dois()));
    expect(opcao.pallet).toEqual({ kgPorPallet: 1000, abaixo: { pallets: 1, kg: 1000 }, acima: { pallets: 2, kg: 2000 } });
    expect(opcao.outrosPallets).toEqual([
      { kgPorPallet: 1200, abaixo: { pallets: 1, kg: 1200 }, acima: { pallets: 2, kg: 2400 } },
    ]);
    expect(opcao).not.toHaveProperty('outrosPalletsKg');
  });

  it('com 0 ou 1 tamanho o objeto da opcao NAO ganha a chave outrosPallets (formato de hoje)', () => {
    for (const cadastro of [
      [{ codigo: 'C0001', quantidade: 25 }],
      [{ codigo: 'C0001', quantidade: 25, palletKg: 600 }],
      [{ codigo: 'C0001', quantidade: 25, palletKg: 600, palletsKg: [600] }],
    ] as EmbalagemCadastrada[][]) {
      const [opcao] = arredondarParaCadaEmbalagem(1400, escolherEmbalagem(['C0001'], cadastro));
      expect(opcao).not.toHaveProperty('outrosPallets');
    }
  });

  it('nada a comprar (quantidade 0): sem pallet e sem outrosPallets, mesmo com 2 tamanhos', () => {
    const [opcao] = arredondarParaCadaEmbalagem(0, escolherEmbalagem(['C0001'], dois()));
    expect(opcao.pallet).toBeNull();
    expect(opcao).not.toHaveProperty('outrosPallets');
  });

  it('montarRelatorioCompras: 2 tamanhos contam 1 item em comPallet; 1 tamanho via lista = relatorio de hoje', () => {
    const q = quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: -1400 })]);
    const r2 = montarRelatorioCompras(q, dois());
    expect(item(r2).porEmbalagem[0].outrosPallets).toHaveLength(1);
    expect(item(r2).embalagem.usada?.outrosPalletsKg).toEqual([1200]);
    expect(r2.totais.comPallet).toBe(1);
    expect(item(r2).quantidadeFinal).toBe(1400); // a Qtd. final continua pela embalagem
    const legado = montarRelatorioCompras(q, [{ codigo: 'C0001', quantidade: 25, palletKg: 600 }]);
    const lista = montarRelatorioCompras(q, [{ codigo: 'C0001', quantidade: 25, palletKg: 600, palletsKg: [600] }]);
    expect(lista).toEqual(legado);
  });

  it('linhasDePallet: uma linha por tamanho (1o e demais); sem pallet = []; com 1 tamanho = 1 linha como antes', () => {
    const [dupla] = arredondarParaCadaEmbalagem(1400, escolherEmbalagem(['C0001'], dois()));
    expect(linhasDePallet(dupla)).toEqual([
      'Pallet de 1.000 kg: 1 pallet = 1.000 kg (abaixo) · 2 pallets = 2.000 kg (acima)',
      'Pallet de 1.200 kg: 1 pallet = 1.200 kg (abaixo) · 2 pallets = 2.400 kg (acima)',
    ]);
    const [simples] = arredondarParaCadaEmbalagem(1400, escolherEmbalagem(['C0001'], [{ codigo: 'C0001', quantidade: 25, palletKg: 600 }]));
    expect(linhasDePallet(simples)).toEqual([textoPallet(simples.pallet!)]);
    const [sem] = arredondarParaCadaEmbalagem(1400, escolherEmbalagem(['C0001'], [{ codigo: 'C0001', quantidade: 25 }]));
    expect(linhasDePallet(sem)).toEqual([]);
    expect(linhasDePallet(undefined)).toEqual([]);
  });

  it('celulasDoItem: a celula Embalagem tem 2 linhas "Pallet de ..." com 2 tamanhos e a de hoje com 1', () => {
    const q = quinzena([linha({ linha: 1, item: 'PRODUTO 001', AN: -1400 })]);
    const comDois = celulasDoItem(item(montarRelatorioCompras(q, dois())), 15)[colunaDe('Embalagem')] as string;
    expect(comDois.split('\n')).toEqual([
      '56 × 25 kg (código C0001)',
      'Pallet de 1.000 kg: 1 pallet = 1.000 kg (abaixo) · 2 pallets = 2.000 kg (acima)',
      'Pallet de 1.200 kg: 1 pallet = 1.200 kg (abaixo) · 2 pallets = 2.400 kg (acima)',
    ]);
    const comUm = celulasDoItem(item(montarRelatorioCompras(q, [{ codigo: 'C0001', quantidade: 25, palletKg: 600 }])), 15)[
      colunaDe('Embalagem')
    ] as string;
    expect(comUm).toBe(`56 × 25 kg (código C0001)\n${textoPallet(opcoesDePallet(1400, 600))}`);
    const semPallet = celulasDoItem(item(montarRelatorioCompras(q, [{ codigo: 'C0001', quantidade: 25 }])), 15)[
      colunaDe('Embalagem')
    ] as string;
    expect(semPallet).toBe('56 × 25 kg (código C0001)');
  });

  it('celulasDoItem: as outras opcoes tambem listam todos os tamanhos (1 linha por tamanho abaixo da opcao)', () => {
    const q = quinzena([linha({ linha: 1, item: 'PRODUTO 001', codigos: ['C0001', 'C0002'], AN: -1400 })]);
    const cadastro: EmbalagemCadastrada[] = [
      { codigo: 'C0001', quantidade: 25, principal: true },
      { codigo: 'C0002', quantidade: 200, palletKg: 1000, palletsKg: [1000, 1200] },
    ];
    const outras = celulasDoItem(item(montarRelatorioCompras(q, cadastro)), 15)[colunaDe('Outras embalagens')] as string;
    expect(outras.split('\n')).toEqual([
      '7 × 200 kg (código C0002) = 1.400 kg',
      'Pallet de 1.000 kg: 1 pallet = 1.000 kg (abaixo) · 2 pallets = 2.000 kg (acima)',
      'Pallet de 1.200 kg: 1 pallet = 1.200 kg (abaixo) · 2 pallets = 2.400 kg (acima)',
    ]);
  });
});
