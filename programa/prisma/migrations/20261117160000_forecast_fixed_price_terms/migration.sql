-- Aditiva e idempotente: termos do preco fechado do Forecast (moeda, incoterm e validade) ao lado de "ForecastProduct"."fixedPrice".
-- Colunas novas, todas nulas e sem default: sem backfill e sem reescrita da tabela; o import da planilha nao as grava.
-- Reversivel com DROP COLUMN das tres colunas.
ALTER TABLE "ForecastProduct" ADD COLUMN IF NOT EXISTS "fixedPriceCurrency" TEXT;
ALTER TABLE "ForecastProduct" ADD COLUMN IF NOT EXISTS "fixedPriceIncoterm" "Incoterm";
ALTER TABLE "ForecastProduct" ADD COLUMN IF NOT EXISTS "fixedPriceValidUntil" DATE;
