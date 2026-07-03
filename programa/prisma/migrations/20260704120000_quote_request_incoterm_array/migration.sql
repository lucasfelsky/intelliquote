-- Convert QuoteRequest.desiredIncoterm from a single Incoterm value to
-- Incoterm[] (multiple incoterms the buyer will accept for this quote).
-- Existing rows keep their single value wrapped as a 1-element array.
ALTER TABLE "QuoteRequest"
  ALTER COLUMN "desiredIncoterm" TYPE "Incoterm"[]
  USING ARRAY["desiredIncoterm"];
