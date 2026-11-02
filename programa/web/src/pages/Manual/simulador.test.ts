import { describe, expect, it } from 'vitest';
import { SIM_FORNECEDORES } from './dados';
import {
  alternarCriterio,
  calcularRanking,
  CRITERIOS_INICIAIS,
  eixoDoRanking,
  formatar,
  LARGURA_DA_BARRA,
  MENSAGEM_MAXIMO,
  MENSAGEM_MINIMO,
  segmentosDaBarra,
  type CriterioId,
} from './simulador';
import { calcularWaterfall, EIXO } from './waterfall';

const nomes = (ativos: CriterioId[]) => calcularRanking(ativos).map((l) => l.fornecedor.nome);
const totais = (ativos: CriterioId[]) => calcularRanking(ativos).map((l) => l.total);

describe('simulador de score: ranking da previa aprovada', () => {
  it('so Preco: a mais barata (Qingdao Harbor Chem) vence com 1,00 e as demais seguem pela cesta', () => {
    expect(nomes(['preco'])).toEqual(['Qingdao Harbor Chem', 'Nordmar Química', 'Lianyun Fine Chemicals', 'Jinhai Industrial']);
    expect(totais(['preco'])).toEqual([1, 0.98, 0.96, 0.92]);
  });

  it('padrao Preco + Pagamento: a Jinhai Industrial passa a frente pelos 90 dias (1,92)', () => {
    expect([...CRITERIOS_INICIAIS]).toEqual(['preco', 'pagamento']);
    expect(nomes(['preco', 'pagamento'])).toEqual(['Jinhai Industrial', 'Lianyun Fine Chemicals', 'Nordmar Química', 'Qingdao Harbor Chem']);
    expect(totais(['preco', 'pagamento'])).toEqual([1.92, 1.63, 1.48, 1.33]);
  });

  it('Incoterm: nivel / 5; Qualidade: media / 5 (sem avaliacao = 0)', () => {
    const linhas = calcularRanking(['incoterm', 'qualidade']);
    expect(linhas.map((l) => [l.fornecedor.nome, l.pontos.incoterm, l.pontos.qualidade, l.total])).toEqual([
      ['Jinhai Industrial', 0.6, 0.92, 1.52],
      ['Lianyun Fine Chemicals', 0.6, 0.86, 1.46],
      ['Qingdao Harbor Chem', 0.6, 0.76, 1.36],
      ['Nordmar Química', 0.8, 0, 0.8],
    ]);
  });

  it('criterio desligado vale 0 e o total e a soma arredondada em 2 casas', () => {
    for (const linha of calcularRanking(['preco'])) {
      expect(linha.pontos.pagamento).toBe(0);
      expect(linha.pontos.incoterm).toBe(0);
      expect(linha.pontos.qualidade).toBe(0);
      expect(linha.total).toBe(linha.pontos.preco);
    }
  });

  it('empate: menor cesta, depois maior prazo, depois maior nivel de incoterm', () => {
    const base = { nome: 'A', cesta: 100, dias: 30, incoterm: 'FOB', nivel: 3, qualidade: 4 };
    const f = [
      { ...base, nome: 'Mais caro', cesta: 100 },
      { ...base, nome: 'Mais barato', cesta: 100 },
    ];
    // tudo igual: a ordem de entrada e preservada
    expect(calcularRanking(['incoterm'], f).map((l) => l.fornecedor.nome)).toEqual(['Mais caro', 'Mais barato']);
    const g = [
      { ...base, nome: 'Cesta maior', cesta: 120, nivel: 3 },
      { ...base, nome: 'Cesta menor', cesta: 110, nivel: 3 },
    ];
    expect(calcularRanking(['incoterm'], g).map((l) => l.fornecedor.nome)).toEqual(['Cesta menor', 'Cesta maior']);
    const h = [
      { ...base, nome: 'Prazo curto', dias: 30 },
      { ...base, nome: 'Prazo longo', dias: 60 },
    ];
    expect(calcularRanking(['incoterm'], h).map((l) => l.fornecedor.nome)).toEqual(['Prazo longo', 'Prazo curto']);
    const i = [
      { ...base, nome: 'Nivel 3', nivel: 3, qualidade: 5 },
      { ...base, nome: 'Nivel 4', nivel: 4, qualidade: 3 },
    ];
    // Preco empata em 1,00 (mesma cesta) e o prazo tambem: decide o maior nivel de incoterm
    expect(calcularRanking(['preco'], i).map((l) => l.fornecedor.nome)).toEqual(['Nivel 4', 'Nivel 3']);
  });
});

describe('simulador de score: criterios (minimo 1, maximo 2)', () => {
  it('o 3o criterio e bloqueado com a mensagem e nada muda', () => {
    const r = alternarCriterio(['preco', 'pagamento'], 'incoterm');
    expect(r.ativos).toEqual(['preco', 'pagamento']);
    expect(r.mensagem).toBe(MENSAGEM_MAXIMO);
    expect(MENSAGEM_MAXIMO).toBe('Selecione no máximo 2 critérios.');
  });

  it('o ultimo criterio nao pode ser desligado', () => {
    const r = alternarCriterio(['preco'], 'preco');
    expect(r.ativos).toEqual(['preco']);
    expect(r.mensagem).toBe(MENSAGEM_MINIMO);
    expect(MENSAGEM_MINIMO).toBe('Selecione ao menos 1 critério.');
  });

  it('liga e desliga dentro do limite, sempre na ordem dos chips', () => {
    expect(alternarCriterio(['preco'], 'qualidade')).toEqual({ ativos: ['preco', 'qualidade'], mensagem: '' });
    expect(alternarCriterio(['pagamento'], 'preco')).toEqual({ ativos: ['preco', 'pagamento'], mensagem: '' });
    expect(alternarCriterio(['preco', 'pagamento'], 'preco')).toEqual({ ativos: ['pagamento'], mensagem: '' });
  });

  it('eixo: 0, meio e maximo (meio com 1 casa so quando ha 1 criterio)', () => {
    expect(eixoDoRanking(2)).toEqual({ meio: '1', maximo: '2' });
    expect(eixoDoRanking(1)).toEqual({ meio: '0,5', maximo: '1' });
  });
});

describe('simulador de score: barras (atributos SVG)', () => {
  it('cada segmento ocupa pontos / criterios ativos do viewBox 0-1000, sem sobrepor e sem passar do total', () => {
    const [primeira] = calcularRanking(['preco', 'pagamento']);
    expect(primeira).toBeDefined();
    const segmentos = segmentosDaBarra(primeira!.pontos, ['preco', 'pagamento']);
    expect(segmentos.map((s) => s.criterio)).toEqual(['preco', 'pagamento']);
    expect(segmentos[0]).toEqual({ criterio: 'preco', x: 0, largura: 460 });
    expect(segmentos[1]).toEqual({ criterio: 'pagamento', x: 460, largura: 500 });
    const fim = segmentos[1]!.x + segmentos[1]!.largura;
    expect(fim).toBe(Math.round((primeira!.total / 2) * LARGURA_DA_BARRA));
  });

  it('so Preco: a mais barata enche a barra toda', () => {
    const [primeira] = calcularRanking(['preco']);
    expect(segmentosDaBarra(primeira!.pontos, ['preco'])).toEqual([{ criterio: 'preco', x: 0, largura: 1000 }]);
  });
});

describe('formatar (pt-BR)', () => {
  it('milhar com ponto, decimal com virgula e casas fixas', () => {
    expect(formatar(41250, 0)).toBe('41.250');
    expect(formatar(1.9, 2)).toBe('1,90');
    expect(formatar(4.3, 1)).toBe('4,3');
  });
});

describe('waterfall do landed cost', () => {
  const w = calcularWaterfall();

  it('formulas: CIF, II, IPI, PIS/COFINS e total (R$ 326.181,42, acima do gatilho de R$ 300.000)', () => {
    expect(w.cif).toBe(253302);
    const valor = (chave: string) => w.passos.find((p) => p.chave === chave)?.valor;
    expect(valor('proposta')).toBe(233602);
    expect(valor('ii')).toBe(30396.24);
    expect(valor('ipi')).toBe(9220.19);
    expect(valor('pis-cofins')).toBe(29762.99);
    expect(valor('outras')).toBe(3500);
    expect(w.total).toBe(326181.42);
    expect(w.gatilho).toBe(300000);
    expect(w.acimaDoGatilho).toBe(true);
    expect(SIM_FORNECEDORES.find((f) => f.nome === 'Jinhai Industrial')?.cesta).toBe(43100);
  });

  it('9 linhas na ordem da previa; CIF e Total landed sao barras cheias', () => {
    expect(w.passos.map((p) => p.rotulo)).toEqual([
      'Proposta em R$ (43.100 × 5,42)',
      'Frete',
      'Seguro',
      'CIF',
      'II (12%)',
      'IPI (3,25%)',
      'PIS + COFINS (11,75%)',
      'Outras taxas',
      'Total landed',
    ]);
    expect(w.passos.filter((p) => p.total).map((p) => p.chave)).toEqual(['cif', 'total']);
  });

  it('textos de valor: "+ " so nas barras que nao partem de 0', () => {
    expect(w.passos.map((p) => p.valorTexto)).toEqual([
      'R$ 233.602,00',
      '+ R$ 18.500,00',
      '+ R$ 1.200,00',
      'R$ 253.302,00',
      '+ R$ 30.396,24',
      '+ R$ 9.220,19',
      '+ R$ 29.762,99',
      '+ R$ 3.500,00',
      'R$ 326.181,42',
    ]);
  });

  it('eixo 0-1000: as barras cabem, o total nao encosta na borda e o gatilho fica em 88,4%', () => {
    for (const p of w.passos) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.largura).toBeLessThanOrEqual(EIXO);
    }
    const total = w.passos[8]!;
    expect(total.x).toBe(0);
    expect(total.largura).toBeLessThan(EIXO);
    expect(w.xGatilho).toBe(884.4);
    expect(w.gatilhoPct).toBe(88.4);
    // o seguro (R$ 1.200) continua visivel
    expect(w.passos[2]!.largura).toBeGreaterThanOrEqual(6);
  });
});
