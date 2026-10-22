import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcular } from '../src/utils/forecastEngine';
import { somarDias } from '../src/utils/forecastMonths';
import {
  DIAS_RUPTURA_CRITICA,
  REGRA_EMBALAGEM,
  URGENCIAS,
  arredondarParaCadaEmbalagem,
  arredondarPorEmbalagem,
  dataDeRuptura,
  dataLimiteDoPedido,
  entraNoRelatorio,
  escolherEmbalagem,
  itensNaOrdemDeUrgencia,
  montarRelatorioCompras,
  motivosSemConsumo,
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

describe('arredondarParaCadaEmbalagem (PR 5B)', () => {
  const codigos = ['C0001', 'C0002', 'C0003'];

  it('uma opcao por embalagem cadastrada, na ordem EMB.1..7; o destaque e a usada (principal fora da 1a posicao)', () => {
    const escolha = escolherEmbalagem(codigos, [
      { codigo: 'C0001', quantidade: 200 },
      { codigo: 'C0002', quantidade: 25 },
      { codigo: 'C0003', quantidade: 1000, rotulo: 'Bag', principal: true },
    ]);
    const opcoes = arredondarParaCadaEmbalagem(450, escolha);
    expect(opcoes).toEqual([
      { codigo: 'C0001', quantidade: 200, rotulo: null, embalagens: 3, quantidadeFinal: 600, destaque: false },
      { codigo: 'C0002', quantidade: 25, rotulo: null, embalagens: 18, quantidadeFinal: 450, destaque: false },
      { codigo: 'C0003', quantidade: 1000, rotulo: 'Bag', embalagens: 1, quantidadeFinal: 1000, destaque: true },
    ]);
    expect(opcoes.filter((o) => o.destaque).map((o) => o.codigo)).toEqual([escolha.usada?.codigo]);
  });

  it('sem principal o destaque e a 1a cadastrada; sem embalagem devolve vazio', () => {
    const escolha = escolherEmbalagem(codigos, [
      { codigo: 'C0003', quantidade: 200 },
      { codigo: 'C0002', quantidade: 25 },
    ]);
    expect(arredondarParaCadaEmbalagem(10, escolha).map((o) => [o.codigo, o.destaque])).toEqual([
      ['C0002', true],
      ['C0003', false],
    ]);
    expect(arredondarParaCadaEmbalagem(10, escolherEmbalagem(codigos, []))).toEqual([]);
  });

  it('kg fracionado e quantidade 0 (0 embalagens, sem -0)', () => {
    const escolha = escolherEmbalagem(codigos, [
      { codigo: 'C0001', quantidade: 0.5 },
      { codigo: 'C0002', quantidade: 2.125 },
    ]);
    expect(arredondarParaCadaEmbalagem(3, escolha).map((o) => [o.embalagens, o.quantidadeFinal])).toEqual([
      [6, 3],
      [2, 4.25],
    ]);
    const zero = arredondarParaCadaEmbalagem(0, escolha);
    expect(zero.map((o) => [o.embalagens, o.quantidadeFinal])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    for (const o of zero) {
      expect(Object.is(o.embalagens, 0)).toBe(true);
      expect(Object.is(o.quantidadeFinal, 0)).toBe(true);
    }
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
    U: 0,
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

  it('porEmbalagem: a opcao em destaque tem os mesmos numeros da Qtd. final; sem embalagem e vazio (PR 5B)', () => {
    const itens = r.grupos.flatMap((g) => g.itens);
    for (const item of itens) {
      if (item.embalagem.usada === null) {
        expect(item.porEmbalagem).toEqual([]);
        continue;
      }
      expect(item.porEmbalagem.map((o) => o.codigo)).toEqual(item.embalagem.cadastradas.map((e) => e.codigo));
      const [destaque, ...demais] = item.porEmbalagem.filter((o) => o.destaque);
      expect(demais).toEqual([]);
      expect(destaque.embalagens).toBe(item.quantidadeEmbalagens);
      expect(destaque.quantidadeFinal).toBe(item.quantidadeFinal);
    }
    const p3 = itens.find((i) => i.item === 'PRODUTO 003')!;
    // 101 kg: principal C0002 (25 kg) = 5 x 25 = 125 (Qtd. final); C0001 (200 kg) = 1 x 200.
    expect(p3.quantidadeFinal).toBe(125);
    expect(p3.porEmbalagem.map((o) => [o.codigo, o.embalagens, o.quantidadeFinal, o.destaque])).toEqual([
      ['C0001', 1, 200, false],
      ['C0002', 5, 125, true],
    ]);
  });

  it('obs: texto da linha com trim; ausente vira vazio, no item e no sem consumo (PR 5B)', () => {
    const q = montarRelatorioCompras(
      sintetica([
        linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A', obs: '  OBS SINTETICA 001 ' }),
        linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE A' }),
        linha({ linha: 3, item: 'PRODUTO 003', fonte: 'FONTE B', Q: 0, AG: 0, U: 10, AN: 10, obs: 'OBS SINTETICA 003' }),
        linha({ linha: 4, item: 'PRODUTO 004', fonte: 'FONTE B', Q: 0, AG: 0, U: 10, AN: 10 }),
      ]),
      [],
    );
    const porNome = new Map(q.grupos.flatMap((g) => g.itens).map((i) => [i.item, i.obs] as const));
    expect(porNome.get('PRODUTO 001')).toBe('OBS SINTETICA 001');
    expect(porNome.get('PRODUTO 002')).toBe('');
    expect(q.semConsumo.itens.map((i) => [i.item, i.obs])).toEqual([
      ['PRODUTO 003', 'OBS SINTETICA 003'],
      ['PRODUTO 004', ''],
    ]);
  });

  it('agrupa por fonte (sem diferenciar caixa/espacos) e ordena grupos pelo item mais urgente', () => {
    expect(r.grupos.map((g) => g.fonte)).toEqual(['FONTE A', 'FONTE B', 'FONTE C']);
    expect(r.grupos.map((g) => g.dataLimiteMaisUrgente)).toEqual(['2026-09-15', '2026-08-23', null]);
    expect(r.grupos.map((g) => g.leadTimeDias)).toEqual([30, 90, 10]);
  });

  it('ordena itens por urgencia e conta vencidas', () => {
    const fonteA = r.grupos.find((g) => g.fonte === 'FONTE A')!;
    expect(fonteA.itens.map((i) => i.item)).toEqual(['PRODUTO 001', 'PRODUTO 003']);
    expect(fonteA.itens.map((i) => i.dataLimite)).toEqual(['2026-09-15', '2026-10-22']);
    expect(fonteA.itens.map((i) => i.vencida)).toEqual([true, false]);
    expect(fonteA.vencidas).toBe(1);
    expect(r.totais).toEqual({
      itens: 4,
      fontes: 3,
      vencidas: 2,
      semEmbalagem: 3,
      multiplasEmbalagens: 1,
      porUrgencia: { 'sem-estoque': 1, critico: 0, atrasado: 1, 'no-prazo': 2 },
    });
    expect(r.fora).toEqual({ semLeadTime: 1, semConsumoSemFalta: 2, semConsumoSemMovimento: 2 });
    expect(r.semConsumo.itens).toEqual([]);
    expect(r.urgencia).toEqual({ diasCritico: 15 });
    const porItem = new Map(r.grupos.flatMap((g) => g.itens).map((i) => [i.item, i] as const));
    const pegar = (nome: string) => porItem.get(nome)!;
    expect(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003', 'PRODUTO 004'].map((n) => pegar(n).urgencia)).toEqual([
      'sem-estoque',
      'atrasado',
      'no-prazo',
      'no-prazo',
    ]);
    expect(['PRODUTO 001', 'PRODUTO 002', 'PRODUTO 003', 'PRODUTO 004'].map((n) => pegar(n).diasAteRuptura)).toEqual([
      -5, 32, 32, null,
    ]);
    expect(r.grupos.map((g) => g.urgenciaMaisAlta)).toEqual(['sem-estoque', 'atrasado', 'no-prazo']);
    expect(r.grupos.map((g) => g.porUrgencia['no-prazo'])).toEqual([1, 0, 1]);
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
      expect(item.porEmbalagem).toEqual([]);
      expect(item.obs).toBe('');
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

  it('ordenacao por urgencia: posicao e permutacao, tupla monotona no grupo, grupos pela posicao do 1o item', () => {
    const todos = r.grupos.flatMap((g) => g.itens);
    expect(todos.map((i) => i.posicaoUrgencia).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 97 }, (_, i) => i),
    );
    const tupla = (i: (typeof todos)[number]) => [URGENCIAS.indexOf(i.urgencia), i.diasAteRuptura!, i.dataLimite!];
    for (const g of r.grupos) {
      const tuplas = g.itens.map(tupla);
      for (let k = 1; k < tuplas.length; k += 1) {
        const [a, b] = [tuplas[k - 1], tuplas[k]];
        const ordem = a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
        expect(ordem).toBeLessThanOrEqual(0);
      }
      const datas = g.itens.map((i) => i.dataLimite!).sort();
      expect(g.dataLimiteMaisUrgente).toBe(datas[0]);
      expect(g.itens.map((i) => i.posicaoUrgencia)).toEqual(
        [...g.itens.map((i) => i.posicaoUrgencia)].sort((a, b) => a - b),
      );
    }
    const posicoes = r.grupos.map((g) => g.itens[0].posicaoUrgencia);
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    expect(r.totais.vencidas).toBe(91);
  });

  it('independe da origem da quinzena (so e repassada para exibicao)', () => {
    const outra = montarRelatorioCompras(quinzena('dbcorp'), []);
    expect({ ...outra, quinzena: undefined }).toEqual({ ...r, quinzena: undefined });
    expect(outra.quinzena.origin).toBe('dbcorp');
  });
});

describe('urgencia (sintetico)', () => {
  const ruptura = (
    parcial: Partial<LinhaParaRelatorio>,
    opcoes: { hoje?: string; diasCritico?: number } = {},
  ) => {
    const q = { ...sintetica([linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A', ...parcial })]), hoje: opcoes.hoje ?? HOJE };
    const r = montarRelatorioCompras(q, [], opcoes.diasCritico === undefined ? {} : { diasCritico: opcoes.diasCritico });
    return r.grupos[0].itens[0];
  };
  const resumo = (i: { urgencia: string; diasAteRuptura: number | null }) => [i.urgencia, i.diasAteRuptura];

  it('mes base negativo sem estoque: ja na data-base -> sem estoque agora', () => {
    const i = ruptura({ AG: 80, projecao: [-100, -160, -220, -280, -340, -400] });
    expect(i.ruptura?.jaNaDataBase).toBe(true);
    expect(resumo(i)).toEqual(['sem-estoque', -5]);
  });

  it('mes base negativo com estoque: critico; passada a data de hoje vira sem estoque; N = 0 desliga a faixa', () => {
    const projecao = [-40, -100, -160, -220, -280, -340];
    const base = ruptura({ AG: 80, projecao });
    expect(base.ruptura?.data).toBe('2026-10-23');
    expect(resumo(base)).toEqual(['critico', 3]);
    expect(resumo(ruptura({ AG: 80, projecao }, { hoje: '2026-10-24' }))).toEqual(['sem-estoque', -1]);
    expect(resumo(ruptura({ AG: 80, projecao }, { diasCritico: 0 }))).toEqual(['atrasado', 3]);
  });

  it('limites: hoje (0) = sem estoque, 15 dias = critico, 16 dias depende da data-limite', () => {
    expect(resumo(ruptura({ AG: 85, projecao: [-60, -120, -180, -240, -300, -360] }))).toEqual(['sem-estoque', 0]);
    const em15 = ruptura({ projecao: [40, -54, -114, -174, -234, -294] });
    expect(em15.ruptura?.data).toBe('2026-11-04');
    expect(resumo(em15)).toEqual(['critico', 15]);
    const em16 = [40, -52, -112, -172, -232, -292];
    expect(ruptura({ AQ: 0, projecao: em16 }).ruptura?.data).toBe('2026-11-05');
    expect(resumo(ruptura({ AQ: 0, projecao: em16 }))).toEqual(['no-prazo', 16]);
    expect(resumo(ruptura({ AQ: 30, projecao: em16 }))).toEqual(['atrasado', 16]);
  });

  it('critico independe da data-limite; lead time 0 nunca vence antes da ruptura', () => {
    const i = ruptura({ AQ: 0, AG: 85, projecao: [-10, -70, -130, -190, -250, -310] });
    expect(i.ruptura?.data).toBe('2026-10-30');
    expect(i.vencida).toBe(false);
    expect(resumo(i)).toEqual(['critico', 10]);
    expect(resumo(ruptura({ AQ: 0 }))).toEqual(['no-prazo', 32]);
  });

  it('lead time nulo fica fora da lista e das faixas (soma das 4 = itens)', () => {
    const r = montarRelatorioCompras(
      sintetica([
        linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A' }),
        linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE A', AQ: null, AN: null }),
      ]),
      [],
    );
    expect(r.totais.itens).toBe(1);
    expect(Object.values(r.totais.porUrgencia).reduce((a, b) => a + b, 0)).toBe(r.totais.itens);
    expect(r.fora.semLeadTime).toBe(1);
  });

  it('sem ruptura no horizonte: no prazo, sem dias, ultimo da faixa e de toda a lista', () => {
    const r = montarRelatorioCompras(
      sintetica([
        linha({ linha: 1, item: 'AAA SEM RUPTURA', fonte: 'FONTE A', AQ: 0, Q: 10, AG: 10, projecao: [5, 5, 5, 5, 5, 5] }),
        linha({ linha: 2, item: 'ZZZ COM RUPTURA', fonte: 'FONTE B', AQ: 0 }),
        linha({ linha: 3, item: 'MMM ATRASADO', fonte: 'FONTE C', AQ: 90 }),
      ]),
      [],
    );
    const lista = itensNaOrdemDeUrgencia(r);
    expect(lista.map((x) => x.item.item)).toEqual(['MMM ATRASADO', 'ZZZ COM RUPTURA', 'AAA SEM RUPTURA']);
    const sem = lista[2].item;
    expect(resumo(sem)).toEqual(['no-prazo', null]);
    expect(sem.posicaoUrgencia).toBe(2);
  });

  it('hoje anterior a data-base: ja na data-base continua sem estoque', () => {
    const i = ruptura({ AG: 80, projecao: [-100, -160, -220, -280, -340, -400] }, { hoje: '2026-10-10' });
    expect(resumo(i)).toEqual(['sem-estoque', 5]);
  });

  it('limite de dias invalido lanca', () => {
    for (const diasCritico of [-1, 1.5, Number.NaN]) {
      expect(() => montarRelatorioCompras(sintetica([]), [], { diasCritico })).toThrow(
        'Limite de dias da faixa critica invalido.',
      );
    }
    expect(DIAS_RUPTURA_CRITICA).toBe(15);
    expect(montarRelatorioCompras(sintetica([]), [], { diasCritico: 0 }).urgencia).toEqual({ diasCritico: 0 });
  });

  it('itensNaOrdemDeUrgencia: lista unica por posicao com a fonte do grupo', () => {
    const r = montarRelatorioCompras(
      sintetica([
        linha({ linha: 1, item: 'PRODUTO A', fonte: 'FONTE X', AQ: 0 }),
        linha({ linha: 2, item: 'PRODUTO B', fonte: 'FONTE Y', AG: 80, projecao: [-100, -160, -220, -280, -340, -400] }),
        linha({ linha: 3, item: 'PRODUTO C', fonte: 'FONTE X', AQ: 90 }),
      ]),
      [],
    );
    const lista = itensNaOrdemDeUrgencia(r);
    expect(lista.map((x) => [x.item.item, x.fonte, x.item.posicaoUrgencia])).toEqual([
      ['PRODUTO B', 'FONTE Y', 0],
      ['PRODUTO C', 'FONTE X', 1],
      ['PRODUTO A', 'FONTE X', 2],
    ]);
  });
});

describe('urgencia (fixture anonimizada)', () => {
  const calculadas = calcular(fixture, { hoje: HOJE, quinzena: 2 });
  const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
  const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
    const p = produtoPorLinha.get(c.linha)!;
    return { ...c, n: p.n, item: p.item, codigos: p.codigos.filter((x) => x !== ''), fonte: p.fonte, status: p.status };
  });
  const montar = (hoje: string, diasCritico?: number) =>
    montarRelatorioCompras(
      { id: 7, label: fixture.id, baseDate: fixture.dataBase, half: 2, origin: 'planilha', hoje, linhas },
      [],
      diasCritico === undefined ? {} : { diasCritico },
    );

  it('hoje 2026-10-20: 29 / 23 / 39 / 6 e os 16 ja na data-base ficam em sem estoque', () => {
    const r = montar('2026-10-20');
    expect(r.totais.porUrgencia).toEqual({ 'sem-estoque': 29, critico: 23, atrasado: 39, 'no-prazo': 6 });
    const jaNaBase = r.grupos.flatMap((g) => g.itens).filter((i) => i.ruptura?.jaNaDataBase);
    expect(jaNaBase).toHaveLength(16);
    expect(jaNaBase.every((i) => i.urgencia === 'sem-estoque')).toBe(true);
  });

  it('hoje 2026-10-15: 20 / 21 / 47 / 9', () => {
    expect(montar('2026-10-15').totais.porUrgencia).toEqual({ 'sem-estoque': 20, critico: 21, atrasado: 47, 'no-prazo': 9 });
  });

  it('N = 7 (hoje 2026-10-20): 29 / 9 / 53 / 6', () => {
    expect(montar('2026-10-20', 7).totais.porUrgencia).toEqual({ 'sem-estoque': 29, critico: 9, atrasado: 53, 'no-prazo': 6 });
  });
});

describe('sem consumo (sintetico)', () => {
  const montar = (ls: LinhaParaRelatorio[]) => montarRelatorioCompras(sintetica(ls), []);

  it('so estoque: entra na secao com motivo estoque', () => {
    const r = montar([linha({ linha: 1, item: 'PRODUTO 001', fonte: ' FONTE A ', Q: 0, AG: 0, U: 10, AN: 10 })]);
    expect(r.grupos).toEqual([]);
    expect(r.semConsumo.itens).toHaveLength(1);
    const [i] = r.semConsumo.itens;
    expect(i).toMatchObject({ motivos: ['estoque'], estoque: 10, programado: 0, fonte: 'FONTE A', semLeadTime: false });
    expect(r.fora.semConsumoSemMovimento).toBe(0);
  });

  it('programacao e estoque: os dois motivos e vem antes do so-estoque', () => {
    const r = montar([
      linha({ linha: 1, item: 'AAA SO ESTOQUE', fonte: 'FONTE A', Q: 0, AG: 0, U: 10, AN: 10 }),
      linha({ linha: 2, item: 'ZZZ COM PROGRAMACAO', fonte: 'FONTE Z', Q: 0, AG: 0, U: 20, AN: 15, programacoes: [0, 5, 0, 0] }),
    ]);
    expect(r.semConsumo.itens.map((i) => [i.item, i.motivos])).toEqual([
      ['ZZZ COM PROGRAMACAO', ['programacao', 'estoque']],
      ['AAA SO ESTOQUE', ['estoque']],
    ]);
    expect(r.semConsumo.itens[0].programado).toBe(5);
  });

  it('sem consumo que ja esta na lista de compra nao repete na secao', () => {
    const r = montar([
      linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A', Q: 0, AG: 0, U: 0, AN: -5, programacoes: [0, 5, 0, 0] }),
    ]);
    expect(r.totais.itens).toBe(1);
    expect(r.semConsumo.itens).toEqual([]);
    expect(r.fora.semConsumoSemMovimento).toBe(0);
  });

  it('sem estoque, programacao nem chegada: so conta (chegada nao conta como movimento)', () => {
    const r = montar([
      linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A', Q: 0, AG: 0, U: 0, AN: 0 }),
      linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE A', Q: 0, AG: 0, U: 0, AN: 100, chegadas: [0, 0, 100, 0, 0] }),
    ]);
    expect(r.semConsumo.itens).toEqual([]);
    expect(r.fora).toEqual({ semLeadTime: 0, semConsumoSemFalta: 1, semConsumoSemMovimento: 2 });
  });

  it('sem lead time com estoque entra na secao e continua em fora.semLeadTime', () => {
    const r = montar([linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A', Q: 0, AG: 0, U: 5, AQ: null, AN: null })]);
    expect(r.semConsumo.itens[0].semLeadTime).toBe(true);
    expect(r.fora.semLeadTime).toBe(1);
  });

  it('media negativa (devolucao) tambem e sem consumo; com consumo nunca entra na secao', () => {
    const r = montar([
      linha({ linha: 1, item: 'PRODUTO 001', fonte: 'FONTE A', Q: -3, AG: -3, U: 5, AN: 5 }),
      linha({ linha: 2, item: 'PRODUTO 002', fonte: 'FONTE A', Q: 60, U: 500, AN: 200 }),
    ]);
    expect(r.semConsumo.itens.map((i) => i.item)).toEqual(['PRODUTO 001']);
    expect(r.grupos).toEqual([]);
    expect(r.fora.semConsumoSemMovimento).toBe(0);
  });

  it('programacoes e chegadas do item com anoMes corretos; productId repassado', () => {
    const r = montar([
      linha({
        linha: 1,
        item: 'PRODUTO 001',
        fonte: 'FONTE A',
        productId: 42,
        Q: 0,
        AG: 0,
        U: 10,
        AN: 10,
        programacoes: [0, 5, 0, 7],
        chegadas: [0, 0, 100, 0, 30],
      }),
    ]);
    const [i] = r.semConsumo.itens;
    expect(i.productId).toBe(42);
    expect(i.programacoes).toEqual([
      { anoMes: '2026-11', quantidade: 5 },
      { anoMes: '2027-01', quantidade: 7 },
    ]);
    expect(i.chegadas).toEqual([
      { anoMes: '2026-12', quantidade: 100 },
      { anoMes: '2027-02', quantidade: 30 },
    ]);
    expect(i.programado).toBe(12);
  });

  it('motivosSemConsumo: ordem fixa e vazio quando entra na lista ou tem consumo', () => {
    expect(motivosSemConsumo({ AN: 10, Q: 0, U: 3, programacoes: [1, 0, 0, 0] })).toEqual(['programacao', 'estoque']);
    expect(motivosSemConsumo({ AN: 10, Q: 5, U: 3, programacoes: [1, 0, 0, 0] })).toEqual([]);
    expect(motivosSemConsumo({ AN: -1, Q: 0, U: 3, programacoes: [1, 0, 0, 0] })).toEqual([]);
    expect(motivosSemConsumo({ AN: 10, Q: 0, U: 0, programacoes: [0, 0, 0, 0] })).toEqual([]);
  });
});

describe('sem consumo (fixture anonimizada)', () => {
  const montarEm = (hoje: string) => {
    const calculadas = calcular(fixture, { hoje, quinzena: 2 });
    const produtoPorLinha = new Map(fixture.produtos.map((p) => [p.linha, p]));
    const linhas: LinhaParaRelatorio[] = calculadas.map((c) => {
      const p = produtoPorLinha.get(c.linha)!;
      return { ...c, n: p.n, item: p.item, codigos: p.codigos.filter((x) => x !== ''), fonte: p.fonte, status: p.status };
    });
    return montarRelatorioCompras(
      { id: 7, label: fixture.id, baseDate: fixture.dataBase, half: 2, origin: 'planilha', hoje, linhas },
      [],
    );
  };
  const r = montarEm('2026-10-20');

  it('50 itens na secao (2 com programacao, 49 com estoque) e 46 so na contagem', () => {
    expect(r.semConsumo.itens).toHaveLength(50);
    expect(r.semConsumo.itens.filter((i) => i.motivos.includes('programacao'))).toHaveLength(2);
    expect(r.semConsumo.itens.filter((i) => i.motivos.includes('estoque'))).toHaveLength(49);
    expect(r.fora.semConsumoSemMovimento).toBe(46);
    expect(r.fora.semConsumoSemFalta).toBe(43);
  });

  it('nenhuma linha da secao aparece na lista de compra', () => {
    const naLista = new Set(r.grupos.flatMap((g) => g.itens.map((i) => i.linha)));
    expect(r.semConsumo.itens.some((i) => naLista.has(i.linha))).toBe(false);
  });

  it('nao depende de hoje', () => {
    expect(montarEm('2026-10-15').semConsumo).toEqual(r.semConsumo);
    expect(montarEm('2026-10-15').fora).toEqual(r.fora);
  });
});
