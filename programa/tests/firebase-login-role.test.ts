// Regra de login Firebase (D1 do PR1 "Solicitacoes do comercial"):
// `comercial` e' papel fixo do banco -- o claim do Portal nao o reverte.
// Para os demais papeis o claim continua reconciliando (comportamento anterior).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// O arquivo faz mais de 20 POST /auth/firebase: sobe o limite do rate limit do endpoint.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_MAX = '1000';
});

const { verifyIdTokenMock, getMock, docMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const docMock = vi.fn(() => ({ get: getMock }));
  return { verifyIdTokenMock: vi.fn(), getMock, docMock };
});

vi.mock('firebase-admin/app', () => ({
  cert: vi.fn(),
  getApp: vi.fn(),
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({ collection: vi.fn(() => ({ doc: docMock })) })),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  isPortalUserClaim,
  resolveFirebaseLoginRole,
  shouldLookupPortalArea,
} from '../src/constants/roles';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  role: { findUnique: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
};

const ROLE_IDS: Record<string, number> = {
  admin: 1,
  comprador: 2,
  gestor: 3,
  viewer: 4,
  comercial: 5,
};

function existingUser(roleName: string, isActive = true) {
  return {
    id: 77,
    name: 'Fulano',
    email: 'fulano@sqquimica.com',
    isActive,
    roleId: ROLE_IDS[roleName],
    role: { name: roleName },
  };
}

function roleNameOf(roleId: number): string {
  return Object.entries(ROLE_IDS).find(([, id]) => id === roleId)?.[0] ?? 'comprador';
}

// Banco simulado com estado: updateMany condicional (where.roleId) + re-leitura por findUnique/findFirst.
let dbUser: ReturnType<typeof existingUser> | null = null;

function useExistingUser(roleName: string): void {
  dbUser = existingUser(roleName);
}

function readDbUser() {
  return dbUser ? { ...dbUser, role: { ...dbUser.role } } : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  docMock.mockImplementation(() => ({ get: getMock }));
  getMock.mockResolvedValue({ exists: false, get: () => undefined });
  prismaMock.role.findUnique.mockImplementation(async ({ where }: { where: { name: string } }) => ({
    id: ROLE_IDS[where.name],
    name: where.name,
  }));
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  dbUser = null;
  prismaMock.user.findUnique.mockImplementation(async () => readDbUser());
  prismaMock.user.findFirst.mockImplementation(async () => readDbUser());
  prismaMock.user.updateMany.mockImplementation(
    async ({ where, data }: { where: { id: number; roleId: number }; data: { roleId: number } }) => {
      if (!dbUser || dbUser.id !== where.id || dbUser.roleId !== where.roleId) return { count: 0 };
      dbUser = existingUser(roleNameOf(data.roleId));
      return { count: 1 };
    },
  );
});

function decodedToken(role?: string) {
  return {
    uid: 'uid-1',
    email: 'Fulano@sqquimica.com',
    name: 'Fulano',
    ...(role ? { role } : {}),
  };
}

async function exchange() {
  return request(app).post('/api/v1/auth/firebase').set('Authorization', 'Bearer fake-token');
}

describe('POST /api/v1/auth/firebase - papel fixo do banco', () => {
  it('(a) existente comercial + claim admin: mantem comercial e nao atualiza o usuario', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    useExistingUser('comercial');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('(b) existente comercial sem claim: mantem comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken());
    useExistingUser('comercial');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('(c) existente comprador + claim admin: claim reconcilia (comportamento atual preservado)', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    useExistingUser('comprador');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('admin');
    // O tryFirebaseAuth global tambem roda com Bearer: todas as atualizacoes vao para admin.
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
    for (const [args] of prismaMock.user.updateMany.mock.calls) {
      expect(args.data).toEqual({ roleId: ROLE_IDS.admin });
    }
  });

  it('(c2) existente admin sem claim: rebaixa para comprador como antes', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken());
    useExistingUser('admin');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
  });

  it('(d) usuario novo sem claim: nasce comprador', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken());
    dbUser = null;
    prismaMock.user.create.mockImplementation(
      async ({ data }: { data: { roleId: number; email: string; name: string } }) => ({
        id: 99,
        name: data.name,
        email: data.email,
        isActive: true,
        roleId: data.roleId,
        role: { name: 'comprador' },
      }),
    );

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
    expect(prismaMock.user.create).toHaveBeenCalled();
    for (const [args] of prismaMock.user.create.mock.calls) {
      expect(args.data.roleId).toBe(ROLE_IDS.comprador);
    }
  });

  it('(e) tryFirebaseAuth via GET /api/v1/whoami: comercial + claim admin continua comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    useExistingUser('comercial');

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('(e2) whoami: existente comprador + claim admin reconcilia para admin', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    useExistingUser('comprador');

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('admin');
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('resolveFirebaseLoginRole', () => {
  it('(f) papel fixo do banco prevalece sobre qualquer claim', () => {
    expect(resolveFirebaseLoginRole({ claimRole: 'admin', currentRole: 'comercial' })).toBe(
      'comercial',
    );
    expect(resolveFirebaseLoginRole({ claimRole: 'comprador', currentRole: 'comercial' })).toBe(
      'comercial',
    );
  });

  it('(f) demais papeis seguem o claim', () => {
    expect(resolveFirebaseLoginRole({ claimRole: 'admin', currentRole: 'comprador' })).toBe('admin');
    expect(resolveFirebaseLoginRole({ claimRole: 'viewer', currentRole: 'admin' })).toBe('viewer');
    expect(resolveFirebaseLoginRole({ claimRole: 'gestor', currentRole: 'gestor' })).toBe('gestor');
  });

  it('(f) sem papel atual: usa o claim', () => {
    expect(resolveFirebaseLoginRole({ claimRole: 'comprador', currentRole: null })).toBe(
      'comprador',
    );
  });

  it('(f) papel atual desconhecido nao e fixado', () => {
    expect(resolveFirebaseLoginRole({ claimRole: 'viewer', currentRole: 'qualquer' })).toBe(
      'viewer',
    );
  });
});

function areaDoc(area: unknown) {
  return { exists: true, get: (field: string) => (field === 'area' ? area : undefined) };
}

function mockNewUser() {
  dbUser = null;
  // O create grava no banco simulado: o exchange (depois do middleware) encontra o usuario.
  prismaMock.user.create.mockImplementation(
    async ({ data }: { data: { roleId: number; email: string; name: string } }) => {
      const created = {
        id: 99,
        name: data.name,
        email: data.email,
        isActive: true,
        roleId: data.roleId,
        role: { name: roleNameOf(data.roleId) },
      };
      dbUser = created;
      return { ...created, role: { ...created.role } };
    },
  );
}

function expectAllCreatesWithRoleId(roleId: number) {
  expect(prismaMock.user.create).toHaveBeenCalled();
  for (const [args] of prismaMock.user.create.mock.calls) {
    expect(args.data.roleId).toBe(roleId);
  }
}

describe('POST /api/v1/auth/firebase - Area Comercial do Portal', () => {
  it('(1) novo usuario, claim user, area Comercial: nasce comercial (uid do token verificado)', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Comercial'));
    mockNewUser();

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expectAllCreatesWithRoleId(ROLE_IDS.comercial);
    // (8) seguranca: a leitura usa o uid do token verificado
    expect(docMock).toHaveBeenCalledWith('uid-1');
  });

  it('(2) claim USER normaliza a area: "  comércial  sul " vira comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('USER'));
    getMock.mockResolvedValue(areaDoc('  comércial  sul '));
    mockNewUser();

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expectAllCreatesWithRoleId(ROLE_IDS.comercial);
  });

  it('(2) area "Comércio exterior" nao e comercial: comprador', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Comércio exterior'));
    mockNewUser();

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
    expectAllCreatesWithRoleId(ROLE_IDS.comprador);
  });

  it('(3) existente comprador, claim user, area Comercial: promove para comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Comercial'));
    useExistingUser('comprador');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
    for (const [args] of prismaMock.user.updateMany.mock.calls) {
      expect(args.data).toEqual({ roleId: ROLE_IDS.comercial });
    }
  });

  it('(4) existente comercial, claim user, area Logística: continua comercial sem ler o Firestore', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Logística'));
    useExistingUser('comercial');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it.each([
    ['admin', 'admin'],
    ['logistica', 'comprador'],
    ['compras', 'comprador'],
    ['viewer', 'viewer'],
    [undefined, 'comprador'],
  ])(
    '(5) claim %s + area Comercial: ignora a area (papel %s) e nao le o Firestore',
    async (claim, expectedRole) => {
      verifyIdTokenMock.mockResolvedValue(decodedToken(claim));
      getMock.mockResolvedValue(areaDoc('Comercial'));
      mockNewUser();

      const response = await exchange();

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe(expectedRole);
      expect(getMock).not.toHaveBeenCalled();
    },
  );

  it('(6) claim user e leitura rejeitada: login 200 como comprador', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    mockNewUser();

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
    expect(getMock).toHaveBeenCalled();
  });

  it('(6) claim user e doc inexistente: login 200 como comprador', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue({ exists: false, get: () => undefined });
    mockNewUser();

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
  });

  it('(6) claim user e area nao-string: login 200 como comprador', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc(42));
    mockNewUser();

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
  });
});

describe('POST /api/v1/auth/firebase - leitura unica e update condicional', () => {
  it('(9) claim user e area nao comercial: le o Firestore exatamente 1 vez (middleware + exchange)', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Logística'));
    useExistingUser('comprador');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('(9) promocao feita pelo middleware: exchange nao le de novo e devolve comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Comercial'));
    useExistingUser('comprador');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('(10) middleware sem req.user (falhou): o exchange le a Area normalmente', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Comercial'));
    useExistingUser('comprador');
    // O middleware usa findFirst; falhando, ele segue sem req.user (o exchange usa findUnique).
    prismaMock.user.findFirst.mockRejectedValue(new Error('db indisponivel'));

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('(11) updateMany e condicional ao papel lido (id + roleId)', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    useExistingUser('comprador');

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('admin');
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 77, roleId: ROLE_IDS.comprador },
      data: { roleId: ROLE_IDS.admin },
    });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 77 },
      include: { role: true },
    });
  });

  it('(12) TOCTOU: count=0 (admin mudou o papel no meio) -> resposta usa o papel relido do banco', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    // Lido como comprador, mas o admin ja mudou para viewer: o update condicional nao casa.
    prismaMock.user.findFirst.mockImplementation(async () => existingUser('comprador'));
    prismaMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id?: number; email?: string } }) =>
        where.id !== undefined ? existingUser('viewer') : existingUser('comprador'),
    );
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('viewer');
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
    for (const [args] of prismaMock.user.updateMany.mock.calls) {
      expect(args.where).toEqual({ id: 77, roleId: ROLE_IDS.comprador });
      expect(args.data).toEqual({ roleId: ROLE_IDS.admin });
    }
  });

  it('(12) re-leitura inativa -> 403', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    prismaMock.user.findFirst.mockImplementation(async () => existingUser('comprador'));
    prismaMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id?: number; email?: string } }) =>
        where.id !== undefined ? existingUser('comprador', false) : existingUser('comprador'),
    );
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await exchange();

    expect(response.status).toBe(403);
  });

  it('(12) re-leitura nula -> 401', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    prismaMock.user.findFirst.mockImplementation(async () => existingUser('comprador'));
    prismaMock.user.findUnique.mockImplementation(
      async ({ where }: { where: { id?: number; email?: string } }) =>
        where.id !== undefined ? null : existingUser('comprador'),
    );
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await exchange();

    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/whoami - Area Comercial do Portal', () => {
  it('(7) novo usuario, claim user, area Comercial: comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockResolvedValue(areaDoc('Comercial'));
    mockNewUser();

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(docMock).toHaveBeenCalledWith('uid-1');
  });

  it('(7) leitura rejeitada: comprador e authenticated true', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('user'));
    getMock.mockRejectedValue(new Error('indisponivel'));
    mockNewUser();

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.user.role).toBe('comprador');
  });
});

describe('GET /api/v1/whoami - update condicional', () => {
  it('(12) count=0: whoami devolve o papel relido do banco', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    prismaMock.user.findFirst.mockImplementation(async () => existingUser('comprador'));
    prismaMock.user.findUnique.mockImplementation(async () => existingUser('viewer'));
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('viewer');
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 77, roleId: ROLE_IDS.comprador },
      data: { roleId: ROLE_IDS.admin },
    });
  });
});

describe('resolveFirebaseLoginRole - portalCommercial', () => {
  it('portalCommercial true promove para comercial (sem papel atual ou comprador)', () => {
    expect(
      resolveFirebaseLoginRole({ claimRole: 'comprador', currentRole: null, portalCommercial: true }),
    ).toBe('comercial');
    expect(
      resolveFirebaseLoginRole({
        claimRole: 'comprador',
        currentRole: 'comprador',
        portalCommercial: true,
      }),
    ).toBe('comercial');
  });

  it('portalCommercial false nunca rebaixa comercial', () => {
    expect(
      resolveFirebaseLoginRole({
        claimRole: 'comprador',
        currentRole: 'comercial',
        portalCommercial: false,
      }),
    ).toBe('comercial');
  });

  it('portalCommercial false segue o claim para os demais papeis', () => {
    expect(
      resolveFirebaseLoginRole({
        claimRole: 'comprador',
        currentRole: 'admin',
        portalCommercial: false,
      }),
    ).toBe('comprador');
  });
});

describe('shouldLookupPortalArea / isPortalUserClaim', () => {
  it('claim user (qualquer caixa) com comprador ou sem papel atual: le a Area', () => {
    expect(shouldLookupPortalArea({ rawClaim: 'user', currentRole: 'comprador' })).toBe(true);
    expect(shouldLookupPortalArea({ rawClaim: 'User', currentRole: 'comprador' })).toBe(true);
    expect(shouldLookupPortalArea({ rawClaim: 'user', currentRole: null })).toBe(true);
  });

  it('papel fixo do banco nao le a Area', () => {
    expect(shouldLookupPortalArea({ rawClaim: 'user', currentRole: 'comercial' })).toBe(false);
  });

  it('outros claims nao leem a Area', () => {
    expect(shouldLookupPortalArea({ rawClaim: 'admin', currentRole: 'comprador' })).toBe(false);
    expect(shouldLookupPortalArea({ rawClaim: 'logistica', currentRole: 'comprador' })).toBe(false);
    expect(shouldLookupPortalArea({ rawClaim: undefined, currentRole: 'comprador' })).toBe(false);
    expect(shouldLookupPortalArea({ rawClaim: 123, currentRole: 'comprador' })).toBe(false);
  });

  it('isPortalUserClaim nao faz trim', () => {
    expect(isPortalUserClaim(' user')).toBe(false);
    expect(isPortalUserClaim('user')).toBe(true);
  });
});
