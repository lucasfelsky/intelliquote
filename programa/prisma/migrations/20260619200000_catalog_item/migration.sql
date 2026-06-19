-- CatalogItem: master data de itens comercializados pela empresa.
-- Permite que o cadastro de cotacao (QuoteRequestItem) referencie um item canonico
-- (FK catalogItemId), garantindo que nome comercial, NCM, codigo DBCorp e flag DG
-- sejam consistentes entre cotacoes e entre fornecedores.
CREATE TABLE "CatalogItem" (
  "id"              SERIAL PRIMARY KEY,
  "commercialName"  TEXT NOT NULL,
  "marketName"      TEXT NOT NULL,
  "ncm"             TEXT,
  "dbcorpCode"      TEXT,
  "isDangerousGood" BOOLEAN NOT NULL DEFAULT FALSE,
  "notes"           TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "CatalogItem_marketName_key" ON "CatalogItem"("marketName");
CREATE INDEX "CatalogItem_marketName_idx" ON "CatalogItem"("marketName");
CREATE INDEX "CatalogItem_commercialName_idx" ON "CatalogItem"("commercialName");
CREATE INDEX "CatalogItem_isDangerousGood_idx" ON "CatalogItem"("isDangerousGood");

-- FK opcional em QuoteRequestItem (SetNull para nao quebrar dados existentes).
ALTER TABLE "QuoteRequestItem"
  ADD COLUMN "catalogItemId" INTEGER,
  ADD CONSTRAINT "QuoteRequestItem_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "QuoteRequestItem_catalogItemId_idx" ON "QuoteRequestItem"("catalogItemId");
