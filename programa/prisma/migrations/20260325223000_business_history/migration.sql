-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('active', 'inactive', 'blocked');

-- AlterTable
ALTER TABLE "QuoteRequest"
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "createdById" INTEGER,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "deadlineAt" TIMESTAMP(3),
ADD COLUMN "description" TEXT,
ADD COLUMN "requestCode" TEXT;

UPDATE "QuoteRequest"
SET "requestCode" = CONCAT('QR-LEGACY-', LPAD("id"::text, 4, '0'))
WHERE "requestCode" IS NULL;

ALTER TABLE "QuoteRequest"
ALTER COLUMN "requestCode" SET NOT NULL;

-- AlterTable
ALTER TABLE "QuoteResponse"
ADD COLUMN "createdById" INTEGER,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "leadTimeDays" INTEGER,
ADD COLUMN "notes" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Supplier"
ADD COLUMN "country" TEXT,
ADD COLUMN "createdById" INTEGER,
ADD COLUMN "notes" TEXT,
ADD COLUMN "status" "SupplierStatus" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "QuoteComparison" (
    "id" SERIAL NOT NULL,
    "quoteRequestId" INTEGER NOT NULL,
    "executedById" INTEGER,
    "priceWeight" INTEGER NOT NULL,
    "paymentTermsWeight" INTEGER NOT NULL,
    "incotermWeight" INTEGER NOT NULL,
    "winnerQuoteResponseId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteComparisonResult" (
    "id" SERIAL NOT NULL,
    "comparisonId" INTEGER NOT NULL,
    "quoteResponseId" INTEGER,
    "supplierId" INTEGER NOT NULL,
    "offeredPrice" DECIMAL(12,2) NOT NULL,
    "offeredIncoterm" "Incoterm" NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL,
    "priceScore" DOUBLE PRECISION NOT NULL,
    "paymentTermsScore" DOUBLE PRECISION NOT NULL,
    "incotermScore" DOUBLE PRECISION NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteComparisonResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteComparison_quoteRequestId_idx" ON "QuoteComparison"("quoteRequestId");

-- CreateIndex
CREATE INDEX "QuoteComparison_executedById_idx" ON "QuoteComparison"("executedById");

-- CreateIndex
CREATE INDEX "QuoteComparison_createdAt_idx" ON "QuoteComparison"("createdAt");

-- CreateIndex
CREATE INDEX "QuoteComparisonResult_comparisonId_idx" ON "QuoteComparisonResult"("comparisonId");

-- CreateIndex
CREATE INDEX "QuoteComparisonResult_quoteResponseId_idx" ON "QuoteComparisonResult"("quoteResponseId");

-- CreateIndex
CREATE INDEX "QuoteComparisonResult_supplierId_idx" ON "QuoteComparisonResult"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_requestCode_key" ON "QuoteRequest"("requestCode");

-- CreateIndex
CREATE INDEX "QuoteRequest_createdById_idx" ON "QuoteRequest"("createdById");

-- CreateIndex
CREATE INDEX "QuoteResponse_createdById_idx" ON "QuoteResponse"("createdById");

-- CreateIndex
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");

-- CreateIndex
CREATE INDEX "Supplier_createdById_idx" ON "Supplier"("createdById");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponse" ADD CONSTRAINT "QuoteResponse_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_winnerQuoteResponseId_fkey" FOREIGN KEY ("winnerQuoteResponseId") REFERENCES "QuoteResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComparisonResult" ADD CONSTRAINT "QuoteComparisonResult_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "QuoteComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComparisonResult" ADD CONSTRAINT "QuoteComparisonResult_quoteResponseId_fkey" FOREIGN KEY ("quoteResponseId") REFERENCES "QuoteResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
