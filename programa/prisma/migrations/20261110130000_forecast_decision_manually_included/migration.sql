-- Aditiva e idempotente: marca a decisao de compra de um item de fora da lista de compra incluido de proposito (E3 do
-- relatorio enxuto). Coluna NOT NULL com DEFAULT false: as linhas existentes ficam false, sem backfill. Reversivel com
-- ALTER TABLE "ForecastPurchaseDecision" DROP COLUMN "manuallyIncluded".
ALTER TABLE "ForecastPurchaseDecision" ADD COLUMN IF NOT EXISTS "manuallyIncluded" BOOLEAN NOT NULL DEFAULT false;
