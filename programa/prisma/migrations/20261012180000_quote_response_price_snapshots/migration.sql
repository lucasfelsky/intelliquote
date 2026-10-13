-- CreateTable
CREATE TABLE "QuoteResponsePriceSnapshot" (
    "id" SERIAL NOT NULL,
    "quoteResponseId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "performedById" INTEGER,
    "supplierContactId" INTEGER,
    "actorName" TEXT,
    "currency" TEXT NOT NULL,
    "offeredIncoterm" "Incoterm" NOT NULL,
    "offeredPrice" DECIMAL(14,2) NOT NULL,
    "items" JSONB NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteResponsePriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteResponsePriceSnapshot_quoteResponseId_recordedAt_idx" ON "QuoteResponsePriceSnapshot"("quoteResponseId", "recordedAt");

-- AddForeignKey
ALTER TABLE "QuoteResponsePriceSnapshot" ADD CONSTRAINT "QuoteResponsePriceSnapshot_quoteResponseId_fkey" FOREIGN KEY ("quoteResponseId") REFERENCES "QuoteResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
