// Boot do refresh PTAX: em producao nao dispara (o job vem do Cloud Scheduler)
// e nenhum cron em memoria eh registrado; fora de producao dispara 1x.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('../src/services/ExchangeRateService', () => ({
  ExchangeRateService: { refresh: mocks.refresh },
}));

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
  mocks.refresh.mockReset();
  mocks.refresh.mockResolvedValue([]);
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('startExchangeRateScheduler', () => {
  it('em production nao chama refresh no boot', async () => {
    process.env.NODE_ENV = 'production';
    const { startExchangeRateScheduler } = await import('../src/lib/scheduler');
    startExchangeRateScheduler();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('fora de production chama refresh 1x no boot (e nao repete)', async () => {
    process.env.NODE_ENV = 'development';
    const { startExchangeRateScheduler } = await import('../src/lib/scheduler');
    startExchangeRateScheduler();
    startExchangeRateScheduler();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('nao ha cron em memoria nem referencia a node-cron no codigo', () => {
    const root = path.resolve(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.dependencies['node-cron']).toBeUndefined();
    const sources = ['src/lib/scheduler.ts', 'src/server.ts'].map((file) =>
      fs.readFileSync(path.join(root, file), 'utf8'),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/node-cron|cron\.schedule/);
    }
    expect(fs.existsSync(path.join(root, 'src/lib/reminderScheduler.ts'))).toBe(false);
  });
});
