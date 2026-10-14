import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';

// Trava o setup tests/setup/prisma-guard.ts: na suite unitaria `src/lib/prisma` devolve o stub,
// entao o PrismaClient real (e a library engine N-API) nunca sobe dentro dos worker threads.
describe.skipIf(process.env.RUN_DB_TESTS === 'true')('prisma guard (suite unitaria)', () => {
  it('src/lib/prisma devolve o stub global, nao um PrismaClient real', () => {
    expect(prisma).toBe((globalThis as { __prisma__?: unknown }).__prisma__);
    expect(() => prisma.user).toThrow(/PrismaClient real acessado \(prisma\.user\)/);
  });

  it('sondagens de await/inspect nao lancam', async () => {
    expect((prisma as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(prisma)).resolves.toBe(prisma);
    expect(() => String(Object.prototype.toString.call(prisma))).not.toThrow();
  });
});
