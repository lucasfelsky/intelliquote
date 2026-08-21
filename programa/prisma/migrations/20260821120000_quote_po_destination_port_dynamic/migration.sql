-- Torna o "Port of Destination" do template `quote_po` (Ordem de Compra)
-- dinamico -- substitui a linha chumbada "NAVEGANTES, BRAZIL." (+ a linha
-- "*FCL: ITAPOA, BRAZIL." que e' removida) pelo placeholder
-- {{destinationPort}}, resolvido a nivel da COTACAO (quoteRequest.destinationPort
-- -> primeiro item -> 'as agreed'). Guard `LIKE '%NAVEGANTES%'` torna
-- idempotente e nao sobrescreve edicao manual do admin feita apos o seed.
UPDATE "EmailTemplate"
SET
  "htmlBody" = REPLACE(
    "htmlBody",
    'Port of Destination: NAVEGANTES, BRAZIL.<br />*FCL: ITAPOA, BRAZIL.',
    'Port of Destination: {{destinationPort}}'
  ),
  "textBody" = REPLACE(
    "textBody",
    E'Port of Destination: NAVEGANTES, BRAZIL.\n*FCL: ITAPOA, BRAZIL.',
    'Port of Destination: {{destinationPort}}'
  )
WHERE "key" = 'quote_po' AND "locale" = 'en' AND "htmlBody" LIKE '%NAVEGANTES%';
