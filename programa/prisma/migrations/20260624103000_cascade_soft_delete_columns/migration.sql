-- Soft delete + indices para cascade delete de QuoteRequest.
-- Necessario para que QuoteRequestController.delete consiga marcar
-- `deletedAt` em QuoteRequestItem, QuoteResponse, SupplierPortalResponse
-- e SupplierPortalResponseItem sem quebrar as queries por coluna inexistente.

ALTER TABLE "QuoteRequestItem"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "QuoteRequestItem_deletedAt_idx" ON "QuoteRequestItem"("deletedAt");

ALTER TABLE "QuoteResponse"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "QuoteResponse_deletedAt_idx" ON "QuoteResponse"("deletedAt");

ALTER TABLE "SupplierPortalResponse"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "SupplierPortalResponse_deletedAt_idx" ON "SupplierPortalResponse"("deletedAt");

ALTER TABLE "SupplierPortalResponseItem"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "SupplierPortalResponseItem_deletedAt_idx" ON "SupplierPortalResponseItem"("deletedAt");
