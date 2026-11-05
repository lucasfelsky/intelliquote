import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dados SINTETICOS (repo publico).
vi.mock('../src/lib/prisma', () => {
  const prisma = {
    auditLog: { create: vi.fn() },
    catalogItem: { findUnique: vi.fn(), findMany: vi.fn() },
    forecastProductCode: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    forecastProduct: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma };
});

import { prisma } from '../src/lib/prisma';
import { aplicarBackfill } from '../src/services/CatalogItemForecastLinkService';

type Mock = ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  auditLog: { create: Mock };
  catalogItem: { findUnique: Mock; findMany: Mock };
  forecastProductCode: Record<'findUnique' | 'findMany' | 'create' | 'updateMany' | 'update', Mock>;
  forecastProduct: { findUnique: Mock };
  $executeRaw: Mock;
  $transaction: Mock;
};

const LINHA = { linha: 2, catalogItemId: 7, codigo: 'TST9400', produtoId: 5 };

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.catalogItem.findUnique.mockResolvedValue({ id: 7, isActive: true, dbcorpCode: 'TST9400' });
  prismaMock.catalogItem.findMany.mockResolvedValue([]);
  prismaMock.forecastProductCode.findUnique.mockResolvedValue(null);
  prismaMock.forecastProductCode.findMany.mockResolvedValue([]);
  prismaMock.forecastProductCode.create.mockImplementation(
    async ({ data }: { data: { position: number; code: string } }) => ({ id: 900 + data.position, ...data }),
  );
  prismaMock.forecastProduct.findUnique.mockResolvedValue({ id: 5, isActive: true, origin: 'dbcorp', codes: [] });
});

// Ordem global (invocationCallOrder) das chamadas de $executeRaw que sao a advisory lock do import.
function ordensDaLockDoImport(): number[] {
  return prismaMock.$executeRaw.mock.calls.flatMap((call, i) => {
    const [sql, ...valores] = call as [readonly string[], ...unknown[]];
    const ehAdvisoryLock = sql.join('').includes('pg_advisory_xact_lock(');
    return ehAdvisoryLock && valores.includes('forecast:import') ? [prismaMock.$executeRaw.mock.invocationCallOrder[i]] : [];
  });
}

// Primeira chamada (ordem global) entre todas as leituras/gravacoes de produto, codigo, item e auditoria.
function primeiraLeituraOuGravacao(): number {
  const mocks: Mock[] = [
    prismaMock.catalogItem.findUnique,
    prismaMock.catalogItem.findMany,
    prismaMock.forecastProduct.findUnique,
    prismaMock.forecastProductCode.findUnique,
    prismaMock.forecastProductCode.findMany,
    prismaMock.forecastProductCode.create,
    prismaMock.forecastProductCode.update,
    prismaMock.forecastProductCode.updateMany,
    prismaMock.auditLog.create,
  ];
  return Math.min(...mocks.flatMap((m) => m.mock.invocationCallOrder));
}

// Mutante: tirar `travarImportForecast(tx)` de aplicarBackfill. O backfill grava em ForecastProductCode e precisa
// serializar com o import do Forecast (advisory lock `forecast:import`), dentro da transacao e ANTES de qualquer
// leitura/gravacao de item, produto ou codigo. Vale nos dois modos (dry-run desfaz no fim, mas ja leu e simulou).
describe.each([
  { gravar: false, modo: 'dry-run (rollback forcado)' },
  { gravar: true, modo: '--gravar' },
])('aplicarBackfill - advisory lock forecast:import, $modo', ({ gravar }) => {
  it('adquire a lock dentro da transacao, antes de ler ou gravar item, produto e codigo', async () => {
    const relatorio = await aplicarBackfill([LINHA], { gravar });

    expect(relatorio).toMatchObject({ gravar, contagem: { aplicado: 1, erro: 0 } });
    // O caminho percorreu leitura e gravacao: sem isso a comparacao de ordem seria vazia.
    expect(prismaMock.catalogItem.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.forecastProduct.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.forecastProductCode.create).toHaveBeenCalledTimes(1);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.any(Object));
    const ordens = ordensDaLockDoImport();
    expect(ordens.length).toBeGreaterThanOrEqual(1);
    const [ordemTransacao] = prismaMock.$transaction.mock.invocationCallOrder;
    expect(ordemTransacao).toBeLessThan(ordens[0]);
    expect(ordens[0]).toBeLessThan(primeiraLeituraOuGravacao());
    expect(ordens[0]).toBeLessThan(prismaMock.forecastProduct.findUnique.mock.invocationCallOrder[0]);
    expect(ordens[0]).toBeLessThan(prismaMock.forecastProductCode.create.mock.invocationCallOrder[0]);
  });

  it('lista vazia: a lock ainda e adquirida (nao depende de ter linha a aplicar)', async () => {
    const relatorio = await aplicarBackfill([], { gravar });

    expect(relatorio.contagem.aplicado).toBe(0);
    expect(ordensDaLockDoImport().length).toBeGreaterThanOrEqual(1);
    expect(prismaMock.forecastProductCode.create).not.toHaveBeenCalled();
  });
});
