-- Aditiva: marca "compra sob demanda" por produto (default constante: sem reescrita da tabela) + motivo opcional.
ALTER TABLE "ForecastProduct" ADD COLUMN "purchaseOnDemand" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "purchaseOnDemandNote" TEXT;
