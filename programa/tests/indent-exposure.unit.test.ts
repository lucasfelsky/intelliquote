import { describe, expect, it } from 'vitest';
import { isValidCnpj } from '../src/utils/cnpj';
import {
  buildClientTerms,
  buildIndentExposureProfile,
  findClientLeak,
  hasForbiddenBuyerPhrase,
  normalizeForMatch,
} from '../src/utils/indentExposure';

// Nomes e CNPJ FICTICIOS (repo publico).
const VALE_ITAJAI = { name: 'Indústria Química Vale do Itajaí Ltda', cnpj: null };
const VALE_VERDE = { name: 'Vale Verde Fertilizantes Ltda', cnpj: '12.345.678/0001-95' };

describe('buildIndentExposureProfile', () => {
  it('mostra o cliente so com parceria E a opcao ligada', () => {
    expect(buildIndentExposureProfile({ hasPartnership: true }, true)).toEqual({ hasPartnership: true, showClient: true });
    expect(buildIndentExposureProfile({ hasPartnership: true }, false)).toEqual({ hasPartnership: true, showClient: false });
    expect(buildIndentExposureProfile({ hasPartnership: false }, true)).toEqual({ hasPartnership: false, showClient: false });
    expect(buildIndentExposureProfile({ hasPartnership: false }, false)).toEqual({ hasPartnership: false, showClient: false });
  });
});

describe('normalizeForMatch', () => {
  it('tira acento, caixa e pontuacao e colapsa espacos', () => {
    expect(normalizeForMatch('  Indústria,  Química/S.A.  ')).toBe('industria quimica s a');
    expect(normalizeForMatch('')).toBe('');
  });
});

describe('buildClientTerms', () => {
  it('cliente com 1a palavra generica: nome completo e sem sufixo, sem a 1a palavra', () => {
    expect(buildClientTerms(VALE_ITAJAI)).toEqual([
      'industria quimica vale do itajai ltda',
      'industria quimica vale do itajai',
    ]);
  });

  it('1a palavra com 4+ letras vira termo; CNPJ entra so com digitos', () => {
    expect(isValidCnpj(VALE_VERDE.cnpj)).toBe(true);
    expect(buildClientTerms(VALE_VERDE)).toEqual([
      'vale verde fertilizantes ltda',
      'vale verde fertilizantes',
      'vale',
      '12345678000195',
    ]);
  });

  it('remove sufixos societarios encadeados e "S.A."', () => {
    expect(buildClientTerms({ name: 'Boreal Quimica S.A.', cnpj: null })).toContain('boreal quimica');
    expect(buildClientTerms({ name: 'Boreal Quimica Ltda ME', cnpj: null })).toContain('boreal quimica');
  });
});

describe('findClientLeak', () => {
  const terms = buildClientTerms(VALE_VERDE);

  it('devolve a CHAVE do 1o campo com vazamento', () => {
    expect(findClientLeak({ item: 'Citric acid', port: 'Porto de Vale Verde Fertilizantes' }, terms)).toBe('port');
    expect(findClientLeak({ a: 'VALE VERDE', b: 'x' }, terms)).toBe('a');
  });

  it('so casa palavra inteira: "valeverde" nao casa "vale verde"', () => {
    expect(findClientLeak({ item: 'valeverde' }, terms)).toBeNull();
    expect(findClientLeak({ item: 'Valencia orange' }, terms)).toBeNull();
  });

  it('CNPJ mascarado e so digitos casam', () => {
    expect(findClientLeak({ message: 'CNPJ 12.345.678/0001-95' }, terms)).toBe('message');
    expect(findClientLeak({ message: 'ref 12345678000195' }, terms)).toBe('message');
    expect(findClientLeak({ message: 'ref 1234567800019' }, terms)).toBeNull();
  });

  it('SQ Quimica e "customer" sozinho nao disparam; vazio e null sao ignorados', () => {
    expect(findClientLeak({ a: 'SQ Quimica', b: 'Our customer service is fast', c: null, d: undefined, e: '  ' }, terms)).toBeNull();
    expect(findClientLeak({ a: 'SQ Quimica' }, buildClientTerms({ name: 'SQ Quimica', cnpj: null }))).toBeNull();
  });

  it('o nome do cliente com acento e caixa diferentes tambem casa', () => {
    expect(findClientLeak({ x: 'indústria química VALE do itajaí' }, buildClientTerms(VALE_ITAJAI))).toBe('x');
  });
});

describe('hasForbiddenBuyerPhrase', () => {
  it('dispara com acento e caixa', () => {
    expect(hasForbiddenBuyerPhrase('We are the BUYER')).toBe(true);
    expect(hasForbiddenBuyerPhrase('Purchaser details')).toBe(true);
    expect(hasForbiddenBuyerPhrase('Sou o Comprador')).toBe(true);
    expect(hasForbiddenBuyerPhrase('A SQ é a compradora')).toBe(true);
    expect(hasForbiddenBuyerPhrase('acting On Behalf   of a client')).toBe(true);
    expect(hasForbiddenBuyerPhrase('this is our customer')).toBe(true);
    expect(hasForbiddenBuyerPhrase('Este é o nosso cliente')).toBe(true);
  });

  it('customer sozinho e texto neutro passam', () => {
    expect(hasForbiddenBuyerPhrase('Please quote best price')).toBe(false);
    expect(hasForbiddenBuyerPhrase('customer service')).toBe(false);
  });
});

// Normalizacao reforcada (NFKD, invisiveis, largura total, homoglifos). Caracteres montados por codigo para o arquivo continuar legivel.
const chars = (...codes: number[]) => String.fromCodePoint(...codes);
const ZWSP = chars(0x200b);

describe('normalizeForMatch - reforco contra ofuscacao', () => {
  it('zero-width, soft hyphen e marcas bidi no meio do nome somem (nao quebram a palavra)', () => {
    expect(normalizeForMatch(`Va${ZWSP}le Verde`)).toBe('vale verde');
    expect(normalizeForMatch(`Va${chars(0x00ad)}le Ve${chars(0x200d)}rde`)).toBe('vale verde');
    expect(normalizeForMatch(`${chars(0x202e)}Vale Verde${chars(0x200e)}`)).toBe('vale verde');
  });

  it('largura total e algarismo romano caem por NFKD', () => {
    expect(normalizeForMatch(chars(0xff36, 0xff41, 0xff4c, 0xff45) + ' Verde')).toBe('vale verde');
    expect(normalizeForMatch(chars(0x2164) + 'ale Verde')).toBe('vale verde');
  });

  it('homoglifo cirilico e grego vira latim (maiusculas e minusculas)', () => {
    expect(normalizeForMatch(`V${chars(0x0430)}l${chars(0x0435)} V${chars(0x0435)}rd${chars(0x0435)}`)).toBe('vale verde');
    expect(normalizeForMatch(chars(0x0412, 0x0430) + 'le ' + chars(0x0412) + 'erde')).toBe('bale berde'); // В cirilico vira "b" (nao "v")
    expect(normalizeForMatch(`${chars(0x03b1)}cme ${chars(0x039f)}${chars(0x03c1)}tima`)).toBe('acme optima');
    expect(normalizeForMatch(`Ind${chars(0x00fa)}stria ${chars(0x0421)}hemical`)).toBe('industria chemical');
  });

  it('combinacao de tecnicas', () => {
    const mixed = `V${chars(0x0430)}${ZWSP}${chars(0x0301)}l${chars(0xff45)} V${chars(0x0435)}r${chars(0x00ad)}d${chars(0xff45)}`;
    expect(normalizeForMatch(mixed)).toBe('vale verde');
  });

  it('ligaduras e letras latinas sem decomposicao', () => {
    expect(normalizeForMatch(`Stra${chars(0x00df)}e`)).toBe('strasse');
    expect(normalizeForMatch(`${chars(0x00f8)}l`)).toBe('ol');
  });
});

describe('findClientLeak - ofuscacao nao escapa', () => {
  const terms = buildClientTerms(VALE_VERDE);

  it.each([
    ['zero-width no meio da palavra', `Va${ZWSP}le Verde Fertilizantes`],
    ['largura total', `${chars(0xff36, 0xff41, 0xff4c, 0xff45)} Verde Fertilizantes`],
    ['homoglifo cirilico', `V${chars(0x0430)}le Verde Fertilizantes`],
    ['combinacao', `V${chars(0x0430)}${ZWSP}l${chars(0xff45)} V${chars(0x0435)}rde Fertilizantes`],
    ['NBSP e underscore', `vale${chars(0x00a0)}verde_fertilizantes`],
  ])('%s', (_label, text) => {
    expect(findClientLeak({ message: text }, terms)).toBe('message');
  });

  it('CNPJ com zero-width, largura total e mascara ainda casa', () => {
    expect(findClientLeak({ message: `12.345${ZWSP}.678/0001-95` }, terms)).toBe('message');
    expect(findClientLeak({ message: chars(...Array.from('12345678000195').map((d) => 0xff10 + Number(d))) }, terms)).toBe('message');
  });

  it('sem falso positivo: texto sem relacao, outros alfabetos e termos genericos', () => {
    const generic = buildClientTerms(VALE_ITAJAI);
    expect(findClientLeak({ a: 'Citric acid anhydrous 7758-29-4', b: 'Port of Santos' }, terms)).toBeNull();
    expect(findClientLeak({ a: chars(0x041c, 0x043e, 0x0441, 0x043a, 0x0432, 0x0430) }, terms)).toBeNull(); // "Moskva" em cirilico
    expect(findClientLeak({ a: 'Industria Quimica do Brasil', b: 'Grupo Quimica Distribuidora' }, generic)).toBeNull();
    expect(findClientLeak({ a: 'Valencia and Valverde' }, terms)).toBeNull(); // so palavra inteira
  });
});
