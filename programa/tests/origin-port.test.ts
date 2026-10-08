import { describe, expect, it } from 'vitest';
import {
  ORIGIN_PORT_MAX_LENGTH,
  buildItemOrigins,
  effectiveOriginPort,
  normalizeItemOriginPort,
  sameOrigin,
} from '../src/utils/originPort';

describe('originPort util', () => {
  it('limite de tamanho', () => {
    expect(ORIGIN_PORT_MAX_LENGTH).toBe(120);
  });

  it('sameOrigin ignora caixa e espacos, e exige ambos preenchidos', () => {
    expect(sameOrigin('shanghai', 'Shanghai ')).toBe(true);
    expect(sameOrigin('Ningbo', 'Shanghai')).toBe(false);
    expect(sameOrigin(null, 'Shanghai')).toBe(false);
    expect(sameOrigin('', '')).toBe(false);
    expect(sameOrigin('  ', undefined)).toBe(false);
  });

  it('normalizeItemOriginPort: vazio/igual a geral => null; diferente => trimado', () => {
    expect(normalizeItemOriginPort(null, 'Shanghai')).toBeNull();
    expect(normalizeItemOriginPort(undefined, 'Shanghai')).toBeNull();
    expect(normalizeItemOriginPort('', 'Shanghai')).toBeNull();
    expect(normalizeItemOriginPort('   ', 'Shanghai')).toBeNull();
    expect(normalizeItemOriginPort('shanghai', 'Shanghai ')).toBeNull();
    expect(normalizeItemOriginPort(' Ningbo ', 'Shanghai')).toBe('Ningbo');
  });

  it('normalizeItemOriginPort: geral nula + item preenchido => item', () => {
    expect(normalizeItemOriginPort('Busan', null)).toBe('Busan');
    expect(normalizeItemOriginPort('Busan', undefined)).toBe('Busan');
    expect(normalizeItemOriginPort('Busan', '  ')).toBe('Busan');
  });

  it('effectiveOriginPort: item || geral || null', () => {
    expect(effectiveOriginPort('Ningbo', 'Shanghai')).toBe('Ningbo');
    expect(effectiveOriginPort(null, ' Shanghai ')).toBe('Shanghai');
    expect(effectiveOriginPort('  ', 'Shanghai')).toBe('Shanghai');
    expect(effectiveOriginPort(null, null)).toBeNull();
    expect(effectiveOriginPort(undefined, '')).toBeNull();
  });

  it('buildItemOrigins: efetiva por item + overridden', () => {
    const origins = buildItemOrigins(
      [
        { quoteRequestItemId: 1, originPort: null, quoteRequestItem: { productName: 'A' } },
        { quoteRequestItemId: 2, originPort: 'Ningbo', quoteRequestItem: { productName: 'B' } },
        { quoteRequestItemId: 3, originPort: 'shanghai', quoteRequestItem: { productName: 'C' } },
        { quoteRequestItemId: 4, originPort: 'Busan' },
      ],
      'Shanghai',
    );
    expect(origins).toEqual([
      { quoteRequestItemId: 1, productName: 'A', originPort: 'Shanghai', overridden: false },
      { quoteRequestItemId: 2, productName: 'B', originPort: 'Ningbo', overridden: true },
      { quoteRequestItemId: 3, productName: 'C', originPort: 'shanghai', overridden: false },
      { quoteRequestItemId: 4, productName: null, originPort: 'Busan', overridden: true },
    ]);
  });

  it('buildItemOrigins: geral nula => item vira override; legado (tudo null) => origem null', () => {
    expect(
      buildItemOrigins([{ quoteRequestItemId: 1, originPort: 'Busan' }], null)[0],
    ).toMatchObject({ originPort: 'Busan', overridden: true });
    expect(buildItemOrigins([{ quoteRequestItemId: 1, originPort: null }], null)[0]).toMatchObject({
      originPort: null,
      overridden: false,
    });
    expect(buildItemOrigins(undefined, 'X')).toEqual([]);
  });
});
