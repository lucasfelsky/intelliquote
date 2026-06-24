-- Destino e INCOTERM por item: campos opcionais que, quando vazios, herdam
-- do cabecalho da QuoteRequest. Necessario para que o portal do fornecedor
-- e o e-mail de cotacao mostrem INCOTERM/destination por linha, com fallback
-- para o valor da cotacao quando o item nao sobrescreve.

ALTER TABLE "QuoteRequest"
  ADD COLUMN IF NOT EXISTS "destinationPort" TEXT;

ALTER TABLE "QuoteRequestItem"
  ADD COLUMN IF NOT EXISTS "desiredIncoterm" "Incoterm",
  ADD COLUMN IF NOT EXISTS "destinationPort" TEXT;