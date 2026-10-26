-- Aditiva e idempotente: tamanhos de pallet ALEM do primeiro, que continua em "packagingPalletKg".
-- Default constante (lista vazia): sem reescrita da tabela e sem backfill (o valor atual ja e o 1o/unico tamanho).
ALTER TABLE "ForecastProductCode" ADD COLUMN IF NOT EXISTS "packagingPalletExtraKg" DECIMAL(18,6)[] NOT NULL DEFAULT ARRAY[]::DECIMAL(18,6)[];
