import { describe, expect, it } from 'vitest';
import type { ForecastOpcaoEmbalagem } from '@/services/forecast';
import {
  linhasOutrasEmbalagens,
  PARAGRAFO_EMBALAGEM,
  textoObservacao,
  textoOpcaoDeEmbalagem,
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
