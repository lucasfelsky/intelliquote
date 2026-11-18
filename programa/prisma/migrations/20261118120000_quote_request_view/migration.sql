-- Aditiva e idempotente: "visto por usuario" das cotacoes (destaque "Nova resposta" na lista). Tabela nova + backfill de baseline
-- (todo par usuario COMEX x cotacao ativa recebe lastSeenAt = agora, para o selo nao acender no historico inteiro no dia do deploy).
-- Reversivel com DROP TABLE "QuoteRequestView".
-- CreateTable
CREATE TABLE IF NOT EXISTS "QuoteRequestView" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "quoteRequestId" INTEGER NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequestView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteRequestView_userId_quoteRequestId_key" ON "QuoteRequestView"("userId", "quoteRequestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QuoteRequestView_quoteRequestId_idx" ON "QuoteRequestView"("quoteRequestId");

-- AddForeignKey (ADD CONSTRAINT nao tem IF NOT EXISTS: a guarda ignora so o objeto ja existente)
DO $$ BEGIN
  ALTER TABLE "QuoteRequestView" ADD CONSTRAINT "QuoteRequestView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "QuoteRequestView" ADD CONSTRAINT "QuoteRequestView_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Baseline: usuarios que veem a lista (admin/comprador/gestor/viewer) x cotacoes nao apagadas.
INSERT INTO "QuoteRequestView" ("userId", "quoteRequestId", "lastSeenAt")
SELECT u."id", q."id", CURRENT_TIMESTAMP
FROM "User" u
JOIN "Role" r ON r."id" = u."roleId"
CROSS JOIN "QuoteRequest" q
WHERE q."deletedAt" IS NULL
  AND r."name" IN ('admin', 'comprador', 'gestor', 'viewer')
ON CONFLICT ("userId", "quoteRequestId") DO NOTHING;
