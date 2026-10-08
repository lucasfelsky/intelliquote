-- AlterTable (aditiva: default false, sem backfill, sem DROP/TRUNCATE)
ALTER TABLE "QuoteResponseItem" ADD COLUMN "isUnavailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SupplierPortalResponseItem" ADD COLUMN "isUnavailable" BOOLEAN NOT NULL DEFAULT false;
