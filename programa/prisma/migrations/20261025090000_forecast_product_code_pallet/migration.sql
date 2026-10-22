-- Aditiva: 1 coluna nula, sem default (sem reescrita da tabela). null = codigo sem pallet fechado cadastrado.
ALTER TABLE "ForecastProductCode" ADD COLUMN "packagingPalletKg" DECIMAL(18,6);
