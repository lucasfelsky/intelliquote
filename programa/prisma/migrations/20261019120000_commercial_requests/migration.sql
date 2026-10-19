-- CreateEnum
CREATE TYPE "CommercialRequestStatus" AS ENUM ('pending', 'quoting', 'fulfilled', 'rejected');

-- CreateTable
CREATE TABLE "CommercialRequest" (
    "id" SERIAL NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "customerName" TEXT,
    "notes" TEXT,
    "status" "CommercialRequestStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "statusChangedById" INTEGER,
    "statusChangedAt" TIMESTAMP(3),
    "quoteRequestId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialRequestItem" (
    "id" SERIAL NOT NULL,
    "commercialRequestId" INTEGER NOT NULL,
    "catalogItemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "targetPrice" DECIMAL(12,2),
    "targetCurrency" TEXT,
    "quoteRequestItemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialRequest_requestedById_createdAt_idx" ON "CommercialRequest"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialRequest_status_createdAt_idx" ON "CommercialRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialRequest_quoteRequestId_idx" ON "CommercialRequest"("quoteRequestId");

-- CreateIndex
CREATE INDEX "CommercialRequestItem_catalogItemId_idx" ON "CommercialRequestItem"("catalogItemId");

-- CreateIndex
CREATE INDEX "CommercialRequestItem_quoteRequestItemId_idx" ON "CommercialRequestItem"("quoteRequestItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialRequestItem_commercialRequestId_catalogItemId_key" ON "CommercialRequestItem"("commercialRequestId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "CommercialRequest" ADD CONSTRAINT "CommercialRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRequest" ADD CONSTRAINT "CommercialRequest_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRequest" ADD CONSTRAINT "CommercialRequest_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRequestItem" ADD CONSTRAINT "CommercialRequestItem_commercialRequestId_fkey" FOREIGN KEY ("commercialRequestId") REFERENCES "CommercialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRequestItem" ADD CONSTRAINT "CommercialRequestItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialRequestItem" ADD CONSTRAINT "CommercialRequestItem_quoteRequestItemId_fkey" FOREIGN KEY ("quoteRequestItemId") REFERENCES "QuoteRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Papel 'comercial' (id gerado pela sequence; idempotente)
INSERT INTO "Role" ("name") VALUES ('comercial') ON CONFLICT ("name") DO NOTHING;
