-- Soft delete columns for Supplier and QuoteRequest, plus default originPort.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Supplier_deletedAt_idx" ON "Supplier"("deletedAt");

ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "originPort" TEXT DEFAULT 'Shanghai';
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "QuoteRequest_deletedAt_idx" ON "QuoteRequest"("deletedAt");
