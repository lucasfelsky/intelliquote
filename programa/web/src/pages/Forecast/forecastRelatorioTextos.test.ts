import { describe, expect, it } from 'vitest';
import type { ForecastOpcaoEmbalagem } from '@/services/forecast';
import {
  contarComMesesForaDaMedia,
  linhasOutrasEmbalagens,
  opcoesOutrasComPallet,
  PARAGRAFO_EMBALAGEM,
  palletDoDestaque,
  paragrafoMesesForaDaMedia,
  resumoMesesForaDaMedia,
  textoMediaSem,
  textoMesesForaDaMedia,
  textoObservacao,
  textoOpcaoDeEmbalagem,
  textoPallet,
  tituloOutrasEmbalagens,
} from './forecastRelatorioTextos';

// Dados 100% sinteticos.
const opcao = (over: Partial<ForecastOpcaoEmbalagem>): ForecastOpcaoEmbalagem => ({
  codigo: 'C0002',
  quantidade: 200,
  rotulo: null,
  embalagens: 3,
  quantidadeFinal: 600,
  destaque: false,
  ...over,
});

describe('textoOpcaoDeEmbalagem', () => {
  it('formato "N × embalagem (código C) = total kg"', () => {
    expect(textoOpcaoDeEmbalagem(opcao({}))).toBe('3 × 200 kg (código C0002) = 600 kg');
  });

  it('usa o rotulo quando existe e kg com ate 3 casas pt-BR', () => {
    expect(textoOpcaoDeEmbalagem(opcao({ rotulo: 'Tambor 200 kg' }))).toBe('3 × Tambor 200 kg (código C0002) = 600 kg');
    expect(textoOpcaoDeEmbalagem(opcao({ quantidade: 2.125, embalagens: 2, quantidadeFinal: 4.25 }))).toBe(
      '2 × 2,125 kg (código C0002) = 4,25 kg',
    );
    expect(textoOpcaoDeEmbalagem(opcao({ quantidade: 1250.5, embalagens: 1, quantidadeFinal: 1250.5 }))).toBe(
      '1 × 1.250,5 kg (código C0002) = 1.250,5 kg',
    );
  });

  it('quantidade 0: 0 embalagens', () => {
    expect(textoOpcaoDeEmbalagem(opcao({ embalagens: 0, quantidadeFinal: 0 }))).toBe('0 × 200 kg (código C0002) = 0 kg');
  });
});

describe('linhasOutrasEmbalagens / tituloOutrasEmbalagens', () => {
  const usada = { codigo: 'C0001', quantidade: 25, rotulo: null };
  const outra = { codigo: 'C0002', quantidade: 200, rotulo: null };
  const dois = {
    embalagem: { usada, cadastradas: [usada, outra], multiplas: true },
    porEmbalagem: [
      opcao({ codigo: 'C0001', quantidade: 25, embalagens: 2, quantidadeFinal: 50, destaque: true }),
      opcao({ codigo: 'C0002', quantidade: 200, embalagens: 1, quantidadeFinal: 200 }),
    ],
  };

  it('so as embalagens que nao estao em destaque, uma por linha', () => {
    expect(linhasOutrasEmbalagens(dois)).toEqual(['1 × 200 kg (código C0002) = 200 kg']);
    expect(tituloOutrasEmbalagens(dois)).toBe('Outras embalagens: 1 × 200 kg (código C0002) = 200 kg');
  });

  it('uma so embalagem ou nenhuma: sem linhas', () => {
    expect(
      linhasOutrasEmbalagens({
        embalagem: { usada, cadastradas: [usada], multiplas: false },
        porEmbalagem: [opcao({ codigo: 'C0001', destaque: true })],
      }),
    ).toEqual([]);
    expect(linhasOutrasEmbalagens({ embalagem: { usada: null, cadastradas: [], multiplas: false }, porEmbalagem: [] })).toEqual([]);
  });

  it('backend antigo (sem porEmbalagem): uma linha no texto de antes', () => {
    const antigo = { embalagem: dois.embalagem };
    expect(linhasOutrasEmbalagens(antigo)).toEqual(['Outras: C0002 (200 kg)']);
    expect(tituloOutrasEmbalagens(antigo)).toBe('Outras embalagens: C0002 (200 kg)');
  });
});

describe('textoObservacao', () => {
  it('prefixo "Obs.:"; vazio, so espacos ou ausente nao mostram nada', () => {
    expect(textoObservacao('OBS SINTETICA')).toBe('Obs.: OBS SINTETICA');
    expect(textoObservacao('  OBS SINTETICA  ')).toBe('Obs.: OBS SINTETICA');
    expect(textoObservacao('')).toBeNull();
    expect(textoObservacao('   ')).toBeNull();
    expect(textoObservacao(undefined)).toBeNull();
    expect(textoObservacao(null)).toBeNull();
  });
});

describe('PARAGRAFO_EMBALAGEM', () => {
  it('explica a quantidade por embalagem e que a Qtd. final usa a embalagem em destaque', () => {
    expect(PARAGRAFO_EMBALAGEM).toContain('Com mais de uma embalagem, mostra também a quantidade arredondada para cada uma');
    expect(PARAGRAFO_EMBALAGEM).toContain('a Qtd. final usa a embalagem em destaque.');
  });
});

// ---- Pallet fechado (PR 6e) ----
const pallet = (kgPorPallet: number, abaixo: number, acima: number) => ({
  kgPorPallet,
  abaixo: { pallets: abaixo, kg: abaixo * kgPorPallet },
  acima: { pallets: acima, kg: acima * kgPorPallet },
});

describe('textoPallet', () => {
  it('abaixo e acima da quantidade sugerida', () => {
    expect(textoPallet(pallet(600, 2, 3))).toBe(
      'Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)',
    );
  });

  it('multiplo exato mostra so "(exato)"', () => {
    expect(textoPallet(pallet(600, 2, 2))).toBe('Pallet de 600 kg: 2 pallets = 1.200 kg (exato)');
  });

  it('nada abaixo de 1 pallet mostra so "(acima)" e usa o singular', () => {
    expect(textoPallet(pallet(600, 0, 1))).toBe('Pallet de 600 kg: 1 pallet = 600 kg (acima)');
    expect(textoPallet(pallet(600, 1, 2))).toBe('Pallet de 600 kg: 1 pallet = 600 kg (abaixo) · 2 pallets = 1.200 kg (acima)');
  });

  it('kg com casas e milhar pt-BR; sem pallet (nulo/ausente) nao ha texto', () => {
    expect(textoPallet(pallet(1250.5, 2, 3))).toBe(
      'Pallet de 1.250,5 kg: 2 pallets = 2.501 kg (abaixo) · 3 pallets = 3.751,5 kg (acima)',
    );
    expect(textoPallet(null)).toBeNull();
    expect(textoPallet(undefined)).toBeNull();
  });
});

describe('palletDoDestaque / opcoesOutrasComPallet', () => {
  const usada = { codigo: 'C0001', quantidade: 25, rotulo: null };
  const outra = { codigo: 'C0002', quantidade: 200, rotulo: null };
  const item = {
    embalagem: { usada, cadastradas: [usada, outra], multiplas: true },
    porEmbalagem: [
      opcao({ codigo: 'C0001', quantidade: 25, embalagens: 56, quantidadeFinal: 1400, destaque: true, pallet: pallet(600, 2, 3) }),
      opcao({ codigo: 'C0002', quantidade: 200, embalagens: 7, quantidadeFinal: 1400, pallet: pallet(1400, 1, 1) }),
    ],
  };

  it('o pallet da embalagem em destaque e o das outras, logo abaixo de cada uma', () => {
    expect(palletDoDestaque(item)).toBe('Pallet de 600 kg: 2 pallets = 1.200 kg (abaixo) · 3 pallets = 1.800 kg (acima)');
    expect(opcoesOutrasComPallet(item)).toEqual([
      { texto: '7 × 200 kg (código C0002) = 1.400 kg', pallet: 'Pallet de 1.400 kg: 1 pallet = 1.400 kg (exato)' },
    ]);
  });

  it('sem pallet (nulo, ausente ou backend antigo): nada novo e as linhas de antes', () => {
    const sem = {
      embalagem: item.embalagem,
      porEmbalagem: item.porEmbalagem.map((o) => ({ ...o, pallet: null })),
    };
    expect(palletDoDestaque(sem)).toBeNull();
    expect(opcoesOutrasComPallet(sem)).toEqual([{ texto: '7 × 200 kg (código C0002) = 1.400 kg', pallet: null }]);
    expect(palletDoDestaque({})).toBeNull();
    expect(opcoesOutrasComPallet({ embalagem: item.embalagem })).toEqual([{ texto: 'Outras: C0002 (200 kg)', pallet: null }]);
    expect(linhasOutrasEmbalagens(item)).toEqual(['7 × 200 kg (código C0002) = 1.400 kg']); // inalterada
    expect(tituloOutrasEmbalagens(item)).toBe('Outras embalagens: 7 × 200 kg (código C0002) = 1.400 kg');
  });

  it('PARAGRAFO_EMBALAGEM explica o pallet e que a Qtd. final continua pela embalagem', () => {
    expect(PARAGRAFO_EMBALAGEM).toContain(
      'Com pallet cadastrado, mostra também os pallets fechados abaixo e acima da quantidade sugerida; a Qtd. final continua pela embalagem.',
    );
  });
});

describe('meses atipicos (PR 6c)', () => {
  it('textoMesesForaDaMedia e textoMediaSem: meses abreviados em ordem; vazio/ausente = nenhum', () => {
    expect(textoMesesForaDaMedia(['2026-08'])).toBe('ago/2026');
    expect(textoMesesForaDaMedia(['2026-08', '2026-09', '2026-10'])).toBe('ago/2026, set/2026, out/2026');
    expect(textoMesesForaDaMedia([])).toBe('');
    expect(textoMesesForaDaMedia(undefined)).toBe('');
    expect(textoMesesForaDaMedia(null)).toBe('');
    expect(textoMediaSem(['2026-08', '2026-09'])).toBe('Média sem: ago/2026, set/2026');
    expect(textoMediaSem([])).toBeNull();
    expect(textoMediaSem(undefined)).toBeNull();
  });

  it('contarComMesesForaDaMedia soma lista de compra, sem consumo e sob demanda; backend antigo = 0', () => {
    const itens = (...marcas: Array<string[] | undefined>) => marcas.map((mesesForaDaMedia) => ({ mesesForaDaMedia }));
    const r = {
      grupos: [{ itens: itens(['2026-08'], undefined, []) }, { itens: itens(['2026-09']) }],
      semConsumo: { itens: itens(['2026-08']) },
      sobDemanda: { itens: itens([], ['2026-10']) },
    } as unknown as Parameters<typeof contarComMesesForaDaMedia>[0];
    expect(contarComMesesForaDaMedia(r)).toBe(4);
    expect(
      contarComMesesForaDaMedia({ grupos: [{ itens: itens(undefined) }] } as unknown as Parameters<typeof contarComMesesForaDaMedia>[0]),
    ).toBe(0);
  });

  it('resumo no singular/plural e o paragrafo das regras', () => {
    expect(resumoMesesForaDaMedia(1)).toBe('1 item usa média sem meses atípicos');
    expect(resumoMesesForaDaMedia(3)).toBe('3 itens usam média sem meses atípicos');
    expect(paragrafoMesesForaDaMedia()).toBe(
      'Meses marcados como venda atípica ficam fora das médias trimestral e semestral (e do consumo do mês, se marcado o mês atual). A conferência com a planilha usa a regra original.',
    );
  });
});
