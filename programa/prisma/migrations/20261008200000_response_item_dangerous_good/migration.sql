-- AlterTable (aditiva: default false, sem backfill, nada destrutivo)
ALTER TABLE "QuoteResponseItem" ADD COLUMN "isDangerousGood" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SupplierPortalResponseItem" ADD COLUMN "isDangerousGood" BOOLEAN NOT NULL DEFAULT false;
