import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import { somarDias } from '../src/utils/forecastMonths';
import {
  REGRA_EMBALAGEM,
  arredondarPorEmbalagem,
  dataDeRuptura,
  dataLimiteDoPedido,
  entraNoRelatorio,
  escolherEmbalagem,
  montarRelatorioCompras,
  type LinhaParaRelatorio,
  type QuinzenaParaRelatorio,
} from '../src/utils/forecastRelatorioCompras';
import type { Quinzena } from '../src/utils/forecastTypes';

// Fixture ANONIMIZADA (repo publico): scripts/forecast-anonymize-fixture.mjs.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'forecast', 'quinzena-10-2.anon.json'), 'utf8'),
) as Quinzena;

const BASE = '2026-10-15';
const HOJE = '2026-10-20';

describe('dataDeRuptura', () => {
  it('mes seguinte: consumo linear dentro do mes (D = projecao + consumo)', () => {
    const r = dataDeRuptura({ Q: 60, AG: 60, projecao: [40, -20, -80, -140, -200, -260] }, BASE);
    expect(r).toEqual({ indiceMes: 1, anoMes: '2026-11', data: '2026-11-21', jaNaDataBase: false });
  });

  it('mes base: conta a partir da data-base e desconta o consumo do mes inteiro (AG)', () => {
    const r = dataDeRuptura({ Q: 60, AG: 80, projecao: [-40, -100, -160, -220, -280, -340] }, BASE);
    expect(r).toEqual({ indiceMes: 0, anoMes: '2026-10', data: '2026-10-23', jaNaDataBase: false });
  });

  it('ja em ruptura na data-base', () => {
    const r = dataDeRuptura({ Q: 60, AG: 80, projecao: [-100, -160, -220, -280, -340, -400] }, BASE);
    expect(r).toEqual({ indiceMes: 0, anoMes: '2026-10', data: '2026-10-15', jaNaDataBase: true });
  });

  it('sem consumo: ruptura no primeiro dia do mes, sem divisao por zero', () => {
    const r = dataDeRuptura({ Q: 0, AG: 0, projecao: [0, 0, -5, -5, -5, -5] }, BASE);
    expect(r).toEqual({ indiceMes: 2, anoMes: '2026-12', data: '2026-12-01', jaNaDataBase: false });
  });

  it('fevereiro: a data nunca passa do fim do mes', () => {
    const r = dataDeRuptura({ Q: 1000, AG: 1000, projecao: [10, 10, 10, 10, -0.0001, -1000] }, BASE);
    expect(r?.indiceMes).toBe(4);
    expect(r?.data).toBe('2027-02-28');
  });

  it('nenhum mes negativo: sem ruptura', () => {
    expect(dataDeRuptura({ Q: 10, AG: 10, projecao: [5, 5, 5, 5, 5, 5] }, BASE)).toBeNull();
  });
});

describe('dataLimiteDoPedido', () => {
  it('ruptura menos lead time em dias corridos', () => {
    expect(dataLimiteDoPedido('2026-11-21', 81)).toBe('2026-09-01');
    expect(dataLimiteDoPedido('2026-11-21', 0)).toBe('2026-11-21');
  });
});

describe('arredondarPorEmbalagem', () => {
  it('arredonda para cima em multiplos da embalagem', () => {
    expect(arredondarPorEmbalagem(401, 200)).toEqual({ embalagens: 3, quantidade: 600 });
    expect(arredondarPorEmbalagem(400, 200)).toEqual({ embalagens: 2, quantidade: 400 });
    expect(arredondarPorEmbalagem(400.0000000001, 200)).toEqual({ embalagens: 2, quantidade: 400 });
    expect(arredondarPorEmbalagem(1, 25)).toEqual({ embalagens: 1, quantidade: 25 });
    expect(arredondarPorEmbalagem(0, 200)).toEqual({ embalagens: 0, quantidade: 0 });
  });

  it('nunca devolve -0 e rejeita embalagem invalida', () => {
    expect(Object.is(arredondarPorEmbalagem(0, 200).embalagens, 0)).toBe(true);
    expect(Object.is(arredondarPorEmbalagem(0, 200).quantidade, 0)).toBe(true);
    expect(() => arredondarPorEmbalagem(10, 0)).toThrow();
  });
});

describe('escolherEmbalagem', () => {
  const codigos = ['C0001', 'C0002', 'C0003'];

  it('sem principal usa a de menor posicao; codigo sem embalagem e ignorado', () => {
    const r = escolherEmbalagem(codigos, [
      { codigo: 'c0003', quantidade: 200 },
      { codigo: 'C0002', quantidade: 25 },
    ]);
    expect(REGRA_EMBALAGEM).toBe('principal-depois-menor-posicao');
    expect(r.usada).toEqual({ codigo: 'C0002', quantidade: 25, rotulo: null });
    expect(r.cadastradas.map((e) => e.codigo)).toEqual(['C0002', 'C0003']);
    expect(r.multiplas).toBe(true);
  });

  it('a marcada como principal prevalece', () => {
    const r = escolherEmbalagem(codigos, [
      { codigo: 'C0003', quantidade: 200, rotulo: 'Tambor', principal: true },
      { codigo: 'C0002', quantidade: 25 },
    ]);
    expect(r.usada).toEqual({ codigo: 'C0003', quantidade: 200, rotulo: 'Tambor' });
    expect(r.multiplas).toBe(true);
  });

  it('lista vazia: sem embalagem; quantidade invalida e ignorada', () => {
    expect(escolherEmbalagem(codigos, [])).toEqual({ usada: null, cadastradas: [], multiplas: false });
    const r = escolherEmbalagem(codigos, [
      { codigo: 'C0001', quantidade: 0 },
      { codigo: 'C0002', quantidade: Number.NaN },
      { codigo: 'C0003', quantidade: -5 },
    ]);
    expect(r.usada).toBeNull();
    expect(r.multiplas).toBe(false);
  });

  it('uma unica embalagem nao e "multiplas"', () => {
    const r = escolherEmbalagem(codigos, [{ codigo: 'C0002', quantidade: 25 }]);
    expect(r.usada?.codigo).toBe('C0002');
    expect(r.multiplas).toBe(false);
  });
});

describe('entraNoRelatorio', () => {
  it('lead time desconhecido, demanda positiva e sem consumo sem falta ficam fora', () => {
    expect(entraNoRelatorio({ AN: null, Q: 10 })).toBe(false);
    expect(entraNoRelatorio({ AN: 5, Q: 10 })).toBe(false);
    expect(entraNoRelatorio({ AN: 0, Q: 0 })).toBe(false);
  });

  it('consumo com demanda 0 entra; sem consumo com demanda negativa entra', () => {
    expect(entraNoRelatorio({ AN: 0, Q: 10 })).toBe(true);
    expect(entraNoRelatorio({ AN: -3, Q: 0 })).toBe(true);
  });
});

function linha(parcial: Partial<LinhaParaRelatorio> & Pick<LinhaParaRelatorio, 'linha' | 'item' | 'fonte'>): LinhaParaRelatorio {
  return {
    codigos: [`C${String(parcial.linha).padStart(4, '0')}`],
    status: 'nao',
    Q: 60,
    AG: 60,
    AN: -100,
    AQ: 30,
    projecao: [40, -20, -80, -140, -200, -260],
    chegadas: [0, 0, 0, 0, 0],
    programacoes: [0, 0, 0, 0],
    ...parcial,
  };
}

function sintetica(linhas: LinhaParaRelatorio[]): QuinzenaParaRelatorio {
  return { id: 1, label: '10-2', baseDate: BASE, half: 2, origin: 'planilha', hoje: HOJE, linhas };
}

describe('montarRelatorioCompras (sintetico)', () => {
  const linhas: LinhaParaRelatorio[] = [
    // FONTE A: 2 itens (um vencido, outro no prazo, com embalagem multipla e em andamento).
    linha({
      linha: 3,
      item: 'PRODUTO 003',
      fonte: 'FONTE A',
      AN: -101,
      codigos: ['C0001', 'C0002'],
      chegadas: [0, 300, 0, 0, 50],
      programacoes: [100, 0, 0, 20],
    }),
    linha({ linha: 4, item: 'PRODUTO 001', fonte: 'fonte a ', AN: -10, projecao: [-100, -160, -220, -280, -340, -400], AG: 80 }),
    // FONTE B: vencida (lead time longo).
    linha({ linha: 5, item: 'PRODUTO 002', fonte: 'FONTE B', AQ: 90, AN: -7 }),
    // FONTE C: sem ruptura no horizonte (fica no fim).
    linha({ linha: 6, item: 'PRODUTO 004', fonte: 'FONTE C', AQ: 10, AN: -5, Q: 10, AG: 10, projecao: [5, 5, 5, 5, 5, 5] }),
    // Fora do relatorio.
    linha({ linha: 7, item: 'PRODUTO 005', fonte: 'FONTE D', AN: null, AQ: null }),
    linha({ linha: 8, item: 'PRODUTO 006', fonte: 'FONTE D', AN: 0, Q: 0 }),
    linha({ linha: 9, item: 'PRODUTO 007', fonte: 'FONTE D', AN: 50 }),
    linha({ linha: 10, item: 'PRODUTO 008', fonte: 'FONTE E', AN: 0, Q: 0 }),
  ];
  const embalagens = [
    { codigo: 'C0001', quantidade: 200 },
    { codigo: 'C0002', quantidade: 25, principal: true },
  ];
  const r = montarRelatorioCompras(sintetica(linhas), embalagens);

  it('agrupa por fonte (sem diferenciar caixa/espacos) e ordena grupos pela data-limite mais urgente', () => {
    expect(r.grupos.map((g) => g.fonte)).toEqual(['FONTE B', 'FONTE A', 'FONTE C']);
    expect(r.grupos.map((g) => g.dataLimiteMaisUrgente)).toEqual(['2026-08-23', '2026-09-15', null]);
    expect(r.grupos.map((g) => g.leadTimeDias)).toEqual([90, 30, 10]);
  });

  it('ordena itens por data-limite e conta vencidas', () => {
    const fonteA = r.grupos.find((g) => g.fonte === 'FONTE A')!;
    expect(fonteA.itens.map((i) => i.item)).toEqual(['PRODUTO 001', 'PRODUTO 003']);
    expect(fonteA.itens.map((i) => i.dataLimite)).toEqual(['2026-09-15', '2026-10-22']);
    expect(fonteA.itens.map((i) => i.vencida)).toEqual([true, false]);
    expect(fonteA.vencidas).toBe(1);
    expect(r.totais).toEqual({ itens: 4, fontes: 3, vencidas: 2, semEmbalagem: 3, multiplasEmbalagens: 1 });
    expect(r.fora).toEqual({ semLeadTime: 1, semConsumoSemFalta: 2 });
  });

  it('item sem ruptura fica sem datas e no fim', () => {
    const c = r.grupos[2].itens[0];
    expect(c.ruptura).toBeNull();
    expect(c.dataLimite).toBeNull();
    expect(c.vencida).toBe(false);
  });

  it('arredonda so o item com embalagem e destaca a usada', () => {
    const itens = r.grupos.flatMap((g) => g.itens);
    const comEmb = itens.find((i) => i.item === 'PRODUTO 003')!;
    expect(comEmb.quantidadeSugerida).toBe(101);
    expect(comEmb.embalagem.usada?.codigo).toBe('C0002');
    expect(comEmb.embalagem.multiplas).toBe(true);
    expect(comEmb.quantidadeEmbalagens).toBe(5);
    expect(comEmb.quantidadeFinal).toBe(125);
    for (const i of itens.filter((x) => x !== comEmb)) {
      expect(i.embalagem.usada).toBeNull();
      expect(i.quantidadeEmbalagens).toBeNull();
      expect(i.quantidadeFinal).toBe(i.quantidadeSugerida);
    }
  });

  it('em andamento so com meses > 0 e anoMes corretos (chegadas ate base+4, programacoes ate base+3)', () => {
    const comEmb = r.grupos.flatMap((g) => g.itens).find((i) => i.item === 'PRODUTO 003')!;
    expect(comEmb.emAndamento.chegadas).toEqual([
      { anoMes: '2026-11', quantidade: 300 },
      { anoMes: '2027-02', quantidade: 50 },
    ]);
    expect(comEmb.emAndamento.programacoes).toEqual([
      { anoMes: '2026-10', quantidade: 100 },
      { anoMes: '2027-01', quantidade: 20 },
    ]);
    const semAndamento = r.grupos.flatMap((g) => g.itens).find((i) => i.item === 'PRODUTO 002')!;
    expect(semAndamento.emAndamento).toEqual({ chegadas: [], programacoes: [] });
  });

  it('sinaliza "nao fraciona" sem mudar a quantidade', () => {
    const com = montarRelatorioCompras(
      sintetica([linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE A', AN: -101, naoFraciona: true })]),
      [],
    );
    const item = com.grupos[0].itens[0];
    expect(item.naoFraciona).toBe(true);
    expect(item.quantidadeFinal).toBe(101);
    expect(r.grupos.flatMap((g) => g.itens).every((i) => i.naoFraciona === false)).toBe(true);
  });

  it('nunca devolve -0 na demanda nem na quantidade sugerida', () => {
    const zero = montarRelatorioCompras(
      sintetica([linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE A', AN: -0, Q: 10 })]),
      [],
    );
    const item = zero.grupos[0].itens[0];
    expect(Object.is(item.demanda, 0)).toBe(true);
    expect(Object.is(item.quantidadeSugerida, 0)).toBe(true);
  });

  it('repassa o productId da linha para o item (nulo quando a linha nao tem)', () => {
    const com = montarRelatorioCompras(
      sintetica([
        linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE A', productId: 42 }),
        linha({ linha: 4, item: 'PRODUTO 004', fonte: 'FONTE A' }),
        linha({ linha: 5, item: 'PRODUTO 005', fonte: 'FONTE A', productId: null }),
      ]),
      [],
    );
    const porLinha = new Map(com.grupos.flatMap((g) => g.itens).map((i) => [i.linha, i.productId] as const));
    expect(porLinha.get(3)).toBe(42);
    expect(porLinha.get(4)).toBeNull();
    expect(porLinha.get(5)).toBeNull();
  });

  it('data-base ou hoje invalidos lancam', () => {
    expect(() => montarRelatorioCompras({ ...sintetica([]), baseDate: '2026-13-01' }, [])).toThrow();
    expect(() => montarRelatorioCompras({ ...sintetica([]), hoje: 'ontem' }, [])).toThrow();
  });
});

describe('montarRelatorioCompras (fixture anonimizada, hoje 2026-10-20)', () => {
  const calculadas = calcular(fixture, { hoje: HOJE, quinzena: 2 });
  const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
  const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
    const p = produtoPorLinha.get(c.linha)!;
    return {
      ...c,
      n: p.n,
      item: p.item,
      codigos: p.codigos.filter((x) => x !== ''),
      fonte: p.fonte,
      status: p.status,
      naoFraciona: p.naoFraciona.trim().toUpperCase() === 'X',
    };
  });
  const quinzena = (origin: string): QuinzenaParaRelatorio => ({
    id: 7,
    label: fixture.id,
    baseDate: fixture.dataBase,
    half: 2,
    origin,
    hoje: HOJE,
    linhas,
  });
  const r = montarRelatorioCompras(quinzena('planilha'), []);

  it('totais conferidos: demanda <= 0 com a regra unica (sem consumo e demanda = 0 fica fora)', () => {
    expect(r.totais.itens).toBe(97);
    expect(r.totais.fontes).toBe(45);
    expect(r.fora.semConsumoSemFalta).toBe(43);
    expect(r.fora.semLeadTime).toBe(0);
    expect(r.totais.semEmbalagem).toBe(97);
  });

  it('sem embalagem cadastrada nenhum item arredonda', () => {
    for (const item of r.grupos.flatMap((g) => g.itens)) {
      expect(item.embalagem.usada).toBeNull();
      expect(item.quantidadeFinal).toBe(item.quantidadeSugerida);
    }
  });

  it('data-limite = ruptura - lead time e vencida = data-limite < hoje', () => {
    for (const item of r.grupos.flatMap((g) => g.itens)) {
      expect(item.ruptura).not.toBeNull();
      expect(item.dataLimite).toBe(somarDias(item.ruptura!.data, -item.leadTimeDias));
      expect(item.vencida).toBe(item.dataLimite! < HOJE);
    }
  });

  it('ordenacao monotona dentro de cada grupo e entre grupos', () => {
    for (const g of r.grupos) {
      const datas = g.itens.map((i) => i.dataLimite!);
      expect(datas).toEqual([...datas].sort());
      expect(g.dataLimiteMaisUrgente).toBe(datas[0]);
    }
    const urgentes = r.grupos.map((g) => g.dataLimiteMaisUrgente!);
    expect(urgentes).toEqual([...urgentes].sort());
  });

  it('independe da origem da quinzena (so e repassada para exibicao)', () => {
    const outra = montarRelatorioCompras(quinzena('dbcorp'), []);
    expect({ ...outra, quinzena: undefined }).toEqual({ ...r, quinzena: undefined });
    expect(outra.quinzena.origin).toBe('dbcorp');
  });
});
