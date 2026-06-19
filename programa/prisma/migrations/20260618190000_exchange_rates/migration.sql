-- Cotacao de cambio diaria obtida via PTAX do Banco Central do Brasil.
-- Codigos de serie (SGS):
--   1     = USD (taxa de compra, R$ por 1 USD)
--   21619 = EUR
--   21620 = GBP
--   21621 = JPY (cents por BRL; tratar separadamente - valor/100)
--   21622 = CHF
--   21623 = CNY
-- Aqui armazenamos apenas o "rateToBrl" ja normalizado para BRL por 1 unidade
-- da moeda estrangeira, que eh o formato usado internamente para o
-- calculo de custo landed.
CREATE TABLE IF NOT EXISTS "ExchangeRate" (
    "id"           SERIAL PRIMARY KEY,
    "currency"     TEXT NOT NULL,
    "rateToBrl"    DECIMAL(14, 6) NOT NULL,
    "referenceDate" DATE NOT NULL,
    "fetchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source"       TEXT NOT NULL DEFAULT 'BCB_PTAX',
    UNIQUE ("currency", "referenceDate")
);

CREATE INDEX IF NOT EXISTS "ExchangeRate_currency_idx" ON "ExchangeRate" ("currency");
CREATE INDEX IF NOT EXISTS "ExchangeRate_fetchedAt_idx" ON "ExchangeRate" ("fetchedAt");
