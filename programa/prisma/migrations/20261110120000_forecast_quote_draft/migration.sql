-- Aditiva e idempotente: rascunho da cotacao do Forecast (E5 do relatorio de compras enxuto), um por quinzena e usuario.
-- Tabela nova, sem backfill e sem tocar em dados existentes; reversivel com DROP TABLE "ForecastQuoteDraft".
-- CreateTable
CREATE TABLE IF NOT EXISTS "ForecastQuoteDraft" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastQuoteDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastQuoteDraft_snapshotId_userId_key" ON "ForecastQuoteDraft"("snapshotId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastQuoteDraft_userId_idx" ON "ForecastQuoteDraft"("userId");

-- AddForeignKey (ADD CONSTRAINT nao tem IF NOT EXISTS: a guarda ignora so o objeto ja existente)
DO $$ BEGIN
  ALTER TABLE "ForecastQuoteDraft" ADD CONSTRAINT "ForecastQuoteDraft_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ForecastQuoteDraft" ADD CONSTRAINT "ForecastQuoteDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
