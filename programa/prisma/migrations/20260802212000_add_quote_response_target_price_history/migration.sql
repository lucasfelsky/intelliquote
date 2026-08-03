-- CreateTable
CREATE TABLE "QuoteResponseTargetPriceHistory" (
    "id" SERIAL NOT NULL,
    "quoteResponseId" INTEGER NOT NULL,
    "targetPrice" DECIMAL(12,2) NOT NULL,
    "sentById" INTEGER,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteResponseTargetPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteResponseTargetPriceHistory_quoteResponseId_idx" ON "QuoteResponseTargetPriceHistory"("quoteResponseId");

-- CreateIndex
CREATE INDEX "QuoteResponseTargetPriceHistory_sentAt_idx" ON "QuoteResponseTargetPriceHistory"("sentAt");

-- AddForeignKey
ALTER TABLE "QuoteResponseTargetPriceHistory" ADD CONSTRAINT "QuoteResponseTargetPriceHistory_quoteResponseId_fkey" FOREIGN KEY ("quoteResponseId") REFERENCES "QuoteResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteResponseTargetPriceHistory" ADD CONSTRAINT "QuoteResponseTargetPriceHistory_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
