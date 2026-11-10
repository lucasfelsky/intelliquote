import { describe, expect, it } from 'vitest';
import type { ForecastItemRelatorio } from '@/services/forecast';
import type { ForecastCandidato } from '@/services/forecastCotacaoLote';
import type { ForecastDecisao } from '@/services/forecastDecisoes';
import {
  agruparPorFonte,
  avisoDeArredondamento,
  etiquetaDoCandidato,
  itemDaLista,
  itemDeCandidato,
  motivoDeBloqueio,
  paraItemDoLote,
  paraItemDoRascunho,
  textoBotaoGerar,
  textoResumoCotacoes,
  validarQuantidadeACotar,
  type ContextoDeBloqueio,
  type ItemDaCotacao,
} from './forecastCriarCotacaoRegras';

function item(over: Partial<ItemDaCotacao> = {}): ItemDaCotacao {
  return {
    productId: 1,
    nome: 'PRODUTO 001',
    codigos: ['C0001'],
    fonte: 'FONTE 001',
    origem: 'lista',
    sugeridaKg: 100,
    kg: '100',
    obs: '',
    ...over,
  };
}

function relatorioItem(over: Record<string, unknown> = {}): ForecastItemRelatorio {
  return { productId: 1, item: 'PRODUTO 001', codigos: ['C0001'], quantidadeFinal: 125.12345, ...over } as unknown as ForecastItemRelatorio;
}

function decisao(over: Partial<ForecastDecisao> = {}): ForecastDecisao {
  return {
    productId: 1,
    quantidadeKg: 300,
    status: 'nao',
    observacao: 'OBS SINTETICA',
    sugeridaKg: 125,
    demandaKg: -40,
    decididaPorId: 1,
    criadaEm: '2026-10-26T17:30:00.000Z',
    atualizadaEm: '2026-10-26T17:30:00.000Z',
    ...over,
  };
}

function candidato(over: Partial<ForecastCandidato> = {}): ForecastCandidato {
  return {
    productId: 9,
    item: 'PRODUTO 009',
    codigos: ['C0009'],
    fonte: 'FONTE 001',
    demandaKg: 480,
    quantidadeSugeridaKg: null,
    motivoForaDaLista: 'sem-falta',
    coberturaAteMes: '2027-01',
    coberturaAteOFimDaJanela: false,
    urgencia: null,
    grupoNome: null,
    ...over,
  };
}

describe('itemDaLista (quantidade inicial)', () => {
  it('sem decisao: a Qtd. final calculada, em kg inteiro para cima', () => {
    const i = itemDaLista({ item: relatorioItem(), fonte: 'FONTE 001' }, undefined, 15);
    expect(i?.kg).toBe('126');
    expect(i?.origem).toBe('lista');
    expect(i?.sugeridaKg).toBe(125.12345);
  });

  it('com decisao salva: a decisao e a observacao dela', () => {
    const i = itemDaLista({ item: relatorioItem(), fonte: 'FONTE 001' }, decisao(), 15);
    expect(i?.kg).toBe('300');
    expect(i?.obs).toBe('OBS SINTETICA');
  });

  it('decisao 0 (nao comprar) ou Qtd. final 0: campo vazio com a dica do motivo', () => {
    expect(itemDaLista({ item: relatorioItem(), fonte: 'F' }, decisao({ quantidadeKg: 0 }), 15)).toMatchObject({
      kg: '',
      dicaKg: 'A decisão salva desta quinzena é não comprar (0 kg).',
    });
    expect(itemDaLista({ item: relatorioItem({ quantidadeFinal: 0 }), fonte: 'F' }, undefined, 15)).toMatchObject({
      kg: '',
      dicaKg: 'Sem quantidade a comprar nesta quinzena.',
    });
  });

  it('item sem productId nao vira item da cotacao', () => {
    expect(itemDaLista({ item: relatorioItem({ productId: null }), fonte: 'F' }, undefined, 15)).toBeNull();
  });
});

describe('itemDeCandidato e etiquetas', () => {
  it('sem falta: campo vazio, de fora da lista, com a etiqueta do mes de cobertura', () => {
    const i = itemDeCandidato(candidato());
    expect(i.origem).toBe('candidato');
    expect(i.kg).toBe('');
    expect(i.etiqueta).toBe('Sem falta: estoque cobre até jan/2027');
  });

  it('com sugerida: a quantidade nasce dela (kg inteiro para cima)', () => {
    expect(itemDeCandidato(candidato({ quantidadeSugeridaKg: 120.2 })).kg).toBe('121');
  });

  it.each([
    [{ motivoForaDaLista: 'sob-demanda' }, 'Compra sob demanda'],
    [{ motivoForaDaLista: 'coberto-por-grupo', grupoNome: 'GRUPO X' }, 'Coberto pelo grupo GRUPO X'],
    [{ motivoForaDaLista: 'sem-consumo-com-movimento' }, 'Sem consumo na média, com movimento'],
    [{ motivoForaDaLista: 'sem-falta', coberturaAteOFimDaJanela: true, coberturaAteMes: '2027-03' }, 'Sem falta: estoque cobre pelo menos até mar/2027'],
  ] as Array<[Partial<ForecastCandidato>, string]>)('etiqueta %#', (parte, texto) => {
    expect(etiquetaDoCandidato(candidato(parte))).toBe(texto);
  });
});

describe('validarQuantidadeACotar', () => {
  it.each([
    ['', 'Informe a quantidade a cotar.'],
    ['abc', 'Informe a quantidade em kg (ex.: 1.600 ou 1600,5).'],
    ['0', 'A quantidade a cotar deve ser maior que zero.'],
    ['-5', 'A quantidade não pode ser negativa.'],
    ['10.000.001', 'A quantidade aceita no máximo 10.000.000 kg.'],
    ['1,2345', 'A quantidade aceita no máximo 3 casas decimais.'],
  ])('"%s" e invalida', (texto, erro) => {
    expect(validarQuantidadeACotar(texto)).toEqual({ kg: null, erro });
  });

  it('aceita pt-BR com milhar e virgula', () => {
    expect(validarQuantidadeACotar('1.600,5')).toEqual({ kg: 1600.5 });
    expect(validarQuantidadeACotar('10')).toEqual({ kg: 10 });
  });

  it('avisa que a cotacao leva o kg inteiro para cima', () => {
    expect(avisoDeArredondamento(10)).toBeUndefined();
    expect(avisoDeArredondamento(10.2)).toBe('A cotação leva 11 kg (inteiro, para cima).');
  });
});

describe('motivoDeBloqueio', () => {
  const ctx = (over: Partial<ContextoDeBloqueio> = {}): ContextoDeBloqueio => ({
    produtosCarregando: false,
    produtosErro: false,
    codesDe: () => [{ code: 'C0001', position: 1, catalogItemId: 5 }],
    cotacaoAbertaDe: () => null,
    ...over,
  });

  it('pode: fonte, vinculo e sem cotacao aberta', () => {
    expect(motivoDeBloqueio(item(), ctx())).toBeNull();
  });

  it('na ordem: indisponivel, sem fonte, cotacao aberta, verificando, erro, sem vinculo', () => {
    expect(motivoDeBloqueio(item({ indisponivel: true }), ctx())).toMatch(/não está mais disponível/);
    expect(motivoDeBloqueio(item({ fonte: '  ' }), ctx())).toBe('Item sem fonte.');
    expect(motivoDeBloqueio(item(), ctx({ cotacaoAbertaDe: () => 'COT-0001' }))).toBe('Este item já está na cotação aberta COT-0001.');
    expect(motivoDeBloqueio(item(), ctx({ produtosCarregando: true }))).toBe('Verificando o vínculo com o catálogo…');
    expect(motivoDeBloqueio(item(), ctx({ produtosErro: true }))).toBe('Não foi possível verificar o vínculo com o catálogo. Recarregue a página.');
    expect(motivoDeBloqueio(item(), ctx({ codesDe: () => [{ code: 'C', position: 1, catalogItemId: null }] }))).toBe(
      'Nenhum código deste produto está vinculado a um item do catálogo.',
    );
    expect(motivoDeBloqueio(item(), ctx({ codesDe: () => undefined }))).toBe('Nenhum código deste produto está vinculado a um item do catálogo.');
  });
});

describe('agrupamento por fonte e resumo', () => {
  it('uma cotacao por fonte, na ordem de aparicao; fonte com caixa/espacos diferentes e a mesma', () => {
    const grupos = agruparPorFonte([
      item({ productId: 1, fonte: 'FONTE 002' }),
      item({ productId: 2, fonte: 'FONTE 003' }),
      item({ productId: 3, fonte: ' fonte 002 ' }),
    ]);
    expect(grupos.map((g) => [g.fonte, g.itens.length])).toEqual([
      ['FONTE 002', 2],
      ['FONTE 003', 1],
    ]);
    expect(textoResumoCotacoes(grupos)).toBe('Serão geradas 2 cotações: FONTE 002 (2 itens) e FONTE 003 (1 item).');
    expect(textoBotaoGerar(grupos.length)).toBe('Gerar 2 cotações');
  });

  it('uma fonte: "Sera gerada 1 cotacao"; sem fonte nao conta como cotacao', () => {
    expect(textoResumoCotacoes(agruparPorFonte([item()]))).toBe('Será gerada 1 cotação: FONTE 001 (1 item).');
    expect(textoBotaoGerar(1)).toBe('Gerar cotação');
    const semFonte = agruparPorFonte([item({ fonte: '' })]);
    expect(semFonte[0]?.fonte).toBe('Sem fonte');
    expect(textoResumoCotacoes(semFonte)).toBe('Nenhuma cotação será gerada: escolha ao menos um item.');
  });
});

describe('rascunho e lote', () => {
  it('rascunho: quantidade invalida ou vazia vai como 0; observacao aparada (vazia = null)', () => {
    expect(paraItemDoRascunho(item({ kg: '1.600,5', obs: '  oi  ' }))).toEqual({ productId: 1, quantidadeKg: 1600.5, observacao: 'oi' });
    expect(paraItemDoRascunho(item({ kg: 'abc', obs: '   ' }))).toEqual({ productId: 1, quantidadeKg: 0, observacao: null });
    expect(paraItemDoRascunho(item({ kg: '' }))).toMatchObject({ quantidadeKg: 0 });
  });

  it('lote: item de fora da lista SEMPRE com incluidoManualmente: true; da lista, sem a chave', () => {
    expect(paraItemDoLote(item({ origem: 'candidato' }), 10, undefined, true)).toEqual({
      productId: 1,
      quantidadeKg: 10,
      observacao: null,
      incluidoManualmente: true,
      atualizadoEm: null,
    });
    expect(paraItemDoLote(item({ obs: ' x ' }), 10, decisao({ atualizadaEm: '2026-10-27T15:00:00.000Z' }), true)).toEqual({
      productId: 1,
      quantidadeKg: 10,
      observacao: 'x',
      atualizadoEm: '2026-10-27T15:00:00.000Z',
    });
  });

  it('lote sem leitura das decisoes: nao manda atualizadoEm (nada para conferir)', () => {
    expect(paraItemDoLote(item(), 10, undefined, false)).not.toHaveProperty('atualizadoEm');
  });
});
