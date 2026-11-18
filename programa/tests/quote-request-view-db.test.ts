import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';

const run = process.env.RUN_DB_TESTS === 'true';

describe.skipIf(!run)('QuoteRequestView em Postgres isolado', () => {
  let prisma: any;
  let service: any;
  let roleId: number;
  let createdRoleId: number | null = null;
  let supplierId: number;
  const userIds: number[] = [];
  const tag = `VIEW-${Date.now()}`;

  async function createUser(key: string): Promise<number> {
    const user = await prisma.user.create({
      data: {
        name: `${tag}-${key}`,
        email: `${tag.toLowerCase()}-${key}@local.test`,
        passwordHash: await hashPassword('Test12345!'),
        roleId,
      },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function createQuote(key: string, extra: Record<string, unknown> = {}): Promise<any> {
    return prisma.quoteRequest.create({
      data: { requestCode: `${tag}-${key}`, desiredIncoterm: ['FOB'], currency: 'USD', ...extra },
    });
  }

  async function createResponse(quoteRequestId: number): Promise<any> {
    return prisma.quoteResponse.create({
      data: {
        quoteRequestId,
        supplierId,
        offeredPrice: 10,
        offeredIncoterm: 'FOB',
        paymentTermsDays: 30,
      },
    });
  }

  async function createSnapshot(
    quoteResponseId: number,
    source: 'manual' | 'portal',
    performedById: number | null,
    recordedAt: Date,
  ): Promise<void> {
    await prisma.quoteResponsePriceSnapshot.create({
      data: {
        quoteResponseId,
        source,
        performedById,
        currency: 'USD',
        offeredIncoterm: 'FOB',
        offeredPrice: 10,
        items: [],
        recordedAt,
      },
    });
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/iq_critical_test') {
      throw new Error('Execute scripts/test-critical-local.mjs para usar um banco descartavel.');
    }
    ({ prisma } = await import('../src/lib/prisma'));
    ({ QuoteRequestViewService: service } = await import('../src/services/QuoteRequestViewService'));

    // Os arquivos de teste de banco compartilham o mesmo Postgres em sequencia.
    const existing = await prisma.role.findUnique({ where: { name: 'comprador' } });
    const role = await prisma.role.upsert({
      where: { name: 'comprador' },
      update: {},
      create: { name: 'comprador' },
    });
    if (!existing) createdRoleId = role.id;
    roleId = role.id;

    const supplier = await prisma.supplier.create({ data: { name: `${tag}-fornecedor` } });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    if (prisma) {
      // QuoteResponse, snapshots e views saem em cascata junto com a cotacao e o usuario.
      await prisma.quoteRequest.deleteMany({ where: { requestCode: { startsWith: tag } } });
      await prisma.supplier.deleteMany({ where: { name: { startsWith: tag } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (createdRoleId) {
        await prisma.role.deleteMany({ where: { id: createdRoleId, users: { none: {} } } });
      }
    }
    await prisma?.$disconnect();
  });

  it('snapshot manual com performedById null conta como resposta nova', async () => {
    const userId = await createUser('null-author');
    const quote = await createQuote('null-author');
    const response = await createResponse(quote.id);
    await prisma.quoteRequestView.create({
      data: { userId, quoteRequestId: quote.id, lastSeenAt: new Date(Date.now() - 3_600_000) },
    });
    await createSnapshot(response.id, 'manual', null, new Date(Date.now() - 60_000));

    const ids = await service.findIdsWithNewResponses(userId, [quote.id], prisma);

    expect([...ids]).toEqual([quote.id]);
  });

  it('snapshot manual do proprio usuario nao conta e o de outro usuario conta', async () => {
    const userId = await createUser('own-manual');
    const otherId = await createUser('other-manual');
    const own = await createQuote('own-manual-own');
    const theirs = await createQuote('own-manual-theirs');
    const ownResponse = await createResponse(own.id);
    const theirsResponse = await createResponse(theirs.id);
    const past = new Date(Date.now() - 3_600_000);
    await prisma.quoteRequestView.createMany({
      data: [
        { userId, quoteRequestId: own.id, lastSeenAt: past },
        { userId, quoteRequestId: theirs.id, lastSeenAt: past },
      ],
    });
    await createSnapshot(ownResponse.id, 'manual', userId, new Date(Date.now() - 60_000));
    await createSnapshot(theirsResponse.id, 'manual', otherId, new Date(Date.now() - 60_000));

    const ids = await service.findIdsWithNewResponses(userId, [own.id, theirs.id], prisma);

    expect([...ids]).toEqual([theirs.id]);
  });

  it('primeira listagem sem view grava baseline, nao acende e e idempotente', async () => {
    const userId = await createUser('baseline');
    const raceUserId = await createUser('baseline-race');
    const active = await createQuote('baseline-active');
    const deleted = await createQuote('baseline-deleted', { deletedAt: new Date() });
    const response = await createResponse(active.id);
    await createSnapshot(response.id, 'portal', null, new Date(Date.now() - 60_000));

    const first = await service.findIdsWithNewResponses(userId, [active.id], prisma);

    expect(first.size).toBe(0);
    const activeCount = await prisma.quoteRequest.count({ where: { deletedAt: null } });
    expect(await prisma.quoteRequestView.count({ where: { userId } })).toBe(activeCount);
    expect(await prisma.quoteRequestView.count({ where: { userId, quoteRequestId: deleted.id } })).toBe(0);

    // Corrida: duas listagens simultaneas de um usuario sem nenhuma view nao lancam nem duplicam.
    const [raceA, raceB] = await Promise.all([
      service.findIdsWithNewResponses(raceUserId, [active.id], prisma),
      service.findIdsWithNewResponses(raceUserId, [active.id], prisma),
    ]);
    expect(raceA.size).toBe(0);
    expect(raceB.size).toBe(0);
    expect(await prisma.quoteRequestView.count({ where: { userId: raceUserId } })).toBe(activeCount);

    // Resposta gravada depois do baseline acende.
    await createSnapshot(response.id, 'portal', null, new Date(Date.now() + 60_000));
    const after = await service.findIdsWithNewResponses(userId, [active.id], prisma);
    expect([...after]).toEqual([active.id]);
  });
});
