-- Aditiva e idempotente: PO direta do Forecast (item de preco fechado), sem cotacao. Tabela nova, sem backfill e sem tocar em dados
-- existentes; so FKs para ForecastSnapshot e ForecastProduct (ON DELETE RESTRICT). Reversivel com DROP TABLE "ForecastPurchaseOrder".
-- CreateTable
CREATE TABLE IF NOT EXISTS "ForecastPurchaseOrder" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "supplierName" TEXT NOT NULL,
    "quantityKg" DECIMAL(18,6) NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "currency" TEXT,
    "incoterm" TEXT,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enviando',
    "failureCode" TEXT,
    "createdById" INTEGER,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastPurchaseOrder_requestKey_key" ON "ForecastPurchaseOrder"("requestKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastPurchaseOrder_snapshotId_productId_idx" ON "ForecastPurchaseOrder"("snapshotId", "productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ForecastPurchaseOrder_status_idx" ON "ForecastPurchaseOrder"("status");

-- AddForeignKey (ADD CONSTRAINT nao tem IF NOT EXISTS: a guarda ignora so o objeto ja existente)
DO $$ BEGIN
  ALTER TABLE "ForecastPurchaseOrder" ADD CONSTRAINT "ForecastPurchaseOrder_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ForecastPurchaseOrder" ADD CONSTRAINT "ForecastPurchaseOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ForecastProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
