-- AlterTable
ALTER TABLE "QuoteResponse"
ADD COLUMN "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1.0,
ADD COLUMN "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "insuranceCost" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "otherFees" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "importDuty" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "ipi" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "pis" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "cofins" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "totalLandedCost" DECIMAL(14,2) NOT NULL DEFAULT 0.0;

-- AlterTable
ALTER TABLE "QuoteComparisonResult"
ADD COLUMN "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1.0,
ADD COLUMN "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "insuranceCost" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "otherFees" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "importDutyRate" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "ipiRate" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "pisRate" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "cofinsRate" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
ADD COLUMN "cifValue" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "importDutyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "ipiAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "pisCofinsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.0,
ADD COLUMN "totalLandedCost" DECIMAL(14,2) NOT NULL DEFAULT 0.0;

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_isPrimary_idx" ON "SupplierContact"("supplierId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierContact_single_primary_per_supplier" ON "SupplierContact"("supplierId") WHERE "isPrimary" = true;

-- CreateIndex
CREATE INDEX "Attachment_entityId_entityType_idx" ON "Attachment"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Align generated schema defaults with Prisma model defaults.
ALTER TABLE "QuoteComparisonResult"
ALTER COLUMN "exchangeRate" DROP DEFAULT,
ALTER COLUMN "freightCost" DROP DEFAULT,
ALTER COLUMN "insuranceCost" DROP DEFAULT,
ALTER COLUMN "otherFees" DROP DEFAULT,
ALTER COLUMN "importDutyRate" DROP DEFAULT,
ALTER COLUMN "ipiRate" DROP DEFAULT,
ALTER COLUMN "pisRate" DROP DEFAULT,
ALTER COLUMN "cofinsRate" DROP DEFAULT,
ALTER COLUMN "cifValue" DROP DEFAULT,
ALTER COLUMN "importDutyAmount" DROP DEFAULT,
ALTER COLUMN "ipiAmount" DROP DEFAULT,
ALTER COLUMN "pisCofinsAmount" DROP DEFAULT,
ALTER COLUMN "totalLandedCost" DROP DEFAULT;
