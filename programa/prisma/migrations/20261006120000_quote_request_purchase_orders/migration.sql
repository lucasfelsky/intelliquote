-- CreateTable
CREATE TABLE "QuoteRequestPurchaseOrder" (
  "id" SERIAL PRIMARY KEY,
  "quoteRequestId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteRequestPurchaseOrder_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId")
    REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QuoteRequestPurchaseOrder_quoteRequestId_position_idx"
  ON "QuoteRequestPurchaseOrder"("quoteRequestId", "position");

-- AlterTable
ALTER TABLE "QuoteRequestItem" ADD COLUMN "purchaseOrderId" INTEGER;

-- AddForeignKey
ALTER TABLE "QuoteRequestItem" ADD CONSTRAINT "QuoteRequestItem_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "QuoteRequestPurchaseOrder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "QuoteRequestItem_purchaseOrderId_idx" ON "QuoteRequestItem"("purchaseOrderId");
