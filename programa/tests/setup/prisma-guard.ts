// Setup global do Vitest (vitest.config.ts > setupFiles): roda antes de cada arquivo de teste.
//
// `src/lib/prisma.ts` faz `global.__prisma__ ?? new PrismaClient()`. Sem banco (suite unitaria),
// todo teste que importa um service/rota sem `vi.mock('../src/lib/prisma')` construia o client real,
// e o construtor do Prisma 6 dispara em segundo plano a carga da library engine (N-API) e o
// `new QueryEngine(...)`. Em `--pool=threads` o Vitest encerra o worker assim que o arquivo termina
// (testes de ~15-30 ms); se o encerramento cai no meio dessa construcao, o Rust recebe
// `PendingException`, entra em panic (engine.rs:76) e derruba o processo inteiro (exit 134).
//
// Aqui entregamos um stub em `global.__prisma__`: o client real nunca e' construido nos testes
// unitarios e qualquer uso acidental falha com mensagem clara (em vez de tentar conectar).
// Os testes *-db (RUN_DB_TESTS=true, via scripts/test-critical-local.mjs) seguem com o client real.

if (process.env.RUN_DB_TESTS !== 'true') {
  const stub = new Proxy(
    {},
    {
      get(_target, prop) {
        // `then`/symbols: sondagens de await/inspect/pretty-format nao podem lancar.
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
        throw new Error(
          `PrismaClient real acessado (prisma.${String(prop)}) num teste unitario. ` +
            "Use vi.mock('../src/lib/prisma'), injete um client fake ou rode como teste *-db (RUN_DB_TESTS=true).",
        );
      },
    },
  );
  (globalThis as { __prisma__?: unknown }).__prisma__ = stub;
}
