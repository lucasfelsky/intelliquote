import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/utils/password';

vi.mock('../src/lib/prisma', () => {
  const tx = {
    companyProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    supplier: {},
    quoteRequest: {},
    quoteResponse: {},
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    __tx: tx,
  };
  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  session: { create: ReturnType<typeof vi.fn> };
  __tx: {
    companyProfile: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
};

const existingProfile = {
  id: 1,
  companyName: 'Empresa antiga',
  dispatchCc: '[]',
  awardApprovalThreshold: null,
};

async function loginAs(role: string): Promise<string> {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    name: role,
    email: `${role}@intelliquote.local`,
    passwordHash,
    isActive: true,
    role: { name: role },
  };
  prismaMock.user.findUnique.mockResolvedValue(user);
  prismaMock.user.findFirst.mockResolvedValue(user);
  prismaMock.session.create.mockImplementation(({ data }: { data: { id: string } }) =>
    Promise.resolve({ id: data.id }),
  );
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: 'ChangeMe123!' });
  if (res.status !== 200) throw new Error(`login ${role} falhou: ${res.status}`);
  return ((res.headers['set-cookie'] as string[]) ?? []).map((c) => c.split(';')[0]).join('; ');
}

describe('PUT /api/v1/company-profile', () => {
  const tx = prismaMock.__tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.companyProfile.findUnique.mockResolvedValue(existingProfile);
    tx.companyProfile.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existingProfile, ...data }),
    );
    tx.auditLog.create.mockResolvedValue({});
  });

  it('viewer recebe 403 e nada e gravado', async () => {
    const cookie = await loginAs('viewer');

    const res = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', cookie)
      .send({ companyName: 'Nova' });

    expect(res.status).toBe(403);
    expect(tx.companyProfile.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('comprador edita, mas awardApprovalThreshold e ignorado', async () => {
    const cookie = await loginAs('comprador');

    const res = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', cookie)
      .send({ companyName: 'Nova', awardApprovalThreshold: 5000 });

    expect(res.status).toBe(200);
    expect(tx.companyProfile.update).toHaveBeenCalledTimes(1);
    expect(tx.companyProfile.update.mock.calls[0][0].data.awardApprovalThreshold).toBeUndefined();
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ thresholdIgnored: true });
  });

  it.each(['gestor', 'admin'])('%s altera awardApprovalThreshold', async (role) => {
    const cookie = await loginAs(role);

    const res = await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', cookie)
      .send({ companyName: 'Nova', awardApprovalThreshold: 5000 });

    expect(res.status).toBe(200);
    expect(tx.companyProfile.update.mock.calls[0][0].data.awardApprovalThreshold).toBe(5000);
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ thresholdIgnored: false });
  });

  it('grava AuditLog company_profile/update com before e after', async () => {
    const cookie = await loginAs('admin');

    await request(app)
      .put('/api/v1/company-profile')
      .set('Cookie', cookie)
      .send({ companyName: 'Empresa nova' });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    const data = tx.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      entityType: 'company_profile',
      entityId: '1',
      action: 'update',
      performedById: 7,
    });
    expect(data.beforeData).toMatchObject({ companyName: 'Empresa antiga' });
    expect(data.afterData).toMatchObject({ companyName: 'Empresa nova' });
  });
});
