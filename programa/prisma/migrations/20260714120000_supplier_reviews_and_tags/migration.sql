-- F12 (backlog 2026-07-12): avaliacao de fornecedor por dimensoes
-- (preco/prazo/qualidade) + etiquetas livres (tags) no fornecedor.

-- 1) Tags do fornecedor (lista de strings; default vazio para linhas existentes).
ALTER TABLE "Supplier"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2) Avaliacao do vencedor capturada ao concluir a cotacao. 1 review por
--    cotacao (unique em quoteRequestId).
CREATE TABLE "SupplierReview" (
  "id" SERIAL NOT NULL,
  "supplierId" INTEGER NOT NULL,
  "quoteRequestId" INTEGER NOT NULL,
  "priceRating" INTEGER NOT NULL,
  "leadTimeRating" INTEGER NOT NULL,
  "qualityRating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierReview_quoteRequestId_key"
  ON "SupplierReview"("quoteRequestId");

CREATE INDEX "SupplierReview_supplierId_idx"
  ON "SupplierReview"("supplierId");

CREATE INDEX "SupplierReview_createdById_idx"
  ON "SupplierReview"("createdById");

ALTER TABLE "SupplierReview"
  ADD CONSTRAINT "SupplierReview_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierReview"
  ADD CONSTRAINT "SupplierReview_quoteRequestId_fkey"
  FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierReview"
  ADD CONSTRAINT "SupplierReview_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
