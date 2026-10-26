import { describe, expect, it } from 'vitest';
import type { ForecastEmbalagens } from '@/services/forecastEmbalagens';
import {
  avisoDoPallet,
  edicaoInicial,
  type EdicaoDeEmbalagens,
  ERRO_QTD_CASAS,
  ERRO_QTD_FORMATO,
  ERRO_QTD_MAXIMA,
  ERRO_PALLET_CASAS,
  ERRO_PALLET_FORMATO,
  ERRO_PALLET_MAXIMO,
  ERRO_PALLET_MUITOS,
  ERRO_PALLET_POSITIVO,
  ERRO_PALLET_REPETIDO,
  ERRO_PALLET_SEM_QUANTIDADE,
  ERRO_QTD_POSITIVA,
  avisoDosPallets,
  erroDoPallet,
  erroDosPallets,
  lerPalletKg,
  lerPalletsKg,
  lerQuantidadeKg,
  MAX_PALLETS_POR_CODIGO,
  montarPatch,
  palletsDoCodigo,
  palletsParaCampo,
  quantidadeParaCampo,
} from './forecastEmbalagens';

describe('lerQuantidadeKg', () => {
  it('vazio vira null (sem embalagem)', () => {
    expect(lerQuantidadeKg('')).toEqual({ ok: true, valor: null });
    expect(lerQuantidadeKg('   ')).toEqual({ ok: true, valor: null });
  });

  it.each([
    ['25', 25],
    ['25,5', 25.5],
    ['22,68', 22.68],
    ['0,5', 0.5],
    ['1.000', 1000],
    ['1.250,5', 1250.5],
    ['1.000.000', 1000000],
    [' 200 ', 200],
    ['2,125', 2.125],
  ])('aceita %s', (texto, valor) => {
    expect(lerQuantidadeKg(texto)).toEqual({ ok: true, valor });
  });

  it.each([
    ['0', ERRO_QTD_POSITIVA],
    ['0,000', ERRO_QTD_POSITIVA],
    ['-5', ERRO_QTD_POSITIVA],
    ['abc', ERRO_QTD_FORMATO],
    ['25 kg', ERRO_QTD_FORMATO],
    ['25.5', ERRO_QTD_FORMATO],
    ['1.00', ERRO_QTD_FORMATO],
    ['25,', ERRO_QTD_FORMATO],
    ['25,1234', ERRO_QTD_CASAS],
    ['1.000.001', ERRO_QTD_MAXIMA],
    ['1000000,001', ERRO_QTD_MAXIMA],
  ])('rejeita %s', (texto, erro) => {
    expect(lerQuantidadeKg(texto)).toEqual({ ok: false, erro });
  });

  it('quantidadeParaCampo devolve o que lerQuantidadeKg le de volta', () => {
    expect(quantidadeParaCampo(null)).toBe('');
    expect(quantidadeParaCampo(22.68)).toBe('22,68');
    expect(quantidadeParaCampo(1000)).toBe('1000');
    expect(lerQuantidadeKg(quantidadeParaCampo(22.68))).toEqual({ ok: true, valor: 22.68 });
  });
});

const original: ForecastEmbalagens = {
  produto: { id: 5, nome: 'PRODUTO 001', ativo: true, embalagemPlanilha: null, naoFraciona: false },
  codigos: [
    { id: 11, posicao: 1, codigo: 'C0001', quantidadeKg: 25, rotulo: 'Saco', principal: true, origem: 'manual', atualizadoEm: '2026-10-22' },
    { id: 12, posicao: 2, codigo: 'C0002', quantidadeKg: null, rotulo: null, principal: false, origem: null, atualizadoEm: null },
    { id: 13, posicao: 3, codigo: 'C0003', quantidadeKg: 200, rotulo: null, principal: false, origem: 'dbcorp', atualizadoEm: '2026-10-21' },
  ],
  usadaCodigoId: 11,
};

// Copia da edicao com o codigo da posicao `i` alterado.
function editar(
  ed: EdicaoDeEmbalagens,
  i: number,
  parcial: Partial<EdicaoDeEmbalagens['codigos'][number]>,
): EdicaoDeEmbalagens {
  return { ...ed, codigos: ed.codigos.map((c, j) => (j === i ? { ...c, ...parcial } : c)) };
}

describe('montarPatch', () => {
  const base = edicaoInicial(original);

  it('nada mudou -> null', () => {
    expect(montarPatch(original, base)).toBeNull();
  });

  it('rotulo so com espacos equivale a vazio (nao conta como mudanca)', () => {
    expect(montarPatch(original, editar(base, 1, { rotulo: '   ' }))).toBeNull();
  });

  it('so os codigos alterados; principal ausente quando nao mudou', () => {
    expect(montarPatch(original, editar(base, 2, { quantidadeKg: 22.68 }))).toEqual({
      embalagens: [{ codigoId: 13, quantidadeKg: 22.68, rotulo: null }],
    });
  });

  it('muda so o rotulo (aparado) e so a principal', () => {
    expect(montarPatch(original, editar(base, 0, { rotulo: '  Saco 25 kg ' }))).toEqual({
      embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco 25 kg' }],
    });
    expect(montarPatch(original, { ...base, principalCodigoId: 13 })).toEqual({ principalCodigoId: 13 });
  });

  it('principal null = nenhuma; limpar a quantidade do principal junto com a principal', () => {
    const ed = { ...editar(base, 0, { quantidadeKg: null, rotulo: null }), principalCodigoId: null };
    expect(montarPatch(original, ed)).toEqual({
      embalagens: [{ codigoId: 11, quantidadeKg: null, rotulo: null }],
      principalCodigoId: null,
    });
  });
});

describe('lerPalletKg (PR 6e)', () => {
  it('mesmas regras da quantidade, com as mensagens do pallet; vazio = sem pallet', () => {
    expect(lerPalletKg('')).toEqual({ ok: true, valor: null });
    expect(lerPalletKg('600')).toEqual({ ok: true, valor: 600 });
    expect(lerPalletKg('1.200')).toEqual({ ok: true, valor: 1200 });
    expect(lerPalletKg('1.250,5')).toEqual({ ok: true, valor: 1250.5 });
    expect(lerPalletKg('1.000.000')).toEqual({ ok: true, valor: 1000000 });
    expect(lerPalletKg('0')).toEqual({ ok: false, erro: ERRO_PALLET_POSITIVO });
    expect(lerPalletKg('-5')).toEqual({ ok: false, erro: ERRO_PALLET_POSITIVO });
    expect(lerPalletKg('1.000.001')).toEqual({ ok: false, erro: ERRO_PALLET_MAXIMO });
    expect(lerPalletKg('600,1234')).toEqual({ ok: false, erro: ERRO_PALLET_CASAS });
    expect(lerPalletKg('abc')).toEqual({ ok: false, erro: ERRO_PALLET_FORMATO });
  });
});

describe('erroDoPallet (PR 6e)', () => {
  it('sem pallet nao ha erro; pallet exige quantidade na embalagem, mas NAO precisa ser multiplo dela', () => {
    expect(erroDoPallet(25, null)).toBeNull();
    expect(erroDoPallet(null, null)).toBeNull();
    expect(erroDoPallet(null, 600)).toBe(ERRO_PALLET_SEM_QUANTIDADE);
    expect(erroDoPallet(25, 600)).toBeNull();
    expect(erroDoPallet(25, 25)).toBeNull();
    expect(erroDoPallet(0.125, 3.125)).toBeNull();
    expect(erroDoPallet(25, 610)).toBeNull();
    expect(erroDoPallet(25, 12.5)).toBeNull();
    expect(erroDoPallet(22.68, 600)).toBeNull();
  });
});

describe('avisoDoPallet (rodada 5 do Comex)', () => {
  it('multiplo exato, sem pallet ou sem quantidade: sem aviso', () => {
    expect(avisoDoPallet(25, null)).toBeNull();
    expect(avisoDoPallet(null, 600)).toBeNull();
    expect(avisoDoPallet(25, 600)).toBeNull();
    expect(avisoDoPallet(0.125, 3.125)).toBeNull();
    expect(avisoDoPallet(0.7, 2.1)).toBeNull();
  });

  it('nao multiplo (ou menor que a embalagem): aviso com os dois valores em kg, sem bloquear', () => {
    expect(avisoDoPallet(25, 610)).toBe('O pallet (610 kg) não é múltiplo da embalagem (25 kg): confira com o fornecedor.');
    expect(avisoDoPallet(25, 12.5)).toBe('O pallet (12,5 kg) não é múltiplo da embalagem (25 kg): confira com o fornecedor.');
    expect(avisoDoPallet(22.68, 600)).toBe('O pallet (600 kg) não é múltiplo da embalagem (22,68 kg): confira com o fornecedor.');
  });
});

describe('montarPatch com pallet (PR 6e)', () => {
  const comPallet: ForecastEmbalagens = {
    ...original,
    codigos: original.codigos.map((c, i) => (i === 0 ? { ...c, palletKg: 600 } : c)),
  };
  const base = edicaoInicial(comPallet);

  it('edicaoInicial carrega o pallet (ausente vira null) e nada mudou -> null', () => {
    expect(base.codigos.map((c) => c.palletKg)).toEqual([600, null, null]);
    expect(montarPatch(comPallet, base)).toBeNull();
  });

  it('o pallet so vai no corpo quando mudou (numero, ou null para apagar)', () => {
    expect(montarPatch(comPallet, editar(base, 1, { palletKg: 400 }))).toEqual({
      embalagens: [{ codigoId: 12, quantidadeKg: null, rotulo: null, palletKg: 400 }],
    });
    expect(montarPatch(comPallet, editar(base, 0, { palletKg: null }))).toEqual({
      embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletKg: null }],
    });
    // Mudou so a quantidade: o pallet nao vai (o servidor mantem e revalida).
    expect(montarPatch(comPallet, editar(base, 0, { quantidadeKg: 20 }))).toEqual({
      embalagens: [{ codigoId: 11, quantidadeKg: 20, rotulo: 'Saco' }],
    });
  });

  it('palletKg undefined (nao informado) nao conta como mudanca; backend antigo sem o campo = sem pallet', () => {
    expect(montarPatch(comPallet, editar(base, 0, { palletKg: undefined }))).toBeNull();
    expect(montarPatch(original, edicaoInicial(original))).toBeNull();
  });
});

describe('varios tamanhos de pallet (Etapa B)', () => {
  it('lerPalletsKg: vazio = []; separa por ponto e virgula; parte vazia e ignorada; um so valor = lerPalletKg', () => {
    expect(lerPalletsKg('')).toEqual({ ok: true, valores: [] });
    expect(lerPalletsKg('   ')).toEqual({ ok: true, valores: [] });
    expect(lerPalletsKg('600')).toEqual({ ok: true, valores: [600] });
    expect(lerPalletsKg('1.000; 1.200')).toEqual({ ok: true, valores: [1000, 1200] });
    expect(lerPalletsKg('1.000;1.250,5;')).toEqual({ ok: true, valores: [1000, 1250.5] });
    expect(lerPalletsKg('1.000; ; 1.200')).toEqual({ ok: true, valores: [1000, 1200] });
  });

  it('lerPalletsKg: erro da primeira parte invalida, repetido e mais de 5 tamanhos', () => {
    expect(lerPalletsKg('abc')).toEqual({ ok: false, erro: ERRO_PALLET_FORMATO });
    expect(lerPalletsKg('1.000; 0')).toEqual({ ok: false, erro: ERRO_PALLET_POSITIVO });
    expect(lerPalletsKg('1.000; 600,1234')).toEqual({ ok: false, erro: ERRO_PALLET_CASAS });
    expect(lerPalletsKg('1.000; 1.000.001')).toEqual({ ok: false, erro: ERRO_PALLET_MAXIMO });
    expect(lerPalletsKg('1.000; 1000')).toEqual({ ok: false, erro: ERRO_PALLET_REPETIDO });
    expect(lerPalletsKg('1; 2; 3; 4; 5')).toEqual({ ok: true, valores: [1, 2, 3, 4, 5] });
    expect(lerPalletsKg('1; 2; 3; 4; 5; 6')).toEqual({ ok: false, erro: ERRO_PALLET_MUITOS });
    expect(MAX_PALLETS_POR_CODIGO).toBe(5);
  });

  it('palletsDoCodigo e palletsParaCampo: lista ausente cai em [palletKg]; o campo volta a ser lido igual', () => {
    expect(palletsDoCodigo({ palletKg: 600 })).toEqual([600]);
    expect(palletsDoCodigo({ palletKg: null })).toEqual([]);
    expect(palletsDoCodigo({})).toEqual([]);
    expect(palletsDoCodigo({ palletKg: 1000, palletsKg: [1000, 1200] })).toEqual([1000, 1200]);
    expect(palletsParaCampo([1000, 1250.5])).toBe('1000; 1250,5');
    expect(palletsParaCampo([])).toBe('');
    expect(lerPalletsKg(palletsParaCampo([1000, 1250.5]))).toEqual({ ok: true, valores: [1000, 1250.5] });
  });

  it('erroDosPallets e avisoDosPallets: sem quantidade bloqueia; aviso por tamanho (1 = texto de hoje)', () => {
    expect(erroDosPallets(null, [1000, 1200])).toBe(ERRO_PALLET_SEM_QUANTIDADE);
    expect(erroDosPallets(null, [])).toBeNull();
    expect(erroDosPallets(25, [1000, 1200])).toBeNull();
    expect(avisoDosPallets(25, [1000, 1200])).toBeNull();
    expect(avisoDosPallets(25, [610])).toBe(avisoDoPallet(25, 610));
    expect(avisoDosPallets(25, [1000, 610])).toBe(avisoDoPallet(25, 610));
    expect(avisoDosPallets(25, [610, 12.5])).toBe(
      'Os pallets (610 kg; 12,5 kg) não são múltiplos da embalagem (25 kg): confira com o fornecedor.',
    );
    expect(avisoDosPallets(null, [610])).toBeNull();
  });

  describe('montarPatch', () => {
    const com = (palletKg: number | null, palletsKg?: number[]): ForecastEmbalagens => ({
      ...original,
      codigos: original.codigos.map((c, i) => (i === 0 ? { ...c, palletKg, ...(palletsKg ? { palletsKg } : {}) } : c)),
    });

    it('edicaoInicial: com 0/1 tamanho e a de antes (sem palletsKg); com 2+ carrega a lista', () => {
      expect(edicaoInicial(com(600)).codigos[0]).not.toHaveProperty('palletsKg');
      expect(edicaoInicial(com(null)).codigos[0]).not.toHaveProperty('palletsKg');
      expect(edicaoInicial(com(1000, [1000, 1200])).codigos[0]).toMatchObject({ palletKg: 1000, palletsKg: [1000, 1200] });
      expect(montarPatch(com(1000, [1000, 1200]), edicaoInicial(com(1000, [1000, 1200])))).toBeNull();
    });

    it('lista igual a atual nao conta como mudanca', () => {
      expect(montarPatch(com(600), editar(edicaoInicial(com(600)), 0, { palletsKg: [600] }))).toBeNull();
      expect(montarPatch(com(null), editar(edicaoInicial(com(null)), 0, { palletsKg: [] }))).toBeNull();
    });

    it('0/1 tamanho antes e depois: vai palletKg como sempre foi (backend antigo so le esse campo)', () => {
      expect(montarPatch(com(null), editar(edicaoInicial(com(null)), 0, { palletsKg: [600] }))).toEqual({
        embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletKg: 600 }],
      });
      expect(montarPatch(com(600), editar(edicaoInicial(com(600)), 0, { palletsKg: [] }))).toEqual({
        embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletKg: null }],
      });
      expect(montarPatch(com(600), editar(edicaoInicial(com(600)), 0, { palletsKg: [900] }))).toEqual({
        embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletKg: 900 }],
      });
    });

    it('2+ tamanhos (antes ou depois): vai palletsKg com a lista inteira, em ordem', () => {
      expect(montarPatch(com(600), editar(edicaoInicial(com(600)), 0, { palletsKg: [600, 900] }))).toEqual({
        embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletsKg: [600, 900] }],
      });
      const dois = com(1000, [1000, 1200]);
      expect(montarPatch(dois, editar(edicaoInicial(dois), 0, { palletsKg: [1200, 1000] }))).toEqual({
        embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletsKg: [1200, 1000] }],
      });
      expect(montarPatch(dois, editar(edicaoInicial(dois), 0, { palletsKg: [] }))).toEqual({
        embalagens: [{ codigoId: 11, quantidadeKg: 25, rotulo: 'Saco', palletsKg: [] }],
      });
    });
  });
});
