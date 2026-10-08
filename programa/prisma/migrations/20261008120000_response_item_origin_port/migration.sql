-- AlterTable (aditiva: colunas nulas, sem default, sem backfill, sem DROP/TRUNCATE)
ALTER TABLE "QuoteResponse" ADD COLUMN "originPort" TEXT;
ALTER TABLE "QuoteResponseItem" ADD COLUMN "originPort" TEXT;
ALTER TABLE "SupplierPortalResponse" ADD COLUMN "originPort" TEXT;
ALTER TABLE "SupplierPortalResponseRevision" ADD COLUMN "originPort" TEXT;
ALTER TABLE "SupplierPortalResponseItem" ADD COLUMN "originPort" TEXT;
