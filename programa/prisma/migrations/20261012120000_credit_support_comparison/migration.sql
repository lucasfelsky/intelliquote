-- AlterTable
ALTER TABLE "QuoteComparison" ADD COLUMN     "winnerCreditSupportRequestId" INTEGER;

-- AlterTable
ALTER TABLE "QuoteComparisonResult" ADD COLUMN     "creditSupportRequestId" INTEGER;

-- AlterTable
ALTER TABLE "CreditSupportRequest" ADD COLUMN     "isWinner" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "QuoteComparison_winnerCreditSupportRequestId_idx" ON "QuoteComparison"("winnerCreditSupportRequestId");

-- CreateIndex
CREATE INDEX "QuoteComparisonResult_creditSupportRequestId_idx" ON "QuoteComparisonResult"("creditSupportRequestId");

-- CreateIndex
CREATE INDEX "CreditSupportRequest_quoteRequestId_isWinner_idx" ON "CreditSupportRequest"("quoteRequestId", "isWinner");

-- AddForeignKey
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_winnerCreditSupportRequestId_fkey" FOREIGN KEY ("winnerCreditSupportRequestId") REFERENCES "CreditSupportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteComparisonResult" ADD CONSTRAINT "QuoteComparisonResult_creditSupportRequestId_fkey" FOREIGN KEY ("creditSupportRequestId") REFERENCES "CreditSupportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
