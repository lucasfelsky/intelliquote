-- AlterTable (aditiva). listedAt: chave de ordenacao da lista de Cotacoes (criacao ou ultima reabertura).
-- DEFAULT CURRENT_TIMESTAMP e STABLE: no PG 11+ o ADD COLUMN e so metadado (sem rewrite). Linhas
-- existentes recebem o instante da migration e sao corrigidas pelo backfill 20261020100100.
ALTER TABLE "QuoteRequest" ADD COLUMN     "listedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reopenedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "QuoteRequest_listedAt_idx" ON "QuoteRequest"("listedAt");
