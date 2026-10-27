-- Aditiva e idempotente: quantidade decidida de compra por item e quinzena (PR3 do piloto do Forecast). Tabela nova, sem
-- backfill e sem tocar em dados existentes; reversivel com DROP TABLE "ForecastPurchaseDecision".
-- CreateTable
CREATE TABLE IF NOT EXISTS "ForecastPurchaseDecision" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantityKg" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'nao',
    "note" TEXT,
    "suggestedKg" DECIMAL(18,6) NOT NULL,
    "demandKg" DECIMAL(18,6) NOT NULL,
    "decidedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastPurchaseDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastPurchaseDecision_snapshotId_productId_key" ON "ForecastPurchaseDecision"("snapshotId", "productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastPurchaseDecision_productId_idx" ON "ForecastPurchaseDecision"("productId");

-- AddForeignKey (ADD CONSTRAINT nao tem IF NOT EXISTS: a guarda ignora so o objeto ja existente)
DO $$ BEGIN
  ALTER TABLE "ForecastPurchaseDecision" ADD CONSTRAINT "ForecastPurchaseDecision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ForecastPurchaseDecision" ADD CONSTRAINT "ForecastPurchaseDecision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ForecastProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
