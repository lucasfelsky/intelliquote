import { describe, expect, it } from 'vitest';
import type { ForecastPrazosEstimativa, ForecastSugestaoPrazoCampo } from '@/services/forecast';
import {
  corpoDosPrazos,
  linhasSugestao,
  mesclarRascunho,
  podeUsarSugestao,
  prazosMudaram,
  rascunhoInicial,
  rascunhoInvalido,
  textoPadraoSalvo,
  textoPadroesAlterados,
  textoSugestao,
  validarDias,
} from './forecastPrazosChegada';

// Dados 100% sinteticos.
const zero = { linhas: 0, kg: 0 };
function prazos(): ForecastPrazosEstimativa {
  return {
    padrao: { prontidaoDias: 35, etdDias: 35 },
    fontes: [
      {
        sourceId: 1,
        nome: 'FONTE 001',
        salvo: { prontidaoDias: null, etdDias: null },
        usado: { prontidaoDias: 35, etdDias: 35 },
        prontidao: { linhas: 2, kg: 500 },
        etd: zero,
      },
      {
        sourceId: 2,
        nome: 'FONTE 002',
        salvo: { prontidaoDias: 50, etdDias: 20 },
        usado: { prontidaoDias: 50, etdDias: 20 },
        prontidao: zero,
        etd: { linhas: 1, kg: 100 },
      },
    ],
    semFonte: { prontidao: zero, etd: zero },
    padroesAlterados: 0,
  };
}

describe('validarDias', () => {
  it('aceita inteiros 0..365 (com espacos nas pontas)', () => {
    for (const ok of ['0', '35', '365', ' 12 ', '007']) expect(validarDias(ok), ok).toBeNull();
  });

  it('recusa vazio, sinal, decimal, texto e acima de 365 com mensagem em portugues', () => {
    expect(validarDias('')).toBe('Informe os dias.');
    expect(validarDias('   ')).toBe('Informe os dias.');
    for (const ruim of ['-1', '+5', '12,5', '12.5', '1e2', 'abc', '3 5']) {
      expect(validarDias(ruim), ruim).toBe('Use um número inteiro de dias, sem sinal nem decimais.');
    }
    expect(validarDias('366')).toBe('No máximo 365 dias.');
    expect(validarDias('99999')).toBe('No máximo 365 dias.');
  });
});

describe('rascunho dos prazos', () => {
  it('rascunhoInicial parte do prazo USADO pelo servidor (salvo, senao padrao)', () => {
    expect(rascunhoInicial(prazos())).toEqual({
      1: { prontidao: '35', etd: '35' },
      2: { prontidao: '50', etd: '20' },
    });
  });

  it('mesclarRascunho: editada fica, nova entra com o usado, a que saiu sai', () => {
    const atual = { 1: { prontidao: '60', etd: '35' }, 9: { prontidao: '1', etd: '1' } };
    expect(mesclarRascunho(atual, prazos())).toEqual({
      1: { prontidao: '60', etd: '35' }, // editada: fica
      2: { prontidao: '50', etd: '20' }, // nova: usado
    });
    expect(mesclarRascunho(null, prazos())).toEqual(rascunhoInicial(prazos()));
  });

  it('corpoDosPrazos: todas as fontes da tabela, como inteiros; null se algum campo e invalido', () => {
    const r = rascunhoInicial(prazos());
    expect(corpoDosPrazos(r, prazos())).toEqual([
      { sourceId: 1, prontidaoDias: 35, etdDias: 35 },
      { sourceId: 2, prontidaoDias: 50, etdDias: 20 },
    ]);
    expect(corpoDosPrazos({ ...r, 1: { prontidao: '60 ', etd: '0' } }, prazos())?.[0]).toEqual({
      sourceId: 1,
      prontidaoDias: 60,
      etdDias: 0,
    });
    expect(corpoDosPrazos({ ...r, 2: { prontidao: '50', etd: '' } }, prazos())).toBeNull();
    expect(corpoDosPrazos({ ...r, 2: { prontidao: '400', etd: '20' } }, prazos())).toBeNull();
    expect(corpoDosPrazos({ 1: r[1]! }, prazos())).toBeNull(); // fonte sem linha no rascunho
    expect(rascunhoInvalido({ ...r, 1: { prontidao: 'x', etd: '35' } }, prazos())).toBe(true);
    expect(rascunhoInvalido(r, prazos())).toBe(false);
  });

  it('prazosMudaram: so quando difere do que a previa atual usou; invalido conta como mudanca', () => {
    const r = rascunhoInicial(prazos());
    expect(prazosMudaram(r, prazos())).toBe(false);
    expect(prazosMudaram(null, prazos())).toBe(false);
    expect(prazosMudaram({ ...r, 1: { prontidao: '36', etd: '35' } }, prazos())).toBe(true);
    expect(prazosMudaram({ ...r, 2: { prontidao: '50', etd: '21' } }, prazos())).toBe(true);
    expect(prazosMudaram({ ...r, 2: { prontidao: '', etd: '20' } }, prazos())).toBe(true);
    // Digitar o mesmo valor com zeros a esquerda nao e mudanca.
    expect(prazosMudaram({ ...r, 1: { prontidao: '035', etd: '35' } }, prazos())).toBe(false);
  });
});

describe('textos', () => {
  it('textoPadroesAlterados: singular, plural e nada', () => {
    expect(textoPadroesAlterados(0)).toBeNull();
    expect(textoPadroesAlterados(1)).toBe('Ao confirmar, 1 fonte terá o padrão salvo alterado.');
    expect(textoPadroesAlterados(3)).toBe('Ao confirmar, 3 fontes terão o padrão salvo alterado.');
  });

  it('textoPadraoSalvo: valor salvo de cada coluna ou traco', () => {
    expect(textoPadraoSalvo({ prontidaoDias: null, etdDias: null })).toBe('—');
    expect(textoPadraoSalvo({ prontidaoDias: 60, etdDias: null })).toBe('prontidão 60 dias');
    expect(textoPadraoSalvo({ prontidaoDias: null, etdDias: 20 })).toBe('ETD 20 dias');
    expect(textoPadraoSalvo({ prontidaoDias: 60, etdDias: 20 })).toBe('prontidão 60 · ETD 20 dias');
  });
});

describe('sugestao pelo historico do FUP', () => {
  const sugestao = (
    situacao: ForecastSugestaoPrazoCampo['situacao'],
    dias: number | null,
    evidencia: Partial<ForecastSugestaoPrazoCampo['evidencia']> = {},
  ): ForecastSugestaoPrazoCampo => ({
    situacao,
    dias,
    atual: 35,
    minAmostras: 10,
    evidencia: {
      amostras: 79,
      mediana: 58,
      percentil: 75,
      valorPercentil: 61,
      min: 4,
      max: 91,
      de: '2033-11-03',
      ate: '2034-10-31',
      dispersaoAlta: false,
      ...evidencia,
    },
  });

  it("'sugerida': valor, percentil, mediana, n, faixa e periodo", () => {
    const s = sugestao('sugerida', 61);
    expect(linhasSugestao(s)).toEqual([
      'Sugestão pelo FUP: 61 dias (P75)',
      'mediana 58 · 79 chegadas',
      'faixa 4–91 dias',
      'ETA FINAL 03/11/2033 a 31/10/2034',
    ]);
    expect(textoSugestao(s)).toBe(
      'Sugestão pelo FUP: 61 dias (P75) · mediana 58 · 79 chegadas · faixa 4–91 dias · ETA FINAL 03/11/2033 a 31/10/2034',
    );
  });

  it("'sugerida' com 1 chegada usa o singular (e o rotulo do percentil segue o backend)", () => {
    expect(textoSugestao(sugestao('sugerida', 50, { amostras: 1, percentil: 50 }))).toContain('(P50) · mediana 58 · 1 chegada ·');
  });

  it("'diferenca_pequena': prazo atual perto do real, com a evidencia", () => {
    const s = sugestao('diferenca_pequena', 37, { valorPercentil: 37, mediana: 36, amostras: 20 });
    expect(textoSugestao(s)).toBe('Prazo atual perto do real · P75 37 · mediana 36 · 20 chegadas');
  });

  it("'poucas_amostras': quantas chegadas e o minimo", () => {
    expect(textoSugestao(sugestao('poucas_amostras', null, { amostras: 9 }))).toBe('Poucas chegadas no FUP (9 de mínimo 10)');
  });

  it('sem sugestao (backend antigo ou sem chegada medida): nada', () => {
    expect(textoSugestao(null)).toBeNull();
    expect(textoSugestao(undefined)).toBeNull();
    expect(linhasSugestao(undefined)).toEqual([]);
  });

  it('podeUsarSugestao: so para sugerida e quando o campo ainda nao esta com o valor', () => {
    const s = sugestao('sugerida', 61);
    expect(podeUsarSugestao('35', s)).toBe(true);
    expect(podeUsarSugestao('', s)).toBe(true);
    expect(podeUsarSugestao('abc', s)).toBe(true);
    expect(podeUsarSugestao('61', s)).toBe(false);
    expect(podeUsarSugestao(' 61 ', s)).toBe(false);
    expect(podeUsarSugestao('35', sugestao('diferenca_pequena', 37))).toBe(false);
    expect(podeUsarSugestao('35', sugestao('poucas_amostras', null))).toBe(false);
    expect(podeUsarSugestao('35', sugestao('sugerida', null))).toBe(false);
    expect(podeUsarSugestao('35', null)).toBe(false);
    expect(podeUsarSugestao('35', undefined)).toBe(false);
  });
});
