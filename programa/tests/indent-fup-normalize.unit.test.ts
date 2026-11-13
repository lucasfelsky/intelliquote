// Normalizacao da FUP Indent: funcoes puras (nomes e valores 100% sinteticos).
import { describe, expect, it } from 'vitest';
import {
  agruparFornecedor,
  arredondar,
  chaveAproximada,
  chaveLinha,
  chaveOrdem,
  interpretarData,
  interpretarDecisao,
  interpretarPo,
  isValidDateKey,
  isWithinLinkWindow,
  linkWindow,
  normalizarDestino,
  normalizarIncoterm,
  normalizarNcm,
  normalizarOrigem,
  normalizarPagamento,
  possivelSigla,
} from '../src/utils/indentFupNormalize';

describe('fornecedor com fabrica (D2/D10)', () => {
  it('sufixo entre parenteses vira fabrica do mesmo fornecedor', () => {
    expect(agruparFornecedor('FORN ALFA (FAB 1)')).toMatchObject({
      base: 'FORN ALFA',
      baseChave: 'forn alfa',
      plant: 'FAB 1',
      regra: 'PARENTESES',
      composto: false,
    });
    expect(agruparFornecedor('  forn   alfa(fab 2) ').plant).toBe('FAB 2');
  });

  it('numero final (1-2 digitos) vira fabrica', () => {
    expect(agruparFornecedor('FORN BETA 2')).toMatchObject({ base: 'FORN BETA', plant: '2', regra: 'NUMERO_FINAL' });
    expect(agruparFornecedor('FORN BETA 12').plant).toBe('12');
  });

  it('numero longo ou colado ao nome nao agrupa', () => {
    expect(agruparFornecedor('FORN 100')).toMatchObject({ base: 'FORN 100', plant: null, regra: 'SEM_VARIANTE' });
    expect(agruparFornecedor('FORN 3M').regra).toBe('SEM_VARIANTE');
  });

  it('composto com barra so propoe (antes = fornecedor, depois = fabrica) e e marcado', () => {
    expect(agruparFornecedor('FORN GAMA/FORN DELTA')).toMatchObject({
      base: 'FORN GAMA',
      plant: 'FORN DELTA',
      regra: 'COMPOSTO_BARRA',
      composto: true,
    });
    expect(agruparFornecedor('FORN GAMA / FORN DELTA').composto).toBe(true);
  });

  it('nome simples nao muda', () => {
    expect(agruparFornecedor('FORN ALFA')).toMatchObject({ base: 'FORN ALFA', plant: null, regra: 'SEM_VARIANTE' });
  });
});

describe('chaves e quase-duplicatas', () => {
  it('caixa, acento e espacos geram a mesma chave aproximada; hifen e espaco tambem', () => {
    expect(chaveAproximada('Cliente  Úm ')).toBe(chaveAproximada('CLIENTE UM'));
    expect(chaveAproximada('PRODUTO X-100')).toBe(chaveAproximada('PRODUTO X 100'));
    expect(chaveAproximada('PRODUTO X-100')).not.toBe(chaveAproximada('PRODUTO Y-100'));
  });

  it('possivel sigla: iniciais em ordem, mesma 1a letra, so sugestao', () => {
    expect(possivelSigla('ZWN', 'ZETA WIN')).toBe(true);
    expect(possivelSigla('XYZ', 'ZETA WIN')).toBe(false);
    expect(possivelSigla('ZETA WIN', 'ZWN')).toBe(false);
    expect(possivelSigla('ABC', 'ABCD')).toBe(false); // diferenca de tamanho pequena demais
  });

  it('chaves de ordem e de linha', () => {
    expect(chaveOrdem('po 001-24', 'id:1', 'id:2')).toBe('po 001-24|id:1|id:2');
    expect(chaveLinha('produto x', 2)).toBe('produto x#2');
  });
});

describe('incoterm', () => {
  it.each([
    ['FCL - CFR SANTOS', 'CFR', 'SANTOS'],
    ['FCL: CFR-NAVEGANTES', 'CFR', 'NAVEGANTES'],
    ['FOB-SHANGHAI', 'FOB', 'SHANGHAI'],
    ['LCL - CFR CALLAO', 'CFR', 'CALLAO'],
    ['FCL - CFR-RIO GRANDE', 'CFR', 'RIO GRANDE'],
    ['cpt local z', 'CPT', 'LOCAL Z'],
    ['CFR', 'CFR', null],
  ])('%s -> %s / %s', (raw, incoterm, local) => {
    expect(normalizarIncoterm(raw)).toMatchObject({ incoterm, local, alerta: null });
  });

  it('incoterm no meio do texto e aceito com alerta; nao reconhecido -> null + alerta', () => {
    expect(normalizarIncoterm('COURIER X (DAP-LOCAL Z)')).toMatchObject({
      incoterm: 'DAP',
      local: 'LOCAL Z',
      alerta: 'incoterm não estava no início do texto',
    });
    expect(normalizarIncoterm('XYZ SANTOS')).toMatchObject({
      incoterm: null,
      raw: 'XYZ SANTOS',
      alerta: 'incoterm não reconhecido',
    });
  });

  it('vazio e hifen: null sem alerta; guarda o original', () => {
    expect(normalizarIncoterm('')).toEqual({ incoterm: null, local: null, raw: null, alerta: null });
    expect(normalizarIncoterm('-').alerta).toBeNull();
    expect(normalizarIncoterm('FCL - CFR SANTOS').raw).toBe('FCL - CFR SANTOS');
  });
});

describe('origem, destino e pagamento', () => {
  it.each([
    ['TAIWAN', 'TAIWAN', null],
    ['CHINA (SHANGHAI)', 'CHINA', 'SHANGHAI'],
    ['TIANJIN (CHINA)', 'CHINA', 'TIANJIN'],
    ['DALIAN', 'CHINA', 'DALIAN'],
    ['TAIWAN - LUZHU', 'TAIWAN', 'LUZHU'],
    ['TAIWAN - LUCHU', 'TAIWAN', 'LUZHU'],
    ['KAOHSIUNG (TAIWAN)', 'TAIWAN', 'KAOHSIUNG'],
    ['CHINA-NINGBO(TIANJIN)', 'CHINA', 'NINGBO'],
    ['HONG KONG', 'HONG KONG', null],
  ])('origem %s -> %s / %s', (raw, pais, detalhe) => {
    expect(normalizarOrigem(raw)).toMatchObject({ pais, detalhe, reconhecida: true });
  });

  it('origem desconhecida: pais null; vazia: reconhecida sem valor', () => {
    expect(normalizarOrigem('LUGAR INEXISTENTE')).toMatchObject({ pais: null, reconhecida: false });
    expect(normalizarOrigem('')).toMatchObject({ pais: null, raw: null, reconhecida: true });
  });

  it('destino: dicionario com acento e qualificadores; fora do dicionario mantem o texto', () => {
    expect(normalizarDestino('ITAJAÍ').destino).toBe('ITAJAI');
    expect(normalizarDestino('ITAJAI (NVT)').destino).toBe('ITAJAI');
    expect(normalizarDestino('PERU (CALLAO)').destino).toBe('CALLAO');
    expect(normalizarDestino('SÃO PAULO').destino).toBe('SAO PAULO');
    expect(normalizarDestino('LUGAR NOVO')).toMatchObject({ destino: 'LUGAR NOVO', reconhecido: false });
    expect(normalizarDestino('').destino).toBeNull();
  });

  it('pagamento: dias + base, adiantado e amostra; o resto fica so em raw', () => {
    expect(normalizarPagamento('90 days from B/L date')).toMatchObject({ dias: 90, base: 'B/L DATE', padronizado: true });
    expect(normalizarPagamento('30 DAYS FROM ETA')).toMatchObject({ dias: 30, base: 'ETA' });
    expect(normalizarPagamento('30 DAYS AFTER ETA')).toMatchObject({ dias: 30, base: 'AFTER ETA' });
    expect(normalizarPagamento('T/T ADVANCE')).toMatchObject({ dias: 0, base: 'ADVANCE' });
    expect(normalizarPagamento('SAMPLES WITH NO COMMERCIAL VALUE')).toMatchObject({ amostra: true, dias: null });
    expect(normalizarPagamento('50% T/T ADV. 50% ARRIVAL')).toMatchObject({ dias: null, padronizado: false });
    expect(normalizarPagamento('')).toMatchObject({ raw: null, padronizado: true });
  });
});

describe('NCM', () => {
  it('8 digitos validos; outros -> null + alerta; vazio ou hifen sem alerta', () => {
    expect(normalizarNcm('1111.22.33')).toEqual({ ncm: '11112233', raw: '1111.22.33', alerta: null });
    expect(normalizarNcm('11.11.22.33').ncm).toBe('11112233');
    expect(normalizarNcm('111122.33').ncm).toBe('11112233');
    expect(normalizarNcm('1111.22')).toMatchObject({ ncm: null, alerta: 'NCM inválido' });
    expect(normalizarNcm('-')).toEqual({ ncm: null, raw: null, alerta: null });
    expect(normalizarNcm(null)).toEqual({ ncm: null, raw: null, alerta: null });
  });
});

describe('datas e numeros', () => {
  it('data da planilha (partes UTC, ja em YYYY-MM-DD) e texto dd/mm/aa estrito', () => {
    expect(interpretarData('2024-12-31')).toEqual({ data: '2024-12-31', bruto: null, alerta: null });
    expect(interpretarData('05/02/25').data).toBe('2025-02-05');
    expect(interpretarData('10/01/2025').data).toBe('2025-01-10');
    expect(interpretarData('29/02/24').data).toBe('2024-02-29');
  });

  it('invalidas: null + alerta + texto original; hifen e vazio sem alerta', () => {
    for (const ruim of ['31/11/24', '03/0218', '18//01/26', '29/02/25', 'em breve']) {
      expect(interpretarData(ruim)).toEqual({ data: null, bruto: ruim, alerta: 'data inválida' });
    }
    expect(interpretarData('-')).toEqual({ data: null, bruto: null, alerta: null });
    expect(interpretarData(null).alerta).toBeNull();
    expect(interpretarData(45000).alerta).toBe('data inválida');
  });

  it('ponto flutuante: 3 casas na quantidade e 6 nos precos', () => {
    expect(arredondar(3279.9999999999995, 3)).toBe(3280);
    expect(arredondar(1.2345678, 6)).toBe(1.234568);
    expect(arredondar(0, 6)).toBe(0);
  });

  it('PO: NNN-AA, revisao opcional e fora do padrao', () => {
    expect(interpretarPo('ALFA TST 012-24')).toEqual({ chave: 'alfa tst 012-24', seq: 12, ano: 2024 });
    expect(interpretarPo('ALFA TST 007-24.1')).toMatchObject({ seq: 7, ano: 2024 });
    expect(interpretarPo('SEM PADRAO')).toMatchObject({ seq: null, ano: null });
  });

  it('decisao do de-para', () => {
    expect(interpretarDecisao('')).toBeNull();
    expect(interpretarDecisao(' criar ')).toEqual({ tipo: 'CRIAR' });
    expect(interpretarDecisao('usar: 12')).toEqual({ tipo: 'USAR', id: 12 });
    expect(interpretarDecisao('AGRUPAR:FORN ALFA')).toEqual({ tipo: 'AGRUPAR', alvo: 'FORN ALFA' });
    expect(interpretarDecisao('IGNORAR')).toEqual({ tipo: 'IGNORAR' });
    expect(interpretarDecisao('talvez')).toEqual({ tipo: 'INVALIDA', texto: 'talvez' });
    expect(interpretarDecisao('USAR:abc')?.tipo).toBe('INVALIDA');
  });
});

describe('janela de vinculos (D9)', () => {
  it('24 meses a partir de 2026-11-13: o dia limite entra, o dia anterior fica fora', () => {
    const j = linkWindow('2026-11-13', 24);
    expect(j).toEqual({ start: '2024-11-13', end: '2026-11-13', months: 24 });
    expect(isWithinLinkWindow('2024-11-13', j!)).toBe(true);
    expect(isWithinLinkWindow('2024-11-12', j!)).toBe(false);
    expect(isWithinLinkWindow('2026-11-13', j!)).toBe(true);
    expect(isWithinLinkWindow('2026-11-14', j!)).toBe(false);
  });

  it('12 meses muda o limite', () => {
    const j = linkWindow('2026-11-13', 12)!;
    expect(j.start).toBe('2025-11-13');
    expect(isWithinLinkWindow('2025-11-13', j)).toBe(true);
    expect(isWithinLinkWindow('2025-11-12', j)).toBe(false);
  });

  it('dia inexistente no mes de destino vira o ultimo dia; cruza ano e bissexto', () => {
    expect(linkWindow('2026-05-31', 3)?.start).toBe('2026-02-28');
    expect(linkWindow('2024-05-31', 3)?.start).toBe('2024-02-29');
    expect(linkWindow('2026-01-15', 2)?.start).toBe('2025-11-15');
    expect(linkWindow('2026-03-01', 1)?.start).toBe('2026-02-01');
  });

  it('referencia invalida ou meses invalidos: null', () => {
    expect(linkWindow('2026-02-30', 24)).toBeNull();
    expect(linkWindow('13/11/2026', 24)).toBeNull();
    expect(linkWindow('2026-11-13', 0)).toBeNull();
    expect(linkWindow('2026-11-13', 1.5)).toBeNull();
    expect(isValidDateKey('2026-11-13')).toBe(true);
    expect(isValidDateKey('2026-13-01')).toBe(false);
  });
});
