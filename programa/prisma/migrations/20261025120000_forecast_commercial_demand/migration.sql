-- Aditiva: demanda do comercial por produto (PR 6d). Tabela nova, sem tocar em dados existentes; reversivel com DROP TABLE.
-- CreateTable
CREATE TABLE "ForecastCommercialDemand" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantityKg" DECIMAL(18,6) NOT NULL,
    "neededBy" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "customerName" TEXT,
    "commercialRequestId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'aberta',
    "closeNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForecastCommercialDemand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastCommercialDemand_status_neededBy_idx" ON "ForecastCommercialDemand"("status", "neededBy");

-- CreateIndex
CREATE INDEX "ForecastCommercialDemand_productId_status_idx" ON "ForecastCommercialDemand"("productId", "status");

-- CreateIndex
CREATE INDEX "ForecastCommercialDemand_commercialRequestId_idx" ON "ForecastCommercialDemand"("commercialRequestId");

-- AddForeignKey
ALTER TABLE "ForecastCommercialDemand" ADD CONSTRAINT "ForecastCommercialDemand_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ForecastProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

