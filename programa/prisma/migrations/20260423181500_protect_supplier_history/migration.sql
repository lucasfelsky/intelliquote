-- Prevent supplier deletions from cascading through quote history.
ALTER TABLE "QuoteResponse" DROP CONSTRAINT "QuoteResponse_supplierId_fkey";

ALTER TABLE "QuoteResponse"
ADD CONSTRAINT "QuoteResponse_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
