import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => {
  const prisma = {
    $queryRaw: vi.fn(),
  };

  return { prisma };
});

import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

const prismaMock = prisma as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
};

describe('Health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna liveness sem depender do banco', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('IntelliQuote API');
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('retorna readiness com banco saudavel', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.database).toBe('ok');
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('retorna 503 quando o banco falha na readiness', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('db down'));

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.checks.database).toBe('error');
  });
});
