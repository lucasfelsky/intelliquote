-- Aditiva: 2 colunas nulas, sem default (sem reescrita da tabela). null = padrao 35 dias na estimativa do FUP.
ALTER TABLE "ForecastSource" ADD COLUMN "arrivalFromReadinessDays" INTEGER,
ADD COLUMN "arrivalFromEtdDays" INTEGER;
