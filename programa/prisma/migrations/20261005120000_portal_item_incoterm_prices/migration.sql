-- AlterTable (aditiva: colunas nulas, sem default, sem DROP/TRUNCATE)
ALTER TABLE "SupplierPortalResponseItem" ADD COLUMN "incotermPrices" JSONB;
ALTER TABLE "QuoteResponseItem" ADD COLUMN "incotermPrices" JSONB;
