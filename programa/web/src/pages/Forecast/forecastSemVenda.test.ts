import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForecastLinha } from '@/services/forecast';
import {
  classificarVenda,
  contarOcultaveis,
  filtrarPorSemVenda,
  gravarMostrarSemVenda,
  lerMostrarSemVenda,
  ocultavelPorSemVenda,
  semVendaHa6Meses,
} from './forecastSemVenda';

// Dados 100% sinteticos.
function linha(over: Partial<ForecastLinha> = {}): ForecastLinha {
  return {
    linha: 3,
    O: 0,
    P: 0,
    Q: 0,
    R: 0,
    S: 0,
    T: 0,
    U: 100,
    chegadas: [0, 0, 0, 0, 0],
    AA: 0,
    programacoes: [0, 0, 0, 0],
    AG: 0,
    projecao: [100, 100, 100, 100, 100, 100],
    AN: 100,
    AQ: null,
    AP: null,
    AR: 0,
    AS: 0,
    item: 'PRODUTO TESTE',
    codigos: ['T0001'],
    fonte: 'FONTE X',
    status: 'nao',
    analiseForecast: null,
    productId: null,
    historico: [0, 0, 0, 0, 0],
    ...over,
  };
}

describe('classificarVenda', () => {
  it('classifica sem venda quando J..N, O e P sao todos zero', () => {
    expect(classificarVenda(linha())).toBe('sem-venda');
    expect(semVendaHa6Meses(linha())).toBe(true);
  });

  it.each([0, 1, 2, 3, 4])('venda em J..N (posicao %i do historico) tira do sem venda', (i) => {
    const historico = [0, 0, 0, 0, 0];
    historico[i] = 5;
    expect(classificarVenda(linha({ historico }))).toBe('com-venda');
  });

  it('venda em O (mes anterior) tira do sem venda', () => {
    expect(classificarVenda(linha({ O: 3 }))).toBe('com-venda');
  });

  it('venda so no mes atual (P > 0) nao e sem venda', () => {
    expect(classificarVenda(linha({ P: 7 }))).toBe('com-venda');
    expect(semVendaHa6Meses(linha({ P: 7 }))).toBe(false);
  });

  it('devolucao liquida (valor negativo) conta como sem venda', () => {
    expect(classificarVenda(linha({ historico: [0, -4, 0, 0, 0], O: -1, P: -2 }))).toBe('sem-venda');
  });

  it('historico ausente ou com menos de 5 meses = indeterminado (nunca oculta, sem selo)', () => {
    const semHistorico = linha({ historico: undefined });
    expect(classificarVenda(semHistorico)).toBe('indeterminado');
    expect(classificarVenda(linha({ historico: [0, 0, 0, 0] }))).toBe('indeterminado');
    expect(semVendaHa6Meses(semHistorico)).toBe(false);
    expect(ocultavelPorSemVenda(semHistorico)).toBe(false);
  });

  it('valor nao finito = indeterminado', () => {
    expect(classificarVenda(linha({ historico: [0, Number.NaN, 0, 0, 0] }))).toBe('indeterminado');
    expect(classificarVenda(linha({ O: Number.POSITIVE_INFINITY }))).toBe('indeterminado');
    expect(classificarVenda(linha({ P: Number.NaN }))).toBe('indeterminado');
  });

  it('meses atipicos (mediaAjustada/mesesForaDaMedia) nao mudam a classificacao', () => {
    const base = linha({ historico: [0, 0, 20, 0, 0] });
    const marcada = linha({
      historico: [0, 0, 20, 0, 0],
      Q: 0,
      R: 0,
      mesesForaDaMedia: [{ anoMes: '2026-08', motivo: 'venda pontual', indice: 2 }],
      mediaAjustada: { meses: [2], Q: 3, R: 3, AG: 3, semMesValido: false },
    });
    expect(classificarVenda(base)).toBe('com-venda');
    expect(classificarVenda(marcada)).toBe('com-venda');
    const semVendaMarcada = linha({
      mesesForaDaMedia: [{ anoMes: '2026-08', motivo: 'zero', indice: 2 }],
      mediaAjustada: { meses: [2], Q: 0, R: 0, AG: 0, semMesValido: true },
    });
    expect(classificarVenda(semVendaMarcada)).toBe('sem-venda');
  });
});

describe('ocultavelPorSemVenda / filtrar / contar', () => {
  it('excecao: linha que entra no relatorio (AN < 0) continua visivel mesmo sem venda', () => {
    const entra = linha({ AN: -10 });
    expect(semVendaHa6Meses(entra)).toBe(true);
    expect(ocultavelPorSemVenda(entra)).toBe(false);
  });

  it('excecao: linha em andamento (status != nao) continua visivel mesmo sem venda', () => {
    const cotando = linha({ status: 'cotando' });
    expect(semVendaHa6Meses(cotando)).toBe(true);
    expect(ocultavelPorSemVenda(cotando)).toBe(false);
    expect(ocultavelPorSemVenda(linha())).toBe(true);
  });

  it('filtrarPorSemVenda(mostrar = true) devolve a mesma referencia', () => {
    const linhas = [linha(), linha({ linha: 4, P: 9 })];
    expect(filtrarPorSemVenda(linhas, true)).toBe(linhas);
    expect(filtrarPorSemVenda(linhas, false)).toEqual([linhas[1]]);
  });

  it('contarOcultaveis conta so os ocultaveis', () => {
    const linhas = [
      linha({ linha: 3 }),
      linha({ linha: 4, P: 9 }),
      linha({ linha: 5, AN: -1 }),
      linha({ linha: 6, status: 'po' }),
      linha({ linha: 7, historico: undefined }),
      linha({ linha: 8 }),
    ];
    expect(contarOcultaveis(linhas)).toBe(2);
  });
});

describe('preferencia', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Zera a memoria de sessao dos usuarios usados nos testes.
    for (const id of [1, 2, 3]) gravarMostrarSemVenda(id, true);
  });

  it("preferencia: sem chave = mostrar; grava 'ocultar' por usuario; mostrar remove a chave", () => {
    expect(lerMostrarSemVenda(1)).toBe(true);
    gravarMostrarSemVenda(1, false);
    expect(localStorage.getItem('iq-forecast-sem-venda:1')).toBe('ocultar');
    expect(lerMostrarSemVenda(1)).toBe(false);
    gravarMostrarSemVenda(1, true);
    expect(localStorage.getItem('iq-forecast-sem-venda:1')).toBeNull();
    expect(lerMostrarSemVenda(1)).toBe(true);
  });

  it('preferencia: usuario diferente nao herda a escolha', () => {
    gravarMostrarSemVenda(1, false);
    expect(lerMostrarSemVenda(2)).toBe(true);
    expect(lerMostrarSemVenda(1)).toBe(false);
  });

  it('preferencia: localStorage que lanca cai para memoria sem quebrar', () => {
    const lanca = () => {
      throw new Error('storage bloqueado');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(lanca);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(lanca);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(lanca);
    expect(lerMostrarSemVenda(3)).toBe(true);
    expect(() => gravarMostrarSemVenda(3, false)).not.toThrow();
    expect(lerMostrarSemVenda(3)).toBe(false);
    expect(() => gravarMostrarSemVenda(3, true)).not.toThrow();
    expect(lerMostrarSemVenda(3)).toBe(true);
  });

  it('preferencia: valor invalido ou userId ausente = mostrar', () => {
    localStorage.setItem('iq-forecast-sem-venda:1', 'qualquer-coisa');
    expect(lerMostrarSemVenda(1)).toBe(true);
    gravarMostrarSemVenda(undefined, false);
    expect(lerMostrarSemVenda(undefined)).toBe(true);
    expect(localStorage.length).toBe(1);
  });
});
