-- Backfill: marca cotacoes cuja PO ja foi enviada (MailLog 'quote-po').
-- 'queued' conta (e-mail enviado com falha so na atualizacao do log); failed/bounced/suppressed nao.
-- Idempotente: so preenche nulos. Sem DROP/TRUNCATE.
UPDATE "QuoteRequest" qr
SET "purchaseOrderSentAt" = s.sent_at
FROM (
  SELECT r."quoteRequestId" AS qr_id, MAX(COALESCE(m."sentAt", m."createdAt")) AS sent_at
  FROM "MailLog" m
  JOIN "QuoteResponse" r ON m."relatedEntityId" = r."id"::text
  WHERE m."templateId" = 'quote-po'
    AND m."relatedEntityType" = 'quote_response'
    AND m."status" IN ('sent', 'queued')
  GROUP BY r."quoteRequestId"
) s
WHERE qr."id" = s.qr_id AND qr."purchaseOrderSentAt" IS NULL;
