// Regra de login Firebase (D1 do PR1 "Solicitacoes do comercial"):
// `comercial` e' papel fixo do banco -- o claim do Portal nao o reverte.
// Para os demais papeis o claim continua reconciliando (comportamento anterior).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyIdTokenMock } = vi.hoisted(() => ({ verifyIdTokenMock: vi.fn() }));

vi.mock('firebase-admin/app', () => ({
  cert: vi.fn(),
  getApp: vi.fn(),
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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
import { resolveFirebaseLoginRole } from '../src/constants/roles';

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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

function existingUser(roleName: string) {
  return {
    id: 77,
    name: 'Fulano',
    email: 'fulano@sqquimica.com',
    isActive: true,
    roleId: ROLE_IDS[roleName],
    role: { name: roleName },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.role.findUnique.mockImplementation(async ({ where }: { where: { name: string } }) => ({
    id: ROLE_IDS[where.name],
    name: where.name,
  }));
  prismaMock.session.create.mockResolvedValue({ id: 'session-1' });
  prismaMock.user.update.mockImplementation(
    async ({ data }: { data: { roleId: number } }) => {
      const name = Object.entries(ROLE_IDS).find(([, id]) => id === data.roleId)?.[0] ?? 'comprador';
      return existingUser(name);
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
    prismaMock.user.findUnique.mockResolvedValue(existingUser('comercial'));
    prismaMock.user.findFirst.mockResolvedValue(existingUser('comercial'));

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('(b) existente comercial sem claim: mantem comercial', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken());
    prismaMock.user.findUnique.mockResolvedValue(existingUser('comercial'));
    prismaMock.user.findFirst.mockResolvedValue(existingUser('comercial'));

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('(c) existente comprador + claim admin: claim reconcilia (comportamento atual preservado)', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    prismaMock.user.findUnique.mockResolvedValue(existingUser('comprador'));
    prismaMock.user.findFirst.mockResolvedValue(existingUser('comprador'));

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('admin');
    // O tryFirebaseAuth global tambem roda com Bearer: todas as atualizacoes vao para admin.
    expect(prismaMock.user.update).toHaveBeenCalled();
    for (const [args] of prismaMock.user.update.mock.calls) {
      expect(args.data).toEqual({ roleId: ROLE_IDS.admin });
    }
  });

  it('(c2) existente admin sem claim: rebaixa para comprador como antes', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken());
    prismaMock.user.findUnique.mockResolvedValue(existingUser('admin'));
    prismaMock.user.findFirst.mockResolvedValue(existingUser('admin'));

    const response = await exchange();

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('comprador');
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('(d) usuario novo sem claim: nasce comprador', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken());
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
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
    prismaMock.user.findFirst.mockResolvedValue(existingUser('comercial'));

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.user.role).toBe('comercial');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('(e2) whoami: existente comprador + claim admin reconcilia para admin', async () => {
    verifyIdTokenMock.mockResolvedValue(decodedToken('admin'));
    prismaMock.user.findFirst.mockResolvedValue(existingUser('comprador'));

    const response = await request(app)
      .get('/api/v1/whoami')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('admin');
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
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
