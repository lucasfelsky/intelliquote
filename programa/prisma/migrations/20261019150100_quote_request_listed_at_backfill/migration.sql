-- Backfill: reopenedAt = ultimo AuditLog 'reopen' da cotacao (AuditLog.entityId e TEXT);
-- listedAt = GREATEST(createdAt, reopenedAt) -- cotacoes ja reabertas hoje tambem sobem.
-- Idempotente: reopenedAt so preenche nulos; listedAt so muda se divergir do calculo
-- (apos um reopen real listedAt = reopenedAt, entao re-executar nao altera nada). Sem DROP/TRUNCATE.
UPDATE "QuoteRequest" qr
SET "reopenedAt" = s.reopened_at
FROM (
  SELECT al."entityId" AS entity_id, MAX(al."createdAt") AS reopened_at
  FROM "AuditLog" al
  WHERE al."entityType" = 'quote_request' AND al."action" = 'reopen'
  GROUP BY al."entityId"
) s
WHERE s.entity_id = qr."id"::text AND qr."reopenedAt" IS NULL;

-- GREATEST ignora NULL no Postgres: sem reopen, listedAt = createdAt.
UPDATE "QuoteRequest"
SET "listedAt" = GREATEST("createdAt", "reopenedAt")
WHERE "listedAt" IS DISTINCT FROM GREATEST("createdAt", "reopenedAt");
