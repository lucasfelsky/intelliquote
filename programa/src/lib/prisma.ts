import { PrismaClient } from '@prisma/client';

declare global {
  // Reutiliza a mesma instancia em ambiente de desenvolvimento.
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

const prisma = global.__prisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma__ = prisma;
}

export { prisma };
