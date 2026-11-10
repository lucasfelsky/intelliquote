-- Aditiva e idempotente (E4a do relatorio de compras enxuto): vinculo cotacao <-> Forecast e Qtd. final da decisao.
-- So colunas ANULAVEIS e um indice: sem backfill, sem FK, sem mudar linhas existentes. Itens e decisoes antigos ficam com
-- os campos novos nulos e continuam como estavam.
-- Reversivel (rollback) com:
--   DROP INDEX IF EXISTS "QuoteRequestItem_forecastSnapshotId_forecastProductId_idx";
--   ALTER TABLE "QuoteRequestItem" DROP COLUMN "forecastSnapshotId", DROP COLUMN "forecastProductId";
--   ALTER TABLE "ForecastPurchaseDecision" DROP COLUMN "finalKg", DROP COLUMN "finalAt", DROP COLUMN "finalQuoteRequestId";
ALTER TABLE "QuoteRequestItem" ADD COLUMN IF NOT EXISTS "forecastSnapshotId" INTEGER;
ALTER TABLE "QuoteRequestItem" ADD COLUMN IF NOT EXISTS "forecastProductId" INTEGER;
CREATE INDEX IF NOT EXISTS "QuoteRequestItem_forecastSnapshotId_forecastProductId_idx"
  ON "QuoteRequestItem"("forecastSnapshotId", "forecastProductId");

ALTER TABLE "ForecastPurchaseDecision" ADD COLUMN IF NOT EXISTS "finalKg" DECIMAL(18,6);
ALTER TABLE "ForecastPurchaseDecision" ADD COLUMN IF NOT EXISTS "finalAt" TIMESTAMP(3);
ALTER TABLE "ForecastPurchaseDecision" ADD COLUMN IF NOT EXISTS "finalQuoteRequestId" INTEGER;
