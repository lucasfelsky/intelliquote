-- AlterTable
ALTER TABLE "QuoteComparison" ADD COLUMN     "qualityWeight" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "QuoteComparisonResult" ADD COLUMN     "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0;
