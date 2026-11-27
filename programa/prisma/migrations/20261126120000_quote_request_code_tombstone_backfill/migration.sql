-- Backfill (so dados): aplica o tombstone `<codigo>#del<id>` nas cotacoes ja excluidas (soft delete),
-- liberando o codigo original no indice unico global "QuoteRequest_requestCode_key".
-- Idempotente: linhas que ja terminam em '#del<id>' nao mudam (2a execucao = 0 linhas).
-- Sem DROP/TRUNCATE e sem mudanca de schema.
UPDATE "QuoteRequest"
SET "requestCode" = "requestCode" || '#del' || "id"::text
WHERE "deletedAt" IS NOT NULL
  AND "requestCode" NOT LIKE ('%#del' || "id"::text);
