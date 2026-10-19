// Unit da leitura da Area do Portal COMEX (Firestore users/{uid}.area).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'firebase-admin/app';

const { getMock, docMock, collectionMock, getFirestoreMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const docMock = vi.fn(() => ({ get: getMock }));
  const collectionMock = vi.fn(() => ({ doc: docMock }));
  const getFirestoreMock = vi.fn(() => ({ collection: collectionMock }));
  return { getMock, docMock, collectionMock, getFirestoreMock };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: getFirestoreMock,
}));

import { logger } from '../src/lib/logger';
import {
  fetchPortalArea,
  isCommercialArea,
  resolveFirebaseLoginRoleWithArea,
} from '../src/services/PortalAreaService';

const fakeApp = {} as App;

function snapshot(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    get: (field: string) => (data ? data[field] : undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFirestoreMock.mockImplementation(() => ({ collection: collectionMock }));
  getMock.mockResolvedValue(snapshot(null));
});

describe('isCommercialArea', () => {
  it.each(['Comercial', 'Comercial Sul', '  COMERCIAL  sul ', 'comercial', 'Comércial'])(
    'true para %j',
    (area) => {
      expect(isCommercialArea(area)).toBe(true);
    },
  );

  it.each([
    'Comércio exterior',
    'Comerciais',
    'comercialx',
    'Comex',
    'Geral',
    '',
    null,
    undefined,
    123,
    ['Comercial'],
  ])('false para %j', (area) => {
    expect(isCommercialArea(area)).toBe(false);
  });
});

describe('fetchPortalArea', () => {
  it('le users/{uid} e devolve a area', async () => {
    getMock.mockResolvedValue(snapshot({ area: 'Comercial' }));

    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBe('Comercial');
    expect(collectionMock).toHaveBeenCalledWith('users');
    expect(docMock).toHaveBeenCalledWith('uid-1');
  });

  it('doc inexistente -> null', async () => {
    getMock.mockResolvedValue(snapshot(null));
    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBeNull();
  });

  it('area numero -> null', async () => {
    getMock.mockResolvedValue(snapshot({ area: 42 }));
    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBeNull();
  });

  it('area ausente -> null', async () => {
    getMock.mockResolvedValue(snapshot({ outro: 'x' }));
    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBeNull();
  });

  it('get rejeita -> null', async () => {
    getMock.mockRejectedValue(Object.assign(new Error('boom'), { code: 'permission-denied' }));
    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBeNull();
  });

  it('getFirestore lanca sincrono -> null', async () => {
    getFirestoreMock.mockImplementation(() => {
      throw new Error('sem credencial');
    });
    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBeNull();
  });

  it('timeout (get nunca resolve) -> null', async () => {
    getMock.mockReturnValue(new Promise(() => undefined));
    await expect(fetchPortalArea(fakeApp, 'uid-1', 20)).resolves.toBeNull();
  });

  it('timeout seguido de rejeicao tardia -> null e sem unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      getMock.mockReturnValue(
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('tardio')), 60);
        }),
      );

      await expect(fetchPortalArea(fakeApp, 'uid-1', 20)).resolves.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('uid vazio -> null sem ler', async () => {
    await expect(fetchPortalArea(fakeApp, '')).resolves.toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('rejeicao com objeto cujo getter code lanca -> null (nunca lanca)', async () => {
    const hostile = {
      get code(): string {
        throw new Error('getter hostil');
      },
    };
    getMock.mockRejectedValue(hostile);
    await expect(fetchPortalArea(fakeApp, 'uid-1')).resolves.toBeNull();
  });
});

describe('resolveFirebaseLoginRoleWithArea', () => {
  const base = {
    app: fakeApp,
    uid: 'uid-1',
    rawClaim: 'user',
    claimRole: 'comprador' as const,
    currentRole: 'comprador',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('claim user + area Comercial -> comercial', async () => {
    getMock.mockResolvedValue(snapshot({ area: 'Comercial' }));
    await expect(resolveFirebaseLoginRoleWithArea(base)).resolves.toBe('comercial');
  });

  it('skipAreaLookup nao le o Firestore e nao promove', async () => {
    getMock.mockResolvedValue(snapshot({ area: 'Comercial' }));
    await expect(resolveFirebaseLoginRoleWithArea({ ...base, skipAreaLookup: true })).resolves.toBe(
      'comprador',
    );
    expect(getMock).not.toHaveBeenCalled();
  });

  it('skipAreaLookup continua respeitando o papel fixo do banco', async () => {
    await expect(
      resolveFirebaseLoginRoleWithArea({ ...base, currentRole: 'comercial', skipAreaLookup: true }),
    ).resolves.toBe('comercial');
  });

  it('fetch que lanca (logger.warn lanca dentro do catch) -> papel atual, sem a Area', async () => {
    getMock.mockResolvedValue(snapshot({ area: 'Comercial' }));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    // Forca o fetchPortalArea a lancar: leitura rejeita e o warn do catch estoura.
    getMock.mockRejectedValue(new Error('boom'));
    warn.mockImplementationOnce(() => {
      throw new Error('logger quebrado');
    });

    await expect(resolveFirebaseLoginRoleWithArea(base)).resolves.toBe('comprador');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('fetch que lanca sem papel atual -> segue o claim', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getMock.mockRejectedValue(new Error('boom'));
    warn.mockImplementationOnce(() => {
      throw new Error('logger quebrado');
    });

    await expect(
      resolveFirebaseLoginRoleWithArea({ ...base, rawClaim: 'user', claimRole: 'viewer', currentRole: null }),
    ).resolves.toBe('viewer');
  });
});
