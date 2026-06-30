import request from 'supertest';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { app } from '../src/app';
import { traceStorage } from '../src/lib/traceContext';
import { logger } from '../src/lib/logger';

describe('traceId middleware', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  afterEach(() => {
    consoleLogSpy.mockClear();
  });

  it('gera um traceId e ecoa no response header quando o cliente nao envia', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    const traceId = res.headers['x-request-id'];
    expect(traceId).toBeDefined();
    expect(traceId).toMatch(/^[A-Za-z0-9.-]+$/);
  });

  it('reusa um X-Request-Id valido enviado pelo cliente', async () => {
    const incoming = 'trace-test-12345';
    const res = await request(app).get('/health/live').set('X-Request-Id', incoming);
    expect(res.headers['x-request-id']).toBe(incoming);
  });

  it('ignora X-Request-Id com caracteres invalidos e gera um novo', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('X-Request-Id', 'has spaces and ; chars');
    const traceId = res.headers['x-request-id'];
    expect(traceId).toBeDefined();
    expect(traceId).not.toBe('has spaces and ; chars');
  });

  it('limita o traceId recebido a 128 caracteres', async () => {
    const long = 'a'.repeat(200);
    const res = await request(app).get('/health/live').set('X-Request-Id', long);
    const traceId = res.headers['x-request-id'] as string;
    expect(traceId.length).toBeLessThanOrEqual(128);
  });

  it('logger injeta traceId quando executado dentro de um contexto', () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: unknown) => { lines.push(String(line)); };
    try {
      const expected = 'ctx-abc-123';
      traceStorage.run({ traceId: expected }, () => {
        logger.info({ userId: 1 }, 'hello');
      });
      // fora do contexto, nao deve carregar traceId
      logger.info({ userId: 2 }, 'sem trace');
      expect(lines.length).toBe(2);
      const first = JSON.parse(lines[0]) as { traceId?: string; msg: string };
      const second = JSON.parse(lines[1]) as { traceId?: string; msg: string };
      expect(first.traceId).toBe(expected);
      expect(first.msg).toBe('hello');
      expect(second.traceId).toBeUndefined();
    } finally {
      console.log = original;
    }
  });

  it('logger nao injeta traceId quando executado fora de um contexto', () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: unknown) => { lines.push(String(line)); };
    try {
      logger.info({ userId: 1 }, 'isolado');
      const parsed = JSON.parse(lines[0]) as { traceId?: string };
      expect(parsed.traceId).toBeUndefined();
    } finally {
      console.log = original;
    }
  });
});
