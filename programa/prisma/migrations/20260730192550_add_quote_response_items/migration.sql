-- AlterTable
ALTER TABLE "CatalogItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "QuoteResponse" ADD COLUMN     "targetPrice" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "QuoteResponseItem" (
    "id" SERIAL NOT NULL,
    "quoteResponseId" INTEGER NOT NULL,
    "quoteRequestItemId" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QuoteResponseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteResponseItem_quoteResponseId_idx" ON "QuoteResponseItem"("quoteResponseId");

-- CreateIndex
CREATE INDEX "QuoteResponseItem_quoteRequestItemId_idx" ON "QuoteResponseItem"("quoteRequestItemId");

-- CreateIndex
CREATE INDEX "QuoteResponseItem_deletedAt_idx" ON "QuoteResponseItem"("deletedAt");

-- AddForeignKey
ALTER TABLE "QuoteResponseItem" ADD CONSTRAINT "QuoteResponseItem_quoteResponseId_fkey" FOREIGN KEY ("quoteResponseId") REFERENCES "QuoteResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponseItem" ADD CONSTRAINT "QuoteResponseItem_quoteRequestItemId_fkey" FOREIGN KEY ("quoteRequestItemId") REFERENCES "QuoteRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
