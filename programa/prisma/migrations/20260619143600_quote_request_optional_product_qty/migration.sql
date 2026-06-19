-- Relax productName/quantity on QuoteRequest: now optional,
-- derived from the first item's catalogItem commercialName/quantity at the API layer.

ALTER TABLE "QuoteRequest"
  ALTER COLUMN "productName" DROP NOT NULL,
  ALTER COLUMN "quantity" DROP NOT NULL;
